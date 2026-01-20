import { defaultVertexShader } from 't3d-effect-composer';
import { definitions } from './bruneton/definitions.js';
import { defines } from './helpers/defines.js';
import { raySphereIntersection } from './helpers/raySphereIntersection.js';
import { common } from './bruneton/common.js';
import { runtime } from './bruneton/runtime.js';
import { AtmosParameters } from '../AtmosParameters.js';
import { tonemapping } from './helpers/tonemapping.js';

const types = /* glsl */`
struct GroundIrradiance {
	vec3 sun;
	vec3 sky;
};

struct CloudsIrradiance {
	vec3 minSun;
	vec3 minSky;
	vec3 maxSun;
	vec3 maxSky;
};

struct CloudDensityProfile {
	vec4 expTerms;
	vec4 exponents;
	vec4 linearTerms;
	vec4 constantTerms;
};
`;

const parameters = /* glsl */`
uniform vec2 resolution;
uniform int frame;
uniform highp sampler3D stbnTexture;

// Atmosphere
uniform float bottomRadius;
uniform mat4 worldToECEFMatrix;
uniform vec3 altitudeCorrection;
uniform vec3 sunDirection;

// Participating medium
uniform float scatteringCoefficient;
uniform float absorptionCoefficient;

// Primary raymarch
uniform float minDensity;
uniform float minExtinction;
uniform float minTransmittance;

// Shape and weather
uniform sampler2D localWeatherTexture;
uniform vec2 localWeatherRepeat;
uniform vec2 localWeatherOffset;
uniform float coverage;
uniform highp sampler3D shapeTexture;
uniform vec3 shapeRepeat;
uniform vec3 shapeOffset;

#ifdef SHAPE_DETAIL
uniform highp sampler3D shapeDetailTexture;
uniform vec3 shapeDetailRepeat;
uniform vec3 shapeDetailOffset;
#endif // SHAPE_DETAIL

#ifdef TURBULENCE
uniform sampler2D turbulenceTexture;
uniform vec2 turbulenceRepeat;
uniform float turbulenceDisplacement;
#endif // TURBULENCE

#ifdef HAZE
uniform float hazeDensityScale;
uniform float hazeExponent;
uniform float hazeScatteringCoefficient;
uniform float hazeAbsorptionCoefficient;
#endif // HAZE

// Cloud layers
uniform vec4 minLayerHeights;
uniform vec4 maxLayerHeights;
uniform vec3 minIntervalHeights;
uniform vec3 maxIntervalHeights;
uniform vec4 densityScales;
uniform vec4 shapeAmounts;
uniform vec4 shapeDetailAmounts;
uniform vec4 weatherExponents;
uniform vec4 shapeAlteringBiases;
uniform vec4 coverageFilterWidths;
uniform float minHeight;
uniform float maxHeight;
uniform float shadowTopHeight; // TODO remove
uniform CloudDensityProfile densityProfile;
`;

const math = /* glsl */`
float remap(const float x, const float min1, const float max1, const float min2, const float max2) {
  return min2 + (x - min1) / (max1 - min1) * (max2 - min2);
}

vec2 remap(const vec2 x, const vec2 min1, const vec2 max1, const vec2 min2, const vec2 max2) {
  return min2 + (x - min1) / (max1 - min1) * (max2 - min2);
}

vec3 remap(const vec3 x, const vec3 min1, const vec3 max1, const vec3 min2, const vec3 max2) {
  return min2 + (x - min1) / (max1 - min1) * (max2 - min2);
}

vec4 remap(const vec4 x, const vec4 min1, const vec4 max1, const vec4 min2, const vec4 max2) {
  return min2 + (x - min1) / (max1 - min1) * (max2 - min2);
}

float remapClamped(const float x, const float min1, const float max1) {
  return saturate((x - min1) / (max1 - min1));
}

vec2 remapClamped(const vec2 x, const vec2 min1, const vec2 max1) {
  return saturate((x - min1) / (max1 - min1));
}

vec3 remapClamped(const vec3 x, const vec3 min1, const vec3 max1) {
  return saturate((x - min1) / (max1 - min1));
}

vec4 remapClamped(const vec4 x, const vec4 min1, const vec4 max1) {
  return saturate((x - min1) / (max1 - min1));
}
`;

const clouds = /* glsl */`
float getSTBN() {
	ivec3 size = textureSize(stbnTexture, 0);
	vec3 scale = 1.0 / vec3(size);
	return texture(stbnTexture, vec3(gl_FragCoord.xy, float(frame % size.z)) * scale).r;
}

// Straightforward spherical mapping
vec2 getSphericalUv(const vec3 position) {
	vec2 st = normalize(position.yx);
	float phi = atan(st.x, st.y);
	float theta = asin(normalize(position).z);
	return vec2(phi * RECIPROCAL_PI2 + 0.5, theta * RECIPROCAL_PI + 0.5);
}

vec2 getCubeSphereUv(const vec3 position) {
	// Cube-sphere relaxation by: http://mathproofs.blogspot.com/2005/07/mapping-cube-to-sphere.html
	// TODO: Tile and fix seams.
	// Possible improvements:
	// https://iquilezles.org/articles/texturerepetition/
	// https://gamedev.stackexchange.com/questions/184388/fragment-shader-map-dot-texture-repeatedly-over-the-sphere
	// https://github.com/mmikk/hextile-demo

	vec3 n = normalize(position);
	vec3 f = abs(n);
	vec3 c = n / max(f.x, max(f.y, f.z));
	vec2 m;
	if (all(greaterThan(f.yy, f.xz))) {
		m = c.y > 0.0 ? vec2(-n.x, n.z) : n.xz;
	} else if (all(greaterThan(f.xx, f.yz))) {
		m = c.x > 0.0 ? n.yz : vec2(-n.y, n.z);
	} else {
		m = c.z > 0.0 ? n.xy : vec2(n.x, -n.y);
	}

	vec2 m2 = m * m;
	float q = dot(m2.xy, vec2(-2.0, 2.0)) - 3.0;
	float q2 = q * q;
	vec2 uv;
	uv.x = sqrt(1.5 + m2.x - m2.y - 0.5 * sqrt(-24.0 * m2.x + q2)) * (m.x > 0.0 ? 1.0 : -1.0);
	uv.y = sqrt(6.0 / (3.0 - uv.x * uv.x)) * m.y;
	return uv * 0.5 + 0.5;
}

vec2 getGlobeUv(const vec3 position) {
	return getCubeSphereUv(position);
}

float getMipLevel(const vec2 uv) {
	const float mipLevelScale = 0.1;
	vec2 coord = uv * resolution;
	vec2 ddx = dFdx(coord);
	vec2 ddy = dFdy(coord);
	float deltaMaxSqr = max(dot(ddx, ddx), dot(ddy, ddy)) * mipLevelScale;
	return max(0.0, 0.5 * log2(max(1.0, deltaMaxSqr)));
}

bool insideLayerIntervals(const float height) {
	bvec3 gt = greaterThan(vec3(height), minIntervalHeights);
	bvec3 lt = lessThan(vec3(height), maxIntervalHeights);
	return any(bvec3(gt.x && lt.x, gt.y && lt.y, gt.z && lt.z));
}

struct WeatherSample {
	vec4 heightFraction; // Normalized height of each layer
	vec4 density;
};

vec4 shapeAlteringFunction(const vec4 heightFraction, const vec4 bias) {
	// Apply a semi-circle transform to round the clouds towards the top.
	vec4 biased = pow(heightFraction, bias);
	vec4 x = clamp(biased * 2.0 - 1.0, -1.0, 1.0);
	return 1.0 - x * x;
}

WeatherSample sampleWeather(const vec2 uv, const float height, const float mipLevel) {
	WeatherSample weather;
	weather.heightFraction = remapClamped(vec4(height), minLayerHeights, maxLayerHeights);

	vec4 localWeather = pow(
		textureLod(
			localWeatherTexture,
			uv * localWeatherRepeat + localWeatherOffset,
			mipLevel
		).LOCAL_WEATHER_CHANNELS,
		weatherExponents
	);

	vec4 heightScale = shapeAlteringFunction(weather.heightFraction, shapeAlteringBiases);

	// Modulation to control weather by coverage parameter.
	// Reference: https://github.com/Prograda/Skybolt/blob/master/Assets/Core/Shaders/Clouds.h#L63
	vec4 factor = 1.0 - coverage * heightScale;
	weather.density = remapClamped(
		mix(localWeather, vec4(1.0), coverageFilterWidths),
		factor,
		factor + coverageFilterWidths
	);

	return weather;
}

vec4 getLayerDensity(const vec4 heightFraction) {
	// prettier-ignore
	return densityProfile.expTerms * exp(densityProfile.exponents * heightFraction) +
		densityProfile.linearTerms * heightFraction +
		densityProfile.constantTerms;
}

struct MediaSample {
	float density;
	vec4 weight;
	float scattering;
	float extinction;
};

MediaSample sampleMedia(
	const WeatherSample weather,
	const vec3 position,
	const vec2 uv,
	const float mipLevel,
	const float jitter,
	out ivec3 sampleCount
) {
	vec4 density = weather.density;

	// TODO: Define in physical length.
	vec3 surfaceNormal = normalize(position);
	float localWeatherSpeed = length(localWeatherOffset);
	vec3 evolution = -surfaceNormal * localWeatherSpeed * 2e4;

	vec3 turbulence = vec3(0.0);
	#ifdef TURBULENCE
	vec2 turbulenceUv = uv * localWeatherRepeat * turbulenceRepeat;
	turbulence =
		turbulenceDisplacement *
		(texture(turbulenceTexture, turbulenceUv).rgb * 2.0 - 1.0) *
		dot(density, remapClamped(weather.heightFraction, vec4(0.3), vec4(0.0)));
	#endif // TURBULENCE

	vec3 shapePosition = (position + evolution + turbulence) * shapeRepeat + shapeOffset;
	float shape = texture(shapeTexture, shapePosition).r;
	density = remapClamped(density, vec4(1.0 - shape) * shapeAmounts, vec4(1.0));

	#ifdef DEBUG_SHOW_SAMPLE_COUNT
	++sampleCount.y;
	#endif // DEBUG_SHOW_SAMPLE_COUNT

	#ifdef SHAPE_DETAIL
	if (mipLevel * 0.5 + (jitter - 0.5) * 0.5 < 0.5) {
		vec3 detailPosition = (position + turbulence) * shapeDetailRepeat + shapeDetailOffset;
		float detail = texture(shapeDetailTexture, detailPosition).r;
		// Fluffy at the top and whippy at the bottom.
		vec4 modifier = mix(
			vec4(pow(detail, 6.0)),
			vec4(1.0 - detail),
			remapClamped(weather.heightFraction, vec4(0.2), vec4(0.4))
		);
		modifier = mix(vec4(0.0), modifier, shapeDetailAmounts);
		density = remapClamped(density * 2.0, vec4(modifier * 0.5), vec4(1.0));

		#ifdef DEBUG_SHOW_SAMPLE_COUNT
		++sampleCount.z;
		#endif // DEBUG_SHOW_SAMPLE_COUNT
	}
	#endif // SHAPE_DETAIL

	// Apply the density profiles.
	density = saturate(density * densityScales * getLayerDensity(weather.heightFraction));

	MediaSample media;
	float densitySum = density.x + density.y + density.z + density.w;
	media.weight = density / densitySum;
	media.scattering = densitySum * scatteringCoefficient;
	media.extinction = densitySum * absorptionCoefficient + media.scattering;
	return media;
}

MediaSample sampleMedia(
	const WeatherSample weather,
	const vec3 position,
	const vec2 uv,
	const float mipLevel,
	const float jitter
) {
	ivec3 sampleCount;
	return sampleMedia(weather, position, uv, mipLevel, jitter, sampleCount);
}
`;

export const AtmosCloudComputeShader = {
	name: 'atmos_cloud_compute',
	defines: {
		TRANSMITTANCE_MAPPING: 1,
		INSCATTER_MAPPING: 1,

		TONE_MAPPING: 5,
		SRGB_OUTPUT: true,

		SHAPE_DETAIL: true,
		TURBULENCE: true,
		HAZE: true,

		POWDER: true,
		ACCURATE_SUN_SKY_LIGHT: true,

		DEBUG_SHOW_SAMPLE_COUNT: false
	},
	uniforms: {
		ATMOSPHERE: AtmosParameters.DEFAULT.toUniform(),
		SUN_SPECTRAL_RADIANCE_TO_LUMINANCE: [0, 0, 0],
		SKY_SPECTRAL_RADIANCE_TO_LUMINANCE: [0, 0, 0],

		irradiance_texture: null,
		transmittance_texture: null,
		scattering_texture: null,

		inverseProjectionMatrix: new Float32Array(16),
		inverseViewMatrix: new Float32Array(16),
		cameraPosition: [0.0, 0.0, 0.0],
		worldToECEFMatrix: new Float32Array(16),
		altitudeCorrection: [0, 0, 0],
		anchorMatrix: new Float32Array(16),

		// Atmosphere
		bottomRadius: 6360000,
		sunDirection: [0.2325, 0.8910, -0.3899],

		depthTex: null,
		projectionView: new Float32Array(16),
		cameraNear: 1.0,
		cameraFar: 3000000,
		cameraHeight: -200,
		temporalJitter: [-0.0003, 0.0017],
		targetUvScale: [1, 1.0011],
		mipLevelScale: 0.2500,

		// Scattering
		skyLightScale: 1,
		powderScale: 0.8,
		powderExponent: 150,

		// Primary raymarch
		maxIterationCount: 500,
		minStepSize: 50,
		maxStepSize: 1000,
		maxRayDistance: 200000,
		perspectiveStepScale: 1.0100,

		// Secondary raymarch
		maxIterationCountToSun: 2,
		minSecondaryStepSize: 100,
		secondaryStepScale: 2,

		// Tone mapping
		toneMappingExposure: 10,

		resolution: [1024, 1024],
		frame: 0,
		stbnTexture: null,

		// Participating medium
		absorptionCoefficient: 0,
		scatteringCoefficient: 1,

		// Primary raymarch
		minDensity: 0.01,
		minExtinction: 0.00,
		minTransmittance: 0.01,

		// Shape and weather
		localWeatherTexture: null,
		localWeatherRepeat: [100, 100],
		localWeatherOffset: [0.0, 0],
		coverage: 0.3,
		shapeTexture: null,
		shapeRepeat: [0.0003, 0.0003, 0.0003],
		shapeOffset: [0.0000, 0.0000, 0.0000],

		shapeDetailTexture: null,
		shapeDetailRepeat: [0.0060, 0.0060, 0.0060],
		shapeDetailOffset: [0.0000, 0.0000, 0.0000],

		turbulenceTexture: null,
		turbulenceRepeat: [20, 20],
		turbulenceDisplacement: 350,

		hazeDensityScale: 0.00,
		hazeExponent: 0.0010,
		hazeScatteringCoefficient: 0.9,
		hazeAbsorptionCoefficient: 0.5,

		minLayerHeights: [750, 1000, 7500, 0],
		maxLayerHeights: [1400, 2200, 8000, 0],
		minIntervalHeights: [0, 2200, 0],
		maxIntervalHeights: [750, 7500, 0],
		densityScales: [0.2000, 0.2000, 0.0030, 0.2000],
		shapeAmounts: [1, 1, 0.4000, 1],
		shapeDetailAmounts: [1, 1, 0, 1],
		weatherExponents: [1, 1, 1, 1],
		shapeAlteringBiases: [0.3500, 0.3500, 0.3500, 0.3500],
		coverageFilterWidths: [0.6000, 0.6000, 0.5000, 0.6000],
		minHeight: 750,
		maxHeight: 8000,
		shadowTopHeight: 2200,
		densityProfile: {
			expTerms: [0.0, 0.0, 0.0, 0.0],
			exponents: [0.0, 0.0, 0.0, 0.0],
			linearTerms: [0.75, 0.75, 0.75, 0.75],
			constantTerms: [0.25, 0.25, 0.25, 0.25]
		}
	},
	vertexShader: /* glsl */`
		${definitions}
		uniform AtmosphereParameters ATMOSPHERE;
		uniform vec3 SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
		uniform vec3 SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;

		uniform sampler2D transmittance_texture;
		uniform highp sampler3D scattering_texture;
		uniform sampler2D irradiance_texture;

		${defines}
		${common}
		${runtime}

		${types}

		uniform mat4 inverseProjectionMatrix;
		uniform mat4 inverseViewMatrix;
		uniform vec3 cameraPosition;
		uniform mat4 worldToECEFMatrix;
		uniform vec3 altitudeCorrection;
		uniform mat4 anchorMatrix;
		
		// Atmosphere
		uniform float bottomRadius;
		uniform vec3 sunDirection;

		// Cloud layers
		uniform float minHeight;
		uniform float maxHeight;

		attribute vec3 a_Position;

		varying vec2 v_Uv;
		varying vec3 vCameraPosition;
		varying vec3 vCameraDirection; // Direction to the center of screen
		varying vec3 vRayDirection; // Direction to the texel

		varying GroundIrradiance vGroundIrradiance;
		varying CloudsIrradiance vCloudsIrradiance;

		void sampleSunSkyIrradiance(const vec3 positionECEF) {
			vGroundIrradiance.sun = GetSunAndSkyScalarIrradiance(
				positionECEF * METER_TO_LENGTH_UNIT,
				sunDirection,
				vGroundIrradiance.sky
			);

			vec3 surfaceNormal = normalize(positionECEF);
			vec2 radii = (bottomRadius + vec2(minHeight, maxHeight)) * METER_TO_LENGTH_UNIT;
			vCloudsIrradiance.minSun = GetSunAndSkyScalarIrradiance(
				surfaceNormal * radii.x,
				sunDirection,
				vCloudsIrradiance.minSky
			);
			vCloudsIrradiance.maxSun = GetSunAndSkyScalarIrradiance(
				surfaceNormal * radii.y,
				sunDirection,
				vCloudsIrradiance.maxSky
			);
		}

		void main() {
			v_Uv = a_Position.xy * 0.5 + 0.5;

			vec3 viewPosition = (inverseProjectionMatrix * vec4(a_Position, 1.0)).xyz;
			vec3 worldDirection = (anchorMatrix * inverseViewMatrix * vec4(viewPosition.xyz, 0.0)).xyz;
			vec3 cameraDirection = normalize((anchorMatrix * inverseViewMatrix * vec4(0.0, 0.0, -1.0, 0.0)).xyz);

			vCameraPosition = (worldToECEFMatrix * vec4(cameraPosition, 1.0)).xyz;
			vCameraDirection = (worldToECEFMatrix * vec4(cameraDirection, 0.0)).xyz;
			vRayDirection = (worldToECEFMatrix * vec4(worldDirection, 0.0)).xyz;

			sampleSunSkyIrradiance(vCameraPosition + altitudeCorrection);

			gl_Position = vec4(a_Position.xy, 1.0, 1.0);
		}
	`,
	fragmentShader: /* glsl */`
		#define LOCAL_WEATHER_CHANNELS rgba

		#define PI2 6.283185307179586
		#define PI_HALF 1.5707963267948966
		#define RECIPROCAL_PI2 0.15915494309189535
		#define EPSILON 1e-6
		#define RECIPROCAL_PI4 0.07957747154594767

		${math}
		${raySphereIntersection}

		${defines}
		${definitions}
		${common}

		uniform AtmosphereParameters ATMOSPHERE;
		uniform vec3 SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
		uniform vec3 SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;

		uniform sampler2D transmittance_texture;
		uniform highp sampler3D scattering_texture;
		uniform sampler2D irradiance_texture;

		${runtime}

		${types}
		${parameters}
		${clouds}

		uniform sampler2D depthTex;
		uniform mat4 projectionView;
		uniform float cameraNear;
		uniform float cameraFar;
		uniform float cameraHeight;
		uniform vec2 temporalJitter;
		uniform vec2 targetUvScale;
		uniform float mipLevelScale;

		// Scattering
		uniform float skyLightScale;
		uniform float powderScale;
		uniform float powderExponent;

		// Primary raymarch
		uniform int maxIterationCount;
		uniform float minStepSize;
		uniform float maxStepSize;
		uniform float maxRayDistance;
		uniform float perspectiveStepScale;

		// Secondary raymarch
		uniform int maxIterationCountToSun;
		uniform float minSecondaryStepSize;
		uniform float secondaryStepScale;
		
		// Tone mapping
		uniform float toneMappingExposure;
		${tonemapping}

		varying vec2 v_Uv;
		varying vec3 vCameraPosition;
		varying vec3 vCameraDirection;
		varying vec3 vRayDirection;
		varying GroundIrradiance vGroundIrradiance;
		varying CloudsIrradiance vCloudsIrradiance;

		float getViewZ(const float depth) {
			return (cameraNear * cameraFar) / ((cameraFar - cameraNear) * depth - cameraFar);
		}

		vec2 henyeyGreenstein(const vec2 g, const float cosTheta) {
			vec2 g2 = g * g;
			return RECIPROCAL_PI4 *
				((1.0 - g2) / max(vec2(1e-7), pow(1.0 + g2 - 2.0 * g * cosTheta, vec2(1.5))));
		}

		float draine(float u, float g, float a) {
			float g2 = g * g;
			return (1.0 - g2) *
				(1.0 + a * u * u) /
				(4.0 * (1.0 + a * (1.0 + 2.0 * g2) / 3.0) * PI * pow(1.0 + g2 - 2.0 * g * u, 1.5));
		}

		// Numerically-fitted large particles (d=10) phase function It won't be
		// plausible without a more precise multiple scattering.
		// Reference: https://research.nvidia.com/labs/rtr/approximate-mie/
		float phaseFunction(const float cosTheta, const float attenuation) {
			const float gHG = 0.988176691700256; // exp(-0.0990567/(d-1.67154))
			const float gD = 0.5556712547839497; // exp(-2.20679/(d+3.91029) - 0.428934)
			const float alpha = 21.995520856274638; // exp(3.62489 - 8.29288/(d+5.52825))
			const float weight = 0.4819554318404214; // exp(-0.599085/(d-0.641583)-0.665888)
			return mix(
				henyeyGreenstein(vec2(gHG) * attenuation, cosTheta).x,
				draine(cosTheta, gD * attenuation, alpha),
				weight
			);
		}

		float phaseFunction(const float cosTheta) {
			return phaseFunction(cosTheta, 1.0);
		}

		float marchOpticalDepth(
			const vec3 rayOrigin,
			const vec3 rayDirection,
			const int maxIterationCount,
			const float mipLevel,
			const float jitter,
			out float rayDistance
		) {
			int iterationCount = int(
				max(0.0, remap(mipLevel, 0.0, 1.0, float(maxIterationCount + 1), 1.0) - jitter)
			);
			if (iterationCount == 0) {
				// Fudge factor to approximate the mean optical depth.
				// TODO: Remove it.
				return 0.5;
			}
			float stepSize = minSecondaryStepSize / float(iterationCount);
			float nextDistance = stepSize * jitter;
			float opticalDepth = 0.0;
			for (int i = 0; i < iterationCount; ++i) {
				rayDistance = nextDistance;
				vec3 position = rayDistance * rayDirection + rayOrigin;
				vec2 uv = getGlobeUv(position);
				float height = length(position) - bottomRadius;
				WeatherSample weather = sampleWeather(uv, height, mipLevel);
				MediaSample media = sampleMedia(weather, position, uv, mipLevel, jitter);
				opticalDepth += media.extinction * stepSize;
				nextDistance += stepSize;
				stepSize *= secondaryStepScale;
			}
			return opticalDepth;
		}
		
		float approximateMultipleScattering(const float opticalDepth, const float cosTheta) {
			// Multiple scattering approximation
			// See: https://fpsunflower.github.io/ckulla/data/oz_volumes.pdf
			// a: attenuation, b: contribution, c: phase attenuation
			vec3 coeffs = vec3(1.0); // [a, b, c]
			const vec3 attenuation = vec3(0.5, 0.5, 0.5); // Should satisfy a <= b
			float scattering = 0.0;
			float beerLambert;
			for (int i = 0; i < 12; ++i) {
				beerLambert = exp(-opticalDepth * coeffs.y);
				scattering += coeffs.x * beerLambert * phaseFunction(cosTheta, coeffs.z);
				coeffs *= attenuation;
			}
			return scattering;
		}

		vec3 getCloudsSunSkyIrradiance(const vec3 position, const float height, out vec3 skyIrradiance) {
			#ifdef ACCURATE_SUN_SKY_LIGHT
				return GetSunAndSkyScalarIrradiance(position * METER_TO_LENGTH_UNIT, sunDirection, skyIrradiance);
			#else // ACCURATE_SUN_SKY_LIGHT
				float alpha = remapClamped(height, minHeight, maxHeight);
				skyIrradiance = mix(vCloudsIrradiance.minSky, vCloudsIrradiance.maxSky, alpha);
				return mix(vCloudsIrradiance.minSun, vCloudsIrradiance.maxSun, alpha);
			#endif // ACCURATE_SUN_SKY_LIGHT
		}

		vec4 marchClouds(
			const vec3 rayOrigin,
			const vec3 rayDirection,
			const vec2 rayNearFar,
			const float cosTheta,
			const float jitter,
			const float rayStartTexelsPerPixel,
			out float frontDepth,
			out ivec3 sampleCount
		) {
			vec3 radianceIntegral = vec3(0.0);
			float transmittanceIntegral = 1.0;
			float weightedDistanceSum = 0.0;
			float transmittanceSum = 0.0;

			float maxRayDistance = rayNearFar.y - rayNearFar.x;
			float stepSize = minStepSize + (perspectiveStepScale - 1.0) * rayNearFar.x;
			// I don't understand why spatial aliasing remains unless doubling the jitter.
			float rayDistance = stepSize * jitter * 2.0;

			for (int i = 0; i < maxIterationCount; ++i) {
				if (rayDistance > maxRayDistance) {
					break; // Termination
				}

				vec3 position = rayDistance * rayDirection + rayOrigin;
				float height = length(position) - bottomRadius;
				float mipLevel = log2(max(1.0, rayStartTexelsPerPixel + rayDistance * 1e-5));

				// Sample rough weather.
				vec2 uv = getGlobeUv(position);
				WeatherSample weather = sampleWeather(uv, height, mipLevel);

				#ifdef DEBUG_SHOW_SAMPLE_COUNT
				++sampleCount.x;
				#endif // DEBUG_SHOW_SAMPLE_COUNT

				if (!any(greaterThan(weather.density, vec4(minDensity)))) {
					// Step longer in empty space.
					// TODO: This produces banding artifacts.
					// Possible improvement: Binary search refinement
					stepSize *= perspectiveStepScale;
					rayDistance += mix(stepSize, maxStepSize, min(1.0, mipLevel));
					continue;
				}

				// Sample detailed participating media.
				MediaSample media = sampleMedia(weather, position, uv, mipLevel, jitter, sampleCount);

				if (media.extinction > minExtinction) {
					vec3 skyIrradiance;
					vec3 sunIrradiance = getCloudsSunSkyIrradiance(position, height, skyIrradiance);
					vec3 surfaceNormal = normalize(position);

					// March optical depth to the sun for finer details, which BSM lacks.
					float sunRayDistance = 0.0;
					float opticalDepth = marchOpticalDepth(
						position,
						sunDirection,
						maxIterationCountToSun,
						mipLevel,
						jitter,
						sunRayDistance
					);

					vec3 radiance = sunIrradiance * approximateMultipleScattering(opticalDepth, cosTheta);

					// Crude approximation of sky gradient. Better than none in the shadows.
					float skyGradient = dot(weather.heightFraction * 0.5 + 0.5, media.weight);
					radiance += skyIrradiance * RECIPROCAL_PI4 * skyGradient * skyLightScale;

					// Finally multiply by scattering.
					radiance *= media.scattering;

					#ifdef POWDER
						radiance *= 1.0 - powderScale * exp(-media.extinction * powderExponent);
					#endif // POWDER

					// Energy-conserving analytical integration of scattered light
					// See 5.6.3 in https://media.contentapi.ea.com/content/dam/eacom/frostbite/files/s2016-pbs-frostbite-sky-clouds-new.pdf
					float transmittance = exp(-media.extinction * stepSize);
					float clampedExtinction = max(media.extinction, 1e-7);
					vec3 scatteringIntegral = (radiance - radiance * transmittance) / clampedExtinction;
					radianceIntegral += transmittanceIntegral * scatteringIntegral;
					transmittanceIntegral *= transmittance;

					// Aerial perspective affecting clouds
					// See 5.9.1 in https://media.contentapi.ea.com/content/dam/eacom/frostbite/files/s2016-pbs-frostbite-sky-clouds-new.pdf
					weightedDistanceSum += rayDistance * transmittanceIntegral;
					transmittanceSum += transmittanceIntegral;
				}

				if (transmittanceIntegral <= minTransmittance) {
					break; // Early termination
				}

				// Take a shorter step because we've already hit the clouds.
				stepSize *= perspectiveStepScale;
				rayDistance += stepSize;
			}

			// The final product of 5.9.1 and we'll evaluate this in aerial perspective.
			frontDepth = transmittanceSum > 0.0 ? weightedDistanceSum / transmittanceSum : -1.0;

			return vec4(radianceIntegral, remapClamped(transmittanceIntegral, 1.0, minTransmittance));
		}

		#ifdef HAZE
		vec4 approximateHaze(
			const vec3 rayOrigin,
			const vec3 rayDirection,
			const float maxRayDistance,
			const float cosTheta,
			const float shadowLength
		) {
			float modulation = remapClamped(coverage, 0.2, 0.4);
			if (cameraHeight * modulation < 0.0) {
				return vec4(0.0);
			}
			float density = modulation * hazeDensityScale * exp(-cameraHeight * hazeExponent);
			if (density < 1e-7) {
				return vec4(0.0); // Prevent artifact in views from space
			}

			// Blend two normals by the difference in angle so that normal near the
			// ground becomes that of the origin, and in the sky that of the horizon.
			vec3 normalAtOrigin = normalize(rayOrigin);
			vec3 normalAtHorizon = (rayOrigin - dot(rayOrigin, rayDirection) * rayDirection) / bottomRadius;
			float alpha = remapClamped(dot(normalAtOrigin, normalAtHorizon), 0.9, 1.0);
			vec3 normal = mix(normalAtOrigin, normalAtHorizon, alpha);

			// Analytical optical depth where density exponentially decreases with height.
			// Based on: https://iquilezles.org/articles/fog/
			float angle = max(dot(normal, rayDirection), 1e-5);
			float exponent = angle * hazeExponent;
			float linearTerm = density / hazeExponent / angle;

			// Derive the optical depths separately for with and without shadow length.
			float expTerm = 1.0 - exp(-maxRayDistance * exponent);
			float shadowExpTerm = 1.0 - exp(-min(maxRayDistance, shadowLength) * exponent);
			float opticalDepth = expTerm * linearTerm;
			float shadowOpticalDepth = max((expTerm - shadowExpTerm) * linearTerm, 0.0);
			float transmittance = saturate(1.0 - exp(-opticalDepth));
			float shadowTransmittance = saturate(1.0 - exp(-shadowOpticalDepth));

			vec3 skyIrradiance = vGroundIrradiance.sky;
			vec3 sunIrradiance = vGroundIrradiance.sun;
			vec3 inscatter = sunIrradiance * phaseFunction(cosTheta) * shadowTransmittance;
			inscatter += skyIrradiance * RECIPROCAL_PI4 * skyLightScale * transmittance;
			inscatter *= hazeScatteringCoefficient / (hazeAbsorptionCoefficient + hazeScatteringCoefficient);
			return vec4(inscatter, transmittance);
		}
		#endif // HAZE

		void applyAerialPerspective(
			const vec3 cameraPosition,
			const vec3 frontPosition,
			inout vec4 color
		) {
			vec3 transmittance;
			vec3 inscatter = GetSkyRadianceToPoint(
				cameraPosition * METER_TO_LENGTH_UNIT,
				frontPosition * METER_TO_LENGTH_UNIT,
				sunDirection,
				transmittance
			);
			color.rgb = color.rgb * transmittance + inscatter * color.a;
		}

		bool rayIntersectsGround(const vec3 cameraPosition, const vec3 rayDirection) {
			float r = length(cameraPosition);
			float mu = dot(cameraPosition, rayDirection) / r;
			return mu < 0.0 && r * r * (mu * mu - 1.0) + bottomRadius * bottomRadius >= 0.0;
		}

		struct IntersectionResult {
			bool ground;
			vec4 first;
			vec4 second;
		};

		IntersectionResult getIntersections(const vec3 cameraPosition, const vec3 rayDirection) {
			IntersectionResult intersections;
			intersections.ground = rayIntersectsGround(cameraPosition, rayDirection);
			raySphereIntersections(
				cameraPosition,
				rayDirection,
				bottomRadius + vec4(0.0, minHeight, maxHeight, shadowTopHeight),
				intersections.first,
				intersections.second
			);
			return intersections;
		}

		vec2 getRayNearFar(const IntersectionResult intersections) {
			vec2 nearFar;
			if (cameraHeight < minHeight) {
				// View below the clouds
				if (intersections.ground) {
					nearFar = vec2(-1.0); // No clouds to the ground
				} else {
					nearFar = vec2(intersections.second.y, intersections.second.z);
					nearFar.y = min(nearFar.y, maxRayDistance);
				}
			} else if (cameraHeight < maxHeight) {
				// View inside the total cloud layer
				if (intersections.ground) {
					nearFar = vec2(cameraNear, intersections.first.y);
				} else {
					nearFar = vec2(cameraNear, intersections.second.z);
				}
			} else {
				// View above the clouds
				nearFar = vec2(intersections.first.z, intersections.second.z);
				if (intersections.ground) {
					// Clamp the ray at the min height.
					nearFar.y = intersections.first.y;
				}
			}
			return nearFar;
		}
		
		#ifdef HAZE
		vec2 getHazeRayNearFar(const IntersectionResult intersections) {
			vec2 nearFar;
			if (cameraHeight < maxHeight) {
				if (intersections.ground) {
					nearFar = vec2(cameraNear, intersections.first.x);
				} else {
					nearFar = vec2(cameraNear, intersections.second.z);
				}
			} else {
				nearFar = vec2(cameraNear, intersections.second.z);
				if (intersections.ground) {
					// Clamp the ray at the ground.
					nearFar.y = intersections.first.x;
				}
			}
			return nearFar;
		}
		#endif // HAZE
		
		float getRayDistanceToScene(const vec3 rayDirection, out float viewZ) {
			float depth = texture2D(depthTex, v_Uv * targetUvScale + temporalJitter).r;
			if (depth < 1.0 - 1e-7) {
				viewZ = getViewZ(depth);
				return -viewZ / dot(rayDirection, vCameraDirection);
			}
			viewZ = 0.0;
			return 0.0;
		}
	
		void main() {
			vec3 cameraPosition = vCameraPosition + altitudeCorrection;
			vec3 rayDirection = normalize(vRayDirection);
			float cosTheta = dot(sunDirection, rayDirection);

			IntersectionResult intersections = getIntersections(cameraPosition, rayDirection);
			vec2 rayNearFar = getRayNearFar(intersections);
			#ifdef HAZE
				vec2 hazeRayNearFar = getHazeRayNearFar(intersections);
			#endif

			float sceneViewZ;
			float rayDistanceToScene = getRayDistanceToScene(rayDirection, sceneViewZ);
			if (rayDistanceToScene > 0.0) {
				rayNearFar.y = min(rayNearFar.y, rayDistanceToScene);
				#ifdef HAZE
				hazeRayNearFar.y = min(hazeRayNearFar.y, rayDistanceToScene);
				#endif // HAZE
			}

			bool intersectsGround = any(lessThan(rayNearFar, vec2(0.0)));
			bool intersectsScene = rayNearFar.y < rayNearFar.x;

			float stbn = getSTBN();

			vec4 color = vec4(0.0);
			float frontDepth = rayNearFar.y;
			float shadowLength = 0.0;
			bool hitClouds = false;

			if (!intersectsGround && !intersectsScene) {
				vec3 rayOrigin = rayNearFar.x * rayDirection + cameraPosition;

				vec2 globeUv = getGlobeUv(rayOrigin);

				float mipLevel = getMipLevel(globeUv * localWeatherRepeat) * mipLevelScale;
				mipLevel = mix(0.0, mipLevel, min(1.0, 0.2 * cameraHeight / maxHeight));

				float marchedFrontDepth;
				ivec3 sampleCount = ivec3(0);
				color = marchClouds(
					rayOrigin,
					rayDirection,
					rayNearFar,
					cosTheta,
					stbn,
					pow(2.0, mipLevel),
					marchedFrontDepth,
					sampleCount
				);

				#ifdef DEBUG_SHOW_SAMPLE_COUNT
    			color = vec4(vec3(sampleCount) / vec3(500.0, 5.0, 5.0), 1.0);
				#endif // DEBUG_SHOW_SAMPLE_COUNT

				// Front depth will be -1.0 when no samples are accumulated.
				hitClouds = marchedFrontDepth >= 0.0;
				if (hitClouds) {
					frontDepth = rayNearFar.x + marchedFrontDepth;

					#ifdef HAZE
					// Clamp the haze ray at the clouds.
					hazeRayNearFar.y = mix(
						hazeRayNearFar.y,
						min(frontDepth, hazeRayNearFar.y),
						color.a // Interpolate by the alpha for smoother edges.
					);
					#endif // HAZE

					// Apply aerial perspective.
					vec3 frontPosition = cameraPosition + frontDepth * rayDirection;
					applyAerialPerspective(cameraPosition, frontPosition, color);
				}
			}

			#ifdef HAZE
			vec4 haze = approximateHaze(
				cameraNear * rayDirection + cameraPosition,
				rayDirection,
				hazeRayNearFar.y - hazeRayNearFar.x,
				cosTheta,
				shadowLength
			);
			color.rgb = mix(color.rgb, haze.rgb, haze.a);
			color.a = color.a * (1.0 - haze.a) + haze.a;
			#endif // HAZE

			color.rgb = ToneMapping(color.rgb);
			gl_FragColor = color;
		}
	`
};

export const AtmosCloudResolveShader = {
	name: 'atmos_cloud_resolve',
	uniforms: {
		colorBuffer: null,
		colorHistoryBuffer: null,
		temporalAlpha: 0.1,
		downsample: 2
	},
	vertexShader: defaultVertexShader,
	fragmentShader: /* glsl */`
		uniform sampler2D colorBuffer;
		uniform sampler2D colorHistoryBuffer;
		uniform float temporalAlpha;
		uniform float downsample;

		varying vec2 v_Uv;

		#define VARIANCE_SAMPLER sampler2D
		#define VARIANCE_SAMPLER_COORD ivec2
		#define VARIANCE_OFFSET_COUNT 4

		const ivec2 varianceOffsets[4] = ivec2[4](ivec2(1, 0), ivec2(0, -1), ivec2(0, 1), ivec2(-1, 0));
		
		vec4 clipAABB(const vec4 current, const vec4 history, const vec4 minColor, const vec4 maxColor) {
			vec3 pClip = 0.5 * (maxColor.rgb + minColor.rgb);
			vec3 eClip = 0.5 * (maxColor.rgb - minColor.rgb) + 1e-7;
			vec4 vClip = history - vec4(pClip, current.a);
			vec3 vUnit = vClip.xyz / eClip;
			vec3 aUnit = abs(vUnit);
			float maUnit = max(aUnit.x, max(aUnit.y, aUnit.z));
			if (maUnit > 1.0) {
				return vec4(pClip, current.a) + vClip / maUnit;
			}
			return history;
		}

		vec4 varianceClipping(
			const VARIANCE_SAMPLER inputBuffer,
			const VARIANCE_SAMPLER_COORD coord,
			const vec4 current,
			const vec4 history,
			const float gamma
		) {
			vec4 moment1 = current;
			vec4 moment2 = current * current;
			vec4 neighbor;

			#if 0 < VARIANCE_OFFSET_COUNT
				neighbor = texelFetchOffset(inputBuffer, coord, 0, varianceOffsets[0]);
				moment1 += neighbor;
				moment2 += neighbor * neighbor;
			#endif
			
			#if 1 < VARIANCE_OFFSET_COUNT
				neighbor = texelFetchOffset(inputBuffer, coord, 0, varianceOffsets[1]);
				moment1 += neighbor;
				moment2 += neighbor * neighbor;
			#endif
			
			#if 2 < VARIANCE_OFFSET_COUNT
				neighbor = texelFetchOffset(inputBuffer, coord, 0, varianceOffsets[2]);
				moment1 += neighbor;
				moment2 += neighbor * neighbor;
			#endif
			
			#if 3 < VARIANCE_OFFSET_COUNT
				neighbor = texelFetchOffset(inputBuffer, coord, 0, varianceOffsets[3]);
				moment1 += neighbor;
				moment2 += neighbor * neighbor;
			#endif
			
			#if 4 < VARIANCE_OFFSET_COUNT
				neighbor = texelFetchOffset(inputBuffer, coord, 0, varianceOffsets[4]);
				moment1 += neighbor;
				moment2 += neighbor * neighbor;
			#endif
			
			#if 5 < VARIANCE_OFFSET_COUNT
				neighbor = texelFetchOffset(inputBuffer, coord, 0, varianceOffsets[5]);
				moment1 += neighbor;
				moment2 += neighbor * neighbor;
			#endif
			
			#if 6 < VARIANCE_OFFSET_COUNT
				neighbor = texelFetchOffset(inputBuffer, coord, 0, varianceOffsets[6]);
				moment1 += neighbor;
				moment2 += neighbor * neighbor;
			#endif
			
			#if 7 < VARIANCE_OFFSET_COUNT
				neighbor = texelFetchOffset(inputBuffer, coord, 0, varianceOffsets[7]);
				moment1 += neighbor;
				moment2 += neighbor * neighbor;
			#endif
			
			const float N = float(VARIANCE_OFFSET_COUNT + 1);
			vec4 mean = moment1 / N;
			vec4 varianceGamma = sqrt(max(moment2 / N - mean * mean, 0.0)) * gamma;
			vec4 minColor = mean - varianceGamma;
			vec4 maxColor = mean + varianceGamma;
			return clipAABB(clamp(mean, minColor, maxColor), history, minColor, maxColor);
		}

		vec4 varianceClipping(
			const VARIANCE_SAMPLER inputBuffer,
			const VARIANCE_SAMPLER_COORD coord,
			const vec4 current,
			const vec4 history
		) {
			return varianceClipping(inputBuffer, coord, current, history, 1.0);
		}
		
		void temporalAntialiasing(const ivec2 coord, out vec4 outputColor) {
			vec4 currentColor = texelFetch(colorBuffer, coord, 0);
			vec4 historyColor = texture(colorHistoryBuffer, v_Uv);
			vec4 clippedColor = varianceClipping(colorBuffer, coord, currentColor, historyColor);
			outputColor = mix(clippedColor, currentColor, temporalAlpha);
		}
		
		void main() {
			ivec2 coord = ivec2(gl_FragCoord.xy / downsample);
			vec4 outputColor = vec4(0.0);
			temporalAntialiasing(coord, outputColor);
			gl_FragColor = outputColor;
		}
	`
};

export const AtmosCloudMixShader = {
	name: 'atmos_cloud_mix',
	uniforms: {
		cloudTex: null,
		sceneTex: null
	},
	vertexShader: defaultVertexShader,
	fragmentShader: /* glsl */`
		uniform sampler2D cloudTex;
		uniform sampler2D sceneTex;

		varying vec2 v_Uv;

		void main() {
			vec4 cloud = texture(cloudTex, v_Uv);
			vec4 scene = texture(sceneTex, v_Uv);
			vec3 color = cloud.rgb + (1.0 - clamp(cloud.a, 0.0, 1.0)) * scene.rgb;
			gl_FragColor = vec4(color, scene.a);
		}
	`
};
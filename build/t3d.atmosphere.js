// t3d-atmosphere
(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('t3d'), require('t3d-effect-composer')) :
	typeof define === 'function' && define.amd ? define(['exports', 't3d', 't3d-effect-composer'], factory) :
	(global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.t3d = global.t3d || {}, global.t3d, global.t3d));
})(this, (function (exports, t3d, t3dEffectComposer) { 'use strict';

	const IRRADIANCE_TEXTURE_WIDTH = 64;
	const IRRADIANCE_TEXTURE_HEIGHT = 16;
	const SCATTERING_TEXTURE_R_SIZE = 32;
	const SCATTERING_TEXTURE_MU_SIZE = 128;
	const SCATTERING_TEXTURE_MU_S_SIZE = 32;
	const SCATTERING_TEXTURE_NU_SIZE = 8;
	const SCATTERING_TEXTURE_WIDTH = SCATTERING_TEXTURE_NU_SIZE * SCATTERING_TEXTURE_MU_S_SIZE;
	const SCATTERING_TEXTURE_HEIGHT = SCATTERING_TEXTURE_MU_SIZE;
	const SCATTERING_TEXTURE_DEPTH = SCATTERING_TEXTURE_R_SIZE;
	const TRANSMITTANCE_TEXTURE_WIDTH = 256;
	const TRANSMITTANCE_TEXTURE_HEIGHT = 64;
	const METER_TO_LENGTH_UNIT = 1 / 1000;

	const AtmosphereCommon = /* glsl */`
struct AtmosphereParameters {
	vec3 solar_irradiance;
	float bottom_radius;
		float top_radius;
	vec3 rayleigh_scattering;
	vec3 mie_scattering;
	vec3 mie_extinction;
	float mie_phase_function_g;
	vec3 absorption_extinction;
	vec3 ground_albedo;
};

uniform AtmosphereParameters atmosphere;

#define IRRADIANCE_TEXTURE_WIDTH ${IRRADIANCE_TEXTURE_WIDTH.toFixed(0)}
#define IRRADIANCE_TEXTURE_HEIGHT ${IRRADIANCE_TEXTURE_HEIGHT.toFixed(0)}
#define SCATTERING_TEXTURE_R_SIZE ${SCATTERING_TEXTURE_R_SIZE.toFixed(0)}
#define SCATTERING_TEXTURE_MU_SIZE ${SCATTERING_TEXTURE_MU_SIZE.toFixed(0)}
#define SCATTERING_TEXTURE_MU_S_SIZE ${SCATTERING_TEXTURE_MU_S_SIZE.toFixed(0)}
#define SCATTERING_TEXTURE_NU_SIZE ${SCATTERING_TEXTURE_NU_SIZE.toFixed(0)}
#define TRANSMITTANCE_TEXTURE_WIDTH ${TRANSMITTANCE_TEXTURE_WIDTH.toFixed(0)}
#define TRANSMITTANCE_TEXTURE_HEIGHT ${TRANSMITTANCE_TEXTURE_HEIGHT.toFixed(0)}
#define METER_TO_LENGTH_UNIT ${METER_TO_LENGTH_UNIT.toFixed(7)}

// Half heights for the atmosphere air density (HR) and particle density (HM)
// This is the height in km that half the particles are found below
const float HR = 8.0;
const float HM = 1.2;

// ---------------------------------------------------------------------------- 
// UTILITY FUNCTIONS
// ---------------------------------------------------------------------------- 

float GetTextureCoordFromUnitRange(const float x, const int texture_size) {
	return 0.5 / float(texture_size) + x * (1.0 - 1.0 / float(texture_size));
}

float GetUnitRangeFromTextureCoord(const float u, const int texture_size) {
	return (u - 0.5 / float(texture_size)) / (1.0 - 1.0 / float(texture_size));
}

float ClampCosine(float mu) {
	return clamp(mu, -1.0, 1.0);
}

float ClampDistance(float d) {
	return max(d, 0.0);
}

float ClampRadius(float r) {
	return clamp(r, atmosphere.bottom_radius, atmosphere.top_radius);
}

float SafeSqrt(float a) {
	return sqrt(max(a, 0.0));
}

float DistanceToTopAtmosphereBoundary(float r, float mu) {
	float discriminant = r * r * (mu * mu - 1.0) + atmosphere.top_radius * atmosphere.top_radius;
	return ClampDistance(-r * mu + SafeSqrt(discriminant));
}

float DistanceToBottomAtmosphereBoundary(float r, float mu) {
	float discriminant = r * r * (mu * mu - 1.0) + atmosphere.bottom_radius * atmosphere.bottom_radius;
	return ClampDistance(-r * mu - SafeSqrt(discriminant));
}

float DistanceToNearestAtmosphereBoundary(float r, float mu, bool rayIntersectsGround) {
	if (rayIntersectsGround) {
		return DistanceToBottomAtmosphereBoundary(r, mu);
	} else {
		return DistanceToTopAtmosphereBoundary(r, mu);
	}
}
`;

	// ref https://ebruneton.github.io/precomputed_atmospheric_scattering
	const TransmittanceLookup = /* glsl */`
#if TRANSMITTANCE_MAPPING == 0
	vec2 GetTransmittanceUvFromRMu(float r, float mu) {
		float u = (mu + 0.15) / (1.0 + 0.15);
		float v = (r - atmosphere.bottom_radius) / (atmosphere.top_radius - atmosphere.bottom_radius);
		return vec2(u, v);
	}
#elif TRANSMITTANCE_MAPPING == 1
	vec2 GetTransmittanceUvFromRMu(float r, float mu) {
		float u = atan((mu + 0.15) / (1.0 + 0.15) * tan(1.5)) / 1.5;
		float v = sqrt((r - atmosphere.bottom_radius) / (atmosphere.top_radius - atmosphere.bottom_radius));
		return vec2(u, v);
	}
#else
	vec2 GetTransmittanceUvFromRMu(float r, float mu) {
		float H = sqrt(atmosphere.top_radius * atmosphere.top_radius - atmosphere.bottom_radius * atmosphere.bottom_radius);
		float rho = SafeSqrt(r * r - atmosphere.bottom_radius * atmosphere.bottom_radius);
		float d = DistanceToTopAtmosphereBoundary(r, mu);
		float d_min = atmosphere.top_radius - r;
		float d_max = rho + H;
		float x_mu = (d - d_min) / (d_max - d_min);
		float x_r = rho / H;
		return vec2(
			GetTextureCoordFromUnitRange(x_mu, TRANSMITTANCE_TEXTURE_WIDTH),
			GetTextureCoordFromUnitRange(x_r, TRANSMITTANCE_TEXTURE_HEIGHT)
		);
	}
#endif

// transmittance(=transparency) of atmosphere for infinite ray (r, mu)
// (mu = cos(view zenith angle)), intersections with ground ignored
vec3 GetTransmittanceToTopAtmosphereBoundary(float r, float mu) {
	vec2 uv = GetTransmittanceUvFromRMu(r, mu);
	return texture2D(transmittanceTexture, uv).rgb;
}

vec3 GetTransmittanceToSun(float r, float mu) {
	float sin_theta_h = atmosphere.bottom_radius / r;
	float cos_theta_h = -sqrt(max(1.0 - sin_theta_h * sin_theta_h, 0.0));
	return GetTransmittanceToTopAtmosphereBoundary(r, mu) *
		smoothstep(-sin_theta_h * 0.004674, sin_theta_h * 0.004674, mu - cos_theta_h);
}

// transmittance(=transparency) of atmosphere between x and x0
// assume segment x, x0 not intersecting ground 
// d = distance between x and x0, mu = cos(zenith angle of [x,x0) ray at x) 
vec3 GetTransmittance(float r, float mu, float d, bool rayIntersectsGround) {
	float r_d = ClampRadius(sqrt(r * r + d * d + 2.0 * r * mu * d));
	float mu_d = ClampCosine((r * mu + d) / r_d);
	if (rayIntersectsGround) {
		return min(
			GetTransmittanceToTopAtmosphereBoundary(r_d, -mu_d) /
				GetTransmittanceToTopAtmosphereBoundary(r, -mu)
			, vec3(1.0));
	} else {
		return min(
			GetTransmittanceToTopAtmosphereBoundary(r, mu) /
				GetTransmittanceToTopAtmosphereBoundary(r_d, mu_d)
			, vec3(1.0));
	}
}
`;

	const InscatterLookup = /* glsl */`
vec4 GetScatteringUvwzFromRMuMuSNu(float r, float mu, float muS, float nu, bool rayIntersectsGround) {
	float H = sqrt(atmosphere.top_radius * atmosphere.top_radius - atmosphere.bottom_radius * atmosphere.bottom_radius);
	float rho = SafeSqrt(r * r - atmosphere.bottom_radius * atmosphere.bottom_radius);
	float uR = GetTextureCoordFromUnitRange(rho / H, SCATTERING_TEXTURE_R_SIZE);
	#if INSCATTER_MAPPING == 1
		float rmu = r * mu;
		float discriminant = rmu * rmu - r * r + atmosphere.bottom_radius * atmosphere.bottom_radius;
		float uMu;
		if (rayIntersectsGround) {
			float d = -rmu - SafeSqrt(discriminant);
			float d_min = r - atmosphere.bottom_radius;
			float d_max = rho;
			uMu = 0.5 - 0.5 * GetTextureCoordFromUnitRange(d_max == d_min ? 0.0 : (d - d_min) / (d_max - d_min), SCATTERING_TEXTURE_MU_SIZE / 2);
		} else {
			float d = -rmu + SafeSqrt(discriminant + H * H);
			float d_min = atmosphere.top_radius - r;
			float d_max = rho + H;
			uMu = 0.5 + 0.5 * GetTextureCoordFromUnitRange((d - d_min) / (d_max - d_min), SCATTERING_TEXTURE_MU_SIZE / 2);
		}

		float d = DistanceToTopAtmosphereBoundary(atmosphere.bottom_radius, muS);
		float d_min = atmosphere.top_radius - atmosphere.bottom_radius;
		float d_max = H;
		float a = (d - d_min) / (d_max - d_min);
		float D = DistanceToTopAtmosphereBoundary(atmosphere.bottom_radius, -0.2);
		float A = (D - d_min) / (d_max - d_min);
		float uMuS = GetTextureCoordFromUnitRange(max(1.0 - a / A, 0.0) / (1.0 + a), SCATTERING_TEXTURE_MU_S_SIZE);
	#else
		float uMu = GetTextureCoordFromUnitRange((mu + 1.0) / 2.0, SCATTERING_TEXTURE_MU_SIZE);
		float uMuS = GetTextureCoordFromUnitRange(max(muS + 0.2, 0.0) / 1.2, SCATTERING_TEXTURE_MU_S_SIZE);
	#endif

	float uNu = (nu + 1.0) / 2.0;

	return vec4(uNu, uMuS, uMu, uR);
}

vec4 GetScattering(float r, float mu, float muS, float nu, bool rayIntersectsGround) {
	vec4 uvwz = GetScatteringUvwzFromRMuMuSNu(r, mu, muS, nu, rayIntersectsGround);

	float tex_coord_x = uvwz.x * float(SCATTERING_TEXTURE_NU_SIZE - 1);
	float tex_x = floor(tex_coord_x);
	float lep = tex_coord_x - tex_x;

	float uMu = uvwz.z;
	float uR = uvwz.w;
	float uNu_uMuS = tex_x + uvwz.y;

	return texture(inscatteringTexture, vec3(uNu_uMuS / float(SCATTERING_TEXTURE_NU_SIZE), uMu, uR)) * (1.0 - lep) + 
			texture(inscatteringTexture, vec3((uNu_uMuS + 1.0) / float(SCATTERING_TEXTURE_NU_SIZE), uMu, uR)) * lep;
}

vec3 GetMie(vec4 rayMie) {	
	// approximated single Mie scattering (cf. approximate Cm in paragraph "Angular precision")
	// rayMie.rgb = C*, rayMie.w = Cm, r
	vec3 rayleighScattering = atmosphere.rayleigh_scattering;
	return rayMie.rgb * rayMie.w / max(rayMie.r, 1e-4) * (rayleighScattering.r / rayleighScattering.xyz);
}

float RayleighPhaseFunction(float nu) {
	float k = 3.0 / (16.0 * PI);
	return k * (1.0 + nu * nu);
}

float MiePhaseFunction(float g, float nu) {
	float k = 3.0 / (8.0 * PI) * (1.0 - g * g) / (2.0 + g * g);
	return k * (1.0 + nu * nu) / pow(1.0 + g * g - 2.0 * g * nu, 1.5);
}

vec3 GetCombinedScattering(float r, float mu, float muS, float nu, bool rayIntersectsGround, out vec3 single_mie_scattering) {
	vec4 scattering = GetScattering(r, mu, muS, nu, rayIntersectsGround);
	single_mie_scattering = GetMie(scattering);
	return scattering.rgb;
}
`;

	const IrradianceLookup = /* glsl */`
vec2 GetIrradianceUvFromRMuS(float r, float mu_s) {
	float x_r = (r - atmosphere.bottom_radius) / (atmosphere.top_radius - atmosphere.bottom_radius);
	float x_mu_s = mu_s * 0.5 + 0.5;
	return vec2(
		GetTextureCoordFromUnitRange(x_mu_s, IRRADIANCE_TEXTURE_WIDTH),
		GetTextureCoordFromUnitRange(x_r, IRRADIANCE_TEXTURE_HEIGHT)
	);
}

vec3 GetIrradiance(float r, float mu_s) {
	vec2 uv = GetIrradianceUvFromRMuS(r, mu_s);
	return vec3(texture2D(irradianceTexture, uv));
}
`;

	// 0 - Linear
	// 1 - Reinhard
	// 2 - Optimized Cineon
	// 3 - ACES Filmic
	// 4 - Neutral
	// 5 - AgX
	// 6 - Unity (Legacy)
	const ToneMapping = /* glsl */`
#if TONE_MAPPING == 0
	// exposure only
	vec3 ToneMapping(vec3 color) {
		return saturate(toneMappingExposure * color);
	}
#elif TONE_MAPPING == 1
	// source: https://www.cs.utah.edu/docs/techreports/2002/pdf/UUCS-02-001.pdf
	vec3 ToneMapping(vec3 color) {
		color *= toneMappingExposure;
		return saturate(color / (vec3(1.0) + color));
	}
#elif TONE_MAPPING == 2
	// source: http://filmicworlds.com/blog/filmic-tonemapping-operators/
	vec3 ToneMapping(vec3 color) {
		// optimized filmic operator by Jim Hejl and Richard Burgess-Dawson
		color *= toneMappingExposure;
		color = max(vec3(0.0), color - 0.004);
		return pow((color * (6.2 * color + 0.5)) / (color * (6.2 * color + 1.7) + 0.06), vec3(2.2));
	}
#elif TONE_MAPPING == 3
	// source: https://github.com/selfshadow/ltc_code/blob/master/webgl/shaders/ltc/ltc_blit.fs
	vec3 RRTAndODTFit(vec3 v) {
		vec3 a = v * (v + 0.0245786) - 0.000090537;
		vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
		return a / b;
	}

	// this implementation of ACES is modified to accommodate a brighter viewing environment.
	// the scale factor of 1/0.6 is subjective. see discussion in https://github.com/mrdoob/three.js/pull/19621.
	vec3 ToneMapping(vec3 color) {
		// sRGB => XYZ => D65_2_D60 => AP1 => RRT_SAT
		const mat3 ACESInputMat = mat3(
			vec3(0.59719, 0.07600, 0.02840), // transposed from source
			vec3(0.35458, 0.90834, 0.13383),
			vec3(0.04823, 0.01566, 0.83777)
		);
		// ODT_SAT => XYZ => D60_2_D65 => sRGB
		const mat3 ACESOutputMat = mat3(
			vec3( 1.60475, -0.10208, -0.00327), // transposed from source
			vec3(-0.53108,	1.10813, -0.07276),
			vec3(-0.07367, -0.00605,	1.07602)
		);
		color *= toneMappingExposure / 0.6;
		color = ACESInputMat * color;
		// Apply RRT and ODT
		color = RRTAndODTFit(color);
		color = ACESOutputMat * color;
		// Clamp to [0, 1]
		return saturate(color);
	}
#elif TONE_MAPPING == 4
	vec3 ToneMapping(vec3 color) {
		const float StartCompression = 0.8 - 0.04;
		const float Desaturation = 0.15;
		color *= toneMappingExposure;
		float x = min(color.r, min(color.g, color.b));
		float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
		color -= offset;
		float peak = max(color.r, max(color.g, color.b));
		if (peak < StartCompression) return color;
		float d = 1. - StartCompression;
		float newPeak = 1. - d * d / (peak + d - StartCompression);
		color *= newPeak / peak;
		float g = 1. - 1. / (Desaturation * (peak - newPeak) + 1.);
		return mix(color, vec3(newPeak), g);
	}
#elif TONE_MAPPING == 5
	// Matrices for rec 2020 <> rec 709 color space conversion
	// matrix provided in row-major order so it has been transposed
	// https://www.itu.int/pub/R-REP-BT.2407-2017
	const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
		vec3(1.6605, -0.1246, -0.0182),
		vec3(-0.5876, 1.1329, -0.1006),
		vec3(-0.0728, -0.0083, 1.1187)
	);

	const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
		vec3(0.6274, 0.0691, 0.0164),
		vec3(0.3293, 0.9195, 0.0880),
		vec3(0.0433, 0.0113, 0.8956)
	);

	// https://iolite-engine.com/blog_posts/minimal_agx_implementation
	// Mean error^2: 3.6705141e-06
	vec3 agxDefaultContrastApprox(vec3 x) {
		vec3 x2 = x * x;
		vec3 x4 = x2 * x2;

		return + 15.5 * x4 * x2
			- 40.14 * x4 * x
			+ 31.96 * x4
			- 6.868 * x2 * x
			+ 0.4298 * x2
			+ 0.1191 * x
			- 0.00232;
	}

	// AgX Tone Mapping implementation based on Filament, which in turn is based
	// on Blender's implementation using rec 2020 primaries
	// https://github.com/google/filament/pull/7236
	// Inputs and outputs are encoded as Linear-sRGB.
	vec3 ToneMapping(vec3 color) {
		// AgX constants
		const mat3 AgXInsetMatrix = mat3(
			vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
			vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
			vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859)
		);

		// explicit AgXOutsetMatrix generated from Filaments AgXOutsetMatrixInv
		const mat3 AgXOutsetMatrix = mat3(
			vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
			vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
			vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405)
		);

		// LOG2_MIN			= -10.0
		// LOG2_MAX			=	+6.5
		// MIDDLE_GRAY	 =	0.18
		const float AgxMinEv = -12.47393;	// log2(pow(2, LOG2_MIN) * MIDDLE_GRAY)
		const float AgxMaxEv = 4.026069;	 // log2(pow(2, LOG2_MAX) * MIDDLE_GRAY)

		color *= toneMappingExposure;

		color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;

		color = AgXInsetMatrix * color;

		// Log2 encoding
		color = max(color, 1e-10); // avoid 0 or negative numbers for log2
		color = log2(color);
		color = (color - AgxMinEv) / (AgxMaxEv - AgxMinEv);

		color = clamp(color, 0.0, 1.0);

		// Apply sigmoid
		color = agxDefaultContrastApprox(color);

		// Apply AgX look
		// v = agxLook(v, look);

		color = AgXOutsetMatrix * color;

		// Linearize
		color = pow(max(vec3(0.0), color), vec3(2.2));

		color = LINEAR_REC2020_TO_LINEAR_SRGB * color;

		// Gamut mapping. Simple clamp for now.
		color = clamp(color, 0.0, 1.0);

		return color;
	}
#elif TONE_MAPPING == 6
	vec3 ToneMapping(vec3 color) {
		color *= toneMappingExposure;
		color.r = mix(1.0 - exp(-color.r), pow(color.r * 0.38317, 1.0 / 2.2), step(color.r, 1.413));
		color.g = mix(1.0 - exp(-color.g), pow(color.g * 0.38317, 1.0 / 2.2), step(color.g, 1.413));
		color.b = mix(1.0 - exp(-color.b), pow(color.b * 0.38317, 1.0 / 2.2), step(color.b, 1.413));
		return color;
	}
#else
	vec3 ToneMapping(vec3 color) {
		return color; // no tone mapping
	}
#endif
`;

	const Runtime = /* glsl */`
bool RayIntersectsGround(float r, float mu) {
	return mu < 0.0 && r * r * (mu * mu - 1.0) + atmosphere.bottom_radius * atmosphere.bottom_radius >= 0.0;
}

bool RayIntersectsGround(vec3 camera, vec3 view_ray) {
	float r = length(camera);
	float mu = dot(camera, view_ray) / r;
	return mu < 0.0 && r * r * (mu * mu - 1.0) + atmosphere.bottom_radius * atmosphere.bottom_radius >= 0.0;
}

float RaySphereFirstIntersection(vec3 origin, vec3 direction, vec3 center, float radius) {
	vec3 a = origin - center;
	float b = 2.0 * dot(direction, a);
	float c = dot(a, a) - radius * radius;
	float discriminant = b * b - 4.0 * c;
	return discriminant < 0.0
		? -1.0
		: (-b - sqrt(discriminant)) * 0.5;
}

float RaySphereFirstIntersection(vec3 origin, vec3 direction, float radius) {
	return RaySphereFirstIntersection(origin, direction, vec3(0.0), radius);
}

vec2 RaySphereIntersections(const vec3 camera, const vec3 direction, const float radius) {
	float b = 2.0 * dot(direction, camera);
	float c = dot(camera, camera) - radius * radius;
	float discriminant = b * b - 4.0 * c;
	float Q = sqrt(discriminant);
	return vec2(-b - Q, -b + Q) * 0.5;
}

bool ClipAtBottomAtmosphere(vec3 view_ray, inout vec3 camera, inout vec3 point) {
	const float eps = 0.0;
	float bottom_radius = atmosphere.bottom_radius + eps;
	float r_camera = length(camera);
	float r_point = length(point);
	bool camera_below = r_camera < bottom_radius;
	bool point_below = r_point < bottom_radius;
	if (camera_below && point_below) {
		return false;
	}
	vec2 t = RaySphereIntersections(camera, view_ray, bottom_radius);
	vec3 intersection = camera + view_ray * (camera_below ? t.y : t.x);
	if (camera_below) {
		camera = intersection;
	} else if (point_below) {
		point = intersection;
	}
	return true;
}

vec3 ClosestPointOnRay(const vec3 camera, const vec3 point) {
	vec3 ray = point - camera;
	float t = clamp(-dot(camera, ray) / dot(ray, ray), 0.0, 1.0);
	return camera + t * ray;
}

vec3 GetSkyRadiance(vec3 camera, vec3 view_ray, vec3 sun_direction, bool clamp_mu_at_horizon, out vec3 transmittance) {
	float r = length(camera);
	if (!clamp_mu_at_horizon && r < atmosphere.bottom_radius) {
		r = atmosphere.bottom_radius;
		camera = normalize(camera) * r;
	}
	float rmu = dot(camera, view_ray);

	float distance_to_top_atmosphere_boundary = -rmu - sqrt(rmu * rmu - r * r + atmosphere.top_radius * atmosphere.top_radius);
	
	if (distance_to_top_atmosphere_boundary > 0.0) {
		camera = camera + view_ray * distance_to_top_atmosphere_boundary;
		r = atmosphere.top_radius;
		rmu += distance_to_top_atmosphere_boundary;
	} else if (r > atmosphere.top_radius) {
		transmittance = vec3(1.0);
		return vec3(0.0);
	}

	float mu = rmu / r;
	if (clamp_mu_at_horizon) {
		float mu_horizon = -SafeSqrt(1.0 -
			(atmosphere.bottom_radius * atmosphere.bottom_radius) / (r * r));
		mu = max(rmu / r, mu_horizon + 0.001);
	}
	float mu_s = dot(camera, sun_direction) / r;
	float nu = dot(view_ray, sun_direction);

	bool ray_r_mu_intersects_ground = RayIntersectsGround(r, mu);

	transmittance = ray_r_mu_intersects_ground
		? vec3(0.0)
		: GetTransmittanceToTopAtmosphereBoundary(r, mu);

	vec3 single_mie_scattering;
	vec3 scattering = GetCombinedScattering(r, mu, mu_s, nu, ray_r_mu_intersects_ground, single_mie_scattering);

	return scattering * RayleighPhaseFunction(nu) +
		single_mie_scattering * MiePhaseFunction(atmosphere.mie_phase_function_g, nu);
}

vec3 GetSkyRadianceToPoint(vec3 camera, vec3 point, vec3 sun_direction, out vec3 transmittance) {
	if (length(ClosestPointOnRay(camera, point)) > atmosphere.top_radius) {
		transmittance = vec3(1.0);
		return vec3(0.0);
	}

	vec3 view_ray = normalize(point - camera);
	if (!ClipAtBottomAtmosphere(view_ray, camera, point)) {
		transmittance = vec3(1.0);
		return vec3(0.0);
	}

	float r = length(camera);
	float rmu = dot(camera, view_ray);

	float distance_to_top_atmosphere_boundary = -rmu - 
		SafeSqrt(rmu * rmu - r * r + 
		atmosphere.top_radius * atmosphere.top_radius);

	// If the viewer is in space and the view ray intersects the atmosphere, move
	// the viewer to the top atmosphere boundary (along the view ray):
	if (distance_to_top_atmosphere_boundary > 0.0) {
		camera = camera + view_ray * distance_to_top_atmosphere_boundary;
		r = atmosphere.top_radius;
		rmu += distance_to_top_atmosphere_boundary;
	}

	float mu = rmu / r;
	float mu_s = dot(camera, sun_direction) / r;
	float nu = dot(view_ray, sun_direction);
	float d = length(point - camera);
	bool ray_r_mu_intersects_ground = RayIntersectsGround(r, mu);

	// Hack to avoid rendering artifacts near the horizon, due to finite
	// atmosphere texture resolution and finite floating point precision.
	// See: https://github.com/ebruneton/precomputed_atmospheric_scattering/pull/32
	if (!ray_r_mu_intersects_ground) {
		float mu_horizon = -SafeSqrt(1.0 - 
			(atmosphere.bottom_radius * atmosphere.bottom_radius) / (r * r));
		mu = max(mu, mu_horizon + 0.004);
	}

	transmittance = GetTransmittance(r, mu, d, ray_r_mu_intersects_ground);

	vec3 single_mie_scattering;
	vec3 scattering = GetCombinedScattering(r, mu, mu_s, nu, ray_r_mu_intersects_ground, single_mie_scattering);

	d = max(d, 0.0);
	float r_p = ClampRadius(sqrt(d * d + 2.0 * r * mu * d + r * r));
	float mu_p = (r * mu + d) / r_p;
	float mu_s_p = (r * mu_s + d * nu) / r_p;

	vec3 single_mie_scattering_p;
	vec3 scattering_p = GetCombinedScattering(r_p, mu_p, mu_s_p, nu, ray_r_mu_intersects_ground, single_mie_scattering_p);

	// Combine the lookup results to get the scattering between camera and point.
	scattering = scattering - transmittance * scattering_p;
	single_mie_scattering = single_mie_scattering - transmittance * single_mie_scattering_p;

	single_mie_scattering = GetMie(vec4(scattering, single_mie_scattering.r));

	// Hack to avoid rendering artifacts when the sun is below the horizon.
	single_mie_scattering = single_mie_scattering * smoothstep(float(0.0), float(0.01), mu_s);

	return scattering * RayleighPhaseFunction(nu) + 
		single_mie_scattering * MiePhaseFunction(atmosphere.mie_phase_function_g, nu);
}

vec3 GetSunAndSkyIrradiance(vec3 point, vec3 normal, vec3 sun_direction, out vec3 sky_irradiance) {
	float r = length(point);
	float mu_s = dot(point, sun_direction) / r;

	// Indirect irradiance (approximated if the surface is not horizontal).
	sky_irradiance = GetIrradiance(r, mu_s) * (1.0 + dot(normal, point) / r) * 0.5;

	// Direct irradiance.
	return atmosphere.solar_irradiance *
		GetTransmittanceToSun(r, mu_s) *
		max(dot(normal, sun_direction), 0.0);
}
`;

	const AtmosSkyShader = {
		name: 'atmos_sky',
		defines: {
			TRANSMITTANCE_MAPPING: 1,
			INSCATTER_MAPPING: 1,
			TONE_MAPPING: 5,
			SRGB_OUTPUT: true,
			GROUND_ALBEDO: true,
			SKY_SUNDISK: true
		},
		uniforms: {
			/* Atmosphere Uniforms */

			inscatteringTexture: null,
			transmittanceTexture: null,
			irradianceTexture: null,
			cameraPosition: new Array(3),
			sunDirection: new Array(3),
			altitudeCorrection: new Array(3),
			toneMappingExposure: 10.0,
			/* Sky Uniforms */

			sunDiskSize: 1
		},
		vertexShader: /* glsl */`
		#define METER_TO_LENGTH_UNIT ${METER_TO_LENGTH_UNIT.toFixed(7)}

				attribute vec3 a_Position;

		uniform mat4 u_Projection;
		uniform mat4 u_View;
		uniform mat4 u_Model;

		uniform vec3 cameraPosition;
		uniform vec3 altitudeCorrection;

		varying vec3 vCameraPosition;
		varying vec3 vRayDirection;

		void getCameraRay(out vec3 origin, out vec3 direction) {
			mat4 inverseProjectionMatrix = inverse(u_Projection);
			mat4 inverseViewMatrix = inverse(u_Model * u_View); // pre-multiplied by model matrix in case use anchorMatrix

			bool isPerspective = inverseProjectionMatrix[2][3] != 0.0; // 4th entry in the 3rd column

			if (isPerspective) {
				// Calculate the camera ray for a perspective camera.
				vec4 viewPosition = inverseProjectionMatrix * vec4(a_Position.xzy, 1.0);
				vec4 worldDirection = inverseViewMatrix * vec4(viewPosition.xyz, 0.0);
				origin = cameraPosition;
				direction = worldDirection.xyz;
			} else {
				// Unprojected points to calculate direction.
				vec4 nearPoint = inverseProjectionMatrix * vec4(a_Position.xz, -1.0, 1.0);
				vec4 farPoint = inverseProjectionMatrix * vec4(a_Position.xz, -0.9, 1.0);
				nearPoint /= nearPoint.w;
				farPoint /= farPoint.w;

				// Calculate world values
				vec4 worldDirection = inverseViewMatrix * vec4(farPoint.xyz - nearPoint.xyz, 0.0);
				vec4 worldOrigin = inverseViewMatrix * nearPoint;

				// Outputs
				direction = worldDirection.xyz;
				origin = worldOrigin.xyz;
			}
		}
				
				void main() {
			vec3 direction, origin;
				getCameraRay(origin, direction);

			vCameraPosition = (origin + altitudeCorrection) * METER_TO_LENGTH_UNIT;
			vRayDirection = direction;

			gl_Position = vec4(a_Position.xz, 1.0, 1.0);
				}
		`,
		fragmentShader: /* glsl */`
		uniform highp sampler3D inscatteringTexture;
				uniform sampler2D transmittanceTexture;
		uniform sampler2D irradianceTexture;

				uniform float toneMappingExposure;

		uniform vec3 sunDirection;
		uniform float sunDiskSize;

		varying vec3 vCameraPosition;
		varying vec3 vRayDirection;

		${AtmosphereCommon}
		${TransmittanceLookup}
		${InscatterLookup}
		${IrradianceLookup}
		${Runtime}

		${ToneMapping}

		#include <dithering_pars_frag>

				void main() {
			vec3 camera = vCameraPosition;
						vec3 view_ray = normalize(vRayDirection);
						float nu = dot(view_ray, sunDirection);

			vec3 col = vec3(0.0);
			vec3 transmittance = vec3(0.0);

			#ifdef GROUND_ALBEDO
				bool ray_r_mu_intersects_ground = RayIntersectsGround(camera, view_ray);
				if (ray_r_mu_intersects_ground) {
					float distance_to_ground = RaySphereFirstIntersection(camera, view_ray, atmosphere.bottom_radius);
					vec3 ground_point = view_ray * distance_to_ground + camera;
					vec3 surface_normal = normalize(ground_point);

					vec3 skyIrradiance;
					vec3 sunIrradiance = GetSunAndSkyIrradiance(
						camera,
						surface_normal, 
						sunDirection, 
						skyIrradiance
					);

					vec3 inscatter = GetSkyRadianceToPoint(
						camera,
						surface_normal * (atmosphere.bottom_radius + 1.0),
						sunDirection,
						transmittance
					);

					vec3 radiance = atmosphere.ground_albedo * RECIPROCAL_PI * (sunIrradiance + skyIrradiance);
					col = transmittance * radiance + inscatter;

					transmittance = vec3(0.0);
				} else {
					col = GetSkyRadiance(camera, view_ray, sunDirection, true, transmittance);
				}
			#else
				col = GetSkyRadiance(camera, view_ray, sunDirection, true, transmittance);
			#endif

			col = ToneMapping(col);
			
						#ifdef SKY_SUNDISK
				float sun = 0.004 * sunDiskSize * MiePhaseFunction(0.99, nu);
						col += sun * transmittance;
						#endif

						gl_FragColor = vec4(col, 1.);

			#ifdef SRGB_OUTPUT
				gl_FragColor = LinearTosRGB(gl_FragColor);
			#endif

			#include <dithering_frag>
				}
		`
	};

	class AtmosSky extends t3d.Mesh {
		constructor() {
			const material = new t3d.ShaderMaterial(AtmosSkyShader);
			material.depthWrite = false;
			material.side = t3d.DRAW_SIDE.BACK;
			material.dithering = true;
			super(new t3d.PlaneGeometry(2, 2), material);
			this.frustumCulled = false;
		}
		setLUTs(lutsData) {
			const {
				transmittanceTexture,
				inscatterTexture,
				irradianceTexture
			} = lutsData;
			const {
				uniforms,
				defines
			} = this.material;
			uniforms.transmittanceTexture = transmittanceTexture;
			uniforms.inscatteringTexture = inscatterTexture;
			uniforms.irradianceTexture = irradianceTexture;
			uniforms.atmosphere = lutsData.atmosphere.toUniform();
			let needsUpdate = false;
			if (defines.TRANSMITTANCE_MAPPING !== lutsData.transmittanceMapping) {
				defines.TRANSMITTANCE_MAPPING = lutsData.transmittanceMapping;
				needsUpdate = true;
			}
			if (defines.INSCATTER_MAPPING !== lutsData.inscatterMapping) {
				defines.INSCATTER_MAPPING = lutsData.inscatterMapping;
				needsUpdate = true;
			}
			this.material.needsUpdate = needsUpdate;
		}
	}

	const AtmosFogShader = {
		name: 'atmos_fog',
		defines: {
			TRANSMITTANCE_MAPPING: 1,
			INSCATTER_MAPPING: 1,
			CORRECT_GEOMETRIC_ERROR: true,
			SUN_LIGHT: true,
			SKY_LIGHT: true,
			TRANSMITTANCE: true,
			INSCATTER: true
		},
		uniforms: {
			/* Atmosphere Uniforms */

			inscatteringTexture: null,
			transmittanceTexture: null,
			irradianceTexture: null,
			cameraPosition: new Array(3),
			sunDirection: new Array(3),
			altitudeCorrection: new Array(3),
			toneMappingExposure: 10.0,
			/* Fog Uniforms */

			tDiffuse: null,
			depthTexture: null,
			normalTexture: null,
			projectionView: new Array(16),
			anchorMatrix: new Array(16),
			ellipsoidRadii: new Array(3),
			geometricErrorCorrectionAmount: 0.0,
			albedoScale: 2 / Math.PI
		},
		vertexShader: /* glsl */`
		#define METER_TO_LENGTH_UNIT ${METER_TO_LENGTH_UNIT.toFixed(7)}

		attribute vec3 a_Position;
		attribute vec2 a_Uv;

		uniform mat4 u_ProjectionView;
		uniform mat4 u_Model;

		uniform vec3 cameraPosition;
		uniform vec3 altitudeCorrection;
		uniform vec3 ellipsoidRadii;
		uniform float geometricErrorCorrectionAmount;

		varying vec3 vCameraPosition;
		varying vec3 vEllipsoidRadiiSquared;
		varying vec3 vGeometryAltitudeCorrection;
		varying vec2 v_Uv;

		void main() {
			gl_Position = u_ProjectionView * u_Model * vec4(a_Position, 1.0);

			vCameraPosition = (cameraPosition + altitudeCorrection) * METER_TO_LENGTH_UNIT;

			vGeometryAltitudeCorrection = altitudeCorrection * METER_TO_LENGTH_UNIT;
			#ifdef CORRECT_GEOMETRIC_ERROR
				vGeometryAltitudeCorrection *= 1.0 - geometricErrorCorrectionAmount;
			#endif

			vec3 radii = ellipsoidRadii * METER_TO_LENGTH_UNIT;
				vEllipsoidRadiiSquared = radii * radii;

			v_Uv = a_Uv;
		}
	`,
		fragmentShader: /* glsl */`
		uniform highp sampler3D inscatteringTexture;
				uniform sampler2D transmittanceTexture;
		uniform sampler2D irradianceTexture;

		uniform float toneMappingExposure;

		uniform vec3 sunDirection;

		uniform sampler2D tDiffuse;
		uniform sampler2D depthTexture;
		uniform sampler2D normalTexture;
		uniform mat4 projectionView;
		uniform mat4 anchorMatrix;
		uniform float geometricErrorCorrectionAmount;
		uniform float albedoScale;

		varying vec3 vCameraPosition;
		varying vec3 vEllipsoidRadiiSquared;
		varying vec3 vGeometryAltitudeCorrection;
		varying vec2 v_Uv;

		${t3dEffectComposer.octahedronToUnitVectorGLSL}

		${AtmosphereCommon}
		${TransmittanceLookup}
		${InscatterLookup}
		${IrradianceLookup}
		${Runtime}

		void correctGeometricError(inout vec3 positionECEF, inout vec3 normalECEF) {
			// TODO: The error is pronounced at the edge of the ellipsoid due to the
			// large difference between the sphere position and the unprojected position
			// at the current fragment. Calculating the sphere position from the fragment
			// UV may resolve this.

			// Correct way is slerp, but this will be small-angle interpolation anyways.
			vec3 sphereNormal = normalize(positionECEF / vEllipsoidRadiiSquared);
			vec3 spherePosition = atmosphere.bottom_radius * sphereNormal;
			normalECEF = mix(normalECEF, sphereNormal, geometricErrorCorrectionAmount);
			positionECEF = mix(positionECEF, spherePosition, geometricErrorCorrectionAmount);
		}

				void main() {
			vec2 uv = v_Uv;

			vec4 inputColor = texture2D(tDiffuse, uv);

			float depth = texture2D(depthTexture, uv).r;
			vec4 gBufferTexel = texture2D(normalTexture, uv);

			// if (depth >= 1.0 - 1e-8) {
			// 	gl_FragColor = inputColor;
			// 	return;
			// }

			if (gBufferTexel.r < -2.0) {
				gl_FragColor = inputColor;
				return;
			}

			vec4 clipPosition = vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
			vec4 worldPosition4 = anchorMatrix * (inverse(projectionView) * clipPosition);

			vec3 worldPosition = worldPosition4.xyz / worldPosition4.w;
			worldPosition = worldPosition * METER_TO_LENGTH_UNIT + vGeometryAltitudeCorrection;
			vec3 worldNormal = octahedronToUnitVector(gBufferTexel.rg);
			worldNormal = (anchorMatrix * vec4(worldNormal, 0.0)).xyz;
			worldNormal = normalize(worldNormal);

			#ifdef CORRECT_GEOMETRIC_ERROR
				correctGeometricError(worldPosition, worldNormal);
			#endif

			vec3 radiance;
			#if defined(SUN_LIGHT) || defined(SKY_LIGHT)
				vec3 diffuse = inputColor.rgb * albedoScale * RECIPROCAL_PI;
				vec3 skyIrradiance;
					vec3 sunIrradiance = GetSunAndSkyIrradiance(worldPosition, worldNormal, sunDirection, skyIrradiance);

				#if defined(SUN_LIGHT) && defined(SKY_LIGHT)
					radiance = diffuse * (sunIrradiance + skyIrradiance);
				#elif defined(SUN_LIGHT)
					radiance = diffuse * sunIrradiance;
				#elif defined(SKY_LIGHT)
					radiance = diffuse * skyIrradiance;
				#endif
			#else
				radiance = inputColor.rgb;
			#endif

			#if defined(TRANSMITTANCE) || defined(INSCATTER)
				vec3 transmittance;
				vec3 inscatter = GetSkyRadianceToPoint(
					vCameraPosition,
					worldPosition,
					sunDirection,
					transmittance
				);

				#ifdef TRANSMITTANCE
					radiance *= transmittance;
				#endif
				#ifdef INSCATTER
					radiance += inscatter;
				#endif
			#endif
			
						gl_FragColor = vec4(radiance, inputColor.a);
				}
	`
	};

	class AtmosFogEffect extends t3dEffectComposer.Effect {
		constructor() {
			super();
			this.bufferDependencies = [{
				key: 'GBuffer'
			}];
			this._mainPass = new t3d.ShaderPostPass(AtmosFogShader);
		}
		setLUTs(lutsData) {
			const {
				transmittanceTexture,
				inscatterTexture,
				irradianceTexture
			} = lutsData;
			const {
				uniforms,
				defines
			} = this._mainPass.material;
			uniforms.transmittanceTexture = transmittanceTexture;
			uniforms.inscatteringTexture = inscatterTexture;
			uniforms.irradianceTexture = irradianceTexture;
			uniforms.atmosphere = lutsData.atmosphere.toUniform();
			let needsUpdate = false;
			if (defines.TRANSMITTANCE_MAPPING !== lutsData.transmittanceMapping) {
				defines.TRANSMITTANCE_MAPPING = lutsData.transmittanceMapping;
				needsUpdate = true;
			}
			if (defines.INSCATTER_MAPPING !== lutsData.inscatterMapping) {
				defines.INSCATTER_MAPPING = lutsData.inscatterMapping;
				needsUpdate = true;
			}
			this._mainPass.material.needsUpdate = needsUpdate;
		}
		render(renderer, composer, inputRenderTarget, outputRenderTarget, finish) {
			const gBuffer = composer.getBuffer('GBuffer');
			const gBufferRenderStates = gBuffer.getCurrentRenderStates();
			gBufferRenderStates.camera.projectionViewMatrix.toArray(this._mainPass.uniforms.projectionView);
			gBufferRenderStates.scene.anchorMatrix.toArray(this._mainPass.uniforms.anchorMatrix);
			renderer.setRenderTarget(outputRenderTarget);
			renderer.setClearColor(0, 0, 0, 0);
			if (finish) {
				renderer.clear(composer.clearColor, composer.clearDepth, composer.clearStencil);
			} else {
				renderer.clear(true, true, false);
			}
			const mainPass = this._mainPass;
			mainPass.uniforms.tDiffuse = inputRenderTarget.texture;
			mainPass.uniforms.depthTexture = gBuffer.output()._attachments[t3d.ATTACHMENT.DEPTH_STENCIL_ATTACHMENT];
			mainPass.uniforms.normalTexture = gBuffer.output()._attachments[t3d.ATTACHMENT.COLOR_ATTACHMENT0];
			if (finish) {
				mainPass.material.transparent = composer._tempClearColor[3] < 1 || !composer.clearColor;
				mainPass.renderStates.camera.rect.fromArray(composer._tempViewport);
			}
			mainPass.render(renderer);
			if (finish) {
				mainPass.material.transparent = false;
				mainPass.renderStates.camera.rect.set(0, 0, 1, 1);
			}
		}
		dispose() {
			this._mainPass.dispose();
		}
	}

	// ref https://ebruneton.github.io/precomputed_atmospheric_scattering
	// ref https://www.shadertoy.com/view/DsBGWG
	const TransmittanceCompute = /* glsl */`
#define TRANSMITTANCE_INTEGRAL_SAMPLES 50

// total optical length of rayleigh or mie
float OpticalDepth(float H, float r, float mu) {
	float dx = DistanceToTopAtmosphereBoundary(r, mu) / float(TRANSMITTANCE_INTEGRAL_SAMPLES);
	
	float xi = 0.0;
	float yi = exp(-(r - atmosphere.bottom_radius) / H);
	float result = 0.0; 
	for (int i = 1; i <= TRANSMITTANCE_INTEGRAL_SAMPLES; ++i) {
		float xj = float(i) * dx; 
		float yj = exp(-(sqrt(r * r + xj * xj + 2.0 * xj * r * mu) - atmosphere.bottom_radius) / H);
		result += (yi + yj) / 2.0 * dx;
		xi = xj;
		yi = yj;
	}
	
	return mu < -sqrt(1.0 - (atmosphere.bottom_radius / r) * (atmosphere.bottom_radius / r)) ? 1e9 : result; 
}

// total optical length of Ozone
float OpticalDepth_O3(float r, float mu) {
	float dx = DistanceToTopAtmosphereBoundary(r, mu) / float(TRANSMITTANCE_INTEGRAL_SAMPLES);

	float result = 0.0;
	for (int i = 0; i <= TRANSMITTANCE_INTEGRAL_SAMPLES; ++i) {
		float d_i = float(i) * dx;
		float r_i = sqrt(d_i * d_i + 2.0 * r * mu * d_i + r * r);
		float height = r_i - atmosphere.bottom_radius;
		float linear_term = 0.0, constant_term = 0.0;
		// 2 Ozone layers
		linear_term = height < 25.0 ? 0.066667 : -0.066667;
		constant_term = height < 25.0 ? -0.66667 : 2.666667;
		float y_i = linear_term * height + constant_term;
		y_i = clamp(y_i, 0.0, 1.0);
		result += y_i * dx;
	}
	return result;
}

#if TRANSMITTANCE_MAPPING == 0
	void GetRMuFromTransmittanceUv(vec2 uv, out float r, out float mu) {
		mu = -0.15 + uv.x * (1.0 + 0.15);
		r = atmosphere.bottom_radius + uv.y * (atmosphere.top_radius - atmosphere.bottom_radius);
	}
#elif TRANSMITTANCE_MAPPING == 1
	void GetRMuFromTransmittanceUv(vec2 uv, out float r, out float mu) {
		mu = -0.15 + tan(1.5 * uv.x) / tan(1.5) * (1.0 + 0.15);
		r = atmosphere.bottom_radius + (uv.y * uv.y) * (atmosphere.top_radius - atmosphere.bottom_radius);
	}
#else
	void GetRMuFromTransmittanceUv(vec2 uv, out float r, out float mu) {
		float H = sqrt(atmosphere.top_radius * atmosphere.top_radius - atmosphere.bottom_radius * atmosphere.bottom_radius);
		vec2 TRANSMITTANCE_TEXTURE_SIZE = vec2(TRANSMITTANCE_TEXTURE_WIDTH, TRANSMITTANCE_TEXTURE_HEIGHT);
		uv = gl_FragCoord.xy / TRANSMITTANCE_TEXTURE_SIZE;
		float x_mu = GetUnitRangeFromTextureCoord(uv.x, TRANSMITTANCE_TEXTURE_WIDTH);
		float x_r = GetUnitRangeFromTextureCoord(uv.y, TRANSMITTANCE_TEXTURE_HEIGHT);
		float rho = H * x_r;
		r = sqrt(rho * rho + atmosphere.bottom_radius * atmosphere.bottom_radius);
		float d_min = atmosphere.top_radius - r;
		float d_max = rho + H;
		float d = d_min + x_mu * (d_max - d_min);
		mu = d <= 0.0 ? 1.0 : (H * H - rho * rho - d * d) / (2.0 * r * d);
		mu = ClampCosine(mu);
	}
#endif

vec3 ComputeTransmittance(vec2 uv) {
	float r, muS;

	GetRMuFromTransmittanceUv(uv, r, muS);

	vec3 depth = atmosphere.rayleigh_scattering * OpticalDepth(HR, r, muS) + atmosphere.mie_extinction * OpticalDepth(HM, r, muS);

	#if TRANSMITTANCE_MAPPING == 2
		depth += atmosphere.absorption_extinction * OpticalDepth_O3(r, muS);
	#endif

	return exp(-depth);
}
`;

	const TransmittanceShader = {
		name: 'atmos_transmittance',
		uniforms: {},
		vertexShader: /* glsl */`
				attribute vec3 a_Position;
				attribute vec2 a_Uv;
					 
				uniform mat4 u_ProjectionView;
				uniform mat4 u_Model;

				varying vec2 v_Uv;

				void main() {
						v_Uv = a_Uv;
						gl_Position = u_ProjectionView * u_Model * vec4(a_Position, 1.0);
				}
		`,
		fragmentShader: /* glsl */`
				varying vec2 v_Uv;

				${AtmosphereCommon}
		${TransmittanceCompute}

				void main() {
						gl_FragColor = vec4(ComputeTransmittance(v_Uv), 1.0);
				}
		`
	};

	const InscatterCompute = /* glsl */`
#define INSCATTER_INTEGRAL_SAMPLES 25

void GetRMuMuSNuFromScatteringUvwz(vec4 uvwz, out float r, out float mu, out float muS, out float nu, out bool rayIntersectsGround) {
	float xMuS = GetUnitRangeFromTextureCoord(uvwz.y, SCATTERING_TEXTURE_MU_S_SIZE);

	float H = sqrt(atmosphere.top_radius * atmosphere.top_radius - atmosphere.bottom_radius * atmosphere.bottom_radius);
	float rho = H * GetUnitRangeFromTextureCoord(uvwz.w, SCATTERING_TEXTURE_R_SIZE);
	r = sqrt(rho * rho + atmosphere.bottom_radius * atmosphere.bottom_radius);

	#if INSCATTER_MAPPING == 1
		if (uvwz.z < 0.5) { // bottom half
			float dmin = r - atmosphere.bottom_radius;
			float dmax = rho;
			float d = dmin + (dmax - dmin) * GetUnitRangeFromTextureCoord(1. - 2. * uvwz.z, SCATTERING_TEXTURE_MU_SIZE / 2);
			mu = d == 0.0 ? -1.0 : ClampCosine(-(rho * rho + d * d) / (2.0 * r * d));
			rayIntersectsGround = true;
		} else {
			float dmin = atmosphere.top_radius - r;
			float dmax = rho + H;
			uvwz.z = clamp(uvwz.z, 0.5, 0.99); // fix jagged bright lines at the horizon, but why ?
			float d = dmin + (dmax - dmin) * GetUnitRangeFromTextureCoord(2. * uvwz.z - 1., SCATTERING_TEXTURE_MU_SIZE / 2);
			mu = d == 0.0 ? 1.0 : ClampCosine((H * H - rho * rho - d * d) / (2.0 * r * d));
			rayIntersectsGround = false;
		}
	
		// paper formula 
		// muS = -(0.6 + log(1.0 - xMuS * (1.0 -	exp(-3.6)))) / 3.0; 
		// better formula 
		// muS = tan((2.0 * xMuS - 1.0 + 0.26) * 0.75) / tan(1.26 * 0.75);

		float d_min = atmosphere.top_radius - atmosphere.bottom_radius;
		float d_max = H;
		float D = DistanceToTopAtmosphereBoundary(atmosphere.bottom_radius, -0.2);
		float A = (D - d_min) / (d_max - d_min);
		float a = (A - xMuS * A) / (1.0 + xMuS * A);
		float d = d_min + min(a, A) * (d_max - d_min);
		muS = d == 0.0 ? 1.0 : ClampCosine((H * H - d * d) / (2.0 * atmosphere.bottom_radius * d));
	#else 
		mu = -1.0 + 2.0 * GetUnitRangeFromTextureCoord(uvwz.z, SCATTERING_TEXTURE_MU_SIZE);
		muS = -0.2 + xMuS * 1.2;
	#endif

	nu = ClampCosine(uvwz.x * 2.0 - 1.0);
}

void ComputeSingleScatteringIntegrand(float r, float mu, float muS, float nu, float d, bool rayIntersectsGround, out vec3 rayleigh, out float mie) {
	float ri = ClampRadius(sqrt(r * r + d * d + 2.0 * r * mu * d));
	float muSi = ClampCosine((muS * r + nu * d) / ri);

	vec3 transmittance = GetTransmittance(r, mu, d, rayIntersectsGround) *
		GetTransmittanceToSun(ri, muSi);

	rayleigh = exp(-(ri - atmosphere.bottom_radius) / HR) * transmittance;
	mie = exp(-(ri - atmosphere.bottom_radius) / HM) * transmittance.x; // only calc the red channel
}

void ComputeSingleScattering(float r, float mu, float muS, float nu, bool rayIntersectsGround, out vec3 ray, out float mie) {
	ray = vec3(0., 0., 0.);
	mie = 0.0; // single channel only

	float dx = DistanceToNearestAtmosphereBoundary(r, mu, rayIntersectsGround)
		/ float(INSCATTER_INTEGRAL_SAMPLES);

	vec3 rayi;
	float miei;

	ComputeSingleScatteringIntegrand(r, mu, muS, nu, 0.0, rayIntersectsGround, rayi, miei);

	for (int i = 1; i <= INSCATTER_INTEGRAL_SAMPLES; ++i) {
		float xj = float(i) * dx; 

		vec3 rayj;
		float miej;

		ComputeSingleScatteringIntegrand(r, mu, muS, nu, xj, rayIntersectsGround, rayj, miej);
		
		ray += (rayi + rayj) / 2.0 * dx;
		mie += (miei + miej) / 2.0 * dx;

		rayi = rayj;
		miei = miej;
	}

	ray *= atmosphere.rayleigh_scattering;
	mie *= atmosphere.mie_scattering.x;
}
`;

	const InscatterShader = {
		name: 'atmos_inscatter',
		defines: {},
		uniforms: {
			transmittanceTexture: null,
			layer: 0
		},
		vertexShader: /* glsl */`
				attribute vec3 a_Position;
				attribute vec2 a_Uv;
					 
				uniform mat4 u_ProjectionView;
				uniform mat4 u_Model;

				varying vec2 v_Uv;

				void main() {
						v_Uv = a_Uv;
						gl_Position = u_ProjectionView * u_Model * vec4(a_Position, 1.0);
				}
		`,
		fragmentShader: /* glsl */`
				${AtmosphereCommon}

		uniform sampler2D transmittanceTexture;

		uniform float layer;

				varying vec2 v_Uv;

		${TransmittanceLookup}
		${InscatterCompute} 
				
				void main() {
			vec2 uv = v_Uv;

			const vec4 SCATTERING_TEXTURE_SIZE = vec4(
				SCATTERING_TEXTURE_NU_SIZE - 1,
				SCATTERING_TEXTURE_MU_S_SIZE,
				SCATTERING_TEXTURE_MU_SIZE,
				SCATTERING_TEXTURE_R_SIZE
			);

			float fragCoordNu = floor(gl_FragCoord.x / float(SCATTERING_TEXTURE_MU_S_SIZE));
			float fragCoordMuS = mod(gl_FragCoord.x, float(SCATTERING_TEXTURE_MU_S_SIZE));

			float fragCoordY = gl_FragCoord.y;

			float fragCoordZ = GetTextureCoordFromUnitRange(layer, SCATTERING_TEXTURE_R_SIZE);

			vec4 uvwz = vec4(fragCoordNu, fragCoordMuS, fragCoordY, fragCoordZ) / SCATTERING_TEXTURE_SIZE;
			
						float r, mu, muS, nu;
			bool rayIntersectsGround;
						GetRMuMuSNuFromScatteringUvwz(uvwz, r, mu, muS, nu, rayIntersectsGround);

			vec3 ray;
						float mie; // only calc the red channel
						ComputeSingleScattering(r, mu, muS, nu, rayIntersectsGround, ray, mie);
						
						// store only red component of single Mie scattering (cf. 'Angular precision')
						gl_FragColor = vec4(ray, mie);
				}
		`
	};

	const IrradianceCompute = /* glsl */`
void GetRMuSFromIrradianceUv(vec2 uv, out float r, out float mu_s) {
	float x_mu_s = GetUnitRangeFromTextureCoord(uv.x, IRRADIANCE_TEXTURE_WIDTH);
	float x_r = GetUnitRangeFromTextureCoord(uv.y, IRRADIANCE_TEXTURE_HEIGHT);
	r = atmosphere.bottom_radius + x_r * (atmosphere.top_radius - atmosphere.bottom_radius);
	mu_s = ClampCosine(2.0 * x_mu_s - 1.0);
}

const float sun_angular_radius = 0.004675; // radians

vec3 ComputeDirectIrradiance(float r, float mu_s) {
	float alpha_s = sun_angular_radius;
	// Approximate average of the cosine factor mu_s over the visible fraction of
	// the Sun disc.
	float average_cosine_factor =
		mu_s < -alpha_s ? 0.0 : (mu_s > alpha_s ? mu_s :
		(mu_s + alpha_s) * (mu_s + alpha_s) / (4.0 * alpha_s));

	return atmosphere.solar_irradiance *
		GetTransmittanceToTopAtmosphereBoundary(r, mu_s) * average_cosine_factor;
}

vec3 ComputeIndirectIrradiance(float r, float mu_s) {
	const int SAMPLE_COUNT = 32;
	const float dphi = PI / float(SAMPLE_COUNT);
	const float dtheta = PI / float(SAMPLE_COUNT);

	vec3 result = vec3(0.0);
	vec3 omega_s = vec3(sqrt(1.0 - mu_s * mu_s), 0.0, mu_s);
	for (int j = 0; j < SAMPLE_COUNT / 2; ++j) {
		float theta = (float(j) + 0.5) * dtheta;
		for (int i = 0; i < 2 * SAMPLE_COUNT; ++i) {
			float phi = (float(i) + 0.5) * dphi;
			vec3 omega =
				vec3(cos(phi) * sin(theta), sin(phi) * sin(theta), cos(theta));
			float domega = dtheta * dphi * sin(theta);

			float nu = dot(omega, omega_s);

			vec3 single_mie_scattering;

			vec3 scattering = GetCombinedScattering(r, omega.z, mu_s, nu, false, single_mie_scattering);

			result += (scattering * RayleighPhaseFunction(nu) + single_mie_scattering *
				MiePhaseFunction(miePhaseFunctionG, nu)) *
				omega.z * domega;
		}
	}
	return result;
}
`;

	const IrradianceShader = {
		name: 'atmos_irradiance',
		uniforms: {
			transmittanceTexture: null,
			inscatteringTexture: null,
			miePhaseFunctionG: 0.8
		},
		vertexShader: /* glsl */`
				attribute vec3 a_Position;
				attribute vec2 a_Uv;
					 
				uniform mat4 u_ProjectionView;
				uniform mat4 u_Model;

				varying vec2 v_Uv;

				void main() {
						v_Uv = a_Uv;
						gl_Position = u_ProjectionView * u_Model * vec4(a_Position, 1.0);
				}
		`,
		fragmentShader: /* glsl */`
				varying vec2 v_Uv;

				${AtmosphereCommon}

		uniform sampler2D transmittanceTexture;
		
		uniform highp sampler3D inscatteringTexture;

		uniform float miePhaseFunctionG;

		${TransmittanceLookup}
		${InscatterLookup}
		${IrradianceCompute}

				void main() {
						float r, mu_s;
			GetRMuSFromIrradianceUv(v_Uv, r, mu_s);
			gl_FragColor = vec4(ComputeIndirectIrradiance(r, mu_s), 1.0);
				}
		`
	};

	const LUMINANCE_COEFFS = /* #__PURE__ */new t3d.Vector3(0.2126, 0.7152, 0.0722);
	class AtmosParameters {
		constructor() {
			// The solar irradiance at the top of the atmosphere.
			this.solarIrradiance = new t3d.Vector3(1.474, 1.8504, 1.91198);

			// The distance between the planet center and the bottom of the atmosphere in
			// meters.
			this.bottomRadius = 6360000;

			// The distance between the planet center and the top of the atmosphere in
			// meters.
			this.topRadius = 6420000;

			// The scattering coefficient of air molecules at the altitude where their
			// density is maximum (usually the bottom of the atmosphere), as a function of
			// wavelength. The scattering coefficient at altitude h is equal to
			// "rayleighScattering" times "rayleighDensity" at this altitude.
			this.rayleighScattering = new t3d.Vector3(0.005802, 0.013558, 0.0331);

			// The scattering coefficient of aerosols at the altitude where their density
			// is maximum (usually the bottom of the atmosphere), as a function of
			// wavelength. The scattering coefficient at altitude h is equal to
			// "mieScattering" times "mieDensity" at this altitude.
			this.mieScattering = new t3d.Vector3(0.003996, 0.003996, 0.003996);

			// The extinction coefficient of aerosols at the altitude where their density
			// is maximum (usually the bottom of the atmosphere), as a function of
			// wavelength. The extinction coefficient at altitude h is equal to
			// "mieExtinction" times "mieDensity" at this altitude.
			this.mieExtinction = new t3d.Vector3(0.00444, 0.00444, 0.00444);

			// The asymmetry parameter for the Cornette-Shanks phase function for the
			// aerosols.
			this.miePhaseFunctionG = 0.8;

			// The extinction coefficient of molecules that absorb light (e.g. ozone) at
			// the altitude where their density is maximum, as a function of wavelength.
			// The extinction coefficient at altitude h is equal to
			// "absorptionExtinction" times "absorptionDensity" at this altitude.
			this.absorptionExtinction = new t3d.Vector3(0.00065, 0.001881, 0.000085);

			// The average albedo of the ground.
			this.groundAlbedo = new t3d.Color3(0.1, 0.1, 0.1);

			// Radiance to luminance conversion
			this.sunRadianceToLuminance = new t3d.Vector3(98242.786222, 69954.398112, 66475.012354);
			this.skyRadianceToLuminance = new t3d.Vector3(114974.916437, 71305.954816, 65310.548555);

			// Luminance values are too large for storing in half precision buffer.
			// We divide them by the luminance of the sun with the unit radiance.
			const luminance = LUMINANCE_COEFFS.dot(this.sunRadianceToLuminance);
			this.sunRadianceToRelativeLuminance = this.sunRadianceToLuminance.clone().multiplyScalar(1 / luminance);
			this.skyRadianceToRelativeLuminance = this.skyRadianceToLuminance.clone().multiplyScalar(1 / luminance);
		}
		toUniform() {
			return {
				solar_irradiance: this.solarIrradiance.toArray(),
				bottom_radius: this.bottomRadius * METER_TO_LENGTH_UNIT,
				top_radius: this.topRadius * METER_TO_LENGTH_UNIT,
				rayleigh_scattering: this.rayleighScattering.toArray(),
				mie_scattering: this.mieScattering.toArray(),
				mie_extinction: this.mieExtinction.toArray(),
				mie_phase_function_g: this.miePhaseFunctionG,
				absorption_extinction: this.absorptionExtinction.toArray(),
				ground_albedo: this.groundAlbedo.toArray()
			};
		}
	}
	AtmosParameters.DEFAULT = new AtmosParameters();

	class AtmosLUTsGenerator {
		constructor(capabilities, options = {}) {
			const isWebGL2 = capabilities.version > 1;
			const atmosphere = options.atmosphere !== undefined ? options.atmosphere : AtmosParameters.DEFAULT;

			// Transmittance mapping
			// 0 - linear implementation
			// 1 - original implementation in 2008
			// 2 - new implementation in 2017
			const transmittanceMapping = options.transmittanceMapping !== undefined ? options.transmittanceMapping : 1;

			// Inscatter mapping
			// 0 - linear implementation
			// 1 - non-linear implementation
			const inscatterMapping = options.inscatterMapping !== undefined ? options.inscatterMapping : 1;

			// ios provides a poor implementation of float linear, so fallback to Half Float
			const isIOS = /(iPad|iPhone|iPod)/g.test(navigator.userAgent);
			let type;
			if (isWebGL2) {
				if (capabilities.getExtension('EXT_color_buffer_float') && capabilities.getExtension('OES_texture_float_linear') && !isIOS) {
					type = t3d.PIXEL_TYPE.FLOAT;
				} else {
					type = t3d.PIXEL_TYPE.HALF_FLOAT;
				}
			} else {
				if (capabilities.getExtension('OES_texture_float') && capabilities.getExtension('OES_texture_float_linear') && !isIOS) {
					type = t3d.PIXEL_TYPE.FLOAT;
				} else if (capabilities.getExtension('OES_texture_half_float') && capabilities.getExtension('OES_texture_half_float_linear')) {
					type = t3d.PIXEL_TYPE.HALF_FLOAT;
				} else {
					type = t3d.PIXEL_TYPE.UNSIGNED_BYTE;
					console.warn('Half float texture is not supported!');
				}
			}

			// Render targets

			const transmittanceRT = new t3d.RenderTarget2D(TRANSMITTANCE_TEXTURE_WIDTH, TRANSMITTANCE_TEXTURE_HEIGHT);
			transmittanceRT.texture.minFilter = t3d.TEXTURE_FILTER.LINEAR;
			transmittanceRT.texture.magFilter = t3d.TEXTURE_FILTER.LINEAR;
			transmittanceRT.texture.type = type;
			transmittanceRT.texture.format = t3d.PIXEL_FORMAT.RGBA;
			transmittanceRT.texture.generateMipmaps = false;
			const inscatterRT = new t3d.RenderTarget3D(SCATTERING_TEXTURE_WIDTH, SCATTERING_TEXTURE_HEIGHT, SCATTERING_TEXTURE_DEPTH);
			inscatterRT.texture.minFilter = t3d.TEXTURE_FILTER.LINEAR;
			inscatterRT.texture.magFilter = t3d.TEXTURE_FILTER.LINEAR;
			inscatterRT.texture.type = type;
			inscatterRT.texture.format = t3d.PIXEL_FORMAT.RGBA;
			inscatterRT.texture.generateMipmaps = false;
			const irradianceRT = new t3d.RenderTarget2D(IRRADIANCE_TEXTURE_WIDTH, IRRADIANCE_TEXTURE_HEIGHT);
			irradianceRT.texture.minFilter = t3d.TEXTURE_FILTER.LINEAR;
			irradianceRT.texture.magFilter = t3d.TEXTURE_FILTER.LINEAR;
			irradianceRT.texture.type = type;
			irradianceRT.texture.format = t3d.PIXEL_FORMAT.RGBA;
			irradianceRT.texture.generateMipmaps = false;

			// Render Passes

			const atmosphereUniform = atmosphere.toUniform();
			const transmittancePass = new t3d.ShaderPostPass(TransmittanceShader);
			transmittancePass.uniforms.atmosphere = atmosphereUniform;
			transmittancePass.material.defines.TRANSMITTANCE_MAPPING = transmittanceMapping;
			const inscatterPass = new t3d.ShaderPostPass(InscatterShader);
			inscatterPass.uniforms.transmittanceTexture = transmittanceRT.texture;
			inscatterPass.uniforms.atmosphere = atmosphereUniform;
			inscatterPass.material.defines.TRANSMITTANCE_MAPPING = transmittanceMapping;
			inscatterPass.material.defines.INSCATTER_MAPPING = inscatterMapping;
			const irradiancePass = new t3d.ShaderPostPass(IrradianceShader);
			irradiancePass.uniforms.transmittanceTexture = transmittanceRT.texture;
			irradiancePass.uniforms.inscatteringTexture = inscatterRT.texture;
			irradiancePass.uniforms.atmosphere = atmosphereUniform;
			irradiancePass.material.defines.TRANSMITTANCE_MAPPING = transmittanceMapping;
			irradiancePass.material.defines.INSCATTER_MAPPING = inscatterMapping;

			//

			this._transmittanceRT = transmittanceRT;
			this._inscatterRT = inscatterRT;
			this._irradianceRT = irradianceRT;
			this._transmittancePass = transmittancePass;
			this._inscatterPass = inscatterPass;
			this._irradiancePass = irradiancePass;
			this._data = {
				transmittanceTexture: transmittanceRT.texture,
				inscatterTexture: inscatterRT.texture,
				irradianceTexture: irradianceRT.texture,
				atmosphere,
				transmittanceMapping: transmittanceMapping,
				inscatterMapping: inscatterMapping
			};
		}
		get data() {
			return this._data;
		}
		computeTransmittance(renderer) {
			renderer.setRenderTarget(this._transmittanceRT);
			renderer.setClearColor(0, 0, 0, 0);
			renderer.clear(true, true, true);
			this._transmittancePass.render(renderer);
		}
		computeInscatter(renderer) {
			const inscatterRT = this._inscatterRT;
			const inscatterPass = this._inscatterPass;
			if (inscatterRT.isRenderTarget3D) {
				for (let i = 0; i < 32; i++) {
					inscatterRT.activeLayer = i;
					inscatterPass.uniforms.layer = i;
					renderer.setRenderTarget(inscatterRT);
					renderer.setClearColor(0, 0, 0, 0);
					renderer.clear(true, true, true);
					inscatterPass.render(renderer);
				}
			} else {
				renderer.setRenderTarget(inscatterRT);
				renderer.setClearColor(0, 0, 0, 0);
				renderer.clear(true, true, true);
				inscatterPass.render(renderer);
			}
		}
		computeIrradiance(renderer) {
			renderer.setRenderTarget(this._irradianceRT);
			renderer.setClearColor(0, 0, 0, 0);
			renderer.clear(true, true, true);
			this._irradiancePass.render(renderer);
		}
		readTransmittancePixels(renderer) {
			readPixels(renderer, this._transmittanceRT);
		}
		readIrradiancePixels(renderer) {
			readPixels(renderer, this._irradianceRT);
		}
		dispose() {
			this._transmittanceRT.dispose();
			this._inscatterRT.dispose();
			this._irradianceRT.dispose();
			this._transmittancePass.dispose();
			this._inscatterPass.dispose();
			this._irradiancePass.dispose();
		}
	}
	function readPixels(renderer, renderTarget) {
		const {
			width,
			height,
			texture
		} = renderTarget;
		const imageData = texture.type === t3d.PIXEL_TYPE.HALF_FLOAT ? new Uint16Array(width * height * 4) : new Float32Array(width * height * 4);
		renderer.setRenderTarget(renderTarget);
		renderer.readRenderTargetPixels(0, 0, width, height, imageData);
		texture.userData.imageData = imageData;
	}

	class AtmosLUTsLoader {
		constructor(capabilities, options = {}) {
			this._fileLoader = new t3d.FileLoader(options.manager);
			this._fileLoader.setResponseType('arraybuffer');
			this._data = {
				transmittanceTexture: null,
				inscatterTexture: null,
				irradianceTexture: null,
				atmosphere: AtmosParameters.DEFAULT,
				transmittanceMapping: 2,
				inscatterMapping: 1
			};
			let type = t3d.PIXEL_TYPE.FLOAT;
			const isWebGL2 = capabilities.version > 1;
			if (isWebGL2) {
				if (capabilities.getExtension('EXT_color_buffer_float') && capabilities.getExtension('OES_texture_float_linear')) {
					type = t3d.PIXEL_TYPE.FLOAT;
				} else {
					type = t3d.PIXEL_TYPE.HALF_FLOAT;
				}
			} else {
				if (capabilities.getExtension('OES_texture_float') && capabilities.getExtension('OES_texture_float_linear')) {
					type = t3d.PIXEL_TYPE.FLOAT;
				} else if (capabilities.getExtension('OES_texture_half_float') && capabilities.getExtension('OES_texture_half_float_linear')) {
					type = t3d.PIXEL_TYPE.HALF_FLOAT;
				} else {
					type = t3d.PIXEL_TYPE.UNSIGNED_BYTE;
					console.warn('Half float texture is not supported!');
				}
			}
			const transmittanceTexture = new t3d.Texture2D();
			transmittanceTexture.minFilter = t3d.TEXTURE_FILTER.LINEAR;
			transmittanceTexture.magFilter = t3d.TEXTURE_FILTER.LINEAR;
			transmittanceTexture.type = type;
			transmittanceTexture.generateMipmaps = false;
			transmittanceTexture.flipY = false;
			this._data.transmittanceTexture = transmittanceTexture;
			const inscatterTexture = new t3d.Texture3D();
			inscatterTexture.minFilter = t3d.TEXTURE_FILTER.LINEAR;
			inscatterTexture.magFilter = t3d.TEXTURE_FILTER.LINEAR;
			inscatterTexture.type = type;
			inscatterTexture.format = t3d.PIXEL_FORMAT.RGBA;
			inscatterTexture.generateMipmaps = false;
			this._data.inscatterTexture = inscatterTexture;
			const irradianceTexture = new t3d.Texture2D();
			irradianceTexture.minFilter = t3d.TEXTURE_FILTER.LINEAR;
			irradianceTexture.magFilter = t3d.TEXTURE_FILTER.LINEAR;
			irradianceTexture.type = type;
			irradianceTexture.generateMipmaps = false;
			irradianceTexture.flipY = false;
			this._data.irradianceTexture = irradianceTexture;
		}
		get data() {
			return this._data;
		}
		loadTransmittanceTexture(url) {
			return this._fileLoader.loadAsync(url).then(data => {
				const texture = this._data.transmittanceTexture;
				texture.image = {
					data: getImageDataFromArrayBuffer(data, texture.type),
					width: 256,
					height: 64
				};
				texture.version++;
			});
		}
		loadInscatterTexture(url) {
			return this._fileLoader.loadAsync(url).then(data => {
				const texture = this._data.inscatterTexture;
				texture.image = {
					data: getImageDataFromArrayBuffer(data, texture.type),
					width: 256,
					height: 128,
					depth: 32
				};
				texture.version++;
			});
		}
		loadIrradianceTexture(url) {
			return this._fileLoader.loadAsync(url).then(data => {
				const texture = this._data.irradianceTexture;
				texture.image = {
					data: getImageDataFromArrayBuffer(data, texture.type),
					width: 64,
					height: 16
				};
				texture.version++;
			});
		}
		dispose() {
			this._data.transmittanceTexture.dispose();
			this._data.inscatterTexture.dispose();
			this._data.irradianceTexture.dispose();
		}
	}
	function getImageDataFromArrayBuffer(arrayBuffer, type) {
		const halfFloatArray = new Uint16Array(arrayBuffer);
		const length = halfFloatArray.length;
		if (type === t3d.PIXEL_TYPE.FLOAT) {
			const floatArray = new Float32Array(length);
			for (let i = 0; i < length; i++) {
				floatArray[i] = t3d.MathUtils.fromHalfFloat(halfFloatArray[i]);
			}
			return floatArray;
		} else if (type === t3d.PIXEL_TYPE.HALF_FLOAT) {
			return halfFloatArray;
		} else {
			const uint8Array = new Uint8Array(length);
			for (let i = 0; i < length; i++) {
				uint8Array[i] = Math.round(t3d.MathUtils.fromHalfFloat(halfFloatArray[i]) * 255);
			}
			return uint8Array;
		}
	}

	const vectorScratch = /* #__PURE__ */new t3d.Vector3();
	const vectorScratch2$3 = /* #__PURE__ */new t3d.Vector3();
	function getAltitudeCorrectionOffset(cameraPosition, bottomRadius, ellipsoid, result) {
		const surfacePosition = ellipsoid.getPositionToSurfacePoint(cameraPosition, vectorScratch);
		return surfacePosition != null ? getOsculatingSphereCenter(ellipsoid, surfacePosition, bottomRadius, result).negate() : result.setScalar(0);
	}
	function getOsculatingSphereCenter(ellipsoid, surfacePosition, radius, result) {
		const a2 = ellipsoid.radius.x ** 2;
		const b2 = ellipsoid.radius.z ** 2;
		const normal = vectorScratch2$3.set(surfacePosition.x / a2, surfacePosition.y / a2, surfacePosition.z / b2).normalize();
		return result.copy(normal.multiplyScalar(-radius).add(surfacePosition));
	}

	function getScatteringCoefficient(wavelengths, skyTint, atmosphereThickness, result) {
		// Sky Tint shifts the value of Wavelengths
		const variableRangeWavelengths = _vec3_1.set(t3d.MathUtils.lerp(wavelengths.x + 150, wavelengths.x - 150, skyTint.r), t3d.MathUtils.lerp(wavelengths.y + 150, wavelengths.y - 150, skyTint.g), t3d.MathUtils.lerp(wavelengths.z + 150, wavelengths.z - 150, skyTint.b));
		variableRangeWavelengths.x = t3d.MathUtils.clamp(variableRangeWavelengths.x, 380, 780);
		variableRangeWavelengths.y = t3d.MathUtils.clamp(variableRangeWavelengths.y, 380, 780);
		variableRangeWavelengths.z = t3d.MathUtils.clamp(variableRangeWavelengths.z, 380, 780);

		// Evaluate Beta Rayleigh function is based on A.J.Preetham

		const WL = variableRangeWavelengths.multiplyScalar(1e-9); // nano meter unit

		const n = 1.0003; // the index of refraction of air
		const N = 2.545e25; // molecular density at sea level
		const pn = 0.035; // depolatization factor for standard air

		const waveLength4 = _vec3_2.set(Math.pow(WL.x, 4), Math.pow(WL.y, 4), Math.pow(WL.z, 4));
		const delta = waveLength4.multiplyScalar(3.0 * N * (6.0 - 7.0 * pn));
		const ray = 8 * Math.pow(Math.PI, 3) * Math.pow(n * n - 1.0, 2) * (6.0 + 3.0 * pn);
		result.set(ray / delta.x, ray / delta.y, ray / delta.z);

		// Atmosphere Thickness ( Rayleigh ) scale
		const Km = 1000.0; // kilo meter unit
		result.multiplyScalar(Km * atmosphereThickness);
		return result;
	}
	const _vec3_1 = new t3d.Vector3();
	const _vec3_2 = new t3d.Vector3();

	function safeSqrt(a) {
		return Math.sqrt(Math.max(a, 0));
	}
	function clampDistance(d) {
		return Math.max(d, 0);
	}
	function rayIntersectsGround(atmosphere, r, mu) {
		const {
			bottomRadius
		} = atmosphere;
		return mu < 0 && r ** 2 * (mu ** 2 - 1) + bottomRadius ** 2 >= 0;
	}
	function distanceToTopAtmosphereBoundary(atmosphere, r, mu) {
		const {
			topRadius
		} = atmosphere;
		const discriminant = r ** 2 * (mu ** 2 - 1) + topRadius ** 2;
		return clampDistance(-r * mu + safeSqrt(discriminant));
	}
	function getTextureCoordFromUnitRange(x, textureSize) {
		return 0.5 / textureSize + x * (1 - 1 / textureSize);
	}

	const vectorScratch1$2 = /* #__PURE__ */new t3d.Vector3();
	const vectorScratch2$2 = /* #__PURE__ */new t3d.Vector3();
	const vectorScratch3 = /* #__PURE__ */new t3d.Vector3();
	function getImageData(texture) {
		if (texture.image.data) {
			return texture.image.data;
		}
		if (texture.userData.imageData) {
			return texture.userData.imageData;
		}
		return undefined;
	}
	function samplePixel(data, index, result) {
		const dataIndex = index * 4; // Assume RGBA
		return result.fromArray(data, dataIndex, true);
	}
	function sampleTexture(texture, uv, result) {
		const data = getImageData(texture);
		if (data == null) {
			return result.setScalar(0);
		}
		const {
			width,
			height
		} = texture.image;
		const x = t3d.MathUtils.clamp(uv.x, 0, 1) * (width - 1);
		const y = t3d.MathUtils.clamp(uv.y, 0, 1) * (height - 1);
		const xi = Math.floor(x);
		const yi = Math.floor(y);
		const tx = x - xi;
		const ty = y - yi;
		const sx = tx;
		const sy = ty;
		const rx0 = xi % width;
		const rx1 = (rx0 + 1) % width;
		const ry0 = yi % height;
		const ry1 = (ry0 + 1) % height;
		const v00 = samplePixel(data, ry0 * width + rx0, vectorScratch1$2);
		const v10 = samplePixel(data, ry0 * width + rx1, vectorScratch2$2);
		const nx0 = v00.lerp(v10, sx);
		const v01 = samplePixel(data, ry1 * width + rx0, vectorScratch2$2);
		const v11 = samplePixel(data, ry1 * width + rx1, vectorScratch3);
		const nx1 = v01.lerp(v11, sx);
		return result.copy(nx0.lerp(nx1, sy));
	}

	function getUvFromRMuS(atmosphere, r, muS, result) {
		const {
			topRadius,
			bottomRadius
		} = atmosphere;
		const xR = (r - bottomRadius) / (topRadius - bottomRadius);
		const xMuS = muS * 0.5 + 0.5;
		return result.set(getTextureCoordFromUnitRange(xMuS, IRRADIANCE_TEXTURE_WIDTH), getTextureCoordFromUnitRange(xR, IRRADIANCE_TEXTURE_HEIGHT));
	}

	// Our target is: (1 + dot(n, p)) * 0.5
	// Constant term: L0 * sqrt(π)/2 == 0.5
	// Linear term: L1 * π/3 * sqrt(3)/sqrt(π) == n/2
	// See: https://github.com/mrdoob/three.js/blob/r170/src/math/SphericalHarmonics3.js#L85
	// See also: https://www.ppsloan.org/publications/StupidSH36.pdf
	const L0_COEFF = 1 / Math.sqrt(Math.PI);
	const L1_COEFF = Math.sqrt(3) / (2 * Math.sqrt(Math.PI));
	const vectorScratch1$1 = /* #__PURE__ */new t3d.Vector3();
	const vectorScratch2$1 = /* #__PURE__ */new t3d.Vector3();
	const uvScratch$1 = /* #__PURE__ */new t3d.Vector2();
	function getSkyLightSH(irradianceTexture, worldPosition, sunDirection, result = new t3d.SphericalHarmonics3(), ellipsoid, atmosphere = AtmosParameters.DEFAULT) {
		const cameraPositionECEF = vectorScratch1$1.copy(worldPosition);
		const r = cameraPositionECEF.getLength();
		const muS = cameraPositionECEF.dot(sunDirection) / r;
		const uv = getUvFromRMuS(atmosphere, r, muS, uvScratch$1);
		const irradiance = sampleTexture(irradianceTexture, uv, vectorScratch2$1);
		irradiance.multiply(atmosphere.skyRadianceToRelativeLuminance);
		const normal = ellipsoid.getPositionToNormal(cameraPositionECEF, vectorScratch1$1);
		const coefficients = result.coefficients;
		coefficients[0].copy(irradiance).multiplyScalar(L0_COEFF);
		coefficients[1].copy(irradiance).multiplyScalar(L1_COEFF * normal.y);
		coefficients[2].copy(irradiance).multiplyScalar(L1_COEFF * normal.z);
		coefficients[3].copy(irradiance).multiplyScalar(L1_COEFF * normal.x);
	}

	function getUvFromRMu(atmosphere, r, mu, result) {
		const {
			topRadius,
			bottomRadius
		} = atmosphere;
		const H = Math.sqrt(topRadius ** 2 - bottomRadius ** 2);
		const rho = safeSqrt(r ** 2 - bottomRadius ** 2);
		const d = distanceToTopAtmosphereBoundary(atmosphere, r, mu);
		const dMin = topRadius - r;
		const dMax = rho + H;
		const xmu = (d - dMin) / (dMax - dMin);
		const xr = rho / H;
		return result.set(getTextureCoordFromUnitRange(xmu, TRANSMITTANCE_TEXTURE_WIDTH), getTextureCoordFromUnitRange(xr, TRANSMITTANCE_TEXTURE_HEIGHT));
	}
	const vectorScratch1 = /* #__PURE__ */new t3d.Vector3();
	const vectorScratch2 = /* #__PURE__ */new t3d.Vector3();
	const uvScratch = /* #__PURE__ */new t3d.Vector2();
	function getSunLightColor(transmittanceTexture, worldPosition, sunDirection, target = new t3d.Color3(), atmosphere = AtmosParameters.DEFAULT) {
		const camera = vectorScratch1.copy(worldPosition);
		const transmittance = vectorScratch2;
		let r = camera.getLength();
		let rmu = camera.dot(sunDirection);
		const {
			topRadius
		} = atmosphere;
		const distanceToTopAtmosphereBoundary = -rmu - Math.sqrt(rmu ** 2 - r ** 2 + topRadius ** 2);
		if (distanceToTopAtmosphereBoundary > 0) {
			r = topRadius;
			rmu += distanceToTopAtmosphereBoundary;
		}
		if (r > topRadius) {
			transmittance.set(1, 1, 1);
		} else {
			const mu = rmu / r;
			const rayRMuIntersectsGround = rayIntersectsGround(atmosphere, r, mu);
			if (rayRMuIntersectsGround) {
				transmittance.setScalar(0);
			} else {
				const uv = getUvFromRMu(atmosphere, r, mu, uvScratch);
				sampleTexture(transmittanceTexture, uv, transmittance);
			}
		}
		const radiance = transmittance.multiply(atmosphere.solarIrradiance).multiply(atmosphere.sunRadianceToRelativeLuminance);
		return target.setRGB(radiance.x, radiance.y, radiance.z);
	}

	exports.AtmosFogEffect = AtmosFogEffect;
	exports.AtmosLUTsGenerator = AtmosLUTsGenerator;
	exports.AtmosLUTsLoader = AtmosLUTsLoader;
	exports.AtmosSky = AtmosSky;
	exports.getAltitudeCorrectionOffset = getAltitudeCorrectionOffset;
	exports.getScatteringCoefficient = getScatteringCoefficient;
	exports.getSkyLightSH = getSkyLightSH;
	exports.getSunLightColor = getSunLightColor;

}));

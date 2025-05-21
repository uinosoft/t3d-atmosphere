// t3d-atmosphere
import { Mesh, ShaderMaterial, DRAW_SIDE, SphereGeometry, Vector3, PIXEL_TYPE, RenderTarget2D, TEXTURE_FILTER, PIXEL_FORMAT, RenderTarget3D, ShaderPostPass, MathUtils } from 't3d';

const AtmosphereCommon = /* glsl */`
uniform vec4 betaR;

const float RES_R_TOTAL = 32.; // all altitude layer
const float RES_MU = 128.; 	// height of the texture
const float RES_MU_S = 32.; // width per table
const float RES_NU = 8.;	// table per texture depth

const vec2 TRANSMISSION_SIZE = vec2(256., 64.); // 256x64

// ---------------------------------------------------------------------------- 
// UTILITY FUNCTIONS
// ---------------------------------------------------------------------------- 

float GetTextureCoordFromUnitRange(float x, float textureSize) {
	return 0.5 / textureSize + x * (1.0 - 1.0 / textureSize);
}

float GetUnitRangeFromTextureCoord(float u, float textureSize) {
	return (u - 0.5 / textureSize) / (1.0 - 1.0 / textureSize);
}

float ClampCosine(float mu) {
	return clamp(mu, -1.0, 1.0);
}

float ClampDistance(float d) {
	return max(d, 0.0);
}

float ClampRadius(float r) {
	return clamp(r, Rg, Rt);
}

float SafeSqrt(float a) {
	return sqrt(max(a, 0.0));
}

float DistanceToTopAtmosphereBoundary(float r, float mu) {
	float discriminant = r * r * (mu * mu - 1.0) + Rt * Rt;
	return ClampDistance(-r * mu + SafeSqrt(discriminant));
}

float DistanceToBottomAtmosphereBoundary(float r, float mu) {
	float discriminant = r * r * (mu * mu - 1.0) + Rg * Rg;
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
		float v = (r - Rg) / (Rt - Rg);
		return vec2(u, v);
	}
#elif TRANSMITTANCE_MAPPING == 1
	vec2 GetTransmittanceUvFromRMu(float r, float mu) {
		float u = atan((mu + 0.15) / (1.0 + 0.15) * tan(1.5)) / 1.5;
		float v = sqrt((r - Rg) / (Rt - Rg));
		return vec2(u, v);
	}
#else
	vec2 GetTransmittanceUvFromRMu(float r, float mu) {
		float H = sqrt(Rt * Rt - Rg * Rg);
		float rho = SafeSqrt(r * r - Rg * Rg);
		float d = DistanceToTopAtmosphereBoundary(r, mu);
		float d_min = Rt - r;
		float d_max = rho + H;
		float x_mu = (d - d_min) / (d_max - d_min);
		float x_r = rho / H;
		return vec2(
			GetTextureCoordFromUnitRange(x_mu, TRANSMISSION_SIZE.x),
			GetTextureCoordFromUnitRange(x_r, TRANSMISSION_SIZE.y)
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
	float sin_theta_h = Rg / r;
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
			, 1.0);
	} else {
		return min(
			GetTransmittanceToTopAtmosphereBoundary(r, mu) /
				GetTransmittanceToTopAtmosphereBoundary(r_d, mu_d)
			, 1.0);
	}
}
`;

const InscatterLookup = /* glsl */`
#ifdef INSCATTER_3D
	const float RES_R = RES_R_TOTAL;
#else
	const float RES_R = float(ALTITUDE_LAYERS);
#endif

vec4 GetScatteringUvwzFromRMuMuSNu(float r, float mu, float muS, float nu, bool rayIntersectsGround) {
	float H = sqrt(Rt * Rt - Rg * Rg);
	float rho = SafeSqrt(r * r - Rg * Rg);
	float uR = GetTextureCoordFromUnitRange(rho / H, RES_R);
	#if INSCATTER_MAPPING == 1
		float rmu = r * mu;
		float discriminant = rmu * rmu - r * r + Rg * Rg;
		float uMu;
		if (rayIntersectsGround) {
			float d = -rmu - SafeSqrt(discriminant);
			float d_min = r - Rg;
			float d_max = rho;
			uMu = 0.5 - 0.5 * GetTextureCoordFromUnitRange(d_max == d_min ? 0.0 : (d - d_min) / (d_max - d_min), RES_MU / 2.);
		} else {
			float d = -rmu + SafeSqrt(discriminant + H * H);
			float d_min = Rt - r;
			float d_max = rho + H;
			uMu = 0.5 + 0.5 * GetTextureCoordFromUnitRange((d - d_min) / (d_max - d_min), RES_MU / 2.);
		}

		float d = DistanceToTopAtmosphereBoundary(Rg, muS);
		float d_min = Rt - Rg;
		float d_max = H;
		float a = (d - d_min) / (d_max - d_min);
		float D = DistanceToTopAtmosphereBoundary(Rg, -0.2);
		float A = (D - d_min) / (d_max - d_min);
		float uMuS = GetTextureCoordFromUnitRange(max(1.0 - a / A, 0.0) / (1.0 + a), RES_MU_S);
	#else
		float uMu = GetTextureCoordFromUnitRange((mu + 1.0) / 2.0, RES_MU);
		float uMuS = GetTextureCoordFromUnitRange(max(muS + 0.2, 0.0) / 1.2, RES_MU_S);
	#endif

	float uNu = (nu + 1.0) / 2.0;

	return vec4(uNu, uMuS, uMu, uR);
}

vec4 GetScattering(float r, float mu, float muS, float nu, bool rayIntersectsGround) {
	vec4 uvwz = GetScatteringUvwzFromRMuMuSNu(r, mu, muS, nu, rayIntersectsGround);

	float tex_coord_x = uvwz.x * (RES_NU - 1.0);
	float tex_x = floor(tex_coord_x);
	float lep = tex_coord_x - tex_x;

	float uMu = uvwz.z;
	float uR = uvwz.w;
	float uNu_uMuS = tex_x + uvwz.y;

	#ifdef INSCATTER_3D
		return texture(inscatteringTexture, vec3(uNu_uMuS / RES_NU, uMu, uR)) * (1.0 - lep) + 
			texture(inscatteringTexture, vec3((uNu_uMuS + 1.0) / RES_NU, uMu, uR)) * lep;
	#else
		#if ALTITUDE_LAYERS > 1
			// new 2D lookup
			float u_0 = floor(uR * RES_R) / RES_R;
			float u_1 = floor(uR * RES_R + 1.0) / RES_R;
			float u_frac = fract(uR * RES_R);

			// pre-calculate uv
			float uv_0X = uNu_uMuS / RES_NU;
			float uv_1X = (uNu_uMuS + 1.0) / RES_NU;
			float uv_0Y = uMu / RES_R + u_0;
			float uv_1Y = uMu / RES_R + u_1;
			float OneMinusLep = 1.0 - lep;

			vec4 A = texture2D(inscatteringTexture, vec2(uv_0X, uv_0Y)) * OneMinusLep + texture2D(inscatteringTexture, vec2(uv_1X, uv_0Y)) * lep;	
			vec4 B = texture2D(inscatteringTexture, vec2(uv_0X, uv_1Y)) * OneMinusLep + texture2D(inscatteringTexture, vec2(uv_1X, uv_1Y)) * lep;	

			return A * (1.0 - u_frac) + B * u_frac;
		#else	
			return texture2D(inscatteringTexture, vec2(uNu_uMuS / RES_NU, uMu)) * (1.0 - lep) + 
				texture2D(inscatteringTexture, vec2((uNu_uMuS + 1.0) / RES_NU, uMu)) * lep;	
		#endif
	#endif 
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
			vec3(-0.53108,  1.10813, -0.07276),
			vec3(-0.07367, -0.00605,  1.07602)
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

		// LOG2_MIN      = -10.0
		// LOG2_MAX      =  +6.5
		// MIDDLE_GRAY   =  0.18
		const float AgxMinEv = -12.47393;  // log2(pow(2, LOG2_MIN) * MIDDLE_GRAY)
		const float AgxMaxEv = 4.026069;   // log2(pow(2, LOG2_MAX) * MIDDLE_GRAY)

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
#endif
`;

const AtmosSkyShader = {
	name: 'atmos_sky',
	defines: {
		TRANSMITTANCE_MAPPING: 1,
		INSCATTER_MAPPING: 1,
		INSCATTER_3D: false,
		ALTITUDE_LAYERS: 4,

		BACKGROUND: false,
		TONE_MAPPING: 5,
		SRGB_OUTPUT: true,

		SKY_SUNDISK: true
	},
	uniforms: {
		inscatteringTexture: null,
		transmittanceTexture: null,
		betaR: [5.8e-3, 1.35e-2, 3.31e-2, 1],

		cameraHeight: 0, // camera height to sealevel

		miePhaseG: 0.8,
		miePhaseScale: 1,

		toneMappingExposure: 10.0,

		sunDirSize: [0, 1, 0, 1]
	},
	vertexShader: /* glsl */`
        #define PI 3.14159265359

        attribute vec3 a_Position;

		uniform mat4 u_Projection;
		uniform mat4 u_View;
		uniform mat4 u_Model;

        uniform float cameraHeight;

        uniform float miePhaseG;
        uniform float miePhaseScale;

        uniform vec4 sunDirSize;

        varying vec4 vWorldPosAndCamY;

        varying vec3 vMiePhase_g;
        varying vec3 vSun_g;

        // Mie phase G function and Mie scattering scale, (compute this function in Vertex program for optimization)
        vec3 PhaseFunctionG(float g, float scale) {
            float g2 = g * g;
            return vec3(
				scale * 3.0 / (8.0 * PI) * (1.0 - g2) / (2.0 + g2), 
				1.0 + g2, 
				2.0 * g
			);
        }

		mat4 clearMat4Translate(mat4 m) {
			mat4 outMatrix = m;
			outMatrix[3].xyz = vec3(0., 0., 0.);
			return outMatrix;
		}
        
        void main() {
			mat4 modelMatrix = clearMat4Translate(u_Model);
			mat4 viewMatrix = clearMat4Translate(u_View);

            vWorldPosAndCamY.xyz = (modelMatrix * vec4(a_Position, 0.0)).xyz;

			#ifdef BACKGROUND
				vWorldPosAndCamY.xyz = (modelMatrix * vec4(a_Position, 0.0)).xyz;
			#else
				vWorldPosAndCamY.xyz = a_Position;
			#endif

			vWorldPosAndCamY.w = max(cameraHeight, 10.0); // no lower than sealevel

			gl_Position = u_Projection * viewMatrix * modelMatrix * vec4(a_Position, 1.0);
			gl_Position.z = gl_Position.w;

            vMiePhase_g = PhaseFunctionG(miePhaseG, miePhaseScale);

            #ifdef SKY_SUNDISK
                vSun_g = PhaseFunctionG(.99, sunDirSize.w * 0.004);
            #else
                vSun_g = vec3(0., 0., 0.);
            #endif
        }
    `,
	fragmentShader: /* glsl */`
        uniform vec4 sunDirSize;

		#ifdef INSCATTER_3D
			 uniform highp sampler3D inscatteringTexture;
		#else
			 uniform sampler2D inscatteringTexture;
		#endif
       
        uniform sampler2D transmittanceTexture;

        uniform float toneMappingExposure;

        varying vec4 vWorldPosAndCamY;
        varying vec3 vMiePhase_g;
        varying vec3 vSun_g;

        const float Rg = 6360000.0;
        const float Rt = 6420000.0;
        const float RL = 6421000.0;

		${AtmosphereCommon}
		${TransmittanceLookup}
		${InscatterLookup}

        vec3 GetMie(vec4 rayMie) {	
            // approximated single Mie scattering (cf. approximate Cm in paragraph "Angular precision")
            // rayMie.rgb = C*, rayMie.w = Cm, r
            return rayMie.rgb * rayMie.w / max(rayMie.r, 1e-4) * (betaR.r / betaR.xyz);
        }

        float PhaseFunctionR() {
			// Rayleigh phase function without multiply (1.0 + mu * mu)
			// We will multiply (1.0 + mu * mu) together with Mie phase later.
			return 3.0 / (16.0 * PI);
		}

        float PhaseFunctionM(float mu, vec3 miePhase_g) {
			// Mie phase function (optimized)
			// Precomputed PhaseFunctionG() with constant values in vertex program and pass them in here
			// we will multiply (1.0 + mu * mu) together with Rayleigh phase later.
			return miePhase_g.x / pow(miePhase_g.y - miePhase_g.z * mu, 1.5);
		}

		bool RayIntersectsGround(float r, float mu) {
			return mu < 0.0 && r * r * (mu * mu - 1.0) + Rg * Rg >= 0.0;
		}

        vec3 SkyRadiance(vec3 camera, vec3 viewdir, float nu, vec3 MiePhase_g, out vec3 transmittance) {
            float r = length(camera);
            float rMu = dot(camera, viewdir);

            float din = -rMu - sqrt(rMu * rMu - r * r + Rt * Rt);
            
            if (din > 0.0) {
                camera += din * viewdir;
                rMu += din;
                r = Rt;
            } else if (r > Rt) {
			 	transmittance = vec3(1., 1., 1.);
				return vec3(0., 0., 0.);
			}

			float mu = rMu / r;
			float muS = dot(camera, sunDirSize.xyz) / r;
            // float nu = dot(viewdir, sunDirSize.xyz); // nu value is from function input

			bool rayIntersectsGround = RayIntersectsGround(r, mu);

            transmittance = rayIntersectsGround ? vec3(0.0) : GetTransmittanceToTopAtmosphereBoundary(r, mu);

			vec4 scattering = GetScattering(r, rMu / r, muS, nu, rayIntersectsGround);
			vec3 scatteringM = GetMie(scattering);

			float phaseR = PhaseFunctionR();
			float phaseM = PhaseFunctionM(nu, MiePhase_g);

            return (scattering.rgb * phaseR + scatteringM * phaseM) * (1.0 + nu * nu);
        }

		${ToneMapping}

		#include <dithering_pars_frag>

        void main() {
            vec3 dir = normalize(vWorldPosAndCamY.xyz);
            float nu = dot(dir, sunDirSize.xyz);

            vec3 transmittance = vec3(0.0);
            vec3 col = SkyRadiance(vec3(0.0, vWorldPosAndCamY.w + Rg, 0.0), dir, nu, vMiePhase_g, transmittance);

			col = ToneMapping(col);
			
            #ifdef SKY_SUNDISK
                float sun = PhaseFunctionM(nu, vSun_g) * (1.0 + nu * nu); 
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

class AtmosSky extends Mesh {

	constructor() {
		const material = new ShaderMaterial(AtmosSkyShader);
		material.depthWrite = false;
		material.side = DRAW_SIDE.BACK;
		material.dithering = true;

		super(new SphereGeometry(1, 100, 100), material);

		this.frustumCulled = false;
	}

	setLUTs(lutsData) {
		const { transmittanceTexture, inscatterTexture } = lutsData;
		const { uniforms, defines } = this.material;

		uniforms.transmittanceTexture = transmittanceTexture;
		uniforms.inscatteringTexture = inscatterTexture;

		uniforms.betaR = lutsData.betaR;

		let needsUpdate = false;

		if (defines.TRANSMITTANCE_MAPPING !== lutsData.transmittanceMapping) {
			defines.TRANSMITTANCE_MAPPING = lutsData.transmittanceMapping;
			needsUpdate = true;
		}

		if (defines.INSCATTER_MAPPING !== lutsData.inscatterMapping) {
			defines.INSCATTER_MAPPING = lutsData.inscatterMapping;
			needsUpdate = true;
		}

		if (defines.INSCATTER_3D !== lutsData.use3DInscatterTexture) {
			defines.INSCATTER_3D = lutsData.use3DInscatterTexture;
			needsUpdate = true;
		}

		if (defines.ALTITUDE_LAYERS !== lutsData.altitudeLayers) {
			defines.ALTITUDE_LAYERS = lutsData.altitudeLayers;
			needsUpdate = true;
		}

		this.material.needsUpdate = needsUpdate;
	}

}

const PrecomputeCommon = /* glsl */`
// The radius of the planet (Rg), radius of the atmosphere (Rt),  atmosphere limit (RL)
const float Rg = 6360.0;
const float Rt = 6420.0;
const float RL = 6421.0;

// Half heights for the atmosphere air density (HR) and particle density (HM)
// This is the height in km that half the particles are found below
const float HR = 8.0;
const float HM = 1.2;

const vec3 betaMSca = vec3(4e-3, 4e-3, 4e-3);
const vec3 betaMEx = betaMSca / 0.9;
const vec3 betaOzone = vec3(0.000650, 0.001881, 0.000085);

// ---------------------------------------------------------------------------- 
// NUMERICAL INTEGRATION PARAMETERS 
// ----------------------------------------------------------------------------

// default Transmittance sample is 500, less then 250 sample will fit in SM 3.0 for dx9,
#define TRANSMITTANCE_INTEGRAL_SAMPLES 50
//default Inscatter sample is 50
#define INSCATTER_INTEGRAL_SAMPLES 25
`;

// ref https://ebruneton.github.io/precomputed_atmospheric_scattering
// ref https://www.shadertoy.com/view/DsBGWG
const TransmittanceCompute = /* glsl */`
// total optical length of rayleigh or mie
float OpticalDepth(float H, float r, float mu) {
	float dx = DistanceToTopAtmosphereBoundary(r, mu) / float(TRANSMITTANCE_INTEGRAL_SAMPLES);
	
	float xi = 0.0;
	float yi = exp(-(r - Rg) / H);
	float result = 0.0; 
	for (int i = 1; i <= TRANSMITTANCE_INTEGRAL_SAMPLES; ++i) {
		float xj = float(i) * dx; 
		float yj = exp(-(sqrt(r * r + xj * xj + 2.0 * xj * r * mu) - Rg) / H);
		result += (yi + yj) / 2.0 * dx;
		xi = xj;
		yi = yj;
	}
	
	return mu < -sqrt(1.0 - (Rg / r) * (Rg / r)) ? 1e9 : result; 
}

// total optical length of Ozone
float OpticalDepth_O3(float r, float mu) {
	float dx = DistanceToTopAtmosphereBoundary(r, mu) / float(TRANSMITTANCE_INTEGRAL_SAMPLES);

	float result = 0.0;
	for (int i = 0; i <= TRANSMITTANCE_INTEGRAL_SAMPLES; ++i) {
		float d_i = float(i) * dx;
		float r_i = sqrt(d_i * d_i + 2.0 * r * mu * d_i + r * r);
		float height = r_i - Rg;
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
		r = Rg + uv.y * (Rt - Rg);
	}
#elif TRANSMITTANCE_MAPPING == 1
	void GetRMuFromTransmittanceUv(vec2 uv, out float r, out float mu) {
		mu = -0.15 + tan(1.5 * uv.x) / tan(1.5) * (1.0 + 0.15);
		r = Rg + (uv.y * uv.y) * (Rt - Rg);
	}
#else
	void GetRMuFromTransmittanceUv(vec2 uv, out float r, out float mu) {
		float H = sqrt(Rt * Rt - Rg * Rg);
		uv = gl_FragCoord.xy / TRANSMISSION_SIZE;
		float x_mu = GetUnitRangeFromTextureCoord(uv.x, TRANSMISSION_SIZE.x);
		float x_r = GetUnitRangeFromTextureCoord(uv.y, TRANSMISSION_SIZE.y);
		float rho = H * x_r;
		r = sqrt(rho * rho + Rg * Rg);
		float d_min = Rt - r;
		float d_max = rho + H;
		float d = d_min + x_mu * (d_max - d_min);
		mu = d <= 0.0 ? 1.0 : (H * H - rho * rho - d * d) / (2.0 * r * d);
		mu = ClampCosine(mu);
	}
#endif

vec3 ComputeTransmittance(vec2 uv) {
	float r, muS;

	GetRMuFromTransmittanceUv(uv, r, muS);

	vec3 depth = betaR.xyz * OpticalDepth(HR, r, muS) + betaMEx * OpticalDepth(HM, r, muS);

	#if TRANSMITTANCE_MAPPING == 2
		depth += betaOzone * OpticalDepth_O3(r, muS);
	#endif

	return exp(-depth);
}
`;

const TransmittanceShader = {
	name: 'atmos_transmittance',
	uniforms: {
		betaR: [5.8e-3, 1.35e-2, 3.31e-2, 1]
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

		${PrecomputeCommon}
        ${AtmosphereCommon}
		${TransmittanceCompute}

        void main() {
            gl_FragColor = vec4(ComputeTransmittance(v_Uv), 1.0);
        }
    `
};

const InscatterCompute = /* glsl */`
void GetRMuMuSNuFromScatteringUvwz(vec4 uvwz, out float r, out float mu, out float muS, out float nu, out bool rayIntersectsGround) {
	float xMuS = GetUnitRangeFromTextureCoord(uvwz.y, RES_MU_S);

	float H = sqrt(Rt * Rt - Rg * Rg);
	float rho = H * GetUnitRangeFromTextureCoord(uvwz.w, RES_R_TOTAL);
	r = sqrt(rho * rho + Rg * Rg);

	#if INSCATTER_MAPPING == 1
		if (uvwz.z < 0.5) { // bottom half
			float dmin = r - Rg;
			float dmax = rho;
			float d = dmin + (dmax - dmin) * GetUnitRangeFromTextureCoord(1. - 2. * uvwz.z, RES_MU / 2.0);
			mu = d == 0.0 ? -1.0 : ClampCosine(-(rho * rho + d * d) / (2.0 * r * d));
			rayIntersectsGround = true;
		} else {
			float dmin = Rt - r;
			float dmax = rho + H;
			uvwz.z = clamp(uvwz.z, 0.5, 0.99); // fix jagged bright lines at the horizon, but why ?
			float d = dmin + (dmax - dmin) * GetUnitRangeFromTextureCoord(2. * uvwz.z - 1., RES_MU / 2.0);
			mu = d == 0.0 ? 1.0 : ClampCosine((H * H - rho * rho - d * d) / (2.0 * r * d));
			rayIntersectsGround = false;
		}
	
		// paper formula 
		// muS = -(0.6 + log(1.0 - xMuS * (1.0 -  exp(-3.6)))) / 3.0; 
		// better formula 
		// muS = tan((2.0 * xMuS - 1.0 + 0.26) * 0.75) / tan(1.26 * 0.75);

		float d_min = Rt - Rg;
		float d_max = H;
		float D = DistanceToTopAtmosphereBoundary(Rg, -0.2);
		float A = (D - d_min) / (d_max - d_min);
		float a = (A - xMuS * A) / (1.0 + xMuS * A);
		float d = d_min + min(a, A) * (d_max - d_min);
		muS = d == 0.0 ? 1.0 : ClampCosine((H * H - d * d) / (2.0 * Rg * d));
	#else 
		mu = -1.0 + 2.0 * GetUnitRangeFromTextureCoord(uvwz.z, RES_MU);
		muS = -0.2 + xMuS * 1.2;
	#endif

	nu = ClampCosine(uvwz.x * 2.0 - 1.0);
}

void ComputeSingleScatteringIntegrand(float r, float mu, float muS, float nu, float d, bool rayIntersectsGround, out vec3 rayleigh, out float mie) {
	float ri = ClampRadius(sqrt(r * r + d * d + 2.0 * r * mu * d));
	float muSi = ClampCosine(
		(muS * r + nu * d) / (ri * mix(1.0, betaR.w, max(0.0, muS))) // added betaR.w to fix the Rayleigh Offset artifacts issue
	);

	vec3 transmittance = GetTransmittance(r, mu, d, rayIntersectsGround) *
		GetTransmittanceToSun(ri, muSi);

	rayleigh = exp(-(ri - Rg) / HR) * transmittance;
	mie = exp(-(ri - Rg) / HM) * transmittance.x; // only calc the red channel
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
	
	ray *= betaR.xyz;
	mie *= betaMSca.x;
}
`;

const InscatterShader = {
	name: 'atmos_inscatter',
	defines: {},
	uniforms: {
		transmittanceTexture: null,
		betaR: [5.8e-3, 1.35e-2, 3.31e-2, 1],
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
		${PrecomputeCommon}
        ${AtmosphereCommon}

		uniform sampler2D transmittanceTexture;

		#ifdef INSCATTER_3D
			uniform float layer;
		#endif

        varying vec2 v_Uv;

		${TransmittanceLookup}
		${InscatterCompute} 
        
        void main() {
			vec2 uv = v_Uv;

			const vec4 SCATTERING_TEXTURE_SIZE = vec4(
				RES_NU - 1.,
				RES_MU_S,
				RES_MU,
				RES_R_TOTAL
			);

			float fragCoordNu = floor(gl_FragCoord.x / RES_MU_S);
			float fragCoordMuS = mod(gl_FragCoord.x, RES_MU_S);

			#ifdef INSCATTER_3D
				float fragCoordY = gl_FragCoord.y;
			#else
				#if ALTITUDE_LAYERS > 1
					float layerIndex = floor(gl_FragCoord.y / RES_MU);
					float layer = pow(2., layerIndex) - 1.0;
					float fragCoordY = mod(gl_FragCoord.y, RES_MU);
				#else
					float layer = 1.0;
					float fragCoordY = gl_FragCoord.y;
				#endif
			#endif

			float fragCoordZ = GetTextureCoordFromUnitRange(layer, RES_R_TOTAL);

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

class AtmosLUTsGenerator {

	constructor(capabilities, options = {}) {
		const isWebGL2 = capabilities.version > 1;

		// Transmittance mapping
		// 0 - linear implementation
		// 1 - original implementation in 2008
		// 2 - new implementation in 2017
		const transmittanceMapping = options.transmittanceMapping !== undefined ? options.transmittanceMapping : 1;

		// Inscatter mapping
		// 0 - linear implementation
		// 1 - non-linear implementation
		const inscatterMapping = options.inscatterMapping !== undefined ? options.inscatterMapping : 1;

		// Whether to use 3D inscatter texture
		const use3DInscatterTexture = options.use3DInscatterTexture !== undefined ? (options.use3DInscatterTexture && isWebGL2) : false;

		// Number of layers to precompute for altitude
		// If use3DInscatterTexture is true, this value is ignored, because the number of layers is fixed to 32
		// If use3DInscatterTexture is false, and altitudeLayers is set to 4, the render layers are set to 1, 2, 4, 8
		// If use3DInscatterTexture is false, and altitudeLayers is set to 1, the render layers are set to 1 only
		const altitudeLayers = options.altitudeLayers !== undefined ? options.altitudeLayers : 4;

		// ios provides a poor implementation of float linear, so fallback to Half Float
		const isIOS = /(iPad|iPhone|iPod)/g.test(navigator.userAgent);

		let type;

		if (isWebGL2) {
			if (capabilities.getExtension('EXT_color_buffer_float') && capabilities.getExtension('OES_texture_float_linear') && !isIOS) {
				type = PIXEL_TYPE.FLOAT;
			} else {
				type = PIXEL_TYPE.HALF_FLOAT;
			}
		} else {
			if (capabilities.getExtension('OES_texture_float') && capabilities.getExtension('OES_texture_float_linear') && !isIOS) {
				type = PIXEL_TYPE.FLOAT;
			} else if (capabilities.getExtension('OES_texture_half_float') && capabilities.getExtension('OES_texture_half_float_linear')) {
				type = PIXEL_TYPE.HALF_FLOAT;
			} else {
				type = PIXEL_TYPE.UNSIGNED_BYTE;
				console.warn('Half float texture is not supported!');
			}
		}

		// Render targets

		const transmittanceRT = new RenderTarget2D(256, 64);
		transmittanceRT.texture.minFilter = TEXTURE_FILTER.LINEAR;
		transmittanceRT.texture.magFilter = TEXTURE_FILTER.LINEAR;
		transmittanceRT.texture.type = type;
		transmittanceRT.texture.format = PIXEL_FORMAT.RGBA;
		transmittanceRT.texture.generateMipmaps = false;

		const inscatterRT = use3DInscatterTexture ? new RenderTarget3D(256, 128, 32) : new RenderTarget2D(256, 128 * altitudeLayers);
		inscatterRT.texture.minFilter = TEXTURE_FILTER.LINEAR;
		inscatterRT.texture.magFilter = TEXTURE_FILTER.LINEAR;
		inscatterRT.texture.type = type;
		inscatterRT.texture.format = PIXEL_FORMAT.RGBA;
		inscatterRT.texture.generateMipmaps = false;

		// Render Passes

		const betaR = [5.8e-3, 1.35e-2, 3.31e-2, 1]; // default betaR

		const transmittancePass = new ShaderPostPass(TransmittanceShader);
		transmittancePass.uniforms.betaR = betaR;
		transmittancePass.material.defines.TRANSMITTANCE_MAPPING = transmittanceMapping;

		const inscatterPass = new ShaderPostPass(InscatterShader);
		inscatterPass.uniforms.transmittanceTexture = transmittanceRT.texture;
		inscatterPass.uniforms.betaR = betaR;
		inscatterPass.material.defines.TRANSMITTANCE_MAPPING = transmittanceMapping;
		inscatterPass.material.defines.INSCATTER_MAPPING = inscatterMapping;
		inscatterPass.material.defines.INSCATTER_3D = !!use3DInscatterTexture;
		inscatterPass.material.defines.ALTITUDE_LAYERS = altitudeLayers;

		//

		this._transmittanceRT = transmittanceRT;
		this._inscatterRT = inscatterRT;

		this._transmittancePass = transmittancePass;
		this._inscatterPass = inscatterPass;

		this._betaR = betaR;

		this._transmittanceMapping = transmittanceMapping;
		this._inscatterMapping = inscatterMapping;
		this._use3DInscatterTexture = use3DInscatterTexture;
		this._altitudeLayers = altitudeLayers;
	}

	get transmittanceTexture() {
		return this._transmittanceRT.texture;
	}

	get inscatterTexture() {
		return this._inscatterRT.texture;
	}

	get betaR() {
		return this._betaR;
	}

	get transmittanceMapping() {
		return this._transmittanceMapping;
	}

	get inscatterMapping() {
		return this._inscatterMapping;
	}

	get use3DInscatterTexture() {
		return this._use3DInscatterTexture;
	}

	get altitudeLayers() {
		return this._altitudeLayers;
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

	setBetaRayleighDensity(wavelengths, skyTint, atmosphereThickness) {
		// Sky Tint shifts the value of Wavelengths
		const variableRangeWavelengths = _vec3_1.set(
			MathUtils.lerp(wavelengths.x + 150, wavelengths.x - 150, skyTint.r),
			MathUtils.lerp(wavelengths.y + 150, wavelengths.y - 150, skyTint.g),
			MathUtils.lerp(wavelengths.z + 150, wavelengths.z - 150, skyTint.b)
		);

		variableRangeWavelengths.x = MathUtils.clamp(variableRangeWavelengths.x, 380, 780);
		variableRangeWavelengths.y = MathUtils.clamp(variableRangeWavelengths.y, 380, 780);
		variableRangeWavelengths.z = MathUtils.clamp(variableRangeWavelengths.z, 380, 780);

		// Evaluate Beta Rayleigh function is based on A.J.Preetham

		const WL = variableRangeWavelengths.multiplyScalar(1e-9); // nano meter unit

		const n = 1.0003; // the index of refraction of air
		const N = 2.545e25; // molecular density at sea level
		const pn = 0.035; // depolatization factor for standard air

		const waveLength4 = _vec3_2.set(Math.pow(WL.x, 4), Math.pow(WL.y, 4), Math.pow(WL.z, 4));
		const delta = waveLength4.multiplyScalar(3.0 * N * (6.0 - 7.0 * pn));
		const ray = (8 * Math.pow(Math.PI, 3) * Math.pow(n * n - 1.0, 2) * (6.0 + 3.0 * pn));
		const betaR = _vec3_1.set(ray / delta.x, ray / delta.y, ray / delta.z);

		// Atmosphere Thickness ( Rayleigh ) scale
		const Km = 1000.0; // kilo meter unit
		betaR.multiplyScalar(Km * atmosphereThickness);

		// w channel solves the Rayleigh Offset artifact issue
		this._betaR[0] = betaR.x;
		this._betaR[1] = betaR.y;
		this._betaR[2] = betaR.z;
		this._betaR[3] = Math.max(Math.pow(atmosphereThickness, Math.PI), 1);

		// w channel solves the Rayleigh Offset artifact issue
		return this._betaR;
	}

	dispose() {
		this._transmittanceRT.dispose();
		this._inscatterRT.dispose();

		this._transmittancePass.dispose();
		this._inscatterPass.dispose();
	}

}

const _vec3_1 = new Vector3();
const _vec3_2 = new Vector3();

export { AtmosLUTsGenerator, AtmosSky };

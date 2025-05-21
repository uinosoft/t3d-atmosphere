import { AtmosphereCommon } from './chunks/AtmosphereCommon.js';
import { TransmittanceLookup } from './chunks/TransmittanceLookup.js';
import { InscatterLookup } from './chunks/InscatterLookup.js';
import { ToneMapping } from './chunks/ToneMapping.js';

export const AtmosSkyShader = {
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
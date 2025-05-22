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

		u_mie_phase_function_g: 0.8,

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

        uniform vec4 sunDirSize;

        varying vec4 vWorldPosAndCamY;

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

		uniform float u_mie_phase_function_g;

        uniform float toneMappingExposure;

        varying vec4 vWorldPosAndCamY;

        const float Rg = 6360000.0;
        const float Rt = 6420000.0;
        const float RL = 6421000.0;

		${AtmosphereCommon}
		${TransmittanceLookup}
		${InscatterLookup}

		bool RayIntersectsGround(float r, float mu) {
			return mu < 0.0 && r * r * (mu * mu - 1.0) + Rg * Rg >= 0.0;
		}

        vec3 GetSkyRadiance(vec3 camera, vec3 view_ray, vec3 sun_direction, out vec3 transmittance) {
            float r = length(camera);
            float rmu = dot(camera, view_ray);

            float distance_to_top_atmosphere_boundary =
				-rmu - SafeSqrt(rmu * rmu - r * r + Rt * Rt);
            
            if (distance_to_top_atmosphere_boundary > 0.0) {
                camera = camera + view_ray * distance_to_top_atmosphere_boundary;
				r = Rt;
                rmu += distance_to_top_atmosphere_boundary;
            } else if (r > Rt) {
			 	transmittance = vec3(1.0);
				return vec3(0.0);
			}

			float mu = rmu / r;
			float mu_s = dot(camera, sun_direction) / r;
            float nu = dot(view_ray, sun_direction);

			bool ray_r_mu_intersects_ground = RayIntersectsGround(r, mu);

            transmittance = ray_r_mu_intersects_ground
				? vec3(0.0)
				: GetTransmittanceToTopAtmosphereBoundary(r, mu);

			vec3 single_mie_scattering;
			vec3 scattering = GetCombinedScattering(r, mu, mu_s, nu, ray_r_mu_intersects_ground, single_mie_scattering);

            return scattering * RayleighPhaseFunction(nu) +
				single_mie_scattering * MiePhaseFunction(u_mie_phase_function_g, nu);
        }

		${ToneMapping}

		#include <dithering_pars_frag>

        void main() {
            vec3 dir = normalize(vWorldPosAndCamY.xyz);
            float nu = dot(dir, sunDirSize.xyz);

            vec3 transmittance = vec3(0.0);
            vec3 col = GetSkyRadiance(vec3(0.0, vWorldPosAndCamY.w + Rg, 0.0), dir, sunDirSize.xyz, transmittance);

			col = ToneMapping(col);
			
            #ifdef SKY_SUNDISK
				float sun = 0.004 * sunDirSize.w * MiePhaseFunction(0.99, nu);
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
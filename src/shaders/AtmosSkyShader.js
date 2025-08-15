import { definitions } from './bruneton/definitions.js';
import { common } from './bruneton/common.js';
import { runtime } from './bruneton/runtime.js';
import { defines } from './helpers/defines.js';
import { raySphereIntersection } from './helpers/raySphereIntersection.js';
import { tonemapping } from './helpers/tonemapping.js';
import { METER_TO_LENGTH_UNIT } from '../constants.js';
import { AtmosParameters } from '../AtmosParameters.js';

export const AtmosSkyShader = {
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

		ATMOSPHERE: AtmosParameters.DEFAULT.toUniform(),
		SUN_SPECTRAL_RADIANCE_TO_LUMINANCE: [0, 0, 0],
		SKY_SPECTRAL_RADIANCE_TO_LUMINANCE: [0, 0, 0],

		scattering_texture: null,
		transmittance_texture: null,
		irradiance_texture: null,

		cameraPosition: [0, 0, 0],
		sunDirection: [0, 0, 0],
		altitudeCorrection: [0, 0, 0],

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
		${defines}
		${definitions}
		${common}
		${raySphereIntersection}

		uniform AtmosphereParameters ATMOSPHERE;
		uniform vec3 SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
		uniform vec3 SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;

		uniform highp sampler3D scattering_texture;
        uniform sampler2D transmittance_texture;
		uniform sampler2D irradiance_texture;

		${runtime}

        uniform float toneMappingExposure;

		uniform vec3 sunDirection;
		uniform float sunDiskSize;

		varying vec3 vCameraPosition;
		varying vec3 vRayDirection;

		${tonemapping}

		#include <dithering_pars_frag>

        void main() {
			vec3 cameraPosition = vCameraPosition;
            vec3 rayDirection = normalize(vRayDirection);

			vec4 outputColor;
			vec3 transmittance;

			#ifdef GROUND_ALBEDO
				float r = length(cameraPosition);
  				float mu = dot(cameraPosition, rayDirection) / r;
				bool ray_r_mu_intersects_ground = RayIntersectsGround(ATMOSPHERE, r, mu);
				if (ray_r_mu_intersects_ground) {
					float distance_to_ground = RaySphereFirstIntersection(
						cameraPosition,
						rayDirection,
						ATMOSPHERE.bottom_radius);
					vec3 groundPosition = rayDirection * distance_to_ground + cameraPosition;
					vec3 surfaceNormal = normalize(groundPosition);
					vec3 skyIrradiance;
					vec3 sunIrradiance = GetSunAndSkyIrradiance(
						cameraPosition,
						surfaceNormal, 
						sunDirection, 
						skyIrradiance
					);
					vec3 inscatter = GetSkyRadianceToPoint(
						cameraPosition,
						ATMOSPHERE.bottom_radius * surfaceNormal,
						sunDirection,
						transmittance
					);
					vec3 radiance = ATMOSPHERE.ground_albedo * RECIPROCAL_PI * (sunIrradiance + skyIrradiance);
					outputColor.rgb = radiance * transmittance + inscatter;
					transmittance = vec3(0.0);
				} else {
					outputColor.rgb = GetSkyRadiance(
						cameraPosition,
						rayDirection,
						sunDirection,
						transmittance
					);
				}
			#else
				outputColor.rgb = GetSkyRadiance(
					cameraPosition,
					rayDirection,
					sunDirection,
					transmittance
				);
			#endif

			outputColor.rgb = ToneMapping(outputColor.rgb);
			
            #ifdef SKY_SUNDISK
				float nu = dot(rayDirection, sunDirection);
				float sun = 0.004 * sunDiskSize * MiePhaseFunction(0.99, nu);
		        outputColor.rgb += sun * transmittance;
            #endif

			outputColor.a = 1.0;

            gl_FragColor = outputColor;

			#ifdef SRGB_OUTPUT
				gl_FragColor = LinearTosRGB(gl_FragColor);
			#endif

			#include <dithering_frag>
        }
    `
};
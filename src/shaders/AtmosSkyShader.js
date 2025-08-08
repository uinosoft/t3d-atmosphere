import { AtmosphereCommon } from './chunks/AtmosphereCommon.js';
import { TransmittanceLookup } from './chunks/TransmittanceLookup.js';
import { InscatterLookup } from './chunks/InscatterLookup.js';
import { IrradianceLookup } from './chunks/IrradianceLookup.js';
import { ToneMapping } from './chunks/ToneMapping.js';
import { METER_TO_LENGTH_UNIT } from '../constants.js';
import { Runtime } from './chunks/Runtime.js';

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
					col = GetSkyRadiance(camera, view_ray, sunDirection, transmittance);
				}
			#else
				col = GetSkyRadiance(camera, view_ray, sunDirection, transmittance);
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
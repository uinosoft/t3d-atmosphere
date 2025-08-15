import { octahedronToUnitVectorGLSL } from 't3d-effect-composer';
import { definitions } from './bruneton/definitions.js';
import { common } from './bruneton/common.js';
import { runtime } from './bruneton/runtime.js';
import { defines } from './helpers/defines.js';
import { METER_TO_LENGTH_UNIT } from '../constants.js';
import { AtmosParameters } from '../AtmosParameters.js';

export const AtmosFogShader = {
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
		${octahedronToUnitVectorGLSL}

		${defines}
		${definitions}
		${common}

		uniform AtmosphereParameters ATMOSPHERE;
		uniform vec3 SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
		uniform vec3 SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;

		uniform highp sampler3D scattering_texture;
        uniform sampler2D transmittance_texture;
		uniform sampler2D irradiance_texture;

		${runtime}

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

		void correctGeometricError(inout vec3 positionECEF, inout vec3 normalECEF) {
			// TODO: The error is pronounced at the edge of the ellipsoid due to the
			// large difference between the sphere position and the unprojected position
			// at the current fragment. Calculating the sphere position from the fragment
			// UV may resolve this.

			// Correct way is slerp, but this will be small-angle interpolation anyways.
			vec3 sphereNormal = normalize(positionECEF / vEllipsoidRadiiSquared);
			vec3 spherePosition = ATMOSPHERE.bottom_radius * sphereNormal;
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
  				vec3 sunIrradiance = GetSunAndSkyIrradiance(
					worldPosition,
					worldNormal,
					sunDirection,
					skyIrradiance
				);

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
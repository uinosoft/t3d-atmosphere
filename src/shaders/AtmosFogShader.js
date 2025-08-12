import { octahedronToUnitVectorGLSL } from 't3d-effect-composer';
import { AtmosphereCommon } from './chunks/AtmosphereCommon.js';
import { TransmittanceLookup } from './chunks/TransmittanceLookup.js';
import { InscatterLookup } from './chunks/InscatterLookup.js';
import { IrradianceLookup } from './chunks/IrradianceLookup.js';
import { ToneMapping } from './chunks/ToneMapping.js';
import { METER_TO_LENGTH_UNIT } from '../constants.js';
import { Runtime } from './chunks/Runtime.js';

export const AtmosFogShader = {
	name: 'atmos_fog',
	defines: {
		TRANSMITTANCE_MAPPING: 1,
		INSCATTER_MAPPING: 1,

		TONE_MAPPING: 5,

		SRGB_OUTPUT: true,

		SUN_LIGHT: true,
		SKY_LIGHT: true
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
		geometricErrorCorrectionAmount: 0.0
	},
	vertexShader: /* glsl */`
		#define METER_TO_LENGTH_UNIT ${METER_TO_LENGTH_UNIT.toFixed(7)}

		attribute vec3 a_Position;
		attribute vec2 a_Uv;

		uniform mat4 u_Projection;
		uniform mat4 u_View;
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
			gl_Position = u_Projection * u_View * u_Model * vec4(a_Position, 1.0);

			vCameraPosition = (cameraPosition + altitudeCorrection) * METER_TO_LENGTH_UNIT;
			
			vec3 radii = ellipsoidRadii * METER_TO_LENGTH_UNIT;
  			vEllipsoidRadiiSquared = radii * radii;

			vGeometryAltitudeCorrection = altitudeCorrection * METER_TO_LENGTH_UNIT;
			vGeometryAltitudeCorrection *= 1.0 - geometricErrorCorrectionAmount;

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

		varying vec3 vCameraPosition;
		varying vec3 vEllipsoidRadiiSquared;
		varying vec3 vGeometryAltitudeCorrection;
		varying vec2 v_Uv;

		${octahedronToUnitVectorGLSL}

		${AtmosphereCommon}
		${TransmittanceLookup}
		${InscatterLookup}
		${IrradianceLookup}
		${Runtime}

		${ToneMapping}

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
			vec2 texCoord = v_Uv;

			vec4 inputColor = texture2D(tDiffuse, texCoord);

			float depth = texture2D(depthTexture, texCoord).r;
			vec4 gBufferTexel = texture2D(normalTexture, texCoord);

			// if (depth >= 1.0 - 1e-8) {
			// 	gl_FragColor = inputColor;
			// 	return;
			// }

			if (gBufferTexel.r < -2.0) {
				gl_FragColor = inputColor;
				return;
			}

			vec2 xy = texCoord * 2.0 - 1.0;
			float z = depth * 2.0 - 1.0;
			vec4 projectedPosition = vec4(xy, z, 1.0);
			vec4 worldPosition4 = anchorMatrix * (inverse(projectionView) * projectedPosition);
			vec3 worldPosition = worldPosition4.xyz / worldPosition4.w;

			worldPosition = worldPosition * METER_TO_LENGTH_UNIT + vGeometryAltitudeCorrection;
			vec3 worldNormal = octahedronToUnitVector(gBufferTexel.rg);
			worldNormal = (anchorMatrix * vec4(worldNormal, 0.0)).xyz;
			worldNormal = normalize(worldNormal);

			correctGeometricError(worldPosition, worldNormal);
			worldNormal = normalize(worldNormal);

			vec3 radiance;
			#if defined(SUN_LIGHT) || defined(SKY_LIGHT)
				vec3 diffuse = RECIPROCAL_PI * inputColor.rgb;

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

			vec3 transmittance;
			vec3 inscatter = GetSkyRadianceToPoint(
				vCameraPosition,
				worldPosition,
				sunDirection,
				transmittance
			);

			radiance *= transmittance;
			radiance += inscatter;
			
            gl_FragColor = vec4(radiance, inputColor.a);
        }
	`
};
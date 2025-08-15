import { definitions } from './bruneton/definitions.js';
import { common } from './bruneton/common.js';
import { precompute } from './bruneton/precompute.js';
import { defines } from './helpers/defines.js';

export const IrradianceShader = {
	name: 'atmos_irradiance',
	defines: {
		TRANSMITTANCE_MAPPING: 1,
		INSCATTER_MAPPING: 1
	},
	uniforms: {
		transmittance_texture: null,
		scattering_texture: null
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
		${defines}
		${definitions}
		${common}
		${precompute}

		uniform AtmosphereParameters ATMOSPHERE;
		uniform sampler2D transmittance_texture;
		uniform highp sampler3D scattering_texture;

		varying vec2 v_Uv;

        void main() {
			vec3 deltaIrradiance;
			deltaIrradiance = ComputeIndirectIrradianceTexture(
				ATMOSPHERE,
				scattering_texture,
				gl_FragCoord.xy
			);
			gl_FragColor = vec4(deltaIrradiance, 1.0);
        }
    `
};
import { definitions } from './bruneton/definitions.js';
import { common } from './bruneton/common.js';
import { precompute } from './bruneton/precompute.js';
import { defines } from './helpers/defines.js';

export const TransmittanceShader = {
	name: 'atmos_transmittance',
	defines: {
		TRANSMITTANCE_MAPPING: 1,
		INSCATTER_MAPPING: 1
	},
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
		${defines}
		${definitions}
		${common}
		${precompute}

		uniform AtmosphereParameters ATMOSPHERE;

		varying vec2 v_Uv;

        void main() {
			vec4 transmittance;
			transmittance.rgb = ComputeTransmittanceToTopAtmosphereBoundaryTexture(
				ATMOSPHERE, gl_FragCoord.xy
			);
			transmittance.a = 1.0;
            gl_FragColor = transmittance;
        }
    `
};
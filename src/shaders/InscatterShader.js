import { definitions } from './bruneton/definitions.js';
import { common } from './bruneton/common.js';
import { precompute } from './bruneton/precompute.js';
import { defines } from './helpers/defines.js';

export const InscatterShader = {
	name: 'atmos_inscatter',
	defines: {
		TRANSMITTANCE_MAPPING: 1,
		INSCATTER_MAPPING: 1
	},
	uniforms: {
		transmittance_texture: null,
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
		${defines}
		${definitions}
		${common}
		${precompute}

		uniform AtmosphereParameters ATMOSPHERE;
		uniform sampler2D transmittance_texture;
		uniform float layer;

		varying vec2 v_Uv;
        
        void main() {
			vec4 deltaRayleigh;
			vec4 deltaMie;
			vec4 scattering;
			vec4 singleMieScattering;
			ComputeSingleScatteringTexture(
				ATMOSPHERE,
				transmittance_texture,
				vec3(gl_FragCoord.xy, float(layer) + 0.5),
				deltaRayleigh.rgb,
    			deltaMie.rgb
			);
			deltaRayleigh.a = 1.0;
  			deltaMie.a = 1.0;

			gl_FragColor = vec4(deltaRayleigh.rgb, deltaMie.r);
        }
    `
};
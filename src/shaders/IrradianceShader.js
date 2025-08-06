import { AtmosphereCommon } from './chunks/AtmosphereCommon.js';
import { TransmittanceLookup } from './chunks/TransmittanceLookup.js';
import { InscatterLookup } from './chunks/InscatterLookup.js';
import { IrradianceCompute } from './chunks/IrradianceCompute.js';

export const IrradianceShader = {
	name: 'atmos_irradiance',
	uniforms: {
		transmittanceTexture: null,
		inscatteringTexture: null,
		miePhaseFunctionG: 0.8
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

        ${AtmosphereCommon}

		uniform sampler2D transmittanceTexture;
		
		uniform highp sampler3D inscatteringTexture;

		uniform float miePhaseFunctionG;

		${TransmittanceLookup}
		${InscatterLookup}
		${IrradianceCompute}

        void main() {
            float r, mu_s;
			GetRMuSFromIrradianceUv(v_Uv, r, mu_s);
			gl_FragColor = vec4(ComputeIndirectIrradiance(r, mu_s), 1.0);
        }
    `
};
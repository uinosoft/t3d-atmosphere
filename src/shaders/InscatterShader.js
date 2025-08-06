import { AtmosphereCommon } from './chunks/AtmosphereCommon.js';
import { InscatterCompute } from './chunks/InscatterCompute.js';
import { TransmittanceLookup } from './chunks/TransmittanceLookup.js';

export const InscatterShader = {
	name: 'atmos_inscatter',
	defines: {},
	uniforms: {
		transmittanceTexture: null,
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
        ${AtmosphereCommon}

		uniform sampler2D transmittanceTexture;

		uniform float layer;

        varying vec2 v_Uv;

		${TransmittanceLookup}
		${InscatterCompute} 
        
        void main() {
			vec2 uv = v_Uv;

			const vec4 SCATTERING_TEXTURE_SIZE = vec4(
				SCATTERING_TEXTURE_NU_SIZE - 1,
				SCATTERING_TEXTURE_MU_S_SIZE,
				SCATTERING_TEXTURE_MU_SIZE,
				SCATTERING_TEXTURE_R_SIZE
			);

			float fragCoordNu = floor(gl_FragCoord.x / float(SCATTERING_TEXTURE_MU_S_SIZE));
			float fragCoordMuS = mod(gl_FragCoord.x, float(SCATTERING_TEXTURE_MU_S_SIZE));

			float fragCoordY = gl_FragCoord.y;

			float fragCoordZ = GetTextureCoordFromUnitRange(layer, SCATTERING_TEXTURE_R_SIZE);

			vec4 uvwz = vec4(fragCoordNu, fragCoordMuS, fragCoordY, fragCoordZ) / SCATTERING_TEXTURE_SIZE;
			
            float r, mu, muS, nu;
			bool rayIntersectsGround;
            GetRMuMuSNuFromScatteringUvwz(uvwz, r, mu, muS, nu, rayIntersectsGround);

			vec3 ray;
            float mie; // only calc the red channel
            ComputeSingleScattering(r, mu, muS, nu, rayIntersectsGround, ray, mie);
            
            // store only red component of single Mie scattering (cf. 'Angular precision')
            gl_FragColor = vec4(ray, mie);
        }
    `
};
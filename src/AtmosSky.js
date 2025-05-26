import { Mesh, ShaderMaterial, DRAW_SIDE, SphereGeometry } from 't3d';
import { AtmosSkyShader } from './shaders/AtmosSkyShader.js';

export class AtmosSky extends Mesh {

	constructor() {
		const material = new ShaderMaterial(AtmosSkyShader);
		material.depthWrite = false;
		material.side = DRAW_SIDE.BACK;
		material.dithering = true;

		super(new SphereGeometry(1, 100, 100), material);

		this.frustumCulled = false;
	}

	setLUTs(lutsData) {
		const { transmittanceTexture, inscatterTexture, irradianceTexture } = lutsData;
		const { uniforms, defines } = this.material;

		uniforms.transmittanceTexture = transmittanceTexture;
		uniforms.inscatteringTexture = inscatterTexture;
		uniforms.irradianceTexture = irradianceTexture;

		uniforms.betaR = lutsData.betaR;

		let needsUpdate = false;

		if (defines.TRANSMITTANCE_MAPPING !== lutsData.transmittanceMapping) {
			defines.TRANSMITTANCE_MAPPING = lutsData.transmittanceMapping;
			needsUpdate = true;
		}

		if (defines.INSCATTER_MAPPING !== lutsData.inscatterMapping) {
			defines.INSCATTER_MAPPING = lutsData.inscatterMapping;
			needsUpdate = true;
		}

		if (defines.INSCATTER_3D !== lutsData.use3DInscatterTexture) {
			defines.INSCATTER_3D = lutsData.use3DInscatterTexture;
			needsUpdate = true;
		}

		if (defines.ALTITUDE_LAYERS !== lutsData.altitudeLayers) {
			defines.ALTITUDE_LAYERS = lutsData.altitudeLayers;
			needsUpdate = true;
		}

		this.material.needsUpdate = needsUpdate;
	}

}
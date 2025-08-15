import { Mesh, ShaderMaterial, DRAW_SIDE, PlaneGeometry } from 't3d';
import { AtmosSkyShader } from './shaders/AtmosSkyShader.js';

export class AtmosSky extends Mesh {

	constructor() {
		const material = new ShaderMaterial(AtmosSkyShader);
		material.depthWrite = false;
		material.side = DRAW_SIDE.BACK;
		material.dithering = true;

		super(new PlaneGeometry(2, 2), material);

		this.frustumCulled = false;
	}

	setLUTs(lutsData) {
		const { atmosphere, transmittanceTexture, inscatterTexture, irradianceTexture } = lutsData;
		const { uniforms, defines } = this.material;

		uniforms.ATMOSPHERE = atmosphere.toUniform();
		atmosphere.sunRadianceToRelativeLuminance.toArray(uniforms.SUN_SPECTRAL_RADIANCE_TO_LUMINANCE);
		atmosphere.skyRadianceToRelativeLuminance.toArray(uniforms.SKY_SPECTRAL_RADIANCE_TO_LUMINANCE);

		uniforms.transmittance_texture = transmittanceTexture;
		uniforms.scattering_texture = inscatterTexture;
		uniforms.irradiance_texture = irradianceTexture;

		let needsUpdate = false;

		if (defines.TRANSMITTANCE_MAPPING !== lutsData.transmittanceMapping) {
			defines.TRANSMITTANCE_MAPPING = lutsData.transmittanceMapping;
			needsUpdate = true;
		}

		if (defines.INSCATTER_MAPPING !== lutsData.inscatterMapping) {
			defines.INSCATTER_MAPPING = lutsData.inscatterMapping;
			needsUpdate = true;
		}

		this.material.needsUpdate = needsUpdate;
	}

}
import { ShaderPostPass, ATTACHMENT } from 't3d';
import { Effect } from 't3d-effect-composer';
import { AtmosFogShader } from './shaders/AtmosFogShader.js';

export class AtmosFogEffect extends Effect {

	constructor() {
		super();

		this.bufferDependencies = [
			{ key: 'GBuffer' }
		];

		this._mainPass = new ShaderPostPass(AtmosFogShader);
	}

	setLUTs(lutsData) {
		const { atmosphere, transmittanceTexture, inscatterTexture, irradianceTexture } = lutsData;
		const { uniforms, defines } = this._mainPass.material;

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

		this._mainPass.material.needsUpdate = needsUpdate;
	}

	render(renderer, composer, inputRenderTarget, outputRenderTarget, finish) {
		const gBuffer = composer.getBuffer('GBuffer');
		const gBufferRenderStates = gBuffer.getCurrentRenderStates();
		gBufferRenderStates.camera.projectionViewMatrix.toArray(this._mainPass.uniforms.projectionView);
		gBufferRenderStates.scene.anchorMatrix.toArray(this._mainPass.uniforms.anchorMatrix);

		renderer.setRenderTarget(outputRenderTarget);
		renderer.setClearColor(0, 0, 0, 0);
		if (finish) {
			renderer.clear(composer.clearColor, composer.clearDepth, composer.clearStencil);
		} else {
			renderer.clear(true, true, false);
		}

		const mainPass = this._mainPass;

		mainPass.uniforms.tDiffuse = inputRenderTarget.texture;
		mainPass.uniforms.depthTexture = gBuffer.output()._attachments[ATTACHMENT.DEPTH_STENCIL_ATTACHMENT];
		mainPass.uniforms.normalTexture = gBuffer.output()._attachments[ATTACHMENT.COLOR_ATTACHMENT0];

		if (finish) {
			mainPass.material.transparent = composer._tempClearColor[3] < 1 || !composer.clearColor;
			mainPass.renderStates.camera.rect.fromArray(composer._tempViewport);
		}
		mainPass.render(renderer);
		if (finish) {
			mainPass.material.transparent = false;
			mainPass.renderStates.camera.rect.set(0, 0, 1, 1);
		}
	}

	dispose() {
		this._mainPass.dispose();
	}

}
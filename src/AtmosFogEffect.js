import { ShaderPostPass, ATTACHMENT, Vector3, MathUtils } from 't3d';
import { Effect } from 't3d-effect-composer';
import { AtmosFogShader } from './shaders/AtmosFogShader.js';
import { getAltitudeCorrectionOffset } from './getAltitudeCorrectionOffset.js';
import { AtmosParameters } from './AtmosParameters.js';

const vectorScratch = /* #__PURE__ */ new Vector3();
const vectorScratch2 = /* #__PURE__ */ new Vector3();
const _geodetic = {};

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

	setCamera(camera, worldToECEFMatrix, options, atmosphere = AtmosParameters.DEFAULT) {
		const { uniforms } = this._mainPass.material;

		vectorScratch.setFromMatrixPosition(camera.worldMatrix);
		vectorScratch.toArray(uniforms.cameraPosition);

		worldToECEFMatrix.toArray(uniforms.worldToECEFMatrix);

		if (options) {
			const ellipsoid = options.ellipsoid;
			const correctAltitude = options.correctAltitude !== undefined ? options.correctAltitude : true;

			const cameraPositionECEF = vectorScratch
				.applyMatrix4(worldToECEFMatrix);

			if (correctAltitude) {
				getAltitudeCorrectionOffset(
					cameraPositionECEF,
					atmosphere.bottomRadius,
					ellipsoid,
					vectorScratch2
				).toArray(uniforms.altitudeCorrection);
			} else {
				vectorScratch2
					.set(0, 0, 0)
					.toArray(uniforms.altitudeCorrection);
			}

			ellipsoid.radius.toArray(uniforms.ellipsoidRadii);

			const cameraHeight = ellipsoid.getPositionToCartographic(cameraPositionECEF, _geodetic).height;
			const projectedScale = vectorScratch2.set(0, Math.max(...ellipsoid.radius), -Math.max(0.0, cameraHeight))
				.applyMatrix4(camera.projectionMatrix);
			const geometricErrorCorrectionAmount = MathUtils.mapLinear(projectedScale.y, 41.5, 13.8, 0, 1);
			uniforms.geometricErrorCorrectionAmount = MathUtils.clamp(geometricErrorCorrectionAmount, 0, 1);
		} else {
			vectorScratch2.set(0, 0, 0);
			vectorScratch2.toArray(uniforms.altitudeCorrection);
			vectorScratch2.toArray(uniforms.ellipsoidRadii);
			uniforms.geometricErrorCorrectionAmount = 1;
		}
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
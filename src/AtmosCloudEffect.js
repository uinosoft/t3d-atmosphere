import { ShaderPostPass, ATTACHMENT, Vector3, Matrix4, Vector2 } from 't3d';
import { Effect } from 't3d-effect-composer';
import { AtmosCloudMixShader, AtmosCloudResolveShader, AtmosCloudComputeShader } from './shaders/AtmosCloudShader.js';
import { AtmosParameters } from './AtmosParameters.js';
import { getAltitudeCorrectionOffset } from './getAltitudeCorrectionOffset.js';

const inverseViewMatrix = /* #__PURE__ */ new Matrix4();
const inverseProjectionMatrix = /* #__PURE__ */ new Matrix4();
const vectorScratch = /* #__PURE__ */ new Vector3();
const vectorScratch2 = /* #__PURE__ */ new Vector3();
const _geodetic = {};

export class AtmosCloudEffect extends Effect {

	constructor() {
		super();

		this.bufferDependencies = [
			{ key: 'GBuffer' }
		];

		this.stbnTexture = null;
		this.shapeDetailTexture = null;
		this.shapeTexture = null;
		this.localWeatherTexture = null;
		this.turbulenceTexture = null;

		this.jitter = true;
		this.animation = true;
		this.animationSpeed = new Vector2(0.00002, 0.00002);
		this.downsample = 0;

		this._cloudPass = new ShaderPostPass(AtmosCloudComputeShader);
		this._downsamplerPass = new ShaderPostPass(AtmosCloudResolveShader);
		this._mixPass = new ShaderPostPass(AtmosCloudMixShader);

		this._frameShotRenderTarget = null;
		this._frame = 0;
	}

	setLUTs(lutsData) {
		const { atmosphere, transmittanceTexture, inscatterTexture, irradianceTexture } = lutsData;
		const { uniforms, defines } = this._cloudPass.material;

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

		this._cloudPass.material.needsUpdate = needsUpdate;
	}

	setCamera(camera, worldToECEFMatrix, options, atmosphere = AtmosParameters.DEFAULT) {
		const { uniforms } = this._cloudPass.material;

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

			const cameraHeight = ellipsoid.getPositionToCartographic(cameraPositionECEF, _geodetic).height;
			uniforms.cameraHeight = cameraHeight;
		} else {
			vectorScratch2.set(0, 0, 0);
			vectorScratch2.toArray(uniforms.altitudeCorrection);
		}
	}

	resize(width, height) {
		const cloudPass = this._cloudPass;
		cloudPass.material.uniforms.resolution = [width, height];

		if (this._frameShotRenderTarget) {
			this._frameShotRenderTarget.resize(width, height);
		}
	}

	dispose() {
		this._cloudPass.dispose();
		this._downsamplerPass.dispose();
		this._mixPass.dispose();

		if (this._frameShotRenderTarget) {
			this._frameShotRenderTarget.dispose();
			this._frameShotRenderTarget = null;
		}
	}

	render(renderer, composer, inputRenderTarget, outputRenderTarget, finish) {
		const frameShotRenderTarget = this._frameShotRenderTarget;

		const tempRT1 = composer._renderTargetCache.allocate(this.downsample);
		const tempRT2 = composer._renderTargetCache.allocate(0);

		const gBuffer = composer.getBuffer('GBuffer');
		const gBufferRenderStates = gBuffer.getCurrentRenderStates();
		gBufferRenderStates.scene.anchorMatrix.toArray(this._cloudPass.uniforms.anchorMatrix);
		gBufferRenderStates.camera.projectionViewMatrix.toArray(this._cloudPass.uniforms.projectionView);

		const depthTexture = gBuffer.output()._attachments[ATTACHMENT.DEPTH_STENCIL_ATTACHMENT];

		const camera = gBufferRenderStates.camera;

		inverseViewMatrix.copy(camera.viewMatrix).inverse();
		inverseProjectionMatrix.copy(camera.projectionMatrix).inverse();

		// step1: compute cloud pass

		const cloudPass = this._cloudPass;

		cloudPass.uniforms.depthTex = depthTexture;
		inverseViewMatrix.toArray(cloudPass.uniforms.inverseViewMatrix);
		inverseProjectionMatrix.toArray(cloudPass.uniforms.inverseProjectionMatrix);

		cloudPass.uniforms.cameraNear = camera.near;
		cloudPass.uniforms.cameraFar = camera.far;

		cloudPass.uniforms.stbnTexture = this.stbnTexture;
		cloudPass.uniforms.shapeDetailTexture = this.shapeDetailTexture;
		cloudPass.uniforms.shapeTexture = this.shapeTexture;
		cloudPass.uniforms.localWeatherTexture = this.localWeatherTexture;
		cloudPass.uniforms.turbulenceTexture = this.turbulenceTexture;

		if (this.jitter) {
			cloudPass.uniforms.frame = this._frame;
		}

		if (this.animation) {
			cloudPass.uniforms.localWeatherOffset[0] += this.animationSpeed.x;
			cloudPass.uniforms.localWeatherOffset[1] += this.animationSpeed.y;
		}

		renderer.setRenderTarget(tempRT1);
		renderer.setClearColor(0, 0, 0, 0);
		cloudPass.render(renderer);

		this._frame++;

		// step2: downsample cloud pass result

		renderer.setRenderTarget(tempRT2);
		this._downsamplerPass.uniforms.colorBuffer = tempRT1.texture;
		this._downsamplerPass.uniforms.downsample = Math.pow(2, this.downsample);
		this._downsamplerPass.uniforms.colorHistoryBuffer = frameShotRenderTarget ? frameShotRenderTarget.texture : tempRT1.texture;
		this._downsamplerPass.render(renderer);

		this._frameShotRenderTarget = tempRT2;

		// step3: mix clouds with scene

		renderer.setRenderTarget(outputRenderTarget);
		if (finish) {
			renderer.clear(composer.clearColor, composer.clearDepth, composer.clearStencil);
		} else {
			renderer.clear(true, true, false);
		}
		const mixPass = this._mixPass;
		mixPass.uniforms.cloudTex = tempRT2.texture;
		mixPass.uniforms.sceneTex = inputRenderTarget.texture;
		if (finish) {
			mixPass.material.transparent = composer._tempClearColor[3] < 1 || !composer.clearColor;
			mixPass.renderStates.camera.rect.fromArray(composer._tempViewport);
		}
		mixPass.render(renderer);
		if (finish) {
			mixPass.material.transparent = false;
			mixPass.renderStates.camera.rect.set(0, 0, 1, 1);
		}

		// clean up

		composer._renderTargetCache.release(tempRT1, this.downsample);
		if (frameShotRenderTarget) {
			composer._renderTargetCache.release(frameShotRenderTarget, 0);
		}
	}

}
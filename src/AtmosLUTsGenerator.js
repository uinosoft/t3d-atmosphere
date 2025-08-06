import { PIXEL_TYPE, RenderTarget2D, RenderTarget3D, TEXTURE_FILTER, PIXEL_FORMAT, ShaderPostPass } from 't3d';
import {
	TRANSMITTANCE_TEXTURE_WIDTH,
	TRANSMITTANCE_TEXTURE_HEIGHT,
	IRRADIANCE_TEXTURE_WIDTH,
	IRRADIANCE_TEXTURE_HEIGHT,
	SCATTERING_TEXTURE_WIDTH,
	SCATTERING_TEXTURE_HEIGHT,
	SCATTERING_TEXTURE_DEPTH
} from './constants.js';
import { TransmittanceShader } from './shaders/TransmittanceShader.js';
import { InscatterShader } from './shaders/InscatterShader.js';
import { IrradianceShader } from './shaders/IrradianceShader.js';
import { AtmosParameters } from './AtmosParameters.js';

export class AtmosLUTsGenerator {

	constructor(capabilities, options = {}) {
		const isWebGL2 = capabilities.version > 1;

		const atmosphere = options.atmosphere !== undefined ? options.atmosphere : AtmosParameters.DEFAULT;

		// Transmittance mapping
		// 0 - linear implementation
		// 1 - original implementation in 2008
		// 2 - new implementation in 2017
		const transmittanceMapping = options.transmittanceMapping !== undefined ? options.transmittanceMapping : 1;

		// Inscatter mapping
		// 0 - linear implementation
		// 1 - non-linear implementation
		const inscatterMapping = options.inscatterMapping !== undefined ? options.inscatterMapping : 1;

		// ios provides a poor implementation of float linear, so fallback to Half Float
		const isIOS = /(iPad|iPhone|iPod)/g.test(navigator.userAgent);

		let type;

		if (isWebGL2) {
			if (capabilities.getExtension('EXT_color_buffer_float') && capabilities.getExtension('OES_texture_float_linear') && !isIOS) {
				type = PIXEL_TYPE.FLOAT;
			} else {
				type = PIXEL_TYPE.HALF_FLOAT;
			}
		} else {
			if (capabilities.getExtension('OES_texture_float') && capabilities.getExtension('OES_texture_float_linear') && !isIOS) {
				type = PIXEL_TYPE.FLOAT;
			} else if (capabilities.getExtension('OES_texture_half_float') && capabilities.getExtension('OES_texture_half_float_linear')) {
				type = PIXEL_TYPE.HALF_FLOAT;
			} else {
				type = PIXEL_TYPE.UNSIGNED_BYTE;
				console.warn('Half float texture is not supported!');
			}
		}

		// Render targets

		const transmittanceRT = new RenderTarget2D(TRANSMITTANCE_TEXTURE_WIDTH, TRANSMITTANCE_TEXTURE_HEIGHT);
		transmittanceRT.texture.minFilter = TEXTURE_FILTER.LINEAR;
		transmittanceRT.texture.magFilter = TEXTURE_FILTER.LINEAR;
		transmittanceRT.texture.type = type;
		transmittanceRT.texture.format = PIXEL_FORMAT.RGBA;
		transmittanceRT.texture.generateMipmaps = false;

		const inscatterRT = new RenderTarget3D(SCATTERING_TEXTURE_WIDTH, SCATTERING_TEXTURE_HEIGHT, SCATTERING_TEXTURE_DEPTH);
		inscatterRT.texture.minFilter = TEXTURE_FILTER.LINEAR;
		inscatterRT.texture.magFilter = TEXTURE_FILTER.LINEAR;
		inscatterRT.texture.type = type;
		inscatterRT.texture.format = PIXEL_FORMAT.RGBA;
		inscatterRT.texture.generateMipmaps = false;

		const irradianceRT = new RenderTarget2D(IRRADIANCE_TEXTURE_WIDTH, IRRADIANCE_TEXTURE_HEIGHT);
		irradianceRT.texture.minFilter = TEXTURE_FILTER.LINEAR;
		irradianceRT.texture.magFilter = TEXTURE_FILTER.LINEAR;
		irradianceRT.texture.type = type;
		irradianceRT.texture.format = PIXEL_FORMAT.RGBA;
		irradianceRT.texture.generateMipmaps = false;

		// Render Passes

		const atmosphereUniform = atmosphere.toUniform();

		const transmittancePass = new ShaderPostPass(TransmittanceShader);
		transmittancePass.uniforms.atmosphere = atmosphereUniform;
		transmittancePass.material.defines.TRANSMITTANCE_MAPPING = transmittanceMapping;

		const inscatterPass = new ShaderPostPass(InscatterShader);
		inscatterPass.uniforms.transmittanceTexture = transmittanceRT.texture;
		inscatterPass.uniforms.atmosphere = atmosphereUniform;
		inscatterPass.material.defines.TRANSMITTANCE_MAPPING = transmittanceMapping;
		inscatterPass.material.defines.INSCATTER_MAPPING = inscatterMapping;

		const irradiancePass = new ShaderPostPass(IrradianceShader);
		irradiancePass.uniforms.transmittanceTexture = transmittanceRT.texture;
		irradiancePass.uniforms.inscatteringTexture = inscatterRT.texture;
		irradiancePass.uniforms.atmosphere = atmosphereUniform;
		irradiancePass.material.defines.TRANSMITTANCE_MAPPING = transmittanceMapping;
		irradiancePass.material.defines.INSCATTER_MAPPING = inscatterMapping;

		//

		this._transmittanceRT = transmittanceRT;
		this._inscatterRT = inscatterRT;
		this._irradianceRT = irradianceRT;

		this._transmittancePass = transmittancePass;
		this._inscatterPass = inscatterPass;
		this._irradiancePass = irradiancePass;

		this._data = {
			transmittanceTexture: transmittanceRT.texture,
			inscatterTexture: inscatterRT.texture,
			irradianceTexture: irradianceRT.texture,
			atmosphere,
			transmittanceMapping: transmittanceMapping,
			inscatterMapping: inscatterMapping
		};
	}

	get data() {
		return this._data;
	}

	computeTransmittance(renderer) {
		renderer.setRenderTarget(this._transmittanceRT);
		renderer.setClearColor(0, 0, 0, 0);
		renderer.clear(true, true, true);
		this._transmittancePass.render(renderer);
	}

	computeInscatter(renderer) {
		const inscatterRT = this._inscatterRT;
		const inscatterPass = this._inscatterPass;
		if (inscatterRT.isRenderTarget3D) {
			for (let i = 0; i < 32; i++) {
				inscatterRT.activeLayer = i;
				inscatterPass.uniforms.layer = i;
				renderer.setRenderTarget(inscatterRT);
				renderer.setClearColor(0, 0, 0, 0);
				renderer.clear(true, true, true);
				inscatterPass.render(renderer);
			}
		} else {
			renderer.setRenderTarget(inscatterRT);
			renderer.setClearColor(0, 0, 0, 0);
			renderer.clear(true, true, true);
			inscatterPass.render(renderer);
		}
	}

	computeIrradiance(renderer) {
		renderer.setRenderTarget(this._irradianceRT);
		renderer.setClearColor(0, 0, 0, 0);
		renderer.clear(true, true, true);
		this._irradiancePass.render(renderer);
	}

	readTransmittancePixels(renderer) {
		readPixels(renderer, this._transmittanceRT);
	}

	readIrradiancePixels(renderer) {
		readPixels(renderer, this._irradianceRT);
	}

	dispose() {
		this._transmittanceRT.dispose();
		this._inscatterRT.dispose();
		this._irradianceRT.dispose();

		this._transmittancePass.dispose();
		this._inscatterPass.dispose();
		this._irradiancePass.dispose();
	}

}

function readPixels(renderer, renderTarget) {
	const { width, height, texture } = renderTarget;
	const imageData =
		texture.type === PIXEL_TYPE.HALF_FLOAT
			? new Uint16Array(width * height * 4)
			: new Float32Array(width * height * 4);
	renderer.setRenderTarget(renderTarget);
	renderer.readRenderTargetPixels(0, 0, width, height, imageData);
	texture.userData.imageData = imageData;
}
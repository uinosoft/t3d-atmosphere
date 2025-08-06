import { FileLoader, PIXEL_FORMAT, PIXEL_TYPE, Texture2D, Texture3D, TEXTURE_FILTER, MathUtils } from 't3d';
import { AtmosParameters } from './AtmosParameters.js';

export class AtmosLUTsLoader {

	constructor(capabilities, options = {}) {
		this._fileLoader = new FileLoader(options.manager);
		this._fileLoader.setResponseType('arraybuffer');

		this._data = {
			transmittanceTexture: null,
			inscatterTexture: null,
			irradianceTexture: null,
			atmosphere: AtmosParameters.DEFAULT,
			transmittanceMapping: 2,
			inscatterMapping: 1
		};

		let type = PIXEL_TYPE.FLOAT;

		const isWebGL2 = capabilities.version > 1;

		if (isWebGL2) {
			if (capabilities.getExtension('EXT_color_buffer_float') && capabilities.getExtension('OES_texture_float_linear')) {
				type = PIXEL_TYPE.FLOAT;
			} else {
				type = PIXEL_TYPE.HALF_FLOAT;
			}
		} else {
			if (capabilities.getExtension('OES_texture_float') && capabilities.getExtension('OES_texture_float_linear')) {
				type = PIXEL_TYPE.FLOAT;
			} else if (capabilities.getExtension('OES_texture_half_float') && capabilities.getExtension('OES_texture_half_float_linear')) {
				type = PIXEL_TYPE.HALF_FLOAT;
			} else {
				type = PIXEL_TYPE.UNSIGNED_BYTE;
				console.warn('Half float texture is not supported!');
			}
		}

		const transmittanceTexture = new Texture2D();
		transmittanceTexture.minFilter = TEXTURE_FILTER.LINEAR;
		transmittanceTexture.magFilter = TEXTURE_FILTER.LINEAR;
		transmittanceTexture.type = type;
		transmittanceTexture.generateMipmaps = false;
		transmittanceTexture.flipY = false;
		this._data.transmittanceTexture = transmittanceTexture;

		const inscatterTexture = new Texture3D();
		inscatterTexture.minFilter = TEXTURE_FILTER.LINEAR;
		inscatterTexture.magFilter = TEXTURE_FILTER.LINEAR;
		inscatterTexture.type = type;
		inscatterTexture.format = PIXEL_FORMAT.RGBA;
		inscatterTexture.generateMipmaps = false;
		this._data.inscatterTexture = inscatterTexture;

		const irradianceTexture = new Texture2D();
		irradianceTexture.minFilter = TEXTURE_FILTER.LINEAR;
		irradianceTexture.magFilter = TEXTURE_FILTER.LINEAR;
		irradianceTexture.type = type;
		irradianceTexture.generateMipmaps = false;
		irradianceTexture.flipY = false;
		this._data.irradianceTexture = irradianceTexture;
	}

	get data() {
		return this._data;
	}

	loadTransmittanceTexture(url) {
		return this._fileLoader.loadAsync(url).then(data => {
			const texture = this._data.transmittanceTexture;
			texture.image = {
				data: getImageDataFromArrayBuffer(data, texture.type),
				width: 256,
				height: 64
			};
			texture.version++;
		});
	}

	loadInscatterTexture(url) {
		return this._fileLoader.loadAsync(url).then(data => {
			const texture = this._data.inscatterTexture;
			texture.image = {
				data: getImageDataFromArrayBuffer(data, texture.type),
				width: 256,
				height: 128,
				depth: 32
			};
			texture.version++;
		});
	}

	loadIrradianceTexture(url) {
		return this._fileLoader.loadAsync(url).then(data => {
			const texture = this._data.irradianceTexture;
			texture.image = {
				data: getImageDataFromArrayBuffer(data, texture.type),
				width: 64,
				height: 16
			};
			texture.version++;
		});
	}

	dispose() {
		this._data.transmittanceTexture.dispose();
		this._data.inscatterTexture.dispose();
		this._data.irradianceTexture.dispose();
	}

}

function getImageDataFromArrayBuffer(arrayBuffer, type) {
	const halfFloatArray = new Uint16Array(arrayBuffer);
	const length = halfFloatArray.length;
	if (type === PIXEL_TYPE.FLOAT) {
		const floatArray = new Float32Array(length);
		for (let i = 0; i < length; i++) {
			floatArray[i] = MathUtils.fromHalfFloat(halfFloatArray[i]);
		}
		return floatArray;
	} else if (type === PIXEL_TYPE.HALF_FLOAT) {
		return halfFloatArray;
	} else {
		const uint8Array = new Uint8Array(length);
		for (let i = 0; i < length; i++) {
			uint8Array[i] = Math.round(MathUtils.fromHalfFloat(halfFloatArray[i]) * 255);
		}
		return uint8Array;
	}
}
import { Mesh, ShaderMaterial, DRAW_SIDE, PlaneGeometry, Vector3 } from 't3d';
import { AtmosSkyShader } from './shaders/AtmosSkyShader.js';
import { getAltitudeCorrectionOffset } from './getAltitudeCorrectionOffset.js';
import { AtmosParameters } from './AtmosParameters.js';

const vectorScratch = /* #__PURE__ */ new Vector3();
const vectorScratch2 = /* #__PURE__ */ new Vector3();

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

	setCamera(camera, worldToECEFMatrix, options, atmosphere = AtmosParameters.DEFAULT) {
		const { uniforms } = this.material;

		vectorScratch.setFromMatrixPosition(camera.worldMatrix);
		vectorScratch.toArray(uniforms.cameraPosition);

		worldToECEFMatrix.toArray(uniforms.worldToECEFMatrix);

		if (options) {
			const ellipsoid = options.ellipsoid;
			const correctAltitude = options.correctAltitude !== undefined ? options.correctAltitude : true;

			if (correctAltitude) {
				const cameraPositionECEF = vectorScratch
					.applyMatrix4(worldToECEFMatrix);
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
		} else {
			vectorScratch2
				.set(0, 0, 0)
				.toArray(uniforms.altitudeCorrection);
		}
	}

}
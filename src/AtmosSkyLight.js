import { Vector2, Vector3, SphericalHarmonicsLight } from 't3d';
import { getTextureCoordFromUnitRange, bottomRadius, topRadius, IRRADIANCE_TEXTURE_WIDTH, IRRADIANCE_TEXTURE_HEIGHT } from './AtmosUtils.js';
import { sampleTexture } from './helpers/sampleTexture.js';

function getUvFromRMuS(r, muS, result) {
	const xR = (r - bottomRadius) / (topRadius - bottomRadius);
	const xMuS = muS * 0.5 + 0.5;
	return result.set(
		getTextureCoordFromUnitRange(xMuS, IRRADIANCE_TEXTURE_WIDTH),
		getTextureCoordFromUnitRange(xR, IRRADIANCE_TEXTURE_HEIGHT)
	);
}

// Our target is: (1 + dot(n, p)) * 0.5
// Constant term: L0 * sqrt(π)/2 == 0.5
// Linear term: L1 * π/3 * sqrt(3)/sqrt(π) == n/2
// See: https://github.com/mrdoob/three.js/blob/r170/src/math/SphericalHarmonics3.js#L85
// See also: https://www.ppsloan.org/publications/StupidSH36.pdf
const L0_COEFF = 1 / Math.sqrt(Math.PI);
const L1_COEFF = Math.sqrt(3) / (2 * Math.sqrt(Math.PI));

const vectorScratch1 = /* #__PURE__ */ new Vector3();
const vectorScratch2 = /* #__PURE__ */ new Vector3();
const uvScratch = /* #__PURE__ */ new Vector2();

const LUMINANCE_COEFFS = /* #__PURE__ */ new Vector3(0.2126, 0.7152, 0.0722);
const skyRadianceToLuminance = new Vector3(114974.916437, 71305.954816, 65310.548555);
const sunRadianceToLuminance = new Vector3(98242.786222, 69954.398112, 66475.012354);
const luminance = LUMINANCE_COEFFS.dot(sunRadianceToLuminance);
const skyRadianceToRelativeLuminance = new Vector3().copy(skyRadianceToLuminance).multiplyScalar(1 / luminance);

export class AtmosSkyLight extends SphericalHarmonicsLight {

	constructor(params) {
		super();
		const {
			irradianceTexture = null,
			ellipsoid,
			sunDirection
		} = params;

		this.irradianceTexture = irradianceTexture;
		this.ellipsoid = ellipsoid;
		this.sunDirection = sunDirection?.clone() ?? new Vector3();
	}

	update(cameraPosition) {
		if (this.irradianceTexture == null) {
			return;
		}

		const cameraPositionECEF = vectorScratch1.copy(cameraPosition);

		 const r = cameraPositionECEF.getLength();
		 const muS = cameraPositionECEF.dot(this.sunDirection) / r;
		 const uv = getUvFromRMuS(r, muS, uvScratch);
		const irradiance = sampleTexture(this.irradianceTexture, uv, vectorScratch2);
		irradiance.multiply(skyRadianceToRelativeLuminance);

		const normal = this.ellipsoid
			.getPositionToNormal(cameraPositionECEF, vectorScratch1);
		const coefficients = this.sh.coefficients;
		coefficients[0].copy(irradiance).multiplyScalar(L0_COEFF);
		coefficients[1].copy(irradiance).multiplyScalar(L1_COEFF * normal.y);
		coefficients[2].copy(irradiance).multiplyScalar(L1_COEFF * normal.z);
		coefficients[3].copy(irradiance).multiplyScalar(L1_COEFF * normal.x);
	}

}
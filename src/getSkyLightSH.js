import { Vector2, Vector3, SphericalHarmonics3 } from 't3d';
import { getTextureCoordFromUnitRange } from './helpers/functions.js';
import { IRRADIANCE_TEXTURE_WIDTH, IRRADIANCE_TEXTURE_HEIGHT } from './constants.js';
import { sampleTexture } from './helpers/sampleTexture.js';
import { AtmosParameters } from './AtmosParameters.js';

function getUvFromRMuS(atmosphere, r, muS, result) {
	const { topRadius, bottomRadius } = atmosphere;
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

export function getSkyLightSH(
	irradianceTexture,
	worldPosition,
	sunDirection,
	result = new SphericalHarmonics3(),
	ellipsoid,
	atmosphere = AtmosParameters.DEFAULT
) {
	const cameraPositionECEF = vectorScratch1.copy(worldPosition);

	const r = cameraPositionECEF.getLength();
	const muS = cameraPositionECEF.dot(sunDirection) / r;
	const uv = getUvFromRMuS(atmosphere, r, muS, uvScratch);
	const irradiance = sampleTexture(irradianceTexture, uv, vectorScratch2);
	irradiance.multiply(atmosphere.skyRadianceToRelativeLuminance);

	const normal = ellipsoid
		.getPositionToNormal(cameraPositionECEF, vectorScratch1);
	const coefficients = result.coefficients;

	coefficients[0].copy(irradiance).multiplyScalar(L0_COEFF);
	coefficients[1].copy(irradiance).multiplyScalar(L1_COEFF * normal.y);
	coefficients[2].copy(irradiance).multiplyScalar(L1_COEFF * normal.z);
	coefficients[3].copy(irradiance).multiplyScalar(L1_COEFF * normal.x);
}
import { Color3, Vector2, Vector3 } from 't3d';
import { AtmosParameters } from './AtmosParameters.js';
import { TRANSMITTANCE_TEXTURE_WIDTH, TRANSMITTANCE_TEXTURE_HEIGHT } from './constants.js';
import { safeSqrt, rayIntersectsGround, distanceToTopAtmosphereBoundary, getTextureCoordFromUnitRange } from './helpers/functions.js';
import { sampleTexture } from './helpers/sampleTexture.js';
import { getAltitudeCorrectionOffset } from './getAltitudeCorrectionOffset.js';

function getUvFromRMu(atmosphere, r, mu, result) {
	const { topRadius, bottomRadius } = atmosphere;
	const H = Math.sqrt(topRadius ** 2 - bottomRadius ** 2);
	const rho = safeSqrt(r ** 2 - bottomRadius ** 2);
	const d = distanceToTopAtmosphereBoundary(atmosphere, r, mu);
	const dMin = topRadius - r;
	const dMax = rho + H;
	const xmu = (d - dMin) / (dMax - dMin);
	const xr = rho / H;
	return result.set(
		getTextureCoordFromUnitRange(xmu, TRANSMITTANCE_TEXTURE_WIDTH),
		getTextureCoordFromUnitRange(xr, TRANSMITTANCE_TEXTURE_HEIGHT)
	);
}

const vectorScratch1 = /* #__PURE__ */ new Vector3();
const vectorScratch2 = /* #__PURE__ */ new Vector3();
const uvScratch = /* #__PURE__ */ new Vector2();

export function getSunLightColor(
	transmittanceTexture,
	cameraPosition,
	sunDirection,
	worldToECEFMatrix,
	target = new Color3(),
	options,
	atmosphere = AtmosParameters.DEFAULT
) {
	const cameraPositionECEF = vectorScratch1.copy(cameraPosition)
		.applyMatrix4(worldToECEFMatrix);

	if (options) {
		const ellipsoid = options.ellipsoid;
		const correctAltitude = options.correctAltitude !== undefined ? options.correctAltitude : true;

		if (correctAltitude) {
			const surfacePosition = ellipsoid.getPositionToSurfacePoint(
				cameraPositionECEF,
				vectorScratch2
			);
			if (surfacePosition != null) {
				cameraPositionECEF.add(
					getAltitudeCorrectionOffset(
						cameraPositionECEF,
						atmosphere.bottomRadius,
						ellipsoid,
						vectorScratch2
					)
				);
			}
		}
	}

	const camera = cameraPositionECEF;
	const transmittance = vectorScratch2;

	let r = camera.getLength();
	let rmu = camera.dot(sunDirection);

	const { topRadius } = atmosphere;

	const distanceToTopAtmosphereBoundary =
		-rmu - Math.sqrt(rmu ** 2 - r ** 2 + topRadius ** 2);

	if (distanceToTopAtmosphereBoundary > 0) {
		r = topRadius;
		rmu += distanceToTopAtmosphereBoundary;
	}

	if (r > topRadius) {
		transmittance.set(1, 1, 1);
	} else {
		const mu = rmu / r;
		const rayRMuIntersectsGround = rayIntersectsGround(atmosphere, r, mu);
		if (rayRMuIntersectsGround) {
			transmittance.setScalar(0);
		} else {
			const uv = getUvFromRMu(atmosphere, r, mu, uvScratch);
			sampleTexture(transmittanceTexture, uv, transmittance);
		}
	}

	const radiance = transmittance
		.multiply(atmosphere.solarIrradiance)
		.multiply(atmosphere.sunRadianceToRelativeLuminance);

	return target.setRGB(radiance.x, radiance.y, radiance.z);
}
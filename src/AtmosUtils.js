import { Vector2, Vector3, Color3, MathUtils } from 't3d';

export function getAltitudeCorrectionOffset(cameraPosition, bottomRadius, ellipsoid, result) {
	const surfacePosition = ellipsoid.getPositionToSurfacePoint(cameraPosition, vectorScratch1);

	return surfacePosition != null
		? getOsculatingSphereCenter(ellipsoid, surfacePosition, bottomRadius, result)
			.negate()
		: result.setScalar(0);
}

function getOsculatingSphereCenter(
	ellipsoid,
	surfacePosition,
	radius,
	result
) {
	const a2 = ellipsoid.radius.x ** 2;
	const b2 = ellipsoid.radius.z ** 2;
	const normal = vectorScratch2
		.set(
			surfacePosition.x / a2,
			surfacePosition.y / a2,
			surfacePosition.z / b2
		)
		.normalize();
	return result.copy(normal.multiplyScalar(-radius).add(surfacePosition));
}

export function getSunLightColor(transmittanceTexture, worldPosition, sunDirection, target = new Color3()) {
	const camera = vectorScratch1.copy(worldPosition);
	const transmittance = vectorScratch2;

	let r = camera.getLength();
	let rmu = camera.dot(sunDirection);

	const distanceToTopAtmosphereBoundary = -rmu - Math.sqrt(rmu ** 2 - r ** 2 + topRadius ** 2);

	if (distanceToTopAtmosphereBoundary > 0) {
		r = topRadius;
		rmu += distanceToTopAtmosphereBoundary;
	}

	if (r > topRadius) {
		transmittance.set(1, 1, 1);
	} else {
		const mu = rmu / r;
		const rayRMuIntersectsGround = rayIntersectsGround(r, mu);
		if (rayRMuIntersectsGround) {
			transmittance.setScalar(0);
		} else {
			const uv = getUvFromRMu(r, mu, uvScratch);
			sampleTexture(transmittanceTexture, uv, transmittance);
		}
	}

	const radiance = transmittance.multiply(solarIrradiance);
	return target.setRGB(radiance.x, radiance.y, radiance.z);
}

function safeSqrt(a) {
	return Math.sqrt(Math.max(a, 0));
}

function clampDistance(d) {
	return Math.max(d, 0);
}

function rayIntersectsGround(r, mu) {
	return mu < 0 && r ** 2 * (mu ** 2 - 1) + bottomRadius ** 2 >= 0;
}

function distanceToTopAtmosphereBoundary(r, mu) {
	const discriminant = r ** 2 * (mu ** 2 - 1) + topRadius ** 2;
	return clampDistance(-r * mu + safeSqrt(discriminant));
}

function getTextureCoordFromUnitRange(x, textureSize) {
	return 0.5 / textureSize + x * (1 - 1 / textureSize);
}

function getUvFromRMu(r, mu, result) {
	const H = Math.sqrt(topRadius ** 2 - bottomRadius ** 2);
	const rho = safeSqrt(r ** 2 - bottomRadius ** 2);
	const d = distanceToTopAtmosphereBoundary(r, mu);
	const dMin = topRadius - r;
	const dMax = rho + H;
	const xmu = (d - dMin) / (dMax - dMin);
	const xr = rho / H;
	return result.set(
		getTextureCoordFromUnitRange(xmu, TRANSMITTANCE_TEXTURE_WIDTH),
		getTextureCoordFromUnitRange(xr, TRANSMITTANCE_TEXTURE_HEIGHT)
	);
}

function samplePixel(data, index, result) {
	const dataIndex = index * 4; // Assume RGBA
	return result.fromArray(data, dataIndex, true);
}

export function sampleTexture(texture, uv, result) {
	const { width, height } = texture.image;
	const data = texture.image.data;

	const x = MathUtils.clamp(uv.x, 0, 1) * (width - 1);
	const y = MathUtils.clamp(uv.y, 0, 1) * (height - 1);
	const xi = Math.floor(x);
	const yi = Math.floor(y);
	const tx = x - xi;
	const ty = y - yi;
	const sx = tx;
	const sy = ty;
	const rx0 = xi % width;
	const rx1 = (rx0 + 1) % width;
	const ry0 = yi % height;
	const ry1 = (ry0 + 1) % height;
	const v00 = samplePixel(data, ry0 * width + rx0, vectorScratch4);
	const v10 = samplePixel(data, ry0 * width + rx1, vectorScratch5);
	const nx0 = v00.lerp(v10, sx);
	const v01 = samplePixel(data, ry1 * width + rx0, vectorScratch6);
	const v11 = samplePixel(data, ry1 * width + rx1, vectorScratch7);
	const nx1 = v01.lerp(v11, sx);
	return result.copy(nx0.lerp(nx1, sy));
}

const solarIrradiance = new Vector3(1.474, 1.8504, 1.91198);
const bottomRadius = 6360000;
const topRadius = 6420000;
const TRANSMITTANCE_TEXTURE_WIDTH = 256;
const TRANSMITTANCE_TEXTURE_HEIGHT = 64;

const vectorScratch1 = new Vector3();
const vectorScratch2 = new Vector3();
const vectorScratch4 = new Vector3();
const vectorScratch5 = new Vector3();
const vectorScratch6 = new Vector3();
const vectorScratch7 = new Vector3();
const uvScratch = new Vector2();

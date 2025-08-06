import { Vector3 } from 't3d';

const vectorScratch = /* #__PURE__ */ new Vector3();
const vectorScratch2 = /* #__PURE__ */ new Vector3();

export function getAltitudeCorrectionOffset(cameraPosition, bottomRadius, ellipsoid, result) {
	const surfacePosition = ellipsoid.getPositionToSurfacePoint(cameraPosition, vectorScratch);

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
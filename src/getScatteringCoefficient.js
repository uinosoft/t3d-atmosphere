import { Vector3, MathUtils } from 't3d';

export function getScatteringCoefficient(wavelengths, skyTint, atmosphereThickness, result) {
	// Sky Tint shifts the value of Wavelengths
	const variableRangeWavelengths = _vec3_1.set(
		MathUtils.lerp(wavelengths.x + 150, wavelengths.x - 150, skyTint.r),
		MathUtils.lerp(wavelengths.y + 150, wavelengths.y - 150, skyTint.g),
		MathUtils.lerp(wavelengths.z + 150, wavelengths.z - 150, skyTint.b)
	);

	variableRangeWavelengths.x = MathUtils.clamp(variableRangeWavelengths.x, 380, 780);
	variableRangeWavelengths.y = MathUtils.clamp(variableRangeWavelengths.y, 380, 780);
	variableRangeWavelengths.z = MathUtils.clamp(variableRangeWavelengths.z, 380, 780);

	// Evaluate Beta Rayleigh function is based on A.J.Preetham

	const WL = variableRangeWavelengths.multiplyScalar(1e-9); // nano meter unit

	const n = 1.0003; // the index of refraction of air
	const N = 2.545e25; // molecular density at sea level
	const pn = 0.035; // depolatization factor for standard air

	const waveLength4 = _vec3_2.set(Math.pow(WL.x, 4), Math.pow(WL.y, 4), Math.pow(WL.z, 4));
	const delta = waveLength4.multiplyScalar(3.0 * N * (6.0 - 7.0 * pn));
	const ray = (8 * Math.pow(Math.PI, 3) * Math.pow(n * n - 1.0, 2) * (6.0 + 3.0 * pn));
	result.set(ray / delta.x, ray / delta.y, ray / delta.z);

	// Atmosphere Thickness ( Rayleigh ) scale
	const Km = 1000.0; // kilo meter unit
	result.multiplyScalar(Km * atmosphereThickness);

	return result;
}

const _vec3_1 = new Vector3();
const _vec3_2 = new Vector3();
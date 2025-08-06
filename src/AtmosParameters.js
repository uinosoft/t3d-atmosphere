import { Color3, Vector3 } from 't3d';
import { METER_TO_LENGTH_UNIT } from './constants.js';

const LUMINANCE_COEFFS = /* #__PURE__ */ new Vector3(0.2126, 0.7152, 0.0722);

export class AtmosParameters {

	constructor() {
		// The solar irradiance at the top of the atmosphere.
		this.solarIrradiance = new Vector3(1.474, 1.8504, 1.91198);

		// The distance between the planet center and the bottom of the atmosphere in
		// meters.
		this.bottomRadius = 6360000;

		// The distance between the planet center and the top of the atmosphere in
		// meters.
		this.topRadius = 6420000;

		// The scattering coefficient of air molecules at the altitude where their
		// density is maximum (usually the bottom of the atmosphere), as a function of
		// wavelength. The scattering coefficient at altitude h is equal to
		// "rayleighScattering" times "rayleighDensity" at this altitude.
		this.rayleighScattering = new Vector3(0.005802, 0.013558, 0.0331);

		// The scattering coefficient of aerosols at the altitude where their density
		// is maximum (usually the bottom of the atmosphere), as a function of
		// wavelength. The scattering coefficient at altitude h is equal to
		// "mieScattering" times "mieDensity" at this altitude.
		this.mieScattering = new Vector3(0.003996, 0.003996, 0.003996);

		// The extinction coefficient of aerosols at the altitude where their density
		// is maximum (usually the bottom of the atmosphere), as a function of
		// wavelength. The extinction coefficient at altitude h is equal to
		// "mieExtinction" times "mieDensity" at this altitude.
		this.mieExtinction = new Vector3(0.00444, 0.00444, 0.00444);

		// The asymmetry parameter for the Cornette-Shanks phase function for the
		// aerosols.
		this.miePhaseFunctionG = 0.8;

		// The extinction coefficient of molecules that absorb light (e.g. ozone) at
		// the altitude where their density is maximum, as a function of wavelength.
		// The extinction coefficient at altitude h is equal to
		// "absorptionExtinction" times "absorptionDensity" at this altitude.
		this.absorptionExtinction = new Vector3(0.00065, 0.001881, 0.000085);

		// The average albedo of the ground.
		this.groundAlbedo = new Color3(0.1, 0.1, 0.1);

		// Radiance to luminance conversion
		this.sunRadianceToLuminance = new Vector3(98242.786222, 69954.398112, 66475.012354);
		this.skyRadianceToLuminance = new Vector3(114974.916437, 71305.954816, 65310.548555);

		// Luminance values are too large for storing in half precision buffer.
		// We divide them by the luminance of the sun with the unit radiance.
		const luminance = LUMINANCE_COEFFS.dot(this.sunRadianceToLuminance);
		this.sunRadianceToRelativeLuminance = this.sunRadianceToLuminance.clone().multiplyScalar(1 / luminance);
		this.skyRadianceToRelativeLuminance = this.skyRadianceToLuminance.clone().multiplyScalar(1 / luminance);
	}

	toUniform() {
		return {
			solar_irradiance: this.solarIrradiance.toArray(),
			bottom_radius: this.bottomRadius * METER_TO_LENGTH_UNIT,
			top_radius: this.topRadius * METER_TO_LENGTH_UNIT,
			rayleigh_scattering: this.rayleighScattering.toArray(),
			mie_scattering: this.mieScattering.toArray(),
			mie_extinction: this.mieExtinction.toArray(),
			mie_phase_function_g: this.miePhaseFunctionG,
	  		absorption_extinction: this.absorptionExtinction.toArray(),
			ground_albedo: this.groundAlbedo.toArray()
		};
	}

}

AtmosParameters.DEFAULT = new AtmosParameters();
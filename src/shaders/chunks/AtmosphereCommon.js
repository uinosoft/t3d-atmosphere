import {
	IRRADIANCE_TEXTURE_WIDTH,
	IRRADIANCE_TEXTURE_HEIGHT,
	SCATTERING_TEXTURE_R_SIZE,
	SCATTERING_TEXTURE_MU_SIZE,
	SCATTERING_TEXTURE_MU_S_SIZE,
	SCATTERING_TEXTURE_NU_SIZE,
	TRANSMITTANCE_TEXTURE_WIDTH,
	TRANSMITTANCE_TEXTURE_HEIGHT,
	METER_TO_LENGTH_UNIT
} from '../../constants.js';

export const AtmosphereCommon = /* glsl */`
struct AtmosphereParameters {
	vec3 solar_irradiance;
	float bottom_radius;
  	float top_radius;
	vec3 rayleigh_scattering;
	vec3 mie_scattering;
	vec3 mie_extinction;
	float mie_phase_function_g;
	vec3 absorption_extinction;
	vec3 ground_albedo;
};

uniform AtmosphereParameters atmosphere;

#define IRRADIANCE_TEXTURE_WIDTH ${IRRADIANCE_TEXTURE_WIDTH.toFixed(0)}
#define IRRADIANCE_TEXTURE_HEIGHT ${IRRADIANCE_TEXTURE_HEIGHT.toFixed(0)}
#define SCATTERING_TEXTURE_R_SIZE ${SCATTERING_TEXTURE_R_SIZE.toFixed(0)}
#define SCATTERING_TEXTURE_MU_SIZE ${SCATTERING_TEXTURE_MU_SIZE.toFixed(0)}
#define SCATTERING_TEXTURE_MU_S_SIZE ${SCATTERING_TEXTURE_MU_S_SIZE.toFixed(0)}
#define SCATTERING_TEXTURE_NU_SIZE ${SCATTERING_TEXTURE_NU_SIZE.toFixed(0)}
#define TRANSMITTANCE_TEXTURE_WIDTH ${TRANSMITTANCE_TEXTURE_WIDTH.toFixed(0)}
#define TRANSMITTANCE_TEXTURE_HEIGHT ${TRANSMITTANCE_TEXTURE_HEIGHT.toFixed(0)}
#define METER_TO_LENGTH_UNIT ${METER_TO_LENGTH_UNIT.toFixed(7)}

// Half heights for the atmosphere air density (HR) and particle density (HM)
// This is the height in km that half the particles are found below
const float HR = 8.0;
const float HM = 1.2;

// ---------------------------------------------------------------------------- 
// UTILITY FUNCTIONS
// ---------------------------------------------------------------------------- 

float GetTextureCoordFromUnitRange(const float x, const int texture_size) {
	return 0.5 / float(texture_size) + x * (1.0 - 1.0 / float(texture_size));
}

float GetUnitRangeFromTextureCoord(const float u, const int texture_size) {
	return (u - 0.5 / float(texture_size)) / (1.0 - 1.0 / float(texture_size));
}

float ClampCosine(float mu) {
	return clamp(mu, -1.0, 1.0);
}

float ClampDistance(float d) {
	return max(d, 0.0);
}

float ClampRadius(float r) {
	return clamp(r, atmosphere.bottom_radius, atmosphere.top_radius);
}

float SafeSqrt(float a) {
	return sqrt(max(a, 0.0));
}

float DistanceToTopAtmosphereBoundary(float r, float mu) {
	float discriminant = r * r * (mu * mu - 1.0) + atmosphere.top_radius * atmosphere.top_radius;
	return ClampDistance(-r * mu + SafeSqrt(discriminant));
}

float DistanceToBottomAtmosphereBoundary(float r, float mu) {
	float discriminant = r * r * (mu * mu - 1.0) + atmosphere.bottom_radius * atmosphere.bottom_radius;
	return ClampDistance(-r * mu - SafeSqrt(discriminant));
}

float DistanceToNearestAtmosphereBoundary(float r, float mu, bool rayIntersectsGround) {
	if (rayIntersectsGround) {
		return DistanceToBottomAtmosphereBoundary(r, mu);
	} else {
		return DistanceToTopAtmosphereBoundary(r, mu);
	}
}
`;
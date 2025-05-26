export const IrradianceCompute = /* glsl */`
void GetRMuSFromIrradianceUv(vec2 uv, out float r, out float mu_s) {
  float x_mu_s = GetUnitRangeFromTextureCoord(uv.x, IRRADIANCE_TEXTURE_WIDTH);
  float x_r = GetUnitRangeFromTextureCoord(uv.y, IRRADIANCE_TEXTURE_HEIGHT);
  r = Rg + x_r * (Rt - Rg);
  mu_s = ClampCosine(2.0 * x_mu_s - 1.0);
}

const float sun_angular_radius = 0.004675; // radians
const float rad = 0.017453292519943295; // degrees to radians

vec3 ComputeDirectIrradiance(float r, float mu_s) {
	float alpha_s = sun_angular_radius / rad;
	// Approximate average of the cosine factor mu_s over the visible fraction of
	// the Sun disc.
	float average_cosine_factor =
		mu_s < -alpha_s ? 0.0 : (mu_s > alpha_s ? mu_s :
		(mu_s + alpha_s) * (mu_s + alpha_s) / (4.0 * alpha_s));

	return solar_irradiance *
		GetTransmittanceToTopAtmosphereBoundary(r, mu_s) * average_cosine_factor;
}

vec3 ComputeIndirectIrradiance(float r, float mu_s) {
	const int SAMPLE_COUNT = 32;
	const float dphi = PI / float(SAMPLE_COUNT);
	const float dtheta = PI / float(SAMPLE_COUNT);

	vec3 result = vec3(0.0);
	vec3 omega_s = vec3(sqrt(1.0 - mu_s * mu_s), 0.0, mu_s);
	for (int j = 0; j < SAMPLE_COUNT / 2; ++j) {
		float theta = (float(j) + 0.5) * dtheta;
		for (int i = 0; i < 2 * SAMPLE_COUNT; ++i) {
			float phi = (float(i) + 0.5) * dphi;
			vec3 omega =
				vec3(cos(phi) * sin(theta), sin(phi) * sin(theta), cos(theta));
			float domega = (dtheta / rad) * (dphi / rad) * sin(theta);

			float nu = dot(omega, omega_s);

			vec3 single_mie_scattering;

			vec3 scattering = GetCombinedScattering(r, omega.z, mu_s, nu, false, single_mie_scattering);

			result += (scattering * RayleighPhaseFunction(nu) + single_mie_scattering *
				MiePhaseFunction(miePhaseFunctionG, nu)) *
				omega.z * domega;
		}
	}
	return result;
}
`;
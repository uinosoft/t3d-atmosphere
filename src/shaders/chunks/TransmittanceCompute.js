// ref https://ebruneton.github.io/precomputed_atmospheric_scattering
// ref https://www.shadertoy.com/view/DsBGWG
export const TransmittanceCompute = /* glsl */`
#define TRANSMITTANCE_INTEGRAL_SAMPLES 50

// total optical length of rayleigh or mie
float OpticalDepth(float H, float r, float mu) {
	float dx = DistanceToTopAtmosphereBoundary(r, mu) / float(TRANSMITTANCE_INTEGRAL_SAMPLES);
	
	float xi = 0.0;
	float yi = exp(-(r - atmosphere.bottom_radius) / H);
	float result = 0.0; 
	for (int i = 1; i <= TRANSMITTANCE_INTEGRAL_SAMPLES; ++i) {
		float xj = float(i) * dx; 
		float yj = exp(-(sqrt(r * r + xj * xj + 2.0 * xj * r * mu) - atmosphere.bottom_radius) / H);
		result += (yi + yj) / 2.0 * dx;
		xi = xj;
		yi = yj;
	}
	
	return mu < -sqrt(1.0 - (atmosphere.bottom_radius / r) * (atmosphere.bottom_radius / r)) ? 1e9 : result; 
}

// total optical length of Ozone
float OpticalDepth_O3(float r, float mu) {
	float dx = DistanceToTopAtmosphereBoundary(r, mu) / float(TRANSMITTANCE_INTEGRAL_SAMPLES);

	float result = 0.0;
	for (int i = 0; i <= TRANSMITTANCE_INTEGRAL_SAMPLES; ++i) {
		float d_i = float(i) * dx;
		float r_i = sqrt(d_i * d_i + 2.0 * r * mu * d_i + r * r);
		float height = r_i - atmosphere.bottom_radius;
		float linear_term = 0.0, constant_term = 0.0;
		// 2 Ozone layers
		linear_term = height < 25.0 ? 0.066667 : -0.066667;
		constant_term = height < 25.0 ? -0.66667 : 2.666667;
		float y_i = linear_term * height + constant_term;
		y_i = clamp(y_i, 0.0, 1.0);
		result += y_i * dx;
	}
	return result;
}

#if TRANSMITTANCE_MAPPING == 0
	void GetRMuFromTransmittanceUv(vec2 uv, out float r, out float mu) {
		mu = -0.15 + uv.x * (1.0 + 0.15);
		r = atmosphere.bottom_radius + uv.y * (atmosphere.top_radius - atmosphere.bottom_radius);
	}
#elif TRANSMITTANCE_MAPPING == 1
	void GetRMuFromTransmittanceUv(vec2 uv, out float r, out float mu) {
		mu = -0.15 + tan(1.5 * uv.x) / tan(1.5) * (1.0 + 0.15);
		r = atmosphere.bottom_radius + (uv.y * uv.y) * (atmosphere.top_radius - atmosphere.bottom_radius);
	}
#else
	void GetRMuFromTransmittanceUv(vec2 uv, out float r, out float mu) {
		float H = sqrt(atmosphere.top_radius * atmosphere.top_radius - atmosphere.bottom_radius * atmosphere.bottom_radius);
		vec2 TRANSMITTANCE_TEXTURE_SIZE = vec2(TRANSMITTANCE_TEXTURE_WIDTH, TRANSMITTANCE_TEXTURE_HEIGHT);
		uv = gl_FragCoord.xy / TRANSMITTANCE_TEXTURE_SIZE;
		float x_mu = GetUnitRangeFromTextureCoord(uv.x, TRANSMITTANCE_TEXTURE_WIDTH);
		float x_r = GetUnitRangeFromTextureCoord(uv.y, TRANSMITTANCE_TEXTURE_HEIGHT);
		float rho = H * x_r;
		r = sqrt(rho * rho + atmosphere.bottom_radius * atmosphere.bottom_radius);
		float d_min = atmosphere.top_radius - r;
		float d_max = rho + H;
		float d = d_min + x_mu * (d_max - d_min);
		mu = d <= 0.0 ? 1.0 : (H * H - rho * rho - d * d) / (2.0 * r * d);
		mu = ClampCosine(mu);
	}
#endif

vec3 ComputeTransmittance(vec2 uv) {
	float r, muS;

	GetRMuFromTransmittanceUv(uv, r, muS);

	vec3 depth = atmosphere.rayleigh_scattering * OpticalDepth(HR, r, muS) + atmosphere.mie_extinction * OpticalDepth(HM, r, muS);

	#if TRANSMITTANCE_MAPPING == 2
		depth += atmosphere.absorption_extinction * OpticalDepth_O3(r, muS);
	#endif

	return exp(-depth);
}
`;
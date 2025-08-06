export const InscatterCompute = /* glsl */`
#define INSCATTER_INTEGRAL_SAMPLES 25

void GetRMuMuSNuFromScatteringUvwz(vec4 uvwz, out float r, out float mu, out float muS, out float nu, out bool rayIntersectsGround) {
	float xMuS = GetUnitRangeFromTextureCoord(uvwz.y, SCATTERING_TEXTURE_MU_S_SIZE);

	float H = sqrt(atmosphere.top_radius * atmosphere.top_radius - atmosphere.bottom_radius * atmosphere.bottom_radius);
	float rho = H * GetUnitRangeFromTextureCoord(uvwz.w, SCATTERING_TEXTURE_R_SIZE);
	r = sqrt(rho * rho + atmosphere.bottom_radius * atmosphere.bottom_radius);

	#if INSCATTER_MAPPING == 1
		if (uvwz.z < 0.5) { // bottom half
			float dmin = r - atmosphere.bottom_radius;
			float dmax = rho;
			float d = dmin + (dmax - dmin) * GetUnitRangeFromTextureCoord(1. - 2. * uvwz.z, SCATTERING_TEXTURE_MU_SIZE / 2);
			mu = d == 0.0 ? -1.0 : ClampCosine(-(rho * rho + d * d) / (2.0 * r * d));
			rayIntersectsGround = true;
		} else {
			float dmin = atmosphere.top_radius - r;
			float dmax = rho + H;
			uvwz.z = clamp(uvwz.z, 0.5, 0.99); // fix jagged bright lines at the horizon, but why ?
			float d = dmin + (dmax - dmin) * GetUnitRangeFromTextureCoord(2. * uvwz.z - 1., SCATTERING_TEXTURE_MU_SIZE / 2);
			mu = d == 0.0 ? 1.0 : ClampCosine((H * H - rho * rho - d * d) / (2.0 * r * d));
			rayIntersectsGround = false;
		}
	
		// paper formula 
		// muS = -(0.6 + log(1.0 - xMuS * (1.0 -  exp(-3.6)))) / 3.0; 
		// better formula 
		// muS = tan((2.0 * xMuS - 1.0 + 0.26) * 0.75) / tan(1.26 * 0.75);

		float d_min = atmosphere.top_radius - atmosphere.bottom_radius;
		float d_max = H;
		float D = DistanceToTopAtmosphereBoundary(atmosphere.bottom_radius, -0.2);
		float A = (D - d_min) / (d_max - d_min);
		float a = (A - xMuS * A) / (1.0 + xMuS * A);
		float d = d_min + min(a, A) * (d_max - d_min);
		muS = d == 0.0 ? 1.0 : ClampCosine((H * H - d * d) / (2.0 * atmosphere.bottom_radius * d));
	#else 
		mu = -1.0 + 2.0 * GetUnitRangeFromTextureCoord(uvwz.z, SCATTERING_TEXTURE_MU_SIZE);
		muS = -0.2 + xMuS * 1.2;
	#endif

	nu = ClampCosine(uvwz.x * 2.0 - 1.0);
}

void ComputeSingleScatteringIntegrand(float r, float mu, float muS, float nu, float d, bool rayIntersectsGround, out vec3 rayleigh, out float mie) {
	float ri = ClampRadius(sqrt(r * r + d * d + 2.0 * r * mu * d));
	float muSi = ClampCosine((muS * r + nu * d) / ri);

	vec3 transmittance = GetTransmittance(r, mu, d, rayIntersectsGround) *
		GetTransmittanceToSun(ri, muSi);

	rayleigh = exp(-(ri - atmosphere.bottom_radius) / HR) * transmittance;
	mie = exp(-(ri - atmosphere.bottom_radius) / HM) * transmittance.x; // only calc the red channel
}

void ComputeSingleScattering(float r, float mu, float muS, float nu, bool rayIntersectsGround, out vec3 ray, out float mie) {
	ray = vec3(0., 0., 0.);
	mie = 0.0; // single channel only

	float dx = DistanceToNearestAtmosphereBoundary(r, mu, rayIntersectsGround)
		/ float(INSCATTER_INTEGRAL_SAMPLES);

	vec3 rayi;
	float miei;

	ComputeSingleScatteringIntegrand(r, mu, muS, nu, 0.0, rayIntersectsGround, rayi, miei);

	for (int i = 1; i <= INSCATTER_INTEGRAL_SAMPLES; ++i) {
		float xj = float(i) * dx; 

		vec3 rayj;
		float miej;

		ComputeSingleScatteringIntegrand(r, mu, muS, nu, xj, rayIntersectsGround, rayj, miej);
		
		ray += (rayi + rayj) / 2.0 * dx;
		mie += (miei + miej) / 2.0 * dx;

		rayi = rayj;
		miei = miej;
	}

	ray *= atmosphere.rayleigh_scattering;
	mie *= atmosphere.mie_scattering.x;
}
`;
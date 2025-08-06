export const InscatterLookup = /* glsl */`
vec4 GetScatteringUvwzFromRMuMuSNu(float r, float mu, float muS, float nu, bool rayIntersectsGround) {
	float H = sqrt(atmosphere.top_radius * atmosphere.top_radius - atmosphere.bottom_radius * atmosphere.bottom_radius);
	float rho = SafeSqrt(r * r - atmosphere.bottom_radius * atmosphere.bottom_radius);
	float uR = GetTextureCoordFromUnitRange(rho / H, SCATTERING_TEXTURE_R_SIZE);
	#if INSCATTER_MAPPING == 1
		float rmu = r * mu;
		float discriminant = rmu * rmu - r * r + atmosphere.bottom_radius * atmosphere.bottom_radius;
		float uMu;
		if (rayIntersectsGround) {
			float d = -rmu - SafeSqrt(discriminant);
			float d_min = r - atmosphere.bottom_radius;
			float d_max = rho;
			uMu = 0.5 - 0.5 * GetTextureCoordFromUnitRange(d_max == d_min ? 0.0 : (d - d_min) / (d_max - d_min), SCATTERING_TEXTURE_MU_SIZE / 2);
		} else {
			float d = -rmu + SafeSqrt(discriminant + H * H);
			float d_min = atmosphere.top_radius - r;
			float d_max = rho + H;
			uMu = 0.5 + 0.5 * GetTextureCoordFromUnitRange((d - d_min) / (d_max - d_min), SCATTERING_TEXTURE_MU_SIZE / 2);
		}

		float d = DistanceToTopAtmosphereBoundary(atmosphere.bottom_radius, muS);
		float d_min = atmosphere.top_radius - atmosphere.bottom_radius;
		float d_max = H;
		float a = (d - d_min) / (d_max - d_min);
		float D = DistanceToTopAtmosphereBoundary(atmosphere.bottom_radius, -0.2);
		float A = (D - d_min) / (d_max - d_min);
		float uMuS = GetTextureCoordFromUnitRange(max(1.0 - a / A, 0.0) / (1.0 + a), SCATTERING_TEXTURE_MU_S_SIZE);
	#else
		float uMu = GetTextureCoordFromUnitRange((mu + 1.0) / 2.0, SCATTERING_TEXTURE_MU_SIZE);
		float uMuS = GetTextureCoordFromUnitRange(max(muS + 0.2, 0.0) / 1.2, SCATTERING_TEXTURE_MU_S_SIZE);
	#endif

	float uNu = (nu + 1.0) / 2.0;

	return vec4(uNu, uMuS, uMu, uR);
}

vec4 GetScattering(float r, float mu, float muS, float nu, bool rayIntersectsGround) {
	vec4 uvwz = GetScatteringUvwzFromRMuMuSNu(r, mu, muS, nu, rayIntersectsGround);

	float tex_coord_x = uvwz.x * float(SCATTERING_TEXTURE_NU_SIZE - 1);
	float tex_x = floor(tex_coord_x);
	float lep = tex_coord_x - tex_x;

	float uMu = uvwz.z;
	float uR = uvwz.w;
	float uNu_uMuS = tex_x + uvwz.y;

	return texture(inscatteringTexture, vec3(uNu_uMuS / float(SCATTERING_TEXTURE_NU_SIZE), uMu, uR)) * (1.0 - lep) + 
			texture(inscatteringTexture, vec3((uNu_uMuS + 1.0) / float(SCATTERING_TEXTURE_NU_SIZE), uMu, uR)) * lep;
}

vec3 GetMie(vec4 rayMie) {	
	// approximated single Mie scattering (cf. approximate Cm in paragraph "Angular precision")
	// rayMie.rgb = C*, rayMie.w = Cm, r
	vec3 rayleighScattering = atmosphere.rayleigh_scattering;
	return rayMie.rgb * rayMie.w / max(rayMie.r, 1e-4) * (rayleighScattering.r / rayleighScattering.xyz);
}

float RayleighPhaseFunction(float nu) {
	float k = 3.0 / (16.0 * PI);
	return k * (1.0 + nu * nu);
}

float MiePhaseFunction(float g, float nu) {
	float k = 3.0 / (8.0 * PI) * (1.0 - g * g) / (2.0 + g * g);
	return k * (1.0 + nu * nu) / pow(1.0 + g * g - 2.0 * g * nu, 1.5);
}

vec3 GetCombinedScattering(float r, float mu, float muS, float nu, bool rayIntersectsGround, out vec3 single_mie_scattering) {
	vec4 scattering = GetScattering(r, mu, muS, nu, rayIntersectsGround);
	single_mie_scattering = GetMie(scattering);
	return scattering.rgb;
}
`;
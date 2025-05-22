export const InscatterLookup = /* glsl */`
#ifdef INSCATTER_3D
	const float RES_R = RES_R_TOTAL;
#else
	const float RES_R = float(ALTITUDE_LAYERS);
#endif

vec4 GetScatteringUvwzFromRMuMuSNu(float r, float mu, float muS, float nu, bool rayIntersectsGround) {
	float H = sqrt(Rt * Rt - Rg * Rg);
	float rho = SafeSqrt(r * r - Rg * Rg);
	float uR = GetTextureCoordFromUnitRange(rho / H, RES_R);
	#if INSCATTER_MAPPING == 1
		float rmu = r * mu;
		float discriminant = rmu * rmu - r * r + Rg * Rg;
		float uMu;
		if (rayIntersectsGround) {
			float d = -rmu - SafeSqrt(discriminant);
			float d_min = r - Rg;
			float d_max = rho;
			uMu = 0.5 - 0.5 * GetTextureCoordFromUnitRange(d_max == d_min ? 0.0 : (d - d_min) / (d_max - d_min), RES_MU / 2.);
		} else {
			float d = -rmu + SafeSqrt(discriminant + H * H);
			float d_min = Rt - r;
			float d_max = rho + H;
			uMu = 0.5 + 0.5 * GetTextureCoordFromUnitRange((d - d_min) / (d_max - d_min), RES_MU / 2.);
		}

		float d = DistanceToTopAtmosphereBoundary(Rg, muS);
		float d_min = Rt - Rg;
		float d_max = H;
		float a = (d - d_min) / (d_max - d_min);
		float D = DistanceToTopAtmosphereBoundary(Rg, -0.2);
		float A = (D - d_min) / (d_max - d_min);
		float uMuS = GetTextureCoordFromUnitRange(max(1.0 - a / A, 0.0) / (1.0 + a), RES_MU_S);
	#else
		float uMu = GetTextureCoordFromUnitRange((mu + 1.0) / 2.0, RES_MU);
		float uMuS = GetTextureCoordFromUnitRange(max(muS + 0.2, 0.0) / 1.2, RES_MU_S);
	#endif

	float uNu = (nu + 1.0) / 2.0;

	return vec4(uNu, uMuS, uMu, uR);
}

vec4 GetScattering(float r, float mu, float muS, float nu, bool rayIntersectsGround) {
	vec4 uvwz = GetScatteringUvwzFromRMuMuSNu(r, mu, muS, nu, rayIntersectsGround);

	float tex_coord_x = uvwz.x * (RES_NU - 1.0);
	float tex_x = floor(tex_coord_x);
	float lep = tex_coord_x - tex_x;

	float uMu = uvwz.z;
	float uR = uvwz.w;
	float uNu_uMuS = tex_x + uvwz.y;

	#ifdef INSCATTER_3D
		return texture(inscatteringTexture, vec3(uNu_uMuS / RES_NU, uMu, uR)) * (1.0 - lep) + 
			texture(inscatteringTexture, vec3((uNu_uMuS + 1.0) / RES_NU, uMu, uR)) * lep;
	#else
		#if ALTITUDE_LAYERS > 1
			// new 2D lookup
			float u_0 = floor(uR * RES_R) / RES_R;
			float u_1 = floor(uR * RES_R + 1.0) / RES_R;
			float u_frac = fract(uR * RES_R);

			// pre-calculate uv
			float uv_0X = uNu_uMuS / RES_NU;
			float uv_1X = (uNu_uMuS + 1.0) / RES_NU;
			float uv_0Y = uMu / RES_R + u_0;
			float uv_1Y = uMu / RES_R + u_1;
			float OneMinusLep = 1.0 - lep;

			vec4 A = texture2D(inscatteringTexture, vec2(uv_0X, uv_0Y)) * OneMinusLep + texture2D(inscatteringTexture, vec2(uv_1X, uv_0Y)) * lep;	
			vec4 B = texture2D(inscatteringTexture, vec2(uv_0X, uv_1Y)) * OneMinusLep + texture2D(inscatteringTexture, vec2(uv_1X, uv_1Y)) * lep;	

			return A * (1.0 - u_frac) + B * u_frac;
		#else	
			return texture2D(inscatteringTexture, vec2(uNu_uMuS / RES_NU, uMu)) * (1.0 - lep) + 
				texture2D(inscatteringTexture, vec2((uNu_uMuS + 1.0) / RES_NU, uMu)) * lep;	
		#endif
	#endif 
}

vec3 GetMie(vec4 rayMie) {	
	// approximated single Mie scattering (cf. approximate Cm in paragraph "Angular precision")
	// rayMie.rgb = C*, rayMie.w = Cm, r
	return rayMie.rgb * rayMie.w / max(rayMie.r, 1e-4) * (betaR.r / betaR.xyz);
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
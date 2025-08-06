export const IrradianceLookup = /* glsl */ `
vec2 GetIrradianceUvFromRMuS(float r, float mu_s) {
	float x_r = (r - atmosphere.bottom_radius) / (atmosphere.top_radius - atmosphere.bottom_radius);
	float x_mu_s = mu_s * 0.5 + 0.5;
	return vec2(
		GetTextureCoordFromUnitRange(x_mu_s, IRRADIANCE_TEXTURE_WIDTH),
		GetTextureCoordFromUnitRange(x_r, IRRADIANCE_TEXTURE_HEIGHT)
	);
}

vec3 GetIrradiance(float r, float mu_s) {
	vec2 uv = GetIrradianceUvFromRMuS(r, mu_s);
	return vec3(texture2D(irradianceTexture, uv));
}
`;
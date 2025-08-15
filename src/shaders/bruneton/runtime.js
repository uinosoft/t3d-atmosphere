// Based on: https://github.com/ebruneton/precomputed_atmospheric_scattering/blob/master/atmosphere/functions.glsl

/**
 * Copyright (c) 2017 Eric Bruneton
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holders nor the names of its
 *    contributors may be used to endorse or promote products derived from
 *    this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 *
 * Precomputed Atmospheric Scattering
 * Copyright (c) 2008 INRIA
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holders nor the names of its
 *    contributors may be used to endorse or promote products derived from
 *    this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

export const runtime = /* glsl */`
vec3 GetExtrapolatedSingleMieScattering(
	const AtmosphereParameters atmosphere, const vec4 scattering) {
	// Algebraically this can never be negative, but rounding errors can produce
	// that effect for sufficiently short view rays.
	// @shotamatsuda: Avoid division by infinitesimal values.
	// See https://github.com/takram-design-engineering/three-geospatial/issues/47
	if (scattering.r < 1e-5) {
		return vec3(0.0);
	}
	return scattering.rgb * scattering.a / scattering.r *
		(atmosphere.rayleigh_scattering.r / atmosphere.mie_scattering.r) *
		(atmosphere.mie_scattering / atmosphere.rayleigh_scattering);
}

IrradianceSpectrum GetCombinedScattering(
	const AtmosphereParameters atmosphere,
	const highp ReducedScatteringTexture scattering_texture,
	const Length r, const Number mu, const Number mu_s, const Number nu, 
	const bool ray_r_mu_intersects_ground, out IrradianceSpectrum single_mie_scattering) {
	vec4 uvwz = GetScatteringTextureUvwzFromRMuMuSNu(
		atmosphere, r, mu, mu_s, nu, ray_r_mu_intersects_ground);

	Number tex_coord_x = uvwz.x * Number(SCATTERING_TEXTURE_NU_SIZE - 1);
	Number tex_x = floor(tex_coord_x);
	Number lerp = tex_coord_x - tex_x;
	vec3 uvw0 = vec3((tex_x + uvwz.y) / Number(SCATTERING_TEXTURE_NU_SIZE),
		uvwz.z, uvwz.w);
	vec3 uvw1 = vec3((tex_x + 1.0 + uvwz.y) / Number(SCATTERING_TEXTURE_NU_SIZE),
		uvwz.z, uvwz.w);

	vec4 combined_scattering =
		texture(scattering_texture, uvw0) * (1.0 - lerp) +
		texture(scattering_texture, uvw1) * lerp;
	IrradianceSpectrum scattering = IrradianceSpectrum(combined_scattering);
	single_mie_scattering =
		GetExtrapolatedSingleMieScattering(atmosphere, combined_scattering);

	return scattering;
}

vec3 GetSkyRadiance(
	const AtmosphereParameters atmosphere,
	const TransmittanceTexture transmittance_texture,
	const highp ReducedScatteringTexture scattering_texture,
	Position camera, const Direction view_ray, 
	const Direction sun_direction, const bool clamp_mu_at_horizon, 
	out DimensionlessSpectrum transmittance) {
	// Compute the distance to the top atmosphere boundary along the view ray,
	// assuming the viewer is in space (or NaN if the view ray does not intersect
	// the atmosphere).
	Length r = length(camera);
	// @shotamatsuda: For rendering points below the bottom atmosphere.
	if (!clamp_mu_at_horizon && r < atmosphere.bottom_radius) {
		r = atmosphere.bottom_radius;
		camera = normalize(camera) * r;
	}
	Length rmu = dot(camera, view_ray);
	// @shotamatsuda: Use SafeSqrt instead.
	// See: https://github.com/takram-design-engineering/three-geospatial/pull/26
	Length distance_to_top_atmosphere_boundary = -rmu -
		SafeSqrt(rmu * rmu - r * r +
			atmosphere.top_radius * atmosphere.top_radius);
	// If the viewer is in space and the view ray intersects the atmosphere, move
	// the viewer to the top atmosphere boundary (along the view ray):
	if (distance_to_top_atmosphere_boundary > 0.0 * m) {
		camera = camera + view_ray * distance_to_top_atmosphere_boundary;
		r = atmosphere.top_radius;
		rmu += distance_to_top_atmosphere_boundary;
	} else if (r > atmosphere.top_radius) {
		// If the view ray does not intersect the atmosphere, simply return 0.
		transmittance = DimensionlessSpectrum(1.0);
		return RadianceSpectrum(0.0 * watt_per_square_meter_per_sr_per_nm);
	}
	// Compute the r, mu, mu_s and nu parameters needed for the texture lookups.
	Number mu = rmu / r;
	// @shotamatsuda: For rendering points below the bottom atmosphere.
	if (clamp_mu_at_horizon) {
		Number mu_horizon = -SafeSqrt(1.0 -
			(atmosphere.bottom_radius * atmosphere.bottom_radius) / (r * r));
		const Number eps = 0.001;
		mu = max(rmu / r, mu_horizon + eps);
	}
	Number mu_s = dot(camera, sun_direction) / r;
	Number nu = dot(view_ray, sun_direction);
	bool ray_r_mu_intersects_ground = RayIntersectsGround(atmosphere, r, mu);

	transmittance = ray_r_mu_intersects_ground ? DimensionlessSpectrum(0.0) :
		GetTransmittanceToTopAtmosphereBoundary(
			atmosphere, transmittance_texture, r, mu);

	IrradianceSpectrum single_mie_scattering;
	IrradianceSpectrum scattering;
	
	scattering = GetCombinedScattering(
		atmosphere, scattering_texture,
		r, mu, mu_s, nu, ray_r_mu_intersects_ground,
		single_mie_scattering);

	return scattering * RayleighPhaseFunction(nu) + single_mie_scattering * 
		MiePhaseFunction(atmosphere.mie_phase_function_g, nu);
}

// @shotamatsuda: Returns the point on the ray closest to the origin.
vec3 ClosestPointOnRay(const Position camera, const Position point) {
	Position ray = point - camera;
	Number t = clamp(-dot(camera, ray) / dot(ray, ray), 0.0, 1.0);
	return camera + t * ray;
}

vec2 RaySphereIntersections(
	const Position camera, const Direction direction, const Length radius) {
	float b = 2.0 * dot(direction, camera);
	float c = dot(camera, camera) - radius * radius;
	float discriminant = b * b - 4.0 * c;
	float Q = sqrt(discriminant);
	return vec2(-b - Q, -b + Q) * 0.5;
}

// @shotamatsuda: Clip the view ray at the bottom atmosphere boundary.
bool ClipAtBottomAtmosphere(
	const AtmosphereParameters atmosphere,
	const Direction view_ray, inout Position camera, inout Position point) {
	const Length eps = 0.0;
	Length bottom_radius = atmosphere.bottom_radius + eps;
	Length r_camera = length(camera);
	Length r_point = length(point);
	bool camera_below = r_camera < bottom_radius;
	bool point_below = r_point < bottom_radius;
	if (camera_below && point_below) {
		return false;
	}
	vec2 t = RaySphereIntersections(camera, view_ray, bottom_radius);
	Position intersection = camera + view_ray * (camera_below ? t.y : t.x);
	if (camera_below) {
		camera = intersection;
	} else if (point_below) {
		point = intersection;
	}
	return true;
}

RadianceSpectrum GetSkyRadianceToPoint(
	const AtmosphereParameters atmosphere,
	const TransmittanceTexture transmittance_texture,
	const highp ReducedScatteringTexture scattering_texture,
	Position camera, Position point,
	const Direction sun_direction, out DimensionlessSpectrum transmittance) {
	// @shotamatsuda: Avoid artifacts when the ray does not intersect the top
	// atmosphere boundary.
	if (length(ClosestPointOnRay(camera, point)) > atmosphere.top_radius) {
		transmittance = vec3(1.0);
		return vec3(0.0);
	}

	Direction view_ray = normalize(point - camera);
	if (!ClipAtBottomAtmosphere(atmosphere, view_ray, camera, point)) {
		transmittance = vec3(1.0);
		return vec3(0.0);
	}

	// Compute the distance to the top atmosphere boundary along the view ray,
	// assuming the viewer is in space (or NaN if the view ray does not intersect
	// the atmosphere).
	Length r = length(camera);
	Length rmu = dot(camera, view_ray);
	// @shotamatsuda: Use SafeSqrt instead.
	// See: https://github.com/takram-design-engineering/three-geospatial/pull/26
	Length distance_to_top_atmosphere_boundary = -rmu - 
		SafeSqrt(rmu * rmu - r * r + 
			atmosphere.top_radius * atmosphere.top_radius);
	// If the viewer is in space and the view ray intersects the atmosphere, move
	// the viewer to the top atmosphere boundary (along the view ray):
	if (distance_to_top_atmosphere_boundary > 0.0 * m) {
		camera = camera + view_ray * distance_to_top_atmosphere_boundary;
		r = atmosphere.top_radius;
		rmu += distance_to_top_atmosphere_boundary;
	}

	// Compute the r, mu, mu_s and nu parameters for the first texture lookup.
	Number mu = rmu / r;
	Number mu_s = dot(camera, sun_direction) / r;
	Number nu = dot(view_ray, sun_direction);
	Length d = length(point - camera);
	bool ray_r_mu_intersects_ground = RayIntersectsGround(atmosphere, r, mu);

	// @shotamatsuda: Hack to avoid rendering artifacts near the horizon, due to
	// finite atmosphere texture resolution and finite floating point precision.
	// See: https://github.com/ebruneton/precomputed_atmospheric_scattering/pull/32
	if (!ray_r_mu_intersects_ground) {
		Number mu_horizon = -SafeSqrt(1.0 - 
			(atmosphere.bottom_radius * atmosphere.bottom_radius) / (r * r));
		const Number eps = 0.004;
		mu = max(mu, mu_horizon + eps);
	}

	transmittance = GetTransmittance(atmosphere, transmittance_texture,
		r, mu, d, ray_r_mu_intersects_ground);

	IrradianceSpectrum single_mie_scattering;
	IrradianceSpectrum scattering = GetCombinedScattering(
		atmosphere, scattering_texture,
		r, mu, mu_s, nu, ray_r_mu_intersects_ground,
		single_mie_scattering);

	// Compute the r, mu, mu_s and nu parameters for the second texture lookup.
	// If shadow_length is not 0 (case of light shafts), we want to ignore the
	// scattering along the last shadow_length meters of the view ray, which we
	// do by subtracting shadow_length from d (this way scattering_p is equal to
	// the S|x_s=x_0-lv term in Eq. (17) of our paper).
	d = max(d, 0.0 * m);
	Length r_p = ClampRadius(atmosphere, sqrt(d * d + 2.0 * r * mu * d + r * r));
	Number mu_p = (r * mu + d) / r_p;
	Number mu_s_p = (r * mu_s + d * nu) / r_p;

	IrradianceSpectrum single_mie_scattering_p;
	IrradianceSpectrum scattering_p = GetCombinedScattering(
		atmosphere, scattering_texture,
		r_p, mu_p, mu_s_p, nu, ray_r_mu_intersects_ground,
		single_mie_scattering_p);

	// Combine the lookup results to get the scattering between camera and point.
	scattering = scattering - transmittance * scattering_p;
	single_mie_scattering = single_mie_scattering - transmittance * single_mie_scattering_p;

	single_mie_scattering = GetExtrapolatedSingleMieScattering(
		atmosphere, vec4(scattering, single_mie_scattering.r));

	// Hack to avoid rendering artifacts when the sun is below the horizon.
	single_mie_scattering = single_mie_scattering *
		smoothstep(Number(0.0), Number(0.01), mu_s);

	return scattering * RayleighPhaseFunction(nu) + single_mie_scattering *
		MiePhaseFunction(atmosphere.mie_phase_function_g, nu);
}

IrradianceSpectrum GetSunAndSkyIrradiance(
	const AtmosphereParameters atmosphere,
	const TransmittanceTexture transmittance_texture,
	const IrradianceTexture irradiance_texture,
	const Position point, const Direction normal, const Direction sun_direction,
	out IrradianceSpectrum sky_irradiance) {
	Length r = length(point);
	Number mu_s = dot(point, sun_direction) / r;

	// Indirect irradiance (approximated if the surface is not horizontal).
	sky_irradiance = GetIrradiance(atmosphere, irradiance_texture, r, mu_s) *
		(1.0 + dot(normal, point) / r) * 0.5;

	// Direct irradiance.
	return atmosphere.solar_irradiance *
		GetTransmittanceToSun(
			atmosphere, transmittance_texture, r, mu_s) *
		max(dot(normal, sun_direction), 0.0);
}

Luminance3 GetSkyLuminance(
	const Position camera, Direction view_ray,
	const Direction sun_direction, out DimensionlessSpectrum transmittance) {
	#ifdef GROUND
		const bool clamp_mu_at_horizon = false;
	#else
		const bool clamp_mu_at_horizon = true;
	#endif

	return GetSkyRadiance(ATMOSPHERE, transmittance_texture,
		scattering_texture,
		camera, view_ray,
		sun_direction, clamp_mu_at_horizon,
		transmittance) * SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;
}

Luminance3 GetSkyLuminanceToPoint(
	const Position camera, const Position point,
	const Direction sun_direction, out DimensionlessSpectrum transmittance) {
	return GetSkyRadianceToPoint(ATMOSPHERE, transmittance_texture,
		scattering_texture,
		camera, point, sun_direction, transmittance) *
		SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;
}

Illuminance3 GetSunAndSkyIlluminance(
	const Position p, const Direction normal, const Direction sun_direction,
	out IrradianceSpectrum sky_irradiance) {
	IrradianceSpectrum sun_irradiance = GetSunAndSkyIrradiance(
		ATMOSPHERE, transmittance_texture, irradiance_texture, p, normal,
		sun_direction, sky_irradiance);
	sky_irradiance *= SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;
	return sun_irradiance * SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
}

#define GetSkyRadiance GetSkyLuminance
#define GetSkyRadianceToPoint GetSkyLuminanceToPoint
#define GetSunAndSkyIrradiance GetSunAndSkyIlluminance
`;
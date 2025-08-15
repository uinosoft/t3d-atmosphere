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

export const precompute = /* glsl */`
Number GetLayerDensity(const DensityProfileLayer layer, const Length altitude) {
	Number density = layer.exp_term * exp(layer.exp_scale * altitude) +
	layer.linear_term * altitude + layer.constant_term;
	return clamp(density, Number(0.0), Number(1.0));
}

Number GetProfileDensity(const DensityProfile profile, const Length altitude) {
	DensityProfileLayer layers[2] = profile.layers;
	return altitude < layers[0].width
		? GetLayerDensity(layers[0], altitude)
		: GetLayerDensity(layers[1], altitude);
}

Length ComputeOpticalLengthToTopAtmosphereBoundary(
	const AtmosphereParameters atmosphere, const DensityProfile profile,
	const Length r, const Number mu) {
	assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
	assert(mu >= -1.0 && mu <= 1.0);
	// Number of intervals for the numerical integration.
	const int SAMPLE_COUNT = 500;
	// The integration step, i.e. the length of each integration interval.
	Length dx =
		DistanceToTopAtmosphereBoundary(atmosphere, r, mu) / Number(SAMPLE_COUNT);
	// Integration loop.
	Length result = 0.0 * m;
	for (int i = 0; i <= SAMPLE_COUNT; ++i) {
		Length d_i = Number(i) * dx;
		// Distance between the current sample point and the planet center.
		Length r_i = sqrt(d_i * d_i + 2.0 * r * mu * d_i + r * r);
		// Number density at the current sample point (divided by the number density
		// at the bottom of the atmosphere, yielding a dimensionless number).
		Number y_i = GetProfileDensity(profile, r_i - atmosphere.bottom_radius);
		// Sample weight (from the trapezoidal rule).
		Number weight_i = i == 0 || i == SAMPLE_COUNT ? 0.5 : 1.0;
		result += y_i * weight_i * dx;
	}
	return result;
}

DimensionlessSpectrum ComputeTransmittanceToTopAtmosphereBoundary(
	const AtmosphereParameters atmosphere, const Length r, const Number mu) {
	assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
	assert(mu >= -1.0 && mu <= 1.0);
	vec3 optical_depth = 
		atmosphere.rayleigh_scattering *
			ComputeOpticalLengthToTopAtmosphereBoundary(
				atmosphere, atmosphere.rayleigh_density, r, mu) +
		atmosphere.mie_extinction *
			ComputeOpticalLengthToTopAtmosphereBoundary(
				atmosphere, atmosphere.mie_density, r, mu);

	#if TRANSMITTANCE_MAPPING == 2
		optical_depth += atmosphere.absorption_extinction *
			ComputeOpticalLengthToTopAtmosphereBoundary(
				atmosphere, atmosphere.absorption_density, r, mu);
	#endif
	return exp(-optical_depth);
}

Number GetUnitRangeFromTextureCoord(const Number u, const int texture_size) {
	return (u - 0.5 / Number(texture_size)) / (1.0 - 1.0 / Number(texture_size));
}

#if TRANSMITTANCE_MAPPING == 0
	void GetRMuFromTransmittanceTextureUv(const AtmosphereParameters atmosphere,
		const vec2 uv, out Length r, out Number mu) {
		assert(uv.x >= 0.0 && uv.x <= 1.0);
  		assert(uv.y >= 0.0 && uv.y <= 1.0);
		mu = -0.15 + uv.x * (1.0 + 0.15);
		r = atmosphere.bottom_radius + uv.y * (atmosphere.top_radius - atmosphere.bottom_radius);
	}
#elif TRANSMITTANCE_MAPPING == 1
	void GetRMuFromTransmittanceTextureUv(const AtmosphereParameters atmosphere,
		const vec2 uv, out Length r, out Number mu) {
		assert(uv.x >= 0.0 && uv.x <= 1.0);
  		assert(uv.y >= 0.0 && uv.y <= 1.0);
		mu = -0.15 + tan(1.5 * uv.x) / tan(1.5) * (1.0 + 0.15);
		r = atmosphere.bottom_radius + (uv.y * uv.y) * (atmosphere.top_radius - atmosphere.bottom_radius);
	}
#else
	void GetRMuFromTransmittanceTextureUv(const AtmosphereParameters atmosphere,
		const vec2 uv, out Length r, out Number mu) {
		assert(uv.x >= 0.0 && uv.x <= 1.0);
  		assert(uv.y >= 0.0 && uv.y <= 1.0);
		Number x_mu = GetUnitRangeFromTextureCoord(uv.x, TRANSMITTANCE_TEXTURE_WIDTH);
		Number x_r = GetUnitRangeFromTextureCoord(uv.y, TRANSMITTANCE_TEXTURE_HEIGHT);
		// Distance to top atmosphere boundary for a horizontal ray at ground level.
		Length H = sqrt(atmosphere.top_radius * atmosphere.top_radius -
			atmosphere.bottom_radius * atmosphere.bottom_radius);
		// Distance to the horizon, from which we can compute r:
		Length rho = H * x_r;
		r = sqrt(rho * rho + atmosphere.bottom_radius * atmosphere.bottom_radius);
		// Distance to the top atmosphere boundary for the ray (r,mu), and its minimum
		// and maximum values over all mu - obtained for (r,1) and (r,mu_horizon) -
		// from which we can recover mu:
		Length d_min = atmosphere.top_radius - r;
		Length d_max = rho + H;
		Length d = d_min + x_mu * (d_max - d_min);
		mu = d <= 0.0 ? Number(1.0) : (H * H - rho * rho - d * d) / (2.0 * r * d);
		mu = ClampCosine(mu);
	}
#endif

DimensionlessSpectrum ComputeTransmittanceToTopAtmosphereBoundaryTexture(
	const AtmosphereParameters atmosphere, const vec2 frag_coord) {
	const vec2 TRANSMITTANCE_TEXTURE_SIZE =
		vec2(TRANSMITTANCE_TEXTURE_WIDTH, TRANSMITTANCE_TEXTURE_HEIGHT);
	Length r;
	Number mu;
	GetRMuFromTransmittanceTextureUv(
		atmosphere, frag_coord / TRANSMITTANCE_TEXTURE_SIZE, r, mu);
	return ComputeTransmittanceToTopAtmosphereBoundary(atmosphere, r, mu);
}

void ComputeSingleScatteringIntegrand(
	const AtmosphereParameters atmosphere,
	const TransmittanceTexture transmittance_texture,
	const Length r, const Number mu, const Number mu_s, const Number nu, 
	const Length d, const bool ray_r_mu_intersects_ground, 
	out DimensionlessSpectrum rayleigh, out DimensionlessSpectrum mie) {
	Length r_d = ClampRadius(atmosphere, sqrt(d * d + 2.0 * r * mu * d + r * r));
	Number mu_s_d = ClampCosine((r * mu_s + d * nu) / r_d);
	DimensionlessSpectrum transmittance = 
		GetTransmittance(
			atmosphere, transmittance_texture, r, mu, d, 
			ray_r_mu_intersects_ground) *
		GetTransmittanceToSun(
			atmosphere, transmittance_texture, r_d, mu_s_d);
	rayleigh = exp(-(r_d - atmosphere.bottom_radius) / HR) * transmittance;
	mie = DimensionlessSpectrum(exp(-(r_d - atmosphere.bottom_radius) / HM) * transmittance.r); // only calc the red channel
}

float DistanceToNearestAtmosphereBoundary(const AtmosphereParameters atmosphere,
	Length r, Number mu, bool ray_r_mu_intersects_ground) {
	if (ray_r_mu_intersects_ground) {
		return DistanceToBottomAtmosphereBoundary(atmosphere, r, mu);
	} else {
		return DistanceToTopAtmosphereBoundary(atmosphere, r, mu);
	}
}

void ComputeSingleScattering(
	const AtmosphereParameters atmosphere,
	const TransmittanceTexture transmittance_texture,
	const Length r, const Number mu, const Number mu_s, const Number nu, 
	const bool ray_r_mu_intersects_ground, 
	out DimensionlessSpectrum rayleigh, out DimensionlessSpectrum mie) {
	assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
	assert(mu >= -1.0 && mu <= 1.0);
	assert(mu_s >= -1.0 && mu_s <= 1.0);
	assert(nu >= -1.0 && nu <= 1.0);

	// Number of intervals for the numerical integration.
  	const int SAMPLE_COUNT = 25;
	// The integration step, i.e. the length of each integration interval.
	Length dx = DistanceToNearestAtmosphereBoundary(atmosphere, r, mu, 
		ray_r_mu_intersects_ground) / Number(SAMPLE_COUNT);
	// Integration loop.
	DimensionlessSpectrum rayleigh_sum = DimensionlessSpectrum(0.0);
	DimensionlessSpectrum mie_sum = DimensionlessSpectrum(0.0);
	for (int i = 0; i <= SAMPLE_COUNT; ++i) {
		Length d_i = Number(i) * dx;
		// The Rayleigh and Mie single scattering at the current sample point.
		DimensionlessSpectrum rayleigh_i;
		DimensionlessSpectrum mie_i;
		ComputeSingleScatteringIntegrand(atmosphere, transmittance_texture,
			r, mu, mu_s, nu, d_i, ray_r_mu_intersects_ground, rayleigh_i, mie_i);
		// Sample weight (from the trapezoidal rule).
    	Number weight_i = (i == 0 || i == SAMPLE_COUNT) ? 0.5 : 1.0;
		rayleigh_sum += rayleigh_i * weight_i;
    	mie_sum += mie_i * weight_i;
	}
	rayleigh = rayleigh_sum * dx * atmosphere.solar_irradiance * 
		atmosphere.rayleigh_scattering;
	mie = mie_sum * dx * atmosphere.solar_irradiance * atmosphere.mie_scattering;
}

void GetRMuMuSNuFromScatteringTextureUvwz(const AtmosphereParameters atmosphere,
	vec4 uvwz, out Length r, out Number mu, out Number mu_s,
	out Number nu, out bool ray_r_mu_intersects_ground) {
	assert(uvwz.x >= 0.0 && uvwz.x <= 1.0);
	assert(uvwz.y >= 0.0 && uvwz.y <= 1.0);
	assert(uvwz.z >= 0.0 && uvwz.z <= 1.0);
	assert(uvwz.w >= 0.0 && uvwz.w <= 1.0);

	// Distance to top atmosphere boundary for a horizontal ray at ground level.
	Length H = sqrt(atmosphere.top_radius * atmosphere.top_radius -
		atmosphere.bottom_radius * atmosphere.bottom_radius);
	// Distance to the horizon.
	Length rho =
		H * GetUnitRangeFromTextureCoord(uvwz.w, SCATTERING_TEXTURE_R_SIZE);
	r = sqrt(rho * rho + atmosphere.bottom_radius * atmosphere.bottom_radius);

	#if INSCATTER_MAPPING == 1
		if (uvwz.z < 0.5) {
			// Distance to the ground for the ray (r,mu), and its minimum and maximum
			// values over all mu - obtained for (r,-1) and (r,mu_horizon) - from which
			// we can recover mu:
			Length d_min = r - atmosphere.bottom_radius;
			Length d_max = rho;
			Length d = d_min + (d_max - d_min) * GetUnitRangeFromTextureCoord(
				1.0 - 2.0 * uvwz.z, SCATTERING_TEXTURE_MU_SIZE / 2);
			mu = d == 0.0 * m ? Number(-1.0) : 
				ClampCosine(-(rho * rho + d * d) / (2.0 * r * d));
			ray_r_mu_intersects_ground = true;
		} else {
			// Distance to the top atmosphere boundary for the ray (r,mu), and its
			// minimum and maximum values over all mu - obtained for (r,1) and
			// (r,mu_horizon) - from which we can recover mu:
			Length d_min = atmosphere.top_radius - r;
			Length d_max = rho + H;
			Length d = d_min + (d_max - d_min) * GetUnitRangeFromTextureCoord(
				2.0 * uvwz.z - 1.0, SCATTERING_TEXTURE_MU_SIZE / 2);
			mu = d == 0.0 * m ? Number(1.0) :
				ClampCosine((H * H - rho * rho - d * d) / (2.0 * r * d));
			ray_r_mu_intersects_ground = false;
		}

		Number x_mu_s =
			GetUnitRangeFromTextureCoord(uvwz.y, SCATTERING_TEXTURE_MU_S_SIZE);
		Length d_min = atmosphere.top_radius - atmosphere.bottom_radius;
		Length d_max = H;
		Length D = DistanceToTopAtmosphereBoundary(
			atmosphere, atmosphere.bottom_radius, atmosphere.mu_s_min);
		Number A = (D - d_min) / (d_max - d_min);
		Number a = (A - x_mu_s * A) / (1.0 + x_mu_s * A);
		Length d = d_min + min(a, A) * (d_max - d_min);
		mu_s = d == 0.0 * m ? Number(1.0) :
			ClampCosine((H * H - d * d) / (2.0 * atmosphere.bottom_radius * d));
	#else 
		Number x_mu_s = GetUnitRangeFromTextureCoord(uvwz.y, SCATTERING_TEXTURE_MU_S_SIZE);
		mu = -1.0 + 2.0 * GetUnitRangeFromTextureCoord(uvwz.z, SCATTERING_TEXTURE_MU_SIZE);
		mu_s = -0.2 + x_mu_s * 1.2;
	#endif

	nu = ClampCosine(uvwz.x * 2.0 - 1.0);
}

void GetRMuMuSNuFromScatteringTextureFragCoord(
	const AtmosphereParameters atmosphere, const vec3 frag_coord,
	out Length r, out Number mu, out Number mu_s, out Number nu,
	out bool ray_r_mu_intersects_ground) {
	const vec4 SCATTERING_TEXTURE_SIZE = vec4(
		SCATTERING_TEXTURE_NU_SIZE - 1,
		SCATTERING_TEXTURE_MU_S_SIZE,
		SCATTERING_TEXTURE_MU_SIZE,
		SCATTERING_TEXTURE_R_SIZE);
	Number frag_coord_nu =
		floor(frag_coord.x / Number(SCATTERING_TEXTURE_MU_S_SIZE));
	Number frag_coord_mu_s =
		mod(frag_coord.x, Number(SCATTERING_TEXTURE_MU_S_SIZE));
	vec4 uvwz =
		vec4(frag_coord_nu, frag_coord_mu_s, frag_coord.y, frag_coord.z) /
			SCATTERING_TEXTURE_SIZE;
	GetRMuMuSNuFromScatteringTextureUvwz(
		atmosphere, uvwz, r, mu, mu_s, nu, ray_r_mu_intersects_ground);
	// Clamp nu to its valid range of values, given mu and mu_s.
	nu = clamp(nu, mu * mu_s - sqrt((1.0 - mu * mu) * (1.0 - mu_s * mu_s)),
		mu * mu_s + sqrt((1.0 - mu * mu) * (1.0 - mu_s * mu_s)));
}

void ComputeSingleScatteringTexture(const AtmosphereParameters atmosphere,
	const TransmittanceTexture transmittance_texture, const vec3 frag_coord,
	out IrradianceSpectrum rayleigh, out IrradianceSpectrum mie) {
	Length r;
	Number mu;
	Number mu_s;
	Number nu;
	bool ray_r_mu_intersects_ground;
	GetRMuMuSNuFromScatteringTextureFragCoord(atmosphere, frag_coord,
		r, mu, mu_s, nu, ray_r_mu_intersects_ground);
	ComputeSingleScattering(atmosphere, transmittance_texture,
		r, mu, mu_s, nu, ray_r_mu_intersects_ground, rayleigh, mie);
}

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

RadianceSpectrum GetScattering(
	const AtmosphereParameters atmosphere,
	const highp ReducedScatteringTexture scattering_texture,
	const Length r, const Number mu, const Number mu_s, const Number nu,
	const bool ray_r_mu_intersects_ground) {
	IrradianceSpectrum mie;
	IrradianceSpectrum rayleigh = GetCombinedScattering(
		atmosphere, scattering_texture, r, mu, mu_s, nu,
		ray_r_mu_intersects_ground, mie);
	return rayleigh * RayleighPhaseFunction(nu) +
		mie * MiePhaseFunction(atmosphere.mie_phase_function_g, nu);
}

IrradianceSpectrum ComputeDirectIrradiance(
	const AtmosphereParameters atmosphere,
	const TransmittanceTexture transmittance_texture,
	const Length r, const Number mu_s) {
	assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
	assert(mu_s >= -1.0 && mu_s <= 1.0);

	Number alpha_s = atmosphere.sun_angular_radius / rad;
	// Approximate average of the cosine factor mu_s over the visible fraction of
	// the Sun disc.
	Number average_cosine_factor =
		mu_s < -alpha_s ? 0.0 : (mu_s > alpha_s ? mu_s :
		(mu_s + alpha_s) * (mu_s + alpha_s) / (4.0 * alpha_s));

	return atmosphere.solar_irradiance *
		GetTransmittanceToTopAtmosphereBoundary(
			atmosphere, transmittance_texture, r, mu_s) * average_cosine_factor;
}

IrradianceSpectrum ComputeIndirectIrradiance(
	const AtmosphereParameters atmosphere,
	const highp ReducedScatteringTexture scattering_texture,
	const Length r, const Number mu_s) {
	assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
	assert(mu_s >= -1.0 && mu_s <= 1.0);
	assert(scattering_order >= 1);

	const int SAMPLE_COUNT = 32;
	const Angle dphi = pi / Number(SAMPLE_COUNT);
	const Angle dtheta = pi / Number(SAMPLE_COUNT);

	IrradianceSpectrum result =
		IrradianceSpectrum(0.0 * watt_per_square_meter_per_nm);
	vec3 omega_s = vec3(sqrt(1.0 - mu_s * mu_s), 0.0, mu_s);
	for (int j = 0; j < SAMPLE_COUNT / 2; ++j) {
		Angle theta = (Number(j) + 0.5) * dtheta;
		for (int i = 0; i < 2 * SAMPLE_COUNT; ++i) {
			Angle phi = (Number(i) + 0.5) * dphi;
			vec3 omega =
				vec3(cos(phi) * sin(theta), sin(phi) * sin(theta), cos(theta));
			SolidAngle domega = (dtheta / rad) * (dphi / rad) * sin(theta) * sr;

			Number nu = dot(omega, omega_s);
			result += GetScattering(atmosphere, scattering_texture,
				r, omega.z, mu_s, nu, false /* ray_r_theta_intersects_ground */) *
					omega.z * domega;
		}
	}
	return result;
}

void GetRMuSFromIrradianceTextureUv(const AtmosphereParameters atmosphere,
	const vec2 uv, out Length r, out Number mu_s) {
	assert(uv.x >= 0.0 && uv.x <= 1.0);
	assert(uv.y >= 0.0 && uv.y <= 1.0);
	Number x_mu_s = GetUnitRangeFromTextureCoord(uv.x, IRRADIANCE_TEXTURE_WIDTH);
	Number x_r = GetUnitRangeFromTextureCoord(uv.y, IRRADIANCE_TEXTURE_HEIGHT);
	r = atmosphere.bottom_radius +
		x_r * (atmosphere.top_radius - atmosphere.bottom_radius);
	mu_s = ClampCosine(2.0 * x_mu_s - 1.0);
}

const vec2 IRRADIANCE_TEXTURE_SIZE =
	vec2(IRRADIANCE_TEXTURE_WIDTH, IRRADIANCE_TEXTURE_HEIGHT);

IrradianceSpectrum ComputeDirectIrradianceTexture(
	const AtmosphereParameters atmosphere,
	const TransmittanceTexture transmittance_texture,
	const vec2 frag_coord) {
	Length r;
	Number mu_s;
	GetRMuSFromIrradianceTextureUv(
		atmosphere, frag_coord / IRRADIANCE_TEXTURE_SIZE, r, mu_s);
	return ComputeDirectIrradiance(atmosphere, transmittance_texture, r, mu_s);
}

IrradianceSpectrum ComputeIndirectIrradianceTexture(
	const AtmosphereParameters atmosphere,
	const highp ReducedScatteringTexture scattering_texture,
	const vec2 frag_coord) {
	Length r;
	Number mu_s;
	GetRMuSFromIrradianceTextureUv(
		atmosphere, frag_coord / IRRADIANCE_TEXTURE_SIZE, r, mu_s);
	return ComputeIndirectIrradiance(atmosphere,
		scattering_texture,
		r, mu_s);
}
`;
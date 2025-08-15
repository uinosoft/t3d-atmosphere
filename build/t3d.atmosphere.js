// t3d-atmosphere
(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('t3d'), require('t3d-effect-composer')) :
	typeof define === 'function' && define.amd ? define(['exports', 't3d', 't3d-effect-composer'], factory) :
	(global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.t3d = global.t3d || {}, global.t3d, global.t3d));
})(this, (function (exports, t3d, t3dEffectComposer) { 'use strict';

	// Based on: https://github.com/ebruneton/precomputed_atmospheric_scattering/blob/master/atmosphere/definitions.glsl

	/**
	 * Copyright (c) 2017 Eric Bruneton
	 * All rights reserved.
	 *
	 * Redistribution and use in source and binary forms, with or without
	 * modification, are permitted provided that the following conditions
	 * are met:
	 * 1. Redistributions of source code must retain the above copyright
	 *		notice, this list of conditions and the following disclaimer.
	 * 2. Redistributions in binary form must reproduce the above copyright
	 *		notice, this list of conditions and the following disclaimer in the
	 *		documentation and/or other materials provided with the distribution.
	 * 3. Neither the name of the copyright holders nor the names of its
	 *		contributors may be used to endorse or promote products derived from
	 *		this software without specific prior written permission.
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

	const definitions = /* glsl */`
#define assert(x)

#define Length float
#define Wavelength float
#define Angle float
#define SolidAngle float
#define Power float
#define LuminousPower float

#define Number float
#define InverseLength float
#define Area float
#define Volume float
#define NumberDensity float
#define Irradiance float
#define Radiance float
#define SpectralPower float
#define SpectralIrradiance float
#define SpectralRadiance float
#define SpectralRadianceDensity float
#define ScatteringCoefficient float
#define InverseSolidAngle float
#define LuminousIntensity float
#define Luminance float
#define Illuminance float

// A generic function from Wavelength to some other type.
#define AbstractSpectrum vec3
// A function from Wavelength to Number.
#define DimensionlessSpectrum vec3
// A function from Wavelength to SpectralPower.
#define PowerSpectrum vec3
// A function from Wavelength to SpectralIrradiance.
#define IrradianceSpectrum vec3
// A function from Wavelength to SpectralRadiance.
#define RadianceSpectrum vec3
// A function from Wavelength to SpectralRadianceDensity.
#define RadianceDensitySpectrum vec3
// A function from Wavelength to ScatteringCoefficient.
#define ScatteringSpectrum vec3

// A position in 3D (3 length values).
#define Position vec3
// A unit direction vector in 3D (3 unit-less values).
#define Direction vec3
// A vector of 3 luminance values.
#define Luminance3 vec3
// A vector of 3 illuminance values.
#define Illuminance3 vec3

#define TransmittanceTexture sampler2D
#define AbstractScatteringTexture sampler3D
#define ReducedScatteringTexture sampler3D
#define ScatteringTexture sampler3D
#define ScatteringDensityTexture sampler3D
#define IrradianceTexture sampler2D

const Length m = 1.0;
const Wavelength nm = 1.0;
const Angle rad = 1.0;
const SolidAngle sr = 1.0;
const Power watt = 1.0;
const LuminousPower lm = 1.0;

#if !defined(PI)
const float PI = 3.14159265358979323846;
#endif // !defined(PI)

const Length km = 1000.0 * m;
const Area m2 = m * m;
const Volume m3 = m * m * m;
const Angle pi = PI * rad;
const Angle deg = pi / 180.0;
const Irradiance watt_per_square_meter = watt / m2;
const Radiance watt_per_square_meter_per_sr = watt / (m2 * sr);
const SpectralIrradiance watt_per_square_meter_per_nm = watt / (m2 * nm);
const SpectralRadiance watt_per_square_meter_per_sr_per_nm = watt / (m2 * sr * nm);
const SpectralRadianceDensity watt_per_cubic_meter_per_sr_per_nm = watt / (m3 * sr * nm);
const LuminousIntensity cd = lm / sr;
const LuminousIntensity kcd = 1000.0 * cd;
const Luminance cd_per_square_meter = cd / m2;
const Luminance kcd_per_square_meter = kcd / m2;

struct DensityProfileLayer {
	Length width;
	Number exp_term;
	InverseLength exp_scale;
	InverseLength linear_term;
	Number constant_term;
};

struct DensityProfile {
	DensityProfileLayer layers[2];
};

struct AtmosphereParameters {
	IrradianceSpectrum solar_irradiance;
	Angle sun_angular_radius;
	Length bottom_radius;
	Length top_radius;
	DensityProfile rayleigh_density;
	ScatteringSpectrum rayleigh_scattering;
	DensityProfile mie_density;
	ScatteringSpectrum mie_scattering;
	ScatteringSpectrum mie_extinction;
	Number mie_phase_function_g;
	DensityProfile absorption_density;
	ScatteringSpectrum absorption_extinction;
	DimensionlessSpectrum ground_albedo;
	Number mu_s_min;
};
`;

	// Based on: https://github.com/ebruneton/precomputed_atmospheric_scattering/blob/master/atmosphere/functions.glsl

	/**
	 * Copyright (c) 2017 Eric Bruneton
	 * All rights reserved.
	 *
	 * Redistribution and use in source and binary forms, with or without
	 * modification, are permitted provided that the following conditions
	 * are met:
	 * 1. Redistributions of source code must retain the above copyright
	 *		notice, this list of conditions and the following disclaimer.
	 * 2. Redistributions in binary form must reproduce the above copyright
	 *		notice, this list of conditions and the following disclaimer in the
	 *		documentation and/or other materials provided with the distribution.
	 * 3. Neither the name of the copyright holders nor the names of its
	 *		contributors may be used to endorse or promote products derived from
	 *		this software without specific prior written permission.
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
	 *		notice, this list of conditions and the following disclaimer.
	 * 2. Redistributions in binary form must reproduce the above copyright
	 *		notice, this list of conditions and the following disclaimer in the
	 *		documentation and/or other materials provided with the distribution.
	 * 3. Neither the name of the copyright holders nor the names of its
	 *		contributors may be used to endorse or promote products derived from
	 *		this software without specific prior written permission.
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

	const common = /* glsl */`
Number ClampCosine(const Number mu) {
	return clamp(mu, Number(-1.0), Number(1.0));
}

Length ClampDistance(const Length d) {
	return max(d, 0.0 * m);
}

Length ClampRadius(const AtmosphereParameters atmosphere, const Length r) {
	return clamp(r, atmosphere.bottom_radius, atmosphere.top_radius);
}

Length SafeSqrt(const Area a) {
	return sqrt(max(a, 0.0 * m2));
}

Length DistanceToTopAtmosphereBoundary(const AtmosphereParameters atmosphere,
	const Length r, const Number mu) {
	assert(r <= atmosphere.top_radius);
	assert(mu >= -1.0 && mu <= 1.0);
	Area discriminant = r * r * (mu * mu - 1.0) +
		atmosphere.top_radius * atmosphere.top_radius;
	return ClampDistance(-r * mu + SafeSqrt(discriminant));
}

Length DistanceToBottomAtmosphereBoundary(const AtmosphereParameters atmosphere,
	const Length r, const Number mu) {
	assert(r >= atmosphere.bottom_radius);
	assert(mu >= -1.0 && mu <= 1.0);
	Area discriminant = r * r * (mu * mu - 1.0) +
		atmosphere.bottom_radius * atmosphere.bottom_radius;
	return ClampDistance(-r * mu - SafeSqrt(discriminant));
}

bool RayIntersectsGround(const AtmosphereParameters atmosphere,
	const Length r, const Number mu) {
	return mu < 0.0 && r * r * (mu * mu - 1.0) +
		atmosphere.bottom_radius * atmosphere.bottom_radius >= 0.0 * m2;
}

Number GetTextureCoordFromUnitRange(const Number x, const int texture_size) {
	return 0.5 / Number(texture_size) + x * (1.0 - 1.0 / Number(texture_size));
}

#if TRANSMITTANCE_MAPPING == 0
	vec2 GetTransmittanceTextureUvFromRMu(const AtmosphereParameters atmosphere,
		const Length r, const Number mu) {
		assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
			assert(mu >= -1.0 && mu <= 1.0);
		float u = (mu + 0.15) / (1.0 + 0.15);
		float v = (r - atmosphere.bottom_radius) / (atmosphere.top_radius - atmosphere.bottom_radius);
		return vec2(u, v);
	}
#elif TRANSMITTANCE_MAPPING == 1
	vec2 GetTransmittanceTextureUvFromRMu(const AtmosphereParameters atmosphere,
		const Length r, const Number mu) {
		assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
			assert(mu >= -1.0 && mu <= 1.0);
		float u = atan((mu + 0.15) / (1.0 + 0.15) * tan(1.5)) / 1.5;
		float v = sqrt((r - atmosphere.bottom_radius) / (atmosphere.top_radius - atmosphere.bottom_radius));
		return vec2(u, v);
	}
#else
	vec2 GetTransmittanceTextureUvFromRMu(const AtmosphereParameters atmosphere,
		const Length r, const Number mu) {
		assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
			assert(mu >= -1.0 && mu <= 1.0);
		// Distance to top atmosphere boundary for a horizontal ray at ground level.
		Length H = sqrt(atmosphere.top_radius * atmosphere.top_radius - 
			atmosphere.bottom_radius * atmosphere.bottom_radius);
		// Distance to the horizon.
		Length rho =
			SafeSqrt(r * r - atmosphere.bottom_radius * atmosphere.bottom_radius);
		// Distance to the top atmosphere boundary for the ray (r,mu), and its minimum
			// and maximum values over all mu - obtained for (r,1) and (r,mu_horizon).
		Length d = DistanceToTopAtmosphereBoundary(atmosphere, r, mu);
		Length d_min = atmosphere.top_radius - r;
		Length d_max = rho + H;
		Number x_mu = (d - d_min) / (d_max - d_min);
		Number x_r = rho / H;
		return vec2(GetTextureCoordFromUnitRange(x_mu, TRANSMITTANCE_TEXTURE_WIDTH),
					GetTextureCoordFromUnitRange(x_r, TRANSMITTANCE_TEXTURE_HEIGHT));
	}
#endif

DimensionlessSpectrum GetTransmittanceToTopAtmosphereBoundary(
	const AtmosphereParameters atmosphere,
	const TransmittanceTexture transmittance_texture,
	const Length r, const Number mu) {
	assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
	vec2 uv = GetTransmittanceTextureUvFromRMu(atmosphere, r, mu);
	return DimensionlessSpectrum(texture(transmittance_texture, uv).rgb);
}

vec3 GetTransmittance(
	const AtmosphereParameters atmosphere,
	const TransmittanceTexture transmittance_texture,
	const Length r, const Number mu, const Length d, 
	const bool ray_r_mu_intersects_ground) {
	assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
	assert(mu >= -1.0 && mu <= 1.0);
	assert(d >= 0.0 * m);

	Length r_d = ClampRadius(atmosphere, sqrt(d * d + 2.0 * r * mu * d + r * r));
	Number mu_d = ClampCosine((r * mu + d) / r_d);

	if (ray_r_mu_intersects_ground) {
		return min(
			GetTransmittanceToTopAtmosphereBoundary(
				atmosphere, transmittance_texture, r_d, -mu_d) /
			GetTransmittanceToTopAtmosphereBoundary(
				atmosphere, transmittance_texture, r, -mu),
			DimensionlessSpectrum(1.0));
	} else {
		return min(
			GetTransmittanceToTopAtmosphereBoundary(
				atmosphere, transmittance_texture, r, mu) /
			GetTransmittanceToTopAtmosphereBoundary(
				atmosphere, transmittance_texture, r_d, mu_d),
			DimensionlessSpectrum(1.0));
	}
}

DimensionlessSpectrum GetTransmittanceToSun(
	const AtmosphereParameters atmosphere,
	const TransmittanceTexture transmittance_texture,
	const Length r, const Number mu_s) {
	Number sin_theta_h = atmosphere.bottom_radius / r;
	Number cos_theta_h = -sqrt(max(1.0 - sin_theta_h * sin_theta_h, 0.0));
	return GetTransmittanceToTopAtmosphereBoundary(
		atmosphere, transmittance_texture, r, mu_s) *
		smoothstep(-sin_theta_h * atmosphere.sun_angular_radius / rad, 
					sin_theta_h * atmosphere.sun_angular_radius / rad,
					mu_s - cos_theta_h);
}

InverseSolidAngle RayleighPhaseFunction(const Number nu) {
	InverseSolidAngle k = 3.0 / (16.0 * PI * sr);
	return k * (1.0 + nu * nu);
}

InverseSolidAngle MiePhaseFunction(const Number g, const Number nu) {
	InverseSolidAngle k = 3.0 / (8.0 * PI * sr) * (1.0 - g * g) / (2.0 + g * g);
	return k * (1.0 + nu * nu) / pow(1.0 + g * g - 2.0 * g * nu, 1.5);
}

vec4 GetScatteringTextureUvwzFromRMuMuSNu(const AtmosphereParameters atmosphere,
	const Length r, const Number mu, const Number mu_s, const Number nu, 
	const bool ray_r_mu_intersects_ground) {
	assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
	assert(mu >= -1.0 && mu <= 1.0);
	assert(mu_s >= -1.0 && mu_s <= 1.0);
	assert(nu >= -1.0 && nu <= 1.0);

	// Distance to top atmosphere boundary for a horizontal ray at ground level.
	Length H = sqrt(atmosphere.top_radius * atmosphere.top_radius - 
		atmosphere.bottom_radius * atmosphere.bottom_radius);
	// Distance to the horizon.
	Length rho = 
		SafeSqrt(r * r - atmosphere.bottom_radius * atmosphere.bottom_radius);
	Number u_r = GetTextureCoordFromUnitRange(rho / H, SCATTERING_TEXTURE_R_SIZE);

	#if INSCATTER_MAPPING == 1
		// Discriminant of the quadratic equation for the intersections of the ray
			// (r,mu) with the ground (see RayIntersectsGround).
		Length r_mu = r * mu;
		Area discriminant = 
			r_mu * r_mu - r * r + atmosphere.bottom_radius * atmosphere.bottom_radius;
		Number u_mu;
		if (ray_r_mu_intersects_ground) {
			// Distance to the ground for the ray (r,mu), and its minimum and maximum
				// values over all mu - obtained for (r,-1) and (r,mu_horizon).
			Length d = -r_mu - SafeSqrt(discriminant);
			Length d_min = r - atmosphere.bottom_radius;
			Length d_max = rho;
			u_mu = 0.5 - 0.5 * GetTextureCoordFromUnitRange(d_max == d_min ? 0.0 : 
				(d - d_min) / (d_max - d_min), SCATTERING_TEXTURE_MU_SIZE / 2);
		} else {
			// Distance to the top atmosphere boundary for the ray (r,mu), and its
			// minimum and maximum values over all mu - obtained for (r,1) and
			// (r,mu_horizon).
			Length d = -r_mu + SafeSqrt(discriminant + H * H);
			Length d_min = atmosphere.top_radius - r;
			Length d_max = rho + H;
			u_mu = 0.5 + 0.5 * GetTextureCoordFromUnitRange(
				(d - d_min) / (d_max - d_min), SCATTERING_TEXTURE_MU_SIZE / 2);
		}

		Length d = DistanceToTopAtmosphereBoundary(
			atmosphere, atmosphere.bottom_radius, mu_s);
		Length d_min = atmosphere.top_radius - atmosphere.bottom_radius;
		Length d_max = H;
		Number a = (d - d_min) / (d_max - d_min);
		Length D = DistanceToTopAtmosphereBoundary(
			atmosphere, atmosphere.bottom_radius, atmosphere.mu_s_min);
		Number A = (D - d_min) / (d_max - d_min);
		// An ad-hoc function equal to 0 for mu_s = mu_s_min (because then d = D and
		// thus a = A), equal to 1 for mu_s = 1 (because then d = d_min and thus
		// a = 0), and with a large slope around mu_s = 0, to get more texture
		// samples near the horizon.
		Number u_mu_s = GetTextureCoordFromUnitRange(
			max(1.0 - a / A, 0.0) / (1.0 + a), SCATTERING_TEXTURE_MU_S_SIZE);
	#else
		Number u_mu = GetTextureCoordFromUnitRange(
			(mu + 1.0) / 2.0, SCATTERING_TEXTURE_MU_SIZE);
		Number u_mu_s = GetTextureCoordFromUnitRange(
			max(mu_s + 0.2, 0.0) / 1.2, SCATTERING_TEXTURE_MU_S_SIZE);
	#endif

	Number u_nu = (nu + 1.0) / 2.0;
	return vec4(u_nu, u_mu_s, u_mu, u_r);
}

vec2 GetIrradianceTextureUvFromRMuS(const AtmosphereParameters atmosphere,
	const Length r, const Number mu_s) {
	assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
	assert(mu_s >= -1.0 && mu_s <= 1.0);
	Number x_r = (r - atmosphere.bottom_radius) /
		(atmosphere.top_radius - atmosphere.bottom_radius);
	Number x_mu_s = mu_s * 0.5 + 0.5;
	return vec2(GetTextureCoordFromUnitRange(x_mu_s, IRRADIANCE_TEXTURE_WIDTH),
				GetTextureCoordFromUnitRange(x_r, IRRADIANCE_TEXTURE_HEIGHT));
}

IrradianceSpectrum GetIrradiance(
	const AtmosphereParameters atmosphere,
	const IrradianceTexture irradiance_texture,
	const Length r, const Number mu_s) {
	vec2 uv = GetIrradianceTextureUvFromRMuS(atmosphere, r, mu_s);
	return IrradianceSpectrum(texture2D(irradiance_texture, uv));
}
`;

	// Based on: https://github.com/ebruneton/precomputed_atmospheric_scattering/blob/master/atmosphere/functions.glsl

	/**
	 * Copyright (c) 2017 Eric Bruneton
	 * All rights reserved.
	 *
	 * Redistribution and use in source and binary forms, with or without
	 * modification, are permitted provided that the following conditions
	 * are met:
	 * 1. Redistributions of source code must retain the above copyright
	 *		notice, this list of conditions and the following disclaimer.
	 * 2. Redistributions in binary form must reproduce the above copyright
	 *		notice, this list of conditions and the following disclaimer in the
	 *		documentation and/or other materials provided with the distribution.
	 * 3. Neither the name of the copyright holders nor the names of its
	 *		contributors may be used to endorse or promote products derived from
	 *		this software without specific prior written permission.
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
	 *		notice, this list of conditions and the following disclaimer.
	 * 2. Redistributions in binary form must reproduce the above copyright
	 *		notice, this list of conditions and the following disclaimer in the
	 *		documentation and/or other materials provided with the distribution.
	 * 3. Neither the name of the copyright holders nor the names of its
	 *		contributors may be used to endorse or promote products derived from
	 *		this software without specific prior written permission.
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

	const runtime = /* glsl */`
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

	const IRRADIANCE_TEXTURE_WIDTH = 64;
	const IRRADIANCE_TEXTURE_HEIGHT = 16;
	const SCATTERING_TEXTURE_R_SIZE = 32;
	const SCATTERING_TEXTURE_MU_SIZE = 128;
	const SCATTERING_TEXTURE_MU_S_SIZE = 32;
	const SCATTERING_TEXTURE_NU_SIZE = 8;
	const SCATTERING_TEXTURE_WIDTH = SCATTERING_TEXTURE_NU_SIZE * SCATTERING_TEXTURE_MU_S_SIZE;
	const SCATTERING_TEXTURE_HEIGHT = SCATTERING_TEXTURE_MU_SIZE;
	const SCATTERING_TEXTURE_DEPTH = SCATTERING_TEXTURE_R_SIZE;
	const TRANSMITTANCE_TEXTURE_WIDTH = 256;
	const TRANSMITTANCE_TEXTURE_HEIGHT = 64;
	const METER_TO_LENGTH_UNIT = 1 / 1000;

	const defines = /* glsl */`
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
`;

	const raySphereIntersection = /* glsl */`
float RaySphereFirstIntersection(vec3 origin, vec3 direction, vec3 center, float radius) {
	vec3 a = origin - center;
	float b = 2.0 * dot(direction, a);
	float c = dot(a, a) - radius * radius;
	float discriminant = b * b - 4.0 * c;
	return discriminant < 0.0
		? -1.0
		: (-b - sqrt(discriminant)) * 0.5;
}

float RaySphereFirstIntersection(vec3 origin, vec3 direction, float radius) {
	return RaySphereFirstIntersection(origin, direction, vec3(0.0), radius);
}
`;

	// 0 - Linear
	// 1 - Reinhard
	// 2 - Optimized Cineon
	// 3 - ACES Filmic
	// 4 - Neutral
	// 5 - AgX
	// 6 - Unity (Legacy)
	const tonemapping = /* glsl */`
#if TONE_MAPPING == 0
	// exposure only
	vec3 ToneMapping(vec3 color) {
		return saturate(toneMappingExposure * color);
	}
#elif TONE_MAPPING == 1
	// source: https://www.cs.utah.edu/docs/techreports/2002/pdf/UUCS-02-001.pdf
	vec3 ToneMapping(vec3 color) {
		color *= toneMappingExposure;
		return saturate(color / (vec3(1.0) + color));
	}
#elif TONE_MAPPING == 2
	// source: http://filmicworlds.com/blog/filmic-tonemapping-operators/
	vec3 ToneMapping(vec3 color) {
		// optimized filmic operator by Jim Hejl and Richard Burgess-Dawson
		color *= toneMappingExposure;
		color = max(vec3(0.0), color - 0.004);
		return pow((color * (6.2 * color + 0.5)) / (color * (6.2 * color + 1.7) + 0.06), vec3(2.2));
	}
#elif TONE_MAPPING == 3
	// source: https://github.com/selfshadow/ltc_code/blob/master/webgl/shaders/ltc/ltc_blit.fs
	vec3 RRTAndODTFit(vec3 v) {
		vec3 a = v * (v + 0.0245786) - 0.000090537;
		vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
		return a / b;
	}

	// this implementation of ACES is modified to accommodate a brighter viewing environment.
	// the scale factor of 1/0.6 is subjective. see discussion in https://github.com/mrdoob/three.js/pull/19621.
	vec3 ToneMapping(vec3 color) {
		// sRGB => XYZ => D65_2_D60 => AP1 => RRT_SAT
		const mat3 ACESInputMat = mat3(
			vec3(0.59719, 0.07600, 0.02840), // transposed from source
			vec3(0.35458, 0.90834, 0.13383),
			vec3(0.04823, 0.01566, 0.83777)
		);
		// ODT_SAT => XYZ => D60_2_D65 => sRGB
		const mat3 ACESOutputMat = mat3(
			vec3( 1.60475, -0.10208, -0.00327), // transposed from source
			vec3(-0.53108,	1.10813, -0.07276),
			vec3(-0.07367, -0.00605,	1.07602)
		);
		color *= toneMappingExposure / 0.6;
		color = ACESInputMat * color;
		// Apply RRT and ODT
		color = RRTAndODTFit(color);
		color = ACESOutputMat * color;
		// Clamp to [0, 1]
		return saturate(color);
	}
#elif TONE_MAPPING == 4
	vec3 ToneMapping(vec3 color) {
		const float StartCompression = 0.8 - 0.04;
		const float Desaturation = 0.15;
		color *= toneMappingExposure;
		float x = min(color.r, min(color.g, color.b));
		float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
		color -= offset;
		float peak = max(color.r, max(color.g, color.b));
		if (peak < StartCompression) return color;
		float d = 1. - StartCompression;
		float newPeak = 1. - d * d / (peak + d - StartCompression);
		color *= newPeak / peak;
		float g = 1. - 1. / (Desaturation * (peak - newPeak) + 1.);
		return mix(color, vec3(newPeak), g);
	}
#elif TONE_MAPPING == 5
	// Matrices for rec 2020 <> rec 709 color space conversion
	// matrix provided in row-major order so it has been transposed
	// https://www.itu.int/pub/R-REP-BT.2407-2017
	const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
		vec3(1.6605, -0.1246, -0.0182),
		vec3(-0.5876, 1.1329, -0.1006),
		vec3(-0.0728, -0.0083, 1.1187)
	);

	const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
		vec3(0.6274, 0.0691, 0.0164),
		vec3(0.3293, 0.9195, 0.0880),
		vec3(0.0433, 0.0113, 0.8956)
	);

	// https://iolite-engine.com/blog_posts/minimal_agx_implementation
	// Mean error^2: 3.6705141e-06
	vec3 agxDefaultContrastApprox(vec3 x) {
		vec3 x2 = x * x;
		vec3 x4 = x2 * x2;

		return + 15.5 * x4 * x2
			- 40.14 * x4 * x
			+ 31.96 * x4
			- 6.868 * x2 * x
			+ 0.4298 * x2
			+ 0.1191 * x
			- 0.00232;
	}

	// AgX Tone Mapping implementation based on Filament, which in turn is based
	// on Blender's implementation using rec 2020 primaries
	// https://github.com/google/filament/pull/7236
	// Inputs and outputs are encoded as Linear-sRGB.
	vec3 ToneMapping(vec3 color) {
		// AgX constants
		const mat3 AgXInsetMatrix = mat3(
			vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
			vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
			vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859)
		);

		// explicit AgXOutsetMatrix generated from Filaments AgXOutsetMatrixInv
		const mat3 AgXOutsetMatrix = mat3(
			vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
			vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
			vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405)
		);

		// LOG2_MIN			= -10.0
		// LOG2_MAX			=	+6.5
		// MIDDLE_GRAY	 =	0.18
		const float AgxMinEv = -12.47393;	// log2(pow(2, LOG2_MIN) * MIDDLE_GRAY)
		const float AgxMaxEv = 4.026069;	 // log2(pow(2, LOG2_MAX) * MIDDLE_GRAY)

		color *= toneMappingExposure;

		color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;

		color = AgXInsetMatrix * color;

		// Log2 encoding
		color = max(color, 1e-10); // avoid 0 or negative numbers for log2
		color = log2(color);
		color = (color - AgxMinEv) / (AgxMaxEv - AgxMinEv);

		color = clamp(color, 0.0, 1.0);

		// Apply sigmoid
		color = agxDefaultContrastApprox(color);

		// Apply AgX look
		// v = agxLook(v, look);

		color = AgXOutsetMatrix * color;

		// Linearize
		color = pow(max(vec3(0.0), color), vec3(2.2));

		color = LINEAR_REC2020_TO_LINEAR_SRGB * color;

		// Gamut mapping. Simple clamp for now.
		color = clamp(color, 0.0, 1.0);

		return color;
	}
#elif TONE_MAPPING == 6
	vec3 ToneMapping(vec3 color) {
		color *= toneMappingExposure;
		color.r = mix(1.0 - exp(-color.r), pow(color.r * 0.38317, 1.0 / 2.2), step(color.r, 1.413));
		color.g = mix(1.0 - exp(-color.g), pow(color.g * 0.38317, 1.0 / 2.2), step(color.g, 1.413));
		color.b = mix(1.0 - exp(-color.b), pow(color.b * 0.38317, 1.0 / 2.2), step(color.b, 1.413));
		return color;
	}
#else
	vec3 ToneMapping(vec3 color) {
		return color; // no tone mapping
	}
#endif
`;

	const LUMINANCE_COEFFS = /* #__PURE__ */new t3d.Vector3(0.2126, 0.7152, 0.0722);

	// An atmosphere layer of width 'width', and whose density is defined as:
	//	 expTerm * exp(expScale * h) + linearTerm * h + constantTerm
	// clamped to [0, 1], and where h is the altitude.
	class DensityProfileLayer {
		constructor(width, expTerm, expScale, linearTerm, constantTerm) {
			this.width = width;
			this.expTerm = expTerm;
			this.expScale = expScale;
			this.linearTerm = linearTerm;
			this.constantTerm = constantTerm;
		}
		toUniform() {
			return {
				width: this.width,
				exp_term: this.expTerm,
				exp_scale: this.expScale,
				linear_term: this.linearTerm,
				constant_term: this.constantTerm
			};
		}
	}
	class AtmosParameters {
		constructor() {
			// The solar irradiance at the top of the atmosphere.
			this.solarIrradiance = new t3d.Vector3(1.474, 1.8504, 1.91198);

			// The sun's angular radius. Warning: the implementation uses approximations
			// that are valid only if this angle is smaller than 0.1 radians.
			this.sunAngularRadius = 0.004675;

			// The distance between the planet center and the bottom of the atmosphere in
			// meters.
			this.bottomRadius = 6360000;

			// The distance between the planet center and the top of the atmosphere in
			// meters.
			this.topRadius = 6420000;

			// The density profile of air molecules, i.e. a function from altitude to
			// dimensionless values between 0 (null density) and 1 (maximum density).
			// prettier-ignore
			this.rayleighDensity = [new DensityProfileLayer(0, 0, 0, 0, 0), new DensityProfileLayer(0, 1, -0.125, 0, 0)];

			// The scattering coefficient of air molecules at the altitude where their
			// density is maximum (usually the bottom of the atmosphere), as a function of
			// wavelength. The scattering coefficient at altitude h is equal to
			// "rayleighScattering" times "rayleighDensity" at this altitude.
			this.rayleighScattering = new t3d.Vector3(0.005802, 0.013558, 0.0331);

			// The density profile of aerosols, i.e. a function from altitude to
			// dimensionless values between 0 (null density) and 1 (maximum density).
			// prettier-ignore
			this.mieDensity = [new DensityProfileLayer(0, 0, 0, 0, 0), new DensityProfileLayer(0, 1, -0.833333, 0, 0)];

			// The scattering coefficient of aerosols at the altitude where their density
			// is maximum (usually the bottom of the atmosphere), as a function of
			// wavelength. The scattering coefficient at altitude h is equal to
			// "mieScattering" times "mieDensity" at this altitude.
			this.mieScattering = new t3d.Vector3(0.003996, 0.003996, 0.003996);

			// The extinction coefficient of aerosols at the altitude where their density
			// is maximum (usually the bottom of the atmosphere), as a function of
			// wavelength. The extinction coefficient at altitude h is equal to
			// "mieExtinction" times "mieDensity" at this altitude.
			this.mieExtinction = new t3d.Vector3(0.00444, 0.00444, 0.00444);

			// The asymmetry parameter for the Cornette-Shanks phase function for the
			// aerosols.
			this.miePhaseFunctionG = 0.8;

			// The density profile of air molecules that absorb light (e.g. ozone), i.e.
			// a function from altitude to dimensionless values between 0 (null density)
			// and 1 (maximum density).
			// prettier-ignore
			this.absorptionDensity = [new DensityProfileLayer(25, 0, 0, 1 / 15, -2 / 3), new DensityProfileLayer(0, 0, 0, -1 / 15, 8 / 3)];

			// The extinction coefficient of molecules that absorb light (e.g. ozone) at
			// the altitude where their density is maximum, as a function of wavelength.
			// The extinction coefficient at altitude h is equal to
			// "absorptionExtinction" times "absorptionDensity" at this altitude.
			this.absorptionExtinction = new t3d.Vector3(0.00065, 0.001881, 0.000085);

			// The average albedo of the ground.
			this.groundAlbedo = new t3d.Color3(0.1, 0.1, 0.1);

			// The cosine of the maximum Sun zenith angle for which atmospheric scattering
			// must be precomputed (for maximum precision, use the smallest Sun zenith
			// angle yielding negligible sky light radiance values. For instance, for the
			// Earth case, 102 degrees is a good choice - yielding muSMin = -0.2).
			this.muSMin = Math.cos(120 * Math.PI / 180);

			// Radiance to luminance conversion
			this.sunRadianceToLuminance = new t3d.Vector3(98242.786222, 69954.398112, 66475.012354);
			this.skyRadianceToLuminance = new t3d.Vector3(114974.916437, 71305.954816, 65310.548555);

			// Luminance values are too large for storing in half precision buffer.
			// We divide them by the luminance of the sun with the unit radiance.
			const luminance = LUMINANCE_COEFFS.dot(this.sunRadianceToLuminance);
			this.sunRadianceToRelativeLuminance = this.sunRadianceToLuminance.clone().multiplyScalar(1 / luminance);
			this.skyRadianceToRelativeLuminance = this.skyRadianceToLuminance.clone().multiplyScalar(1 / luminance);
		}
		toUniform() {
			return {
				solar_irradiance: this.solarIrradiance.toArray(),
				sun_angular_radius: this.sunAngularRadius,
				bottom_radius: this.bottomRadius * METER_TO_LENGTH_UNIT,
				top_radius: this.topRadius * METER_TO_LENGTH_UNIT,
				rayleigh_density: {
					layers: this.rayleighDensity.map(layer => layer.toUniform())
				},
				rayleigh_scattering: this.rayleighScattering.toArray(),
				mie_density: {
					layers: this.mieDensity.map(layer => layer.toUniform())
				},
				mie_scattering: this.mieScattering.toArray(),
				mie_extinction: this.mieExtinction.toArray(),
				mie_phase_function_g: this.miePhaseFunctionG,
				absorption_density: {
					layers: this.absorptionDensity.map(layer => layer.toUniform())
				},
				absorption_extinction: this.absorptionExtinction.toArray(),
				ground_albedo: this.groundAlbedo.toArray(),
				mu_s_min: this.muSMin
			};
		}
	}
	AtmosParameters.DEFAULT = new AtmosParameters();

	const AtmosSkyShader = {
		name: 'atmos_sky',
		defines: {
			TRANSMITTANCE_MAPPING: 1,
			INSCATTER_MAPPING: 1,
			TONE_MAPPING: 5,
			SRGB_OUTPUT: true,
			GROUND_ALBEDO: true,
			SKY_SUNDISK: true
		},
		uniforms: {
			/* Atmosphere Uniforms */

			ATMOSPHERE: AtmosParameters.DEFAULT.toUniform(),
			SUN_SPECTRAL_RADIANCE_TO_LUMINANCE: [0, 0, 0],
			SKY_SPECTRAL_RADIANCE_TO_LUMINANCE: [0, 0, 0],
			scattering_texture: null,
			transmittance_texture: null,
			irradiance_texture: null,
			cameraPosition: [0, 0, 0],
			sunDirection: [0, 0, 0],
			altitudeCorrection: [0, 0, 0],
			toneMappingExposure: 10.0,
			/* Sky Uniforms */

			sunDiskSize: 1
		},
		vertexShader: /* glsl */`
		#define METER_TO_LENGTH_UNIT ${METER_TO_LENGTH_UNIT.toFixed(7)}

				attribute vec3 a_Position;

		uniform mat4 u_Projection;
		uniform mat4 u_View;
		uniform mat4 u_Model;

		uniform vec3 cameraPosition;
		uniform vec3 altitudeCorrection;

		varying vec3 vCameraPosition;
		varying vec3 vRayDirection;

		void getCameraRay(out vec3 origin, out vec3 direction) {
			mat4 inverseProjectionMatrix = inverse(u_Projection);
			mat4 inverseViewMatrix = inverse(u_Model * u_View); // pre-multiplied by model matrix in case use anchorMatrix

			bool isPerspective = inverseProjectionMatrix[2][3] != 0.0; // 4th entry in the 3rd column

			if (isPerspective) {
				// Calculate the camera ray for a perspective camera.
				vec4 viewPosition = inverseProjectionMatrix * vec4(a_Position.xzy, 1.0);
				vec4 worldDirection = inverseViewMatrix * vec4(viewPosition.xyz, 0.0);
				origin = cameraPosition;
				direction = worldDirection.xyz;
			} else {
				// Unprojected points to calculate direction.
				vec4 nearPoint = inverseProjectionMatrix * vec4(a_Position.xz, -1.0, 1.0);
				vec4 farPoint = inverseProjectionMatrix * vec4(a_Position.xz, -0.9, 1.0);
				nearPoint /= nearPoint.w;
				farPoint /= farPoint.w;

				// Calculate world values
				vec4 worldDirection = inverseViewMatrix * vec4(farPoint.xyz - nearPoint.xyz, 0.0);
				vec4 worldOrigin = inverseViewMatrix * nearPoint;

				// Outputs
				direction = worldDirection.xyz;
				origin = worldOrigin.xyz;
			}
		}
				
				void main() {
			vec3 direction, origin;
				getCameraRay(origin, direction);

			vCameraPosition = (origin + altitudeCorrection) * METER_TO_LENGTH_UNIT;
			vRayDirection = direction;

			gl_Position = vec4(a_Position.xz, 1.0, 1.0);
				}
		`,
		fragmentShader: /* glsl */`
		${defines}
		${definitions}
		${common}
		${raySphereIntersection}

		uniform AtmosphereParameters ATMOSPHERE;
		uniform vec3 SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
		uniform vec3 SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;

		uniform highp sampler3D scattering_texture;
				uniform sampler2D transmittance_texture;
		uniform sampler2D irradiance_texture;

		${runtime}

				uniform float toneMappingExposure;

		uniform vec3 sunDirection;
		uniform float sunDiskSize;

		varying vec3 vCameraPosition;
		varying vec3 vRayDirection;

		${tonemapping}

		#include <dithering_pars_frag>

				void main() {
			vec3 cameraPosition = vCameraPosition;
						vec3 rayDirection = normalize(vRayDirection);

			vec4 outputColor;
			vec3 transmittance;

			#ifdef GROUND_ALBEDO
				float r = length(cameraPosition);
					float mu = dot(cameraPosition, rayDirection) / r;
				bool ray_r_mu_intersects_ground = RayIntersectsGround(ATMOSPHERE, r, mu);
				if (ray_r_mu_intersects_ground) {
					float distance_to_ground = RaySphereFirstIntersection(
						cameraPosition,
						rayDirection,
						ATMOSPHERE.bottom_radius);
					vec3 groundPosition = rayDirection * distance_to_ground + cameraPosition;
					vec3 surfaceNormal = normalize(groundPosition);
					vec3 skyIrradiance;
					vec3 sunIrradiance = GetSunAndSkyIrradiance(
						cameraPosition,
						surfaceNormal, 
						sunDirection, 
						skyIrradiance
					);
					vec3 inscatter = GetSkyRadianceToPoint(
						cameraPosition,
						ATMOSPHERE.bottom_radius * surfaceNormal,
						sunDirection,
						transmittance
					);
					vec3 radiance = ATMOSPHERE.ground_albedo * RECIPROCAL_PI * (sunIrradiance + skyIrradiance);
					outputColor.rgb = radiance * transmittance + inscatter;
					transmittance = vec3(0.0);
				} else {
					outputColor.rgb = GetSkyRadiance(
						cameraPosition,
						rayDirection,
						sunDirection,
						transmittance
					);
				}
			#else
				outputColor.rgb = GetSkyRadiance(
					cameraPosition,
					rayDirection,
					sunDirection,
					transmittance
				);
			#endif

			outputColor.rgb = ToneMapping(outputColor.rgb);
			
						#ifdef SKY_SUNDISK
				float nu = dot(rayDirection, sunDirection);
				float sun = 0.004 * sunDiskSize * MiePhaseFunction(0.99, nu);
						outputColor.rgb += sun * transmittance;
						#endif

			outputColor.a = 1.0;

						gl_FragColor = outputColor;

			#ifdef SRGB_OUTPUT
				gl_FragColor = LinearTosRGB(gl_FragColor);
			#endif

			#include <dithering_frag>
				}
		`
	};

	class AtmosSky extends t3d.Mesh {
		constructor() {
			const material = new t3d.ShaderMaterial(AtmosSkyShader);
			material.depthWrite = false;
			material.side = t3d.DRAW_SIDE.BACK;
			material.dithering = true;
			super(new t3d.PlaneGeometry(2, 2), material);
			this.frustumCulled = false;
		}
		setLUTs(lutsData) {
			const {
				atmosphere,
				transmittanceTexture,
				inscatterTexture,
				irradianceTexture
			} = lutsData;
			const {
				uniforms,
				defines
			} = this.material;
			uniforms.ATMOSPHERE = atmosphere.toUniform();
			atmosphere.sunRadianceToRelativeLuminance.toArray(uniforms.SUN_SPECTRAL_RADIANCE_TO_LUMINANCE);
			atmosphere.skyRadianceToRelativeLuminance.toArray(uniforms.SKY_SPECTRAL_RADIANCE_TO_LUMINANCE);
			uniforms.transmittance_texture = transmittanceTexture;
			uniforms.scattering_texture = inscatterTexture;
			uniforms.irradiance_texture = irradianceTexture;
			let needsUpdate = false;
			if (defines.TRANSMITTANCE_MAPPING !== lutsData.transmittanceMapping) {
				defines.TRANSMITTANCE_MAPPING = lutsData.transmittanceMapping;
				needsUpdate = true;
			}
			if (defines.INSCATTER_MAPPING !== lutsData.inscatterMapping) {
				defines.INSCATTER_MAPPING = lutsData.inscatterMapping;
				needsUpdate = true;
			}
			this.material.needsUpdate = needsUpdate;
		}
	}

	const AtmosFogShader = {
		name: 'atmos_fog',
		defines: {
			TRANSMITTANCE_MAPPING: 1,
			INSCATTER_MAPPING: 1,
			CORRECT_GEOMETRIC_ERROR: true,
			SUN_LIGHT: true,
			SKY_LIGHT: true,
			TRANSMITTANCE: true,
			INSCATTER: true
		},
		uniforms: {
			/* Atmosphere Uniforms */

			ATMOSPHERE: AtmosParameters.DEFAULT.toUniform(),
			SUN_SPECTRAL_RADIANCE_TO_LUMINANCE: [0, 0, 0],
			SKY_SPECTRAL_RADIANCE_TO_LUMINANCE: [0, 0, 0],
			scattering_texture: null,
			transmittance_texture: null,
			irradiance_texture: null,
			cameraPosition: [0, 0, 0],
			sunDirection: [0, 0, 0],
			altitudeCorrection: [0, 0, 0],
			toneMappingExposure: 10.0,
			/* Fog Uniforms */

			tDiffuse: null,
			depthTexture: null,
			normalTexture: null,
			projectionView: new Array(16),
			anchorMatrix: new Array(16),
			ellipsoidRadii: new Array(3),
			geometricErrorCorrectionAmount: 0.0,
			albedoScale: 2 / Math.PI
		},
		vertexShader: /* glsl */`
		#define METER_TO_LENGTH_UNIT ${METER_TO_LENGTH_UNIT.toFixed(7)}

		attribute vec3 a_Position;
		attribute vec2 a_Uv;

		uniform mat4 u_ProjectionView;
		uniform mat4 u_Model;

		uniform vec3 cameraPosition;
		uniform vec3 altitudeCorrection;
		uniform vec3 ellipsoidRadii;
		uniform float geometricErrorCorrectionAmount;

		varying vec3 vCameraPosition;
		varying vec3 vEllipsoidRadiiSquared;
		varying vec3 vGeometryAltitudeCorrection;
		varying vec2 v_Uv;

		void main() {
			gl_Position = u_ProjectionView * u_Model * vec4(a_Position, 1.0);

			vCameraPosition = (cameraPosition + altitudeCorrection) * METER_TO_LENGTH_UNIT;

			vGeometryAltitudeCorrection = altitudeCorrection * METER_TO_LENGTH_UNIT;
			#ifdef CORRECT_GEOMETRIC_ERROR
				vGeometryAltitudeCorrection *= 1.0 - geometricErrorCorrectionAmount;
			#endif

			vec3 radii = ellipsoidRadii * METER_TO_LENGTH_UNIT;
				vEllipsoidRadiiSquared = radii * radii;

			v_Uv = a_Uv;
		}
	`,
		fragmentShader: /* glsl */`
		${t3dEffectComposer.octahedronToUnitVectorGLSL}

		${defines}
		${definitions}
		${common}

		uniform AtmosphereParameters ATMOSPHERE;
		uniform vec3 SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
		uniform vec3 SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;

		uniform highp sampler3D scattering_texture;
				uniform sampler2D transmittance_texture;
		uniform sampler2D irradiance_texture;

		${runtime}

		uniform float toneMappingExposure;

		uniform vec3 sunDirection;

		uniform sampler2D tDiffuse;
		uniform sampler2D depthTexture;
		uniform sampler2D normalTexture;
		uniform mat4 projectionView;
		uniform mat4 anchorMatrix;
		uniform float geometricErrorCorrectionAmount;
		uniform float albedoScale;

		varying vec3 vCameraPosition;
		varying vec3 vEllipsoidRadiiSquared;
		varying vec3 vGeometryAltitudeCorrection;
		varying vec2 v_Uv;

		void correctGeometricError(inout vec3 positionECEF, inout vec3 normalECEF) {
			// TODO: The error is pronounced at the edge of the ellipsoid due to the
			// large difference between the sphere position and the unprojected position
			// at the current fragment. Calculating the sphere position from the fragment
			// UV may resolve this.

			// Correct way is slerp, but this will be small-angle interpolation anyways.
			vec3 sphereNormal = normalize(positionECEF / vEllipsoidRadiiSquared);
			vec3 spherePosition = ATMOSPHERE.bottom_radius * sphereNormal;
			normalECEF = mix(normalECEF, sphereNormal, geometricErrorCorrectionAmount);
			positionECEF = mix(positionECEF, spherePosition, geometricErrorCorrectionAmount);
		}

				void main() {
			vec2 uv = v_Uv;

			vec4 inputColor = texture2D(tDiffuse, uv);

			float depth = texture2D(depthTexture, uv).r;
			vec4 gBufferTexel = texture2D(normalTexture, uv);

			// if (depth >= 1.0 - 1e-8) {
			// 	gl_FragColor = inputColor;
			// 	return;
			// }

			if (gBufferTexel.r < -2.0) {
				gl_FragColor = inputColor;
				return;
			}

			vec4 clipPosition = vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
			vec4 worldPosition4 = anchorMatrix * (inverse(projectionView) * clipPosition);

			vec3 worldPosition = worldPosition4.xyz / worldPosition4.w;
			worldPosition = worldPosition * METER_TO_LENGTH_UNIT + vGeometryAltitudeCorrection;
			vec3 worldNormal = octahedronToUnitVector(gBufferTexel.rg);
			worldNormal = (anchorMatrix * vec4(worldNormal, 0.0)).xyz;
			worldNormal = normalize(worldNormal);

			#ifdef CORRECT_GEOMETRIC_ERROR
				correctGeometricError(worldPosition, worldNormal);
			#endif

			vec3 radiance;
			#if defined(SUN_LIGHT) || defined(SKY_LIGHT)
				vec3 diffuse = inputColor.rgb * albedoScale * RECIPROCAL_PI;
				vec3 skyIrradiance;
					vec3 sunIrradiance = GetSunAndSkyIrradiance(
					worldPosition,
					worldNormal,
					sunDirection,
					skyIrradiance
				);

				#if defined(SUN_LIGHT) && defined(SKY_LIGHT)
					radiance = diffuse * (sunIrradiance + skyIrradiance);
				#elif defined(SUN_LIGHT)
					radiance = diffuse * sunIrradiance;
				#elif defined(SKY_LIGHT)
					radiance = diffuse * skyIrradiance;
				#endif
			#else
				radiance = inputColor.rgb;
			#endif

			#if defined(TRANSMITTANCE) || defined(INSCATTER)
				vec3 transmittance;
				vec3 inscatter = GetSkyRadianceToPoint(
					vCameraPosition,
					worldPosition,
					sunDirection,
					transmittance
				);

				#ifdef TRANSMITTANCE
					radiance *= transmittance;
				#endif
				#ifdef INSCATTER
					radiance += inscatter;
				#endif
			#endif
			
						gl_FragColor = vec4(radiance, inputColor.a);
				}
	`
	};

	class AtmosFogEffect extends t3dEffectComposer.Effect {
		constructor() {
			super();
			this.bufferDependencies = [{
				key: 'GBuffer'
			}];
			this._mainPass = new t3d.ShaderPostPass(AtmosFogShader);
		}
		setLUTs(lutsData) {
			const {
				atmosphere,
				transmittanceTexture,
				inscatterTexture,
				irradianceTexture
			} = lutsData;
			const {
				uniforms,
				defines
			} = this._mainPass.material;
			uniforms.ATMOSPHERE = atmosphere.toUniform();
			atmosphere.sunRadianceToRelativeLuminance.toArray(uniforms.SUN_SPECTRAL_RADIANCE_TO_LUMINANCE);
			atmosphere.skyRadianceToRelativeLuminance.toArray(uniforms.SKY_SPECTRAL_RADIANCE_TO_LUMINANCE);
			uniforms.transmittance_texture = transmittanceTexture;
			uniforms.scattering_texture = inscatterTexture;
			uniforms.irradiance_texture = irradianceTexture;
			let needsUpdate = false;
			if (defines.TRANSMITTANCE_MAPPING !== lutsData.transmittanceMapping) {
				defines.TRANSMITTANCE_MAPPING = lutsData.transmittanceMapping;
				needsUpdate = true;
			}
			if (defines.INSCATTER_MAPPING !== lutsData.inscatterMapping) {
				defines.INSCATTER_MAPPING = lutsData.inscatterMapping;
				needsUpdate = true;
			}
			this._mainPass.material.needsUpdate = needsUpdate;
		}
		render(renderer, composer, inputRenderTarget, outputRenderTarget, finish) {
			const gBuffer = composer.getBuffer('GBuffer');
			const gBufferRenderStates = gBuffer.getCurrentRenderStates();
			gBufferRenderStates.camera.projectionViewMatrix.toArray(this._mainPass.uniforms.projectionView);
			gBufferRenderStates.scene.anchorMatrix.toArray(this._mainPass.uniforms.anchorMatrix);
			renderer.setRenderTarget(outputRenderTarget);
			renderer.setClearColor(0, 0, 0, 0);
			if (finish) {
				renderer.clear(composer.clearColor, composer.clearDepth, composer.clearStencil);
			} else {
				renderer.clear(true, true, false);
			}
			const mainPass = this._mainPass;
			mainPass.uniforms.tDiffuse = inputRenderTarget.texture;
			mainPass.uniforms.depthTexture = gBuffer.output()._attachments[t3d.ATTACHMENT.DEPTH_STENCIL_ATTACHMENT];
			mainPass.uniforms.normalTexture = gBuffer.output()._attachments[t3d.ATTACHMENT.COLOR_ATTACHMENT0];
			if (finish) {
				mainPass.material.transparent = composer._tempClearColor[3] < 1 || !composer.clearColor;
				mainPass.renderStates.camera.rect.fromArray(composer._tempViewport);
			}
			mainPass.render(renderer);
			if (finish) {
				mainPass.material.transparent = false;
				mainPass.renderStates.camera.rect.set(0, 0, 1, 1);
			}
		}
		dispose() {
			this._mainPass.dispose();
		}
	}

	// Based on: https://github.com/ebruneton/precomputed_atmospheric_scattering/blob/master/atmosphere/functions.glsl

	/**
	 * Copyright (c) 2017 Eric Bruneton
	 * All rights reserved.
	 *
	 * Redistribution and use in source and binary forms, with or without
	 * modification, are permitted provided that the following conditions
	 * are met:
	 * 1. Redistributions of source code must retain the above copyright
	 *		notice, this list of conditions and the following disclaimer.
	 * 2. Redistributions in binary form must reproduce the above copyright
	 *		notice, this list of conditions and the following disclaimer in the
	 *		documentation and/or other materials provided with the distribution.
	 * 3. Neither the name of the copyright holders nor the names of its
	 *		contributors may be used to endorse or promote products derived from
	 *		this software without specific prior written permission.
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
	 *		notice, this list of conditions and the following disclaimer.
	 * 2. Redistributions in binary form must reproduce the above copyright
	 *		notice, this list of conditions and the following disclaimer in the
	 *		documentation and/or other materials provided with the distribution.
	 * 3. Neither the name of the copyright holders nor the names of its
	 *		contributors may be used to endorse or promote products derived from
	 *		this software without specific prior written permission.
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

	const precompute = /* glsl */`
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

	const TransmittanceShader = {
		name: 'atmos_transmittance',
		defines: {
			TRANSMITTANCE_MAPPING: 1,
			INSCATTER_MAPPING: 1
		},
		uniforms: {},
		vertexShader: /* glsl */`
				attribute vec3 a_Position;
				attribute vec2 a_Uv;
					 
				uniform mat4 u_ProjectionView;
				uniform mat4 u_Model;

				varying vec2 v_Uv;

				void main() {
						v_Uv = a_Uv;
						gl_Position = u_ProjectionView * u_Model * vec4(a_Position, 1.0);
				}
		`,
		fragmentShader: /* glsl */`
		${defines}
		${definitions}
		${common}
		${precompute}

		uniform AtmosphereParameters ATMOSPHERE;

		varying vec2 v_Uv;

				void main() {
			vec4 transmittance;
			transmittance.rgb = ComputeTransmittanceToTopAtmosphereBoundaryTexture(
				ATMOSPHERE, gl_FragCoord.xy
			);
			transmittance.a = 1.0;
						gl_FragColor = transmittance;
				}
		`
	};

	const InscatterShader = {
		name: 'atmos_inscatter',
		defines: {
			TRANSMITTANCE_MAPPING: 1,
			INSCATTER_MAPPING: 1
		},
		uniforms: {
			transmittance_texture: null,
			layer: 0
		},
		vertexShader: /* glsl */`
				attribute vec3 a_Position;
				attribute vec2 a_Uv;
					 
				uniform mat4 u_ProjectionView;
				uniform mat4 u_Model;

				varying vec2 v_Uv;

				void main() {
						v_Uv = a_Uv;
						gl_Position = u_ProjectionView * u_Model * vec4(a_Position, 1.0);
				}
		`,
		fragmentShader: /* glsl */`
		${defines}
		${definitions}
		${common}
		${precompute}

		uniform AtmosphereParameters ATMOSPHERE;
		uniform sampler2D transmittance_texture;
		uniform float layer;

		varying vec2 v_Uv;
				
				void main() {
			vec4 deltaRayleigh;
			vec4 deltaMie;
			vec4 scattering;
			vec4 singleMieScattering;
			ComputeSingleScatteringTexture(
				ATMOSPHERE,
				transmittance_texture,
				vec3(gl_FragCoord.xy, float(layer) + 0.5),
				deltaRayleigh.rgb,
					deltaMie.rgb
			);
			deltaRayleigh.a = 1.0;
				deltaMie.a = 1.0;

			gl_FragColor = vec4(deltaRayleigh.rgb, deltaMie.r);
				}
		`
	};

	const IrradianceShader = {
		name: 'atmos_irradiance',
		defines: {
			TRANSMITTANCE_MAPPING: 1,
			INSCATTER_MAPPING: 1
		},
		uniforms: {
			transmittance_texture: null,
			scattering_texture: null
		},
		vertexShader: /* glsl */`
				attribute vec3 a_Position;
				attribute vec2 a_Uv;
					 
				uniform mat4 u_ProjectionView;
				uniform mat4 u_Model;

				varying vec2 v_Uv;

				void main() {
						v_Uv = a_Uv;
						gl_Position = u_ProjectionView * u_Model * vec4(a_Position, 1.0);
				}
		`,
		fragmentShader: /* glsl */`
		${defines}
		${definitions}
		${common}
		${precompute}

		uniform AtmosphereParameters ATMOSPHERE;
		uniform sampler2D transmittance_texture;
		uniform highp sampler3D scattering_texture;

		varying vec2 v_Uv;

				void main() {
			vec3 deltaIrradiance;
			deltaIrradiance = ComputeIndirectIrradianceTexture(
				ATMOSPHERE,
				scattering_texture,
				gl_FragCoord.xy
			);
			gl_FragColor = vec4(deltaIrradiance, 1.0);
				}
		`
	};

	class AtmosLUTsGenerator {
		constructor(capabilities, options = {}) {
			const isWebGL2 = capabilities.version > 1;
			const atmosphere = options.atmosphere !== undefined ? options.atmosphere : AtmosParameters.DEFAULT;

			// Transmittance mapping
			// 0 - linear implementation
			// 1 - original implementation in 2008
			// 2 - new implementation in 2017
			const transmittanceMapping = options.transmittanceMapping !== undefined ? options.transmittanceMapping : 1;

			// Inscatter mapping
			// 0 - linear implementation
			// 1 - non-linear implementation
			const inscatterMapping = options.inscatterMapping !== undefined ? options.inscatterMapping : 1;

			// ios provides a poor implementation of float linear, so fallback to Half Float
			const isIOS = /(iPad|iPhone|iPod)/g.test(navigator.userAgent);
			let type;
			if (isWebGL2) {
				if (capabilities.getExtension('EXT_color_buffer_float') && capabilities.getExtension('OES_texture_float_linear') && !isIOS) {
					type = t3d.PIXEL_TYPE.FLOAT;
				} else {
					type = t3d.PIXEL_TYPE.HALF_FLOAT;
				}
			} else {
				if (capabilities.getExtension('OES_texture_float') && capabilities.getExtension('OES_texture_float_linear') && !isIOS) {
					type = t3d.PIXEL_TYPE.FLOAT;
				} else if (capabilities.getExtension('OES_texture_half_float') && capabilities.getExtension('OES_texture_half_float_linear')) {
					type = t3d.PIXEL_TYPE.HALF_FLOAT;
				} else {
					type = t3d.PIXEL_TYPE.UNSIGNED_BYTE;
					console.warn('Half float texture is not supported!');
				}
			}

			// Render targets

			const transmittanceRT = new t3d.RenderTarget2D(TRANSMITTANCE_TEXTURE_WIDTH, TRANSMITTANCE_TEXTURE_HEIGHT);
			transmittanceRT.texture.minFilter = t3d.TEXTURE_FILTER.LINEAR;
			transmittanceRT.texture.magFilter = t3d.TEXTURE_FILTER.LINEAR;
			transmittanceRT.texture.type = type;
			transmittanceRT.texture.format = t3d.PIXEL_FORMAT.RGBA;
			transmittanceRT.texture.generateMipmaps = false;
			const inscatterRT = new t3d.RenderTarget3D(SCATTERING_TEXTURE_WIDTH, SCATTERING_TEXTURE_HEIGHT, SCATTERING_TEXTURE_DEPTH);
			inscatterRT.texture.minFilter = t3d.TEXTURE_FILTER.LINEAR;
			inscatterRT.texture.magFilter = t3d.TEXTURE_FILTER.LINEAR;
			inscatterRT.texture.type = type;
			inscatterRT.texture.format = t3d.PIXEL_FORMAT.RGBA;
			inscatterRT.texture.generateMipmaps = false;
			const irradianceRT = new t3d.RenderTarget2D(IRRADIANCE_TEXTURE_WIDTH, IRRADIANCE_TEXTURE_HEIGHT);
			irradianceRT.texture.minFilter = t3d.TEXTURE_FILTER.LINEAR;
			irradianceRT.texture.magFilter = t3d.TEXTURE_FILTER.LINEAR;
			irradianceRT.texture.type = type;
			irradianceRT.texture.format = t3d.PIXEL_FORMAT.RGBA;
			irradianceRT.texture.generateMipmaps = false;

			// Render Passes

			const atmosphereUniform = atmosphere.toUniform();
			const transmittancePass = new t3d.ShaderPostPass(TransmittanceShader);
			transmittancePass.uniforms.ATMOSPHERE = atmosphereUniform;
			transmittancePass.material.defines.TRANSMITTANCE_MAPPING = transmittanceMapping;
			const inscatterPass = new t3d.ShaderPostPass(InscatterShader);
			inscatterPass.uniforms.transmittance_texture = transmittanceRT.texture;
			inscatterPass.uniforms.ATMOSPHERE = atmosphereUniform;
			inscatterPass.material.defines.TRANSMITTANCE_MAPPING = transmittanceMapping;
			inscatterPass.material.defines.INSCATTER_MAPPING = inscatterMapping;
			const irradiancePass = new t3d.ShaderPostPass(IrradianceShader);
			irradiancePass.uniforms.transmittance_texture = transmittanceRT.texture;
			irradiancePass.uniforms.scattering_texture = inscatterRT.texture;
			irradiancePass.uniforms.ATMOSPHERE = atmosphereUniform;
			irradiancePass.material.defines.TRANSMITTANCE_MAPPING = transmittanceMapping;
			irradiancePass.material.defines.INSCATTER_MAPPING = inscatterMapping;

			//

			this._transmittanceRT = transmittanceRT;
			this._inscatterRT = inscatterRT;
			this._irradianceRT = irradianceRT;
			this._transmittancePass = transmittancePass;
			this._inscatterPass = inscatterPass;
			this._irradiancePass = irradiancePass;
			this._data = {
				transmittanceTexture: transmittanceRT.texture,
				inscatterTexture: inscatterRT.texture,
				irradianceTexture: irradianceRT.texture,
				atmosphere,
				transmittanceMapping: transmittanceMapping,
				inscatterMapping: inscatterMapping
			};
		}
		get data() {
			return this._data;
		}
		computeTransmittance(renderer) {
			renderer.setRenderTarget(this._transmittanceRT);
			renderer.setClearColor(0, 0, 0, 0);
			renderer.clear(true, true, true);
			this._transmittancePass.render(renderer);
		}
		computeInscatter(renderer) {
			const inscatterRT = this._inscatterRT;
			const inscatterPass = this._inscatterPass;
			if (inscatterRT.isRenderTarget3D) {
				for (let i = 0; i < 32; i++) {
					inscatterRT.activeLayer = i;
					inscatterPass.uniforms.layer = i;
					renderer.setRenderTarget(inscatterRT);
					renderer.setClearColor(0, 0, 0, 0);
					renderer.clear(true, true, true);
					inscatterPass.render(renderer);
				}
			} else {
				renderer.setRenderTarget(inscatterRT);
				renderer.setClearColor(0, 0, 0, 0);
				renderer.clear(true, true, true);
				inscatterPass.render(renderer);
			}
		}
		computeIrradiance(renderer) {
			renderer.setRenderTarget(this._irradianceRT);
			renderer.setClearColor(0, 0, 0, 0);
			renderer.clear(true, true, true);
			this._irradiancePass.render(renderer);
		}
		readTransmittancePixels(renderer) {
			readPixels(renderer, this._transmittanceRT);
		}
		readIrradiancePixels(renderer) {
			readPixels(renderer, this._irradianceRT);
		}
		dispose() {
			this._transmittanceRT.dispose();
			this._inscatterRT.dispose();
			this._irradianceRT.dispose();
			this._transmittancePass.dispose();
			this._inscatterPass.dispose();
			this._irradiancePass.dispose();
		}
	}
	function readPixels(renderer, renderTarget) {
		const {
			width,
			height,
			texture
		} = renderTarget;
		const imageData = texture.type === t3d.PIXEL_TYPE.HALF_FLOAT ? new Uint16Array(width * height * 4) : new Float32Array(width * height * 4);
		renderer.setRenderTarget(renderTarget);
		renderer.readRenderTargetPixels(0, 0, width, height, imageData);
		texture.userData.imageData = imageData;
	}

	class AtmosLUTsLoader {
		constructor(capabilities, options = {}) {
			this._fileLoader = new t3d.FileLoader(options.manager);
			this._fileLoader.setResponseType('arraybuffer');
			this._data = {
				transmittanceTexture: null,
				inscatterTexture: null,
				irradianceTexture: null,
				atmosphere: AtmosParameters.DEFAULT,
				transmittanceMapping: 2,
				inscatterMapping: 1
			};
			let type = t3d.PIXEL_TYPE.FLOAT;
			const isWebGL2 = capabilities.version > 1;
			if (isWebGL2) {
				if (capabilities.getExtension('EXT_color_buffer_float') && capabilities.getExtension('OES_texture_float_linear')) {
					type = t3d.PIXEL_TYPE.FLOAT;
				} else {
					type = t3d.PIXEL_TYPE.HALF_FLOAT;
				}
			} else {
				if (capabilities.getExtension('OES_texture_float') && capabilities.getExtension('OES_texture_float_linear')) {
					type = t3d.PIXEL_TYPE.FLOAT;
				} else if (capabilities.getExtension('OES_texture_half_float') && capabilities.getExtension('OES_texture_half_float_linear')) {
					type = t3d.PIXEL_TYPE.HALF_FLOAT;
				} else {
					type = t3d.PIXEL_TYPE.UNSIGNED_BYTE;
					console.warn('Half float texture is not supported!');
				}
			}
			const transmittanceTexture = new t3d.Texture2D();
			transmittanceTexture.minFilter = t3d.TEXTURE_FILTER.LINEAR;
			transmittanceTexture.magFilter = t3d.TEXTURE_FILTER.LINEAR;
			transmittanceTexture.type = type;
			transmittanceTexture.generateMipmaps = false;
			transmittanceTexture.flipY = false;
			this._data.transmittanceTexture = transmittanceTexture;
			const inscatterTexture = new t3d.Texture3D();
			inscatterTexture.minFilter = t3d.TEXTURE_FILTER.LINEAR;
			inscatterTexture.magFilter = t3d.TEXTURE_FILTER.LINEAR;
			inscatterTexture.type = type;
			inscatterTexture.format = t3d.PIXEL_FORMAT.RGBA;
			inscatterTexture.generateMipmaps = false;
			this._data.inscatterTexture = inscatterTexture;
			const irradianceTexture = new t3d.Texture2D();
			irradianceTexture.minFilter = t3d.TEXTURE_FILTER.LINEAR;
			irradianceTexture.magFilter = t3d.TEXTURE_FILTER.LINEAR;
			irradianceTexture.type = type;
			irradianceTexture.generateMipmaps = false;
			irradianceTexture.flipY = false;
			this._data.irradianceTexture = irradianceTexture;
		}
		get data() {
			return this._data;
		}
		loadTransmittanceTexture(url) {
			return this._fileLoader.loadAsync(url).then(data => {
				const texture = this._data.transmittanceTexture;
				texture.image = {
					data: getImageDataFromArrayBuffer(data, texture.type),
					width: 256,
					height: 64
				};
				texture.version++;
			});
		}
		loadInscatterTexture(url) {
			return this._fileLoader.loadAsync(url).then(data => {
				const texture = this._data.inscatterTexture;
				texture.image = {
					data: getImageDataFromArrayBuffer(data, texture.type),
					width: 256,
					height: 128,
					depth: 32
				};
				texture.version++;
			});
		}
		loadIrradianceTexture(url) {
			return this._fileLoader.loadAsync(url).then(data => {
				const texture = this._data.irradianceTexture;
				texture.image = {
					data: getImageDataFromArrayBuffer(data, texture.type),
					width: 64,
					height: 16
				};
				texture.version++;
			});
		}
		dispose() {
			this._data.transmittanceTexture.dispose();
			this._data.inscatterTexture.dispose();
			this._data.irradianceTexture.dispose();
		}
	}
	function getImageDataFromArrayBuffer(arrayBuffer, type) {
		const halfFloatArray = new Uint16Array(arrayBuffer);
		const length = halfFloatArray.length;
		if (type === t3d.PIXEL_TYPE.FLOAT) {
			const floatArray = new Float32Array(length);
			for (let i = 0; i < length; i++) {
				floatArray[i] = t3d.MathUtils.fromHalfFloat(halfFloatArray[i]);
			}
			return floatArray;
		} else if (type === t3d.PIXEL_TYPE.HALF_FLOAT) {
			return halfFloatArray;
		} else {
			const uint8Array = new Uint8Array(length);
			for (let i = 0; i < length; i++) {
				uint8Array[i] = Math.round(t3d.MathUtils.fromHalfFloat(halfFloatArray[i]) * 255);
			}
			return uint8Array;
		}
	}

	const vectorScratch = /* #__PURE__ */new t3d.Vector3();
	const vectorScratch2$3 = /* #__PURE__ */new t3d.Vector3();
	function getAltitudeCorrectionOffset(cameraPosition, bottomRadius, ellipsoid, result) {
		const surfacePosition = ellipsoid.getPositionToSurfacePoint(cameraPosition, vectorScratch);
		return surfacePosition != null ? getOsculatingSphereCenter(ellipsoid, surfacePosition, bottomRadius, result).negate() : result.setScalar(0);
	}
	function getOsculatingSphereCenter(ellipsoid, surfacePosition, radius, result) {
		const a2 = ellipsoid.radius.x ** 2;
		const b2 = ellipsoid.radius.z ** 2;
		const normal = vectorScratch2$3.set(surfacePosition.x / a2, surfacePosition.y / a2, surfacePosition.z / b2).normalize();
		return result.copy(normal.multiplyScalar(-radius).add(surfacePosition));
	}

	function getScatteringCoefficient(wavelengths, skyTint, atmosphereThickness, result) {
		// Sky Tint shifts the value of Wavelengths
		const variableRangeWavelengths = _vec3_1.set(t3d.MathUtils.lerp(wavelengths.x + 150, wavelengths.x - 150, skyTint.r), t3d.MathUtils.lerp(wavelengths.y + 150, wavelengths.y - 150, skyTint.g), t3d.MathUtils.lerp(wavelengths.z + 150, wavelengths.z - 150, skyTint.b));
		variableRangeWavelengths.x = t3d.MathUtils.clamp(variableRangeWavelengths.x, 380, 780);
		variableRangeWavelengths.y = t3d.MathUtils.clamp(variableRangeWavelengths.y, 380, 780);
		variableRangeWavelengths.z = t3d.MathUtils.clamp(variableRangeWavelengths.z, 380, 780);

		// Evaluate Beta Rayleigh function is based on A.J.Preetham

		const WL = variableRangeWavelengths.multiplyScalar(1e-9); // nano meter unit

		const n = 1.0003; // the index of refraction of air
		const N = 2.545e25; // molecular density at sea level
		const pn = 0.035; // depolatization factor for standard air

		const waveLength4 = _vec3_2.set(Math.pow(WL.x, 4), Math.pow(WL.y, 4), Math.pow(WL.z, 4));
		const delta = waveLength4.multiplyScalar(3.0 * N * (6.0 - 7.0 * pn));
		const ray = 8 * Math.pow(Math.PI, 3) * Math.pow(n * n - 1.0, 2) * (6.0 + 3.0 * pn);
		result.set(ray / delta.x, ray / delta.y, ray / delta.z);

		// Atmosphere Thickness ( Rayleigh ) scale
		const Km = 1000.0; // kilo meter unit
		result.multiplyScalar(Km * atmosphereThickness);
		return result;
	}
	const _vec3_1 = new t3d.Vector3();
	const _vec3_2 = new t3d.Vector3();

	function safeSqrt(a) {
		return Math.sqrt(Math.max(a, 0));
	}
	function clampDistance(d) {
		return Math.max(d, 0);
	}
	function rayIntersectsGround(atmosphere, r, mu) {
		const {
			bottomRadius
		} = atmosphere;
		return mu < 0 && r ** 2 * (mu ** 2 - 1) + bottomRadius ** 2 >= 0;
	}
	function distanceToTopAtmosphereBoundary(atmosphere, r, mu) {
		const {
			topRadius
		} = atmosphere;
		const discriminant = r ** 2 * (mu ** 2 - 1) + topRadius ** 2;
		return clampDistance(-r * mu + safeSqrt(discriminant));
	}
	function getTextureCoordFromUnitRange(x, textureSize) {
		return 0.5 / textureSize + x * (1 - 1 / textureSize);
	}

	const vectorScratch1$2 = /* #__PURE__ */new t3d.Vector3();
	const vectorScratch2$2 = /* #__PURE__ */new t3d.Vector3();
	const vectorScratch3 = /* #__PURE__ */new t3d.Vector3();
	function getImageData(texture) {
		if (texture.image.data) {
			return texture.image.data;
		}
		if (texture.userData.imageData) {
			return texture.userData.imageData;
		}
		return undefined;
	}
	function samplePixel(data, index, result) {
		const dataIndex = index * 4; // Assume RGBA
		return result.fromArray(data, dataIndex, true);
	}
	function sampleTexture(texture, uv, result) {
		const data = getImageData(texture);
		if (data == null) {
			return result.setScalar(0);
		}
		const {
			width,
			height
		} = texture.image;
		const x = t3d.MathUtils.clamp(uv.x, 0, 1) * (width - 1);
		const y = t3d.MathUtils.clamp(uv.y, 0, 1) * (height - 1);
		const xi = Math.floor(x);
		const yi = Math.floor(y);
		const tx = x - xi;
		const ty = y - yi;
		const sx = tx;
		const sy = ty;
		const rx0 = xi % width;
		const rx1 = (rx0 + 1) % width;
		const ry0 = yi % height;
		const ry1 = (ry0 + 1) % height;
		const v00 = samplePixel(data, ry0 * width + rx0, vectorScratch1$2);
		const v10 = samplePixel(data, ry0 * width + rx1, vectorScratch2$2);
		const nx0 = v00.lerp(v10, sx);
		const v01 = samplePixel(data, ry1 * width + rx0, vectorScratch2$2);
		const v11 = samplePixel(data, ry1 * width + rx1, vectorScratch3);
		const nx1 = v01.lerp(v11, sx);
		return result.copy(nx0.lerp(nx1, sy));
	}

	function getUvFromRMuS(atmosphere, r, muS, result) {
		const {
			topRadius,
			bottomRadius
		} = atmosphere;
		const xR = (r - bottomRadius) / (topRadius - bottomRadius);
		const xMuS = muS * 0.5 + 0.5;
		return result.set(getTextureCoordFromUnitRange(xMuS, IRRADIANCE_TEXTURE_WIDTH), getTextureCoordFromUnitRange(xR, IRRADIANCE_TEXTURE_HEIGHT));
	}

	// Our target is: (1 + dot(n, p)) * 0.5
	// Constant term: L0 * sqrt(π)/2 == 0.5
	// Linear term: L1 * π/3 * sqrt(3)/sqrt(π) == n/2
	// See: https://github.com/mrdoob/three.js/blob/r170/src/math/SphericalHarmonics3.js#L85
	// See also: https://www.ppsloan.org/publications/StupidSH36.pdf
	const L0_COEFF = 1 / Math.sqrt(Math.PI);
	const L1_COEFF = Math.sqrt(3) / (2 * Math.sqrt(Math.PI));
	const vectorScratch1$1 = /* #__PURE__ */new t3d.Vector3();
	const vectorScratch2$1 = /* #__PURE__ */new t3d.Vector3();
	const uvScratch$1 = /* #__PURE__ */new t3d.Vector2();
	function getSkyLightSH(irradianceTexture, worldPosition, sunDirection, result = new t3d.SphericalHarmonics3(), ellipsoid, atmosphere = AtmosParameters.DEFAULT) {
		const cameraPositionECEF = vectorScratch1$1.copy(worldPosition);
		const r = cameraPositionECEF.getLength();
		const muS = cameraPositionECEF.dot(sunDirection) / r;
		const uv = getUvFromRMuS(atmosphere, r, muS, uvScratch$1);
		const irradiance = sampleTexture(irradianceTexture, uv, vectorScratch2$1);
		irradiance.multiply(atmosphere.skyRadianceToRelativeLuminance);
		const normal = ellipsoid.getPositionToNormal(cameraPositionECEF, vectorScratch1$1);
		const coefficients = result.coefficients;
		coefficients[0].copy(irradiance).multiplyScalar(L0_COEFF);
		coefficients[1].copy(irradiance).multiplyScalar(L1_COEFF * normal.y);
		coefficients[2].copy(irradiance).multiplyScalar(L1_COEFF * normal.z);
		coefficients[3].copy(irradiance).multiplyScalar(L1_COEFF * normal.x);
	}

	function getUvFromRMu(atmosphere, r, mu, result) {
		const {
			topRadius,
			bottomRadius
		} = atmosphere;
		const H = Math.sqrt(topRadius ** 2 - bottomRadius ** 2);
		const rho = safeSqrt(r ** 2 - bottomRadius ** 2);
		const d = distanceToTopAtmosphereBoundary(atmosphere, r, mu);
		const dMin = topRadius - r;
		const dMax = rho + H;
		const xmu = (d - dMin) / (dMax - dMin);
		const xr = rho / H;
		return result.set(getTextureCoordFromUnitRange(xmu, TRANSMITTANCE_TEXTURE_WIDTH), getTextureCoordFromUnitRange(xr, TRANSMITTANCE_TEXTURE_HEIGHT));
	}
	const vectorScratch1 = /* #__PURE__ */new t3d.Vector3();
	const vectorScratch2 = /* #__PURE__ */new t3d.Vector3();
	const uvScratch = /* #__PURE__ */new t3d.Vector2();
	function getSunLightColor(transmittanceTexture, worldPosition, sunDirection, target = new t3d.Color3(), atmosphere = AtmosParameters.DEFAULT) {
		const camera = vectorScratch1.copy(worldPosition);
		const transmittance = vectorScratch2;
		let r = camera.getLength();
		let rmu = camera.dot(sunDirection);
		const {
			topRadius
		} = atmosphere;
		const distanceToTopAtmosphereBoundary = -rmu - Math.sqrt(rmu ** 2 - r ** 2 + topRadius ** 2);
		if (distanceToTopAtmosphereBoundary > 0) {
			r = topRadius;
			rmu += distanceToTopAtmosphereBoundary;
		}
		if (r > topRadius) {
			transmittance.set(1, 1, 1);
		} else {
			const mu = rmu / r;
			const rayRMuIntersectsGround = rayIntersectsGround(atmosphere, r, mu);
			if (rayRMuIntersectsGround) {
				transmittance.setScalar(0);
			} else {
				const uv = getUvFromRMu(atmosphere, r, mu, uvScratch);
				sampleTexture(transmittanceTexture, uv, transmittance);
			}
		}
		const radiance = transmittance.multiply(atmosphere.solarIrradiance).multiply(atmosphere.sunRadianceToRelativeLuminance);
		return target.setRGB(radiance.x, radiance.y, radiance.z);
	}

	exports.AtmosFogEffect = AtmosFogEffect;
	exports.AtmosLUTsGenerator = AtmosLUTsGenerator;
	exports.AtmosLUTsLoader = AtmosLUTsLoader;
	exports.AtmosSky = AtmosSky;
	exports.getAltitudeCorrectionOffset = getAltitudeCorrectionOffset;
	exports.getScatteringCoefficient = getScatteringCoefficient;
	exports.getSkyLightSH = getSkyLightSH;
	exports.getSunLightColor = getSunLightColor;

}));

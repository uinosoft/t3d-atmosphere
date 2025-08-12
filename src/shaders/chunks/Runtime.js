export const Runtime = /* glsl */ `
bool RayIntersectsGround(float r, float mu) {
	return mu < 0.0 && r * r * (mu * mu - 1.0) + atmosphere.bottom_radius * atmosphere.bottom_radius >= 0.0;
}

bool RayIntersectsGround(vec3 camera, vec3 view_ray) {
	float r = length(camera);
	float mu = dot(camera, view_ray) / r;
	return mu < 0.0 && r * r * (mu * mu - 1.0) + atmosphere.bottom_radius * atmosphere.bottom_radius >= 0.0;
}

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

vec2 RaySphereIntersections(const vec3 camera, const vec3 direction, const float radius) {
	float b = 2.0 * dot(direction, camera);
	float c = dot(camera, camera) - radius * radius;
	float discriminant = b * b - 4.0 * c;
	float Q = sqrt(discriminant);
	return vec2(-b - Q, -b + Q) * 0.5;
}

bool ClipAtBottomAtmosphere(vec3 view_ray, inout vec3 camera, inout vec3 point) {
	const float eps = 0.0;
	float bottom_radius = atmosphere.bottom_radius + eps;
	float r_camera = length(camera);
	float r_point = length(point);
	bool camera_below = r_camera < bottom_radius;
	bool point_below = r_point < bottom_radius;
	if (camera_below && point_below) {
		return false;
	}
	vec2 t = RaySphereIntersections(camera, view_ray, bottom_radius);
	vec3 intersection = camera + view_ray * (camera_below ? t.y : t.x);
	if (camera_below) {
		camera = intersection;
	} else if (point_below) {
		point = intersection;
	}
	return true;
}

vec3 ClosestPointOnRay(const vec3 camera, const vec3 point) {
  vec3 ray = point - camera;
  float t = clamp(-dot(camera, ray) / dot(ray, ray), 0.0, 1.0);
  return camera + t * ray;
}

vec3 GetSkyRadiance(vec3 camera, vec3 view_ray, vec3 sun_direction, bool clamp_mu_at_horizon, out vec3 transmittance) {
	float r = length(camera);
	if (!clamp_mu_at_horizon && r < atmosphere.bottom_radius) {
		r = atmosphere.bottom_radius;
		camera = normalize(camera) * r;
	}
	float rmu = dot(camera, view_ray);

	float distance_to_top_atmosphere_boundary = -rmu - sqrt(rmu * rmu - r * r + atmosphere.top_radius * atmosphere.top_radius);
	
	if (distance_to_top_atmosphere_boundary > 0.0) {
		camera = camera + view_ray * distance_to_top_atmosphere_boundary;
		r = atmosphere.top_radius;
		rmu += distance_to_top_atmosphere_boundary;
	} else if (r > atmosphere.top_radius) {
		transmittance = vec3(1.0);
		return vec3(0.0);
	}

	float mu = rmu / r;
	if (clamp_mu_at_horizon) {
		float mu_horizon = -SafeSqrt(1.0 -
			(atmosphere.bottom_radius * atmosphere.bottom_radius) / (r * r));
		mu = max(rmu / r, mu_horizon + 0.001);
	}
	float mu_s = dot(camera, sun_direction) / r;
	float nu = dot(view_ray, sun_direction);

	bool ray_r_mu_intersects_ground = RayIntersectsGround(r, mu);

	transmittance = ray_r_mu_intersects_ground
		? vec3(0.0)
		: GetTransmittanceToTopAtmosphereBoundary(r, mu);

	vec3 single_mie_scattering;
	vec3 scattering = GetCombinedScattering(r, mu, mu_s, nu, ray_r_mu_intersects_ground, single_mie_scattering);

	return scattering * RayleighPhaseFunction(nu) +
		single_mie_scattering * MiePhaseFunction(atmosphere.mie_phase_function_g, nu);
}

vec3 GetSkyRadianceToPoint(vec3 camera, vec3 point, vec3 sun_direction, out vec3 transmittance) {
	if (length(ClosestPointOnRay(camera, point)) > atmosphere.top_radius) {
		transmittance = vec3(1.0);
		return vec3(0.0);
	}

	vec3 view_ray = normalize(point - camera);
	if (!ClipAtBottomAtmosphere(view_ray, camera, point)) {
		transmittance = vec3(1.0);
		return vec3(0.0);
	}

	float r = length(camera);
	float rmu = dot(camera, view_ray);

	float distance_to_top_atmosphere_boundary = -rmu - 
		SafeSqrt(rmu * rmu - r * r + 
		atmosphere.top_radius * atmosphere.top_radius);

	// If the viewer is in space and the view ray intersects the atmosphere, move
	// the viewer to the top atmosphere boundary (along the view ray):
	if (distance_to_top_atmosphere_boundary > 0.0) {
		camera = camera + view_ray * distance_to_top_atmosphere_boundary;
		r = atmosphere.top_radius;
		rmu += distance_to_top_atmosphere_boundary;
	}

	float mu = rmu / r;
	float mu_s = dot(camera, sun_direction) / r;
	float nu = dot(view_ray, sun_direction);
	float d = length(point - camera);
	bool ray_r_mu_intersects_ground = RayIntersectsGround(r, mu);

	// Hack to avoid rendering artifacts near the horizon, due to finite
	// atmosphere texture resolution and finite floating point precision.
	// See: https://github.com/ebruneton/precomputed_atmospheric_scattering/pull/32
	if (!ray_r_mu_intersects_ground) {
		float mu_horizon = -SafeSqrt(1.0 - 
			(atmosphere.bottom_radius * atmosphere.bottom_radius) / (r * r));
		mu = max(mu, mu_horizon + 0.004);
	}

	transmittance = GetTransmittance(r, mu, d, ray_r_mu_intersects_ground);

	vec3 single_mie_scattering;
	vec3 scattering = GetCombinedScattering(r, mu, mu_s, nu, ray_r_mu_intersects_ground, single_mie_scattering);

	d = max(d, 0.0);
	float r_p = ClampRadius(sqrt(d * d + 2.0 * r * mu * d + r * r));
	float mu_p = (r * mu + d) / r_p;
	float mu_s_p = (r * mu_s + d * nu) / r_p;

	vec3 single_mie_scattering_p;
	vec3 scattering_p = GetCombinedScattering(r_p, mu_p, mu_s_p, nu, ray_r_mu_intersects_ground, single_mie_scattering_p);

	// Combine the lookup results to get the scattering between camera and point.
	scattering = scattering - transmittance * scattering_p;
	single_mie_scattering = single_mie_scattering - transmittance * single_mie_scattering_p;

	single_mie_scattering = GetMie(vec4(scattering, single_mie_scattering.r));

	// Hack to avoid rendering artifacts when the sun is below the horizon.
	single_mie_scattering = single_mie_scattering * smoothstep(float(0.0), float(0.01), mu_s);

	return scattering * RayleighPhaseFunction(nu) + 
		single_mie_scattering * MiePhaseFunction(atmosphere.mie_phase_function_g, nu);
}

vec3 GetSunAndSkyIrradiance(vec3 point, vec3 normal, vec3 sun_direction, out vec3 sky_irradiance) {
	float r = length(point);
	float mu_s = dot(point, sun_direction) / r;

	// Indirect irradiance (approximated if the surface is not horizontal).
	sky_irradiance = GetIrradiance(r, mu_s) * (1.0 + dot(normal, point) / r) * 0.5;

	// Direct irradiance.
	return atmosphere.solar_irradiance *
		GetTransmittanceToSun(r, mu_s) *
		max(dot(normal, sun_direction), 0.0);
}
`;
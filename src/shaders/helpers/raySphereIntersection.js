export const raySphereIntersection = /* glsl */ `
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

void raySphereIntersections(
	const vec3 origin,
	const vec3 direction,
	const vec3 center,
	const vec4 radius,
	out vec4 intersection1,
	out vec4 intersection2
) {
	vec3 a = origin - center;
	float b = 2.0 * dot(direction, a);
	vec4 c = dot(a, a) - radius * radius;
	vec4 discriminant = b * b - 4.0 * c;
	vec4 mask = step(discriminant, vec4(0.0));
	vec4 Q = sqrt(max(vec4(0.0), discriminant));
	intersection1 = mix((-b - Q) * 0.5, vec4(-1.0), mask);
	intersection2 = mix((-b + Q) * 0.5, vec4(-1.0), mask);
}

void raySphereIntersections(
	const vec3 origin,
	const vec3 direction,
	const vec4 radius,
	out vec4 intersection1,
	out vec4 intersection2
) {
	raySphereIntersections(origin, direction, vec3(0.0), radius, intersection1, intersection2);
}
`;
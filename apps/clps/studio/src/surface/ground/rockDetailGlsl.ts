/**
 * Surface detail on rocks, below what the mesh carries: pits, grain and small fracture facets as a tilt of the shading
 * normal from three octaves of 3D value noise (4 cm, 1.5 cm and 6 mm wavelengths). Each octave fades out when the pixel
 * footprint approaches its wavelength, so nothing shimmers at a distance. The banked regolith at a rock's base is smooth.
 */
export const rockDetailGlsl = /* glsl */ `
float rockHash31(vec3 cell) {
  uvec3 q = uvec3(ivec3(cell));
  uint h = q.x * 1597334673u ^ q.y * 3812015801u ^ q.z * 2654435761u;
  h = (h ^ (h >> 15u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  h ^= h >> 16u;
  return float(h) * (2.0 / 4294967295.0) - 1.0;
}

float rockNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = x - i;
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = rockHash31(i);
  float b = rockHash31(i + vec3(1.0, 0.0, 0.0));
  float c = rockHash31(i + vec3(0.0, 1.0, 0.0));
  float d = rockHash31(i + vec3(1.0, 1.0, 0.0));
  float e = rockHash31(i + vec3(0.0, 0.0, 1.0));
  float g = rockHash31(i + vec3(1.0, 0.0, 1.0));
  float h = rockHash31(i + vec3(0.0, 1.0, 1.0));
  float k = rockHash31(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}

/* Roughness height in metres at p for a pixel footprint of 'footprint' metres. */
float rockRoughness(vec3 p, float footprint) {
  float height = 0.0;
  float wavelength = 0.04;
  for (int k = 0; k < 3; k++) {
    float weight = 1.0 - smoothstep(0.15, 0.5, footprint / wavelength);
    if (weight <= 0.0) break;
    // Fracture facets read better than smooth lumps: fold the noise into creases.
    float n = rockNoise(p / wavelength + float(k) * 11.7);
    height += weight * wavelength * 0.28 * (0.6 * n + 0.4 * (1.0 - 2.0 * abs(n)));
    wavelength *= 0.38;
  }
  return height;
}

vec3 rockShadingNormal(vec3 p, vec3 n, float footprint, float dust) {
  if (footprint > 0.1) return n;
  vec3 t = normalize(abs(n.y) < 0.9 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(n, t);
  float e = max(footprint, 0.002);
  float h0 = rockRoughness(p, footprint);
  float ht = rockRoughness(p + t * e, footprint);
  float hb = rockRoughness(p + b * e, footprint);
  vec2 g = vec2(ht - h0, hb - h0) / e;
  g *= 1.0 - 0.85 * dust;
  g *= min(1.0, 0.8 / max(length(g), 1.0e-4));
  return normalize(n - g.x * t - g.y * b);
}
`;

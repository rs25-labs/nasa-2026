/**
 * Regolith roughness below the mesh, as a slope field. Height is a sum of smooth noise octaves from 64 cm to
 * 4 cm wavelength fixed to the map plane (so it never swims); only the gradient is used, as a tilt of the
 * shading normal. Each octave fades out as the pixel footprint on the ground approaches half its wavelength,
 * so nothing aliases or shimmers and distant ground returns to its mesh normal.
 */
export const MICRO = {
  octaves: 5,
  longestWavelengthM: 0.64,
  /** Gradient scale per octave (rise over run). */
  slope: 0.035,
  /** Fresh-crater brightening of albedo at full immaturity. */
  maturityGain: 0.3,
} as const;

export function microGlsl(): string {
  return /* glsl */ `
#define LML_MICRO_OCTAVES ${MICRO.octaves}
#define LML_MICRO_LONGEST ${MICRO.longestWavelengthM}
#define LML_MICRO_SLOPE ${MICRO.slope}
#define LML_MATURITY_GAIN ${MICRO.maturityGain}

float lmlHash21(vec2 cell) {
  uvec2 q = uvec2(ivec2(cell));
  uint h = q.x * 1597334673u ^ q.y * 3812015801u;
  h = (h ^ (h >> 15u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  h ^= h >> 16u;
  return float(h) * (2.0 / 4294967295.0) - 1.0;
}

/* Value noise in [-1, 1] and its gradient. */
vec3 lmlNoiseD(vec2 x) {
  vec2 i = floor(x);
  vec2 f = x - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = lmlHash21(i);
  float b = lmlHash21(i + vec2(1.0, 0.0));
  float c = lmlHash21(i + vec2(0.0, 1.0));
  float d = lmlHash21(i + vec2(1.0, 1.0));
  float k = a - b - c + d;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y, du * (vec2(b - a, c - a) + k * u.yx));
}

/* Gradient (d/dx, d/dz) of the roughness height at map-fixed position xz for a pixel footprint of 'footprint' metres. */
vec2 lmlMicroGradient(vec2 xz, float footprint) {
  vec2 gradient = vec2(0.0);
  float wavelength = LML_MICRO_LONGEST;
  mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
  mat2 frame = mat2(1.0);
  for (int k = 0; k < LML_MICRO_OCTAVES; k++) {
    float weight = smoothstep(3.0 * footprint, 8.0 * footprint, wavelength);
    if (weight <= 0.0) break;
    vec3 n = lmlNoiseD(frame * xz / wavelength + float(k) * 17.31);
    // d/d(world) of n(frame * xz / wavelength) is transpose(frame) * grad / wavelength; amplitude is wavelength-proportional,
    // so every octave contributes the same slope.
    gradient += weight * LML_MICRO_SLOPE * (transpose(frame) * n.yz);
    wavelength *= 0.5;
    frame = turn * frame;
  }
  return gradient;
}
`;
}

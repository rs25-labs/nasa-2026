import * as THREE from 'three';
import { DETAIL_FIRST_TEXELS, DETAIL_FULL_TEXELS, OCTAVE_REPRESENTATIVE } from './craterBands';
import { TILE_OCTAVES, TILE_PERIODS } from './smallCraterTile';
import { CRATERS, CRATER_STEP, cumulativeDensity, octaveDiameter } from './craters';

/**
 * The small end of the crater field, evaluated per fragment from the same hashed cells and profile that `craters.ts` stamps on the
 * CPU. A level's baked detail grid carries craters of at least `DETAIL_FIRST_TEXELS` of its own texels; the smaller ones are summed
 * here as a slope (the gradient of the crater relief), for any level. Each crater is weighted by its size against the pixel
 * footprint (it fades out before it can alias), so the look depends on distance from the camera and not on which level a fragment
 * belongs to. Craters are weighted by D exactly as the CPU does (data weight, detail band), so nothing is counted twice or lost.
 */

/** The shader draws at most this many craters from a cell (the CPU allows 40; the chance of more is under one per cent). */
const POISSON_TERMS = 10;

export function craterTable(): THREE.Vector4[] {
  const table: THREE.Vector4[] = [];
  for (let k = 0; k < CRATERS.octaves; k += 1) {
    const dMin = octaveDiameter(k);
    const cell = CRATERS.cellFactor * dMin;
    const slope = dMin >= CRATERS.breakDiameterM ? CRATERS.slopeLarge : CRATERS.slopeSmall;
    const lambda = (cumulativeDensity(dMin) - cumulativeDensity(2 * dMin)) * cell * cell;
    let p = Math.exp(-lambda);
    let cumulative = p;
    const terms: number[] = [];
    for (let n = 0; n < 12; n += 1) {
      terms.push(n < POISSON_TERMS ? cumulative : 2);
      p *= lambda / (n + 1);
      cumulative += p;
    }
    table.push(new THREE.Vector4(1 - 2 ** -slope, slope, 0, 0));
    for (let v = 0; v < 3; v += 1) table.push(new THREE.Vector4(terms[4 * v], terms[4 * v + 1], terms[4 * v + 2], terms[4 * v + 3]));
  }
  return table;
}

export function craterGlsl(): string {
  const octaves = CRATERS.octaves;
  return /* glsl */ `
#define LML_CRATER_OCTAVES ${octaves}
uniform vec4 lmlCraterTable[${octaves * 4}];
uniform vec3 lmlCraterMap;

uint lmlCraterHash(int i, int j, int seed) {
  uint h = uint(i) * 0x27d4eb2du ^ uint(j) * 0x165667b1u ^ uint(seed) * 0x9e3779b1u;
  h ^= h >> 15u;
  h *= 0x85ebca6bu;
  h ^= h >> 13u;
  h *= 0xc2b2ae35u;
  h ^= h >> 16u;
  return h;
}

uint lmlCraterChain(uint h) {
  uint x = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  x = (x ^ (x >> 12u)) * 0x297a2d39u;
  return x ^ (x >> 15u);
}

float lmlCraterUnit(uint h) {
  return float(h) * (1.0 / 4294967296.0);
}

/* Crater relief at normalised radius x and its derivative (y); the same profile as craters.ts, tapered to zero by 1.5 radii. */
vec2 lmlCraterProfile(float x, float depth, float rim, float rounding) {
  float low = 1.0 - rounding;
  float high = 1.0 + rounding;
  float bowl = -depth + (depth + rim) * x * x;
  float dBowl = 2.0 * (depth + rim) * x;
  float x3 = x * x * x;
  float outer = rim / x3;
  float dOuter = -3.0 * rim / (x3 * x);
  vec2 v;
  if (x <= low) {
    v = vec2(bowl, dBowl);
  } else if (x >= high) {
    v = vec2(outer, dOuter);
  } else {
    float t = clamp((x - low) / (high - low), 0.0, 1.0);
    float s = t * t * (3.0 - 2.0 * t);
    float ds = 6.0 * t * (1.0 - t) / (high - low);
    v = vec2((1.0 - s) * bowl + s * outer, (1.0 - s) * dBowl + s * dOuter + ds * (outer - bowl));
  }
  float t = clamp((x - 1.2) / 0.3, 0.0, 1.0);
  float w = 1.0 - t * t * (3.0 - 2.0 * t);
  float dw = -6.0 * t * (1.0 - t) / 0.3;
  return vec2(v.x * w, v.y * w + v.x * dw);
}

uniform highp sampler2DArray lmlCraterTile;
uniform vec4 lmlCraterTileXf[${TILE_OCTAVES}];
const float LML_TILE_PERIOD[${TILE_OCTAVES}] = float[${TILE_OCTAVES}](${TILE_PERIODS.map((value) => value.toFixed(1)).join(', ')});

/* Gradient (scene axes) of the smallest crater octaves from the repeating tile, filtered over the pixel footprint by the mip chain. */
vec2 lmlCraterTileGradient(vec2 scenePosition, float detailSpacing) {
  vec2 gradient = vec2(0.0);
  vec2 q = vec2(scenePosition.x, -scenePosition.y);
  float pixelSize = lmlCraterMap.z;
  for (int k = 0; k < ${TILE_OCTAVES}; k++) {
    float dMin = ${CRATERS.smallestDiameterM.toFixed(2)} * exp2(float(k));
    float weight = (1.0 - smoothstep(${DETAIL_FIRST_TEXELS.toFixed(1)} * detailSpacing, ${DETAIL_FULL_TEXELS.toFixed(1)} * detailSpacing, ${OCTAVE_REPRESENTATIVE.toFixed(2)} * dMin))
                 * (1.0 - smoothstep(2.5 * pixelSize, 4.0 * pixelSize, ${OCTAVE_REPRESENTATIVE.toFixed(2)} * dMin));
    if (weight <= 0.0) continue;
    vec4 xf = lmlCraterTileXf[k];
    vec2 t = vec2(xf.x * q.x - xf.y * q.y, xf.y * q.x + xf.x * q.y) + xf.zw;
    vec2 g = texture(lmlCraterTile, vec3(t / LML_TILE_PERIOD[k], float(k))).rg;
    vec2 gradMap = vec2(xf.x * g.x + xf.y * g.y, -xf.y * g.x + xf.x * g.y);
    gradient += weight * vec2(gradMap.x, -gradMap.y);
  }
  return gradient;
}

/*
 * Gradient (d/dx, d/dz of the relief, scene axes) of the craters smaller than the level's baked detail grid carries, at map
 * position 'map', for a pixel footprint of 'footprint' metres. 'detailSpacing' is the level's detail grid spacing.
 */
vec2 lmlCraterGradient(vec2 map, float footprint, float detailSpacing) {
  vec2 gradient = vec2(0.0);
  float pixelSize = lmlCraterMap.z;
  for (int k = 0; k < LML_CRATER_OCTAVES; k++) {
    float dMin = ${CRATERS.smallestDiameterM.toFixed(2)} * exp2(float(k));
    if (dMin >= 4.0 * pixelSize || dMin >= ${DETAIL_FULL_TEXELS.toFixed(1)} * detailSpacing) break;
    if (k < ${TILE_OCTAVES} || dMin <= 1.25 * footprint) continue;
    // The share of this octave the baked detail grid does not carry (complement of octaveDetailWeight in craters.ts).
    float octaveWeight = 1.0 - smoothstep(${DETAIL_FIRST_TEXELS.toFixed(1)} * detailSpacing, ${DETAIL_FULL_TEXELS.toFixed(1)} * detailSpacing, ${OCTAVE_REPRESENTATIVE.toFixed(2)} * dMin);
    if (octaveWeight <= 0.0) continue;
    float cell = ${CRATERS.cellFactor.toFixed(1)} * dMin;
    vec2 scaled = map / cell;
    ivec2 base = ivec2(floor(scaled));
    vec2 f = scaled - vec2(base);
    ivec2 side = ivec2(f.x < 0.5 ? -1 : 1, f.y < 0.5 ? -1 : 1);
    // A neighbouring cell can reach this point only when the point is within 1.65 * dMin (0.41 cells) of it.
    vec2 near = vec2(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    bool useX = near.x < 0.41;
    bool useY = near.y < 0.41;
    vec4 octave = lmlCraterTable[k * 4];
    float span = octave.x;
    float slopeExp = octave.y;
    vec4 cum0 = lmlCraterTable[k * 4 + 1];
    vec4 cum1 = lmlCraterTable[k * 4 + 2];
    vec4 cum2 = lmlCraterTable[k * 4 + 3];
    int seed = 1013 + k * 7919;
    for (int c = 0; c < 4; c++) {
      if (((c & 1) == 1 && !useX) || ((c >> 1) == 1 && !useY)) continue;
      ivec2 id = base + ivec2((c & 1) * side.x, (c >> 1) * side.y);
      uint h = lmlCraterHash(id.x, id.y, seed);
      float u = lmlCraterUnit(h);
      int count = 0;
      count = int(dot(vec4(greaterThan(vec4(u), cum0)) + vec4(greaterThan(vec4(u), cum1)) + vec4(greaterThan(vec4(u), cum2)), vec4(1.0)));
      for (int m = 0; m < 10; m++) {
        if (m >= count) break;
        uint hm = lmlCraterChain(h + uint(m + 1) * ${'0x' + CRATER_STEP.toString(16)}u);
        float ux = lmlCraterUnit(hm);
        hm = lmlCraterChain(hm);
        float uy = lmlCraterUnit(hm);
        hm = lmlCraterChain(hm);
        float uSize = lmlCraterUnit(hm);
        vec2 d = map - (vec2(id) + vec2(ux, uy)) * cell;
        if (dot(d, d) > 2.7 * dMin * dMin) continue;
        float diameter = dMin * pow(1.0 - uSize * span, -1.0 / slopeExp);
        float radius = 0.5 * diameter;
        if (dot(d, d) > 2.7 * radius * radius) continue;
        float weight = octaveWeight
                     * (1.0 - smoothstep(2.5 * pixelSize, 4.0 * pixelSize, diameter))
                     * smoothstep(2.5 * footprint, 4.5 * footprint, diameter);
        if (weight <= 0.0) continue;
        hm = lmlCraterChain(hm);
        float uAge = lmlCraterUnit(hm);
        hm = lmlCraterChain(hm);
        float uShape = lmlCraterUnit(hm);
        hm = lmlCraterChain(hm);
        float uAxis = lmlCraterUnit(hm);
        hm = lmlCraterChain(hm);
        float uAngle = lmlCraterUnit(hm);
        float fresh = pow(1.0 - uAge, 4.0) * min(1.0, sqrt(diameter / 30.0));
        float degradation = 1.0 - fresh;
        float depth = (0.05 + 0.15 * pow(fresh, 1.5)) * (0.85 + 0.3 * uShape) * diameter;
        float rim = 0.04 * fresh * fresh * (0.8 + 0.4 * uAxis) * diameter;
        float rounding = 0.03 + 0.4 * degradation;
        float ellipticity = 0.1 * uAxis * (0.4 + 0.6 * fresh) * (1.0 - degradation * 0.5);
        float angle = uAngle * LML_PI;
        float cs = cos(angle);
        float sn = sin(angle);
        float semiA = radius * (1.0 + ellipticity);
        float semiB = radius * (1.0 - ellipticity);
        float u1 = d.x * cs + d.y * sn;
        float v1 = -d.x * sn + d.y * cs;
        float invA = 1.0 / (semiA * semiA);
        float invB = 1.0 / (semiB * semiB);
        float q = sqrt(u1 * u1 * invA + v1 * v1 * invB);
        if (q >= 1.5 || q < 1.0e-4) continue;
        float dp = lmlCraterProfile(q, depth, rim, rounding).y;
        float dqU = u1 * invA / q;
        float dqV = v1 * invB / q;
        vec2 gradMap = dp * vec2(dqU * cs - dqV * sn, dqU * sn + dqV * cs);
        gradient += weight * vec2(gradMap.x, -gradMap.y);
      }
    }
  }
  return gradient;
}
`;
}

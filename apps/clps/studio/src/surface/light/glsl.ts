import { lightingDefines } from './constants';

/**
 * Shader code shared by the terrain, the bake passes and any later material.
 *
 * Geometry: everything is in scene metres. Height is scene Y, which already includes the curvature drop
 * (d^2 / 2R), so the Sun is a straight line in this frame and a point is shadowed when terrain toward the
 * Sun rises above that line. `slope` is rise over horizontal run toward a body.
 */
export function lightingGlsl(): string {
  return /* glsl */ `
${lightingDefines()}
#define LML_LEVELS 8
#define LML_TEXELS 257.0
const float LML_PI = 3.14159265358979;

uniform highp sampler2DArray lmlHeights;
uniform highp sampler2DArray lmlHorizon;
uniform highp sampler2DArray lmlBounce;
uniform highp sampler2DArray lmlBounceCoarse;
uniform highp sampler2DArray lmlBounceIn;
uniform vec4 lmlLevel[LML_LEVELS];
uniform float lmlMaxHeight;
uniform float lmlLinearHeights;
uniform vec3 lmlSunDirection;
uniform vec4 lmlSun;
uniform vec3 lmlEarthDirection;
uniform vec4 lmlEarth;
uniform float lmlEarthIrradiance;
uniform vec3 lmlEarthTint;
uniform highp sampler2DShadow lmlShadowMap0;
uniform mat4 lmlShadowMatrix0;
uniform vec3 lmlShadowParams0;
uniform highp sampler2DShadow lmlShadowMap1;
uniform mat4 lmlShadowMatrix1;
uniform vec3 lmlShadowParams1;
uniform highp sampler2DShadow lmlShadowMap2;
uniform mat4 lmlShadowMatrix2;
uniform vec3 lmlShadowParams2;
uniform highp sampler2DShadow lmlShadowMap3;
uniform mat4 lmlShadowMatrix3;
uniform vec3 lmlShadowParams3;
uniform highp sampler2DShadow lmlShadowMapRover;
uniform mat4 lmlShadowMatrixRover;
uniform vec3 lmlShadowParamsRover;
uniform vec3 lmlLampPos[2];
uniform vec3 lmlLampDir[2];
uniform float lmlLampOn;

/* Finest loaded level that contains xz, searching from level 'from'; -1 when none. */
int lmlFindLevel(vec2 xz, int from) {
  for (int k = 0; k < LML_LEVELS; k++) {
    if (k < from) continue;
    vec4 info = lmlLevel[k];
    if (info.z < 0.0) continue;
    vec2 d = abs(xz - info.xy);
    if (max(d.x, d.y) < info.z) return k;
  }
  return -1;
}

vec2 lmlTexelCoord(int k, vec2 xz) {
  vec4 info = lmlLevel[k];
  return (xz - info.xy + info.z) / info.w;
}

vec3 lmlTexUv(int k, vec2 xz) {
  return vec3((lmlTexelCoord(k, xz) + 0.5) / LML_TEXELS, float(k));
}

/* Bilinear height: cheap, used for long marches and gathers. */
float lmlHeightLinear(int k, vec2 xz) {
  if (lmlLinearHeights > 0.5) return texture(lmlHeights, lmlTexUv(k, xz)).r;
  vec2 t = clamp(lmlTexelCoord(k, xz), vec2(0.0), vec2(LML_TEXELS - 1.001));
  ivec3 base = ivec3(ivec2(floor(t)), k);
  vec2 f = fract(t);
  float a = texelFetch(lmlHeights, base, 0).r;
  float b = texelFetch(lmlHeights, base + ivec3(1, 0, 0), 0).r;
  float c = texelFetch(lmlHeights, base + ivec3(0, 1, 0), 0).r;
  float d = texelFetch(lmlHeights, base + ivec3(1, 1, 0), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/* Height on the very triangles the mesh draws (cell split along the b-c diagonal). */
float lmlHeightTriangle(int k, vec2 xz) {
  vec2 t = lmlTexelCoord(k, xz);
  vec2 cell = clamp(floor(t), vec2(0.0), vec2(LML_TEXELS - 2.0));
  vec2 f = clamp(t - cell, vec2(0.0), vec2(1.0));
  ivec3 base = ivec3(ivec2(cell), k);
  float a = texelFetch(lmlHeights, base, 0).r;
  float b = texelFetch(lmlHeights, base + ivec3(0, 1, 0), 0).r;
  float c = texelFetch(lmlHeights, base + ivec3(1, 0, 0), 0).r;
  if (f.x + f.y <= 1.0) return a + (c - a) * f.x + (b - a) * f.y;
  float d = texelFetch(lmlHeights, base + ivec3(1, 1, 0), 0).r;
  return d + (b - d) * (1.0 - f.x) + (c - d) * (1.0 - f.y);
}

/* Terrain height at xz from the finest level, or -1e5 when nothing is loaded there. */
float lmlGroundHeight(vec2 xz) {
  int k = lmlFindLevel(xz, 0);
  return k < 0 ? -1.0e5 : lmlHeightTriangle(k, xz);
}

/*
 * Largest slope (rise over run) of terrain above P toward 'dir', sampled at run distances t0 to t1 in
 * geometric steps. 'exact' reads the mesh triangles, otherwise bilinear heights. Samples use the finest
 * level that covers them and stop when the loaded terrain ends.
 */
float lmlMarchFrom(vec3 P, vec2 dir, float t0, float t1, int steps, bool exact, int firstLevel) {
  float best = -1.0e4;
  float ratio = pow(t1 / t0, 1.0 / float(max(steps - 1, 1)));
  float rise = lmlMaxHeight - P.y;
  float t = t0;
  int level = firstLevel;
  for (int i = 0; i < 128; i++) {
    if (i >= steps) break;
    vec2 xz = P.xz + dir * t;
    // Most steps stay on the level of the one before: test that first, search only when it has been left.
    vec4 here = lmlLevel[level];
    if (!(here.z >= 0.0 && max(abs(xz.x - here.x), abs(xz.y - here.y)) < here.z)) {
      level = lmlFindLevel(xz, level);
      if (level < 0) break;
    }
    // The mesh's own triangles matter within a few cells of the point; farther out a bilinear read is within the bias.
    float h = (exact && t < 4.0 * lmlLevel[level].w) ? lmlHeightTriangle(level, xz) : lmlHeightLinear(level, xz);
    best = max(best, (h - P.y - (LML_BIAS_M + LML_BIAS_TEXEL * lmlLevel[level].w)) / t);
    if (rise > 0.0 && rise / t < best) break;
    t *= ratio;
  }
  return best;
}

float lmlMarch(vec3 P, vec2 dir, float t0, float t1, int steps, bool exact) {
  return lmlMarchFrom(P, dir, t0, t1, steps, exact, 0);
}

/* Visible fraction of a disc of angular radius 'radius' when its centre is 'margin' above a straight horizon. */
float lmlDiscFraction(float margin, float radius) {
  float u = clamp(margin / radius, -1.0, 1.0);
  return 0.5 + (u * sqrt(1.0 - u * u) + asin(u)) / LML_PI;
}

/* 'body' is lmlSun or lmlEarth: (horizontal x, horizontal z, tan elevation, angular radius). */
float lmlFractionFromSlope(float slope, vec4 body) {
  return lmlDiscFraction(atan(body.z) - atan(slope), body.w);
}

/*
 * Visible fraction of the Sun's disc at P from terrain: the baked far horizon (beyond 12 grid cells),
 * interpolated, and a per-fragment march over the near range on the mesh triangles.
 */
float lmlSunVisibilityL(vec3 P, int level, int marchFrom) {
  if (level < 0) return 1.0;
  float far = texture(lmlHorizon, lmlTexUv(level, P.xz)).r;
  if (lmlFractionFromSlope(far, lmlSun) <= 0.0) return 0.0;
  // The baked full horizon (near and far) at the four texel corners around P: when the Sun is clearly above
  // or clearly below all four, the per-fragment march cannot change the answer, so skip it. Only fragments
  // near a shadow edge march.
  vec2 t = lmlTexelCoord(level, P.xz);
  ivec2 corner = clamp(ivec2(floor(t)), ivec2(0), ivec2(int(LML_TEXELS) - 2));
  float b0 = texelFetch(lmlHorizon, ivec3(corner, level), 0).b;
  float b1 = texelFetch(lmlHorizon, ivec3(corner + ivec2(1, 0), level), 0).b;
  float b2 = texelFetch(lmlHorizon, ivec3(corner + ivec2(0, 1), level), 0).b;
  float b3 = texelFetch(lmlHorizon, ivec3(corner + ivec2(1, 1), level), 0).b;
  float sunElevation = atan(lmlSun.z);
  float guard = lmlSun.w + LML_SKIP_GUARD;
  if (atan(max(max(b0, b1), max(b2, b3))) < sunElevation - guard) return 1.0;
  if (atan(min(min(b0, b1), min(b2, b3))) > sunElevation + guard) return 0.0;
  float spacing = lmlLevel[level].w;
  float near = lmlMarchFrom(P, lmlSun.xy, LML_NEAR_START * spacing, LML_NEAR_TEXELS * spacing, LML_NEAR_STEPS, true, marchFrom);
  return lmlFractionFromSlope(max(far, near), lmlSun);
}

/* Visible fraction of Earth's disc at P, from the baked horizon toward Earth. */
float lmlEarthVisibilityL(vec3 P, int level) {
  if (level < 0) return 1.0;
  float slope = texture(lmlHorizon, lmlTexUv(level, P.xz)).g;
  return lmlFractionFromSlope(slope, lmlEarth);
}

/*
 * One shadow cascade: x is the fraction of light reaching P, y is how much this map covers P (1 inside, falling to 0 at the
 * map's border, so cascades and the unshadowed ground beyond blend without a line). radiusTexels = 0 reads one bilinear
 * comparison (an edge one texel wide: knife-sharp at contact). Otherwise eight comparisons on a Poisson disc of that radius,
 * turned by a per-pixel and per-frame angle (the frame-to-frame average is what the eye sees), give the soft edge that a
 * shadow has far from its caster. The Sun's penumbra is 0.0093 times the distance from the caster, so the coarse cascades,
 * which serve far ground, have wide kernels and the finest does not.
 */
const vec2 LML_POISSON[8] = vec2[8](
  vec2(-0.613392, 0.617481), vec2(0.170019, -0.040254), vec2(-0.299417, 0.791925), vec2(0.645680, 0.493210),
  vec2(-0.651784, 0.717887), vec2(0.421003, 0.027070), vec2(-0.817194, -0.271096), vec2(-0.705374, -0.668203));
uniform float lmlShadowTurn;

vec2 lmlCascade(highp sampler2DShadow map, mat4 matrix, vec3 params, vec3 P, float radiusTexels) {
  vec4 clip = matrix * vec4(P, 1.0);
  vec3 uvz = clip.xyz / clip.w * 0.5 + 0.5;
  float border = max(abs(uvz.x - 0.5), abs(uvz.y - 0.5));
  float coverage = 1.0 - smoothstep(0.38, 0.47, border);
  if (coverage <= 0.0 || uvz.z > 1.0) return vec2(1.0, 0.0);
  float z = uvz.z - params.y;
  if (radiusTexels <= 0.0) return vec2(texture(map, vec3(uvz.xy, z)), coverage);
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float angle = 6.2831853 * fract(noise + lmlShadowTurn);
  vec2 c = vec2(cos(angle), sin(angle));
  mat2 turn = mat2(c.x, c.y, -c.y, c.x);
  float radius = radiusTexels * params.z;
  // Four taps at the kernel's edge first: where they agree (all lit or all shadowed) the pixel is not near a shadow edge and
  // the answer is already known; only edge pixels pay for the other four.
  float lit = texture(map, vec3(uvz.xy + turn * LML_POISSON[0] * radius, z)) + texture(map, vec3(uvz.xy + turn * LML_POISSON[3] * radius, z))
            + texture(map, vec3(uvz.xy + turn * LML_POISSON[6] * radius, z)) + texture(map, vec3(uvz.xy + turn * LML_POISSON[7] * radius, z));
  if (lit > 0.001 && lit < 3.999) {
    lit += texture(map, vec3(uvz.xy + turn * LML_POISSON[1] * radius, z)) + texture(map, vec3(uvz.xy + turn * LML_POISSON[2] * radius, z))
         + texture(map, vec3(uvz.xy + turn * LML_POISSON[4] * radius, z)) + texture(map, vec3(uvz.xy + turn * LML_POISSON[5] * radius, z));
    return vec2(lit * 0.125, coverage);
  }
  return vec2(lit * 0.25, coverage);
}

/* Fraction of light that reaches P past objects registered as shadow casters: four cascades, fine to coarse. */
float lmlObjectShadow(vec3 P) {
  float lit = 1.0;
  if (lmlShadowParams0.x > 0.5) {
    lit = 0.0;
    float rest = 1.0;
    vec2 c = lmlCascade(lmlShadowMap0, lmlShadowMatrix0, lmlShadowParams0, P, 0.0);
    lit += rest * c.x * c.y;
    rest *= 1.0 - c.y;
    if (rest > 0.0) {
      c = lmlCascade(lmlShadowMap1, lmlShadowMatrix1, lmlShadowParams1, P, 2.0);
      lit += rest * c.x * c.y;
      rest *= 1.0 - c.y;
    }
    if (rest > 0.0) {
      c = lmlCascade(lmlShadowMap2, lmlShadowMatrix2, lmlShadowParams2, P, 2.5);
      lit += rest * c.x * c.y;
      rest *= 1.0 - c.y;
    }
    if (rest > 0.0) {
      c = lmlCascade(lmlShadowMap3, lmlShadowMatrix3, lmlShadowParams3, P, 2.0);
      lit += rest * c.x * c.y;
      rest *= 1.0 - c.y;
    }
    lit += rest;
  }
  if (lmlShadowParamsRover.x > 0.5) {
    vec2 rover = lmlCascade(lmlShadowMapRover, lmlShadowMatrixRover, lmlShadowParamsRover, P, 1.5);
    lit *= rover.x * rover.y + (1.0 - rover.y);
  }
  return lit;
}

/*
 * Irradiance (relative to direct sunlight) at P from headlamp i, without the surface cosine: intensity over distance
 * squared, the beam's edge fade, and a short march along the ray to the lamp that tests it against the terrain.
 * L is the unit vector from P to the lamp. Zero when the lamps are off.
 */
float lmlLampIrradiance(int i, vec3 P, out vec3 L) {
  L = vec3(0.0, 1.0, 0.0);
  if (lmlLampOn < 0.5) return 0.0;
  vec3 d = P - lmlLampPos[i];
  float r2 = dot(d, d);
  if (r2 > LML_LAMP_RANGE * LML_LAMP_RANGE || r2 < 0.01) return 0.0;
  float r = sqrt(r2);
  L = -d / r;
  float cone = dot(d / r, lmlLampDir[i]);
  // An LED lamp behind a reflector: a bright core with a wide soft spill and no edge. Intensity falls as a Gaussian of the angle
  // off the axis (core sigma 12 degrees) plus a faint wide skirt (sigma 40 degrees), and fades to nothing toward the lamp's own
  // plane; distance falloff is the inverse square below.
  float theta = acos(clamp(cone, -1.0, 1.0));
  float beam = 0.88 * exp(-(theta * theta) / (2.0 * 0.21 * 0.21)) + 0.12 * exp(-(theta * theta) / (2.0 * 0.70 * 0.70));
  // Area lights around the hull add a faint even flood in every direction, so the ground beside and behind the vehicle is lit too.
  beam = beam * smoothstep(0.15, 0.45, cone) + 0.3;
  beam *= 1.0 - smoothstep(0.8 * LML_LAMP_RANGE, LML_LAMP_RANGE, r);
  // Below a few millionths of sunlight the lamp is lost in the ground's own bounce and earthshine: skip the terrain march.
  if (LML_LAMP_INTENSITY * beam / r2 < 4.0e-6) return 0.0;
  float open = 1.0;
  // Terrain shadows in the beam matter where the beam is strong; in the faint spill a shorter march is enough.
  if (r > 2.0) {
    int steps = LML_LAMP_INTENSITY * beam / r2 > 1.0e-4 ? 4 : 2;
    int level = 0;
    for (int k = 1; k <= 4; k++) {
      if (k > steps) break;
      float t = 0.04 + 0.92 * float(k) / float(steps + 1);
      vec3 q = mix(P, lmlLampPos[i], t);
      level = lmlFindLevel(q.xz, level);
      if (level < 0) break;
      float h = lmlHeightLinear(level, q.xz);
      open *= smoothstep(-0.05 - 0.01 * r * t, 0.02, q.y - h);
    }
  }
  // The lamps are an array of emitters, not a point: within a few metres the falloff levels off, so the hull beside them is not burnt out.
  return LML_LAMP_INTENSITY * beam * open / max(r2, 9.0);
}

/*
 * Regolith reflectance: Lommel-Seeliger with a two-term Henyey-Greenstein particle phase function and a
 * shadow-hiding opposition surge, normalised so that normal incidence at zero phase has radiance factor
 * LML_ALBEDO. Returns the BRDF; radiance = irradiance * mu0 * brdf. cosG is the cosine of the phase angle.
 */
float lmlPhase(float cosG) {
  float b = LML_PHASE_B;
  float back = (1.0 - b * b) / pow(1.0 + b * b - 2.0 * b * cosG, 1.5);
  float forward = (1.0 - b * b) / pow(1.0 + b * b + 2.0 * b * cosG, 1.5);
  return (1.0 - LML_PHASE_FWD) * back + LML_PHASE_FWD * forward;
}

float lmlSurge(float cosG) {
  float tanHalf = sqrt(max(1.0 - cosG, 0.0) / max(1.0 + cosG, 1.0e-4));
  return LML_SURGE_B0 / (1.0 + tanHalf / LML_SURGE_H);
}

float lmlBrdf(float mu0, float mu, float cosG) {
  float limb = 2.0 / (mu0 + mu);
  float particle = lmlPhase(cosG) * (1.0 + lmlSurge(cosG)) / (LML_PHASE_ZERO * (1.0 + LML_SURGE_B0));
  return (LML_ALBEDO / LML_PI) * limb * particle;
}

/*
 * Irradiance at P (relative to direct sunlight at normal incidence) from sunlit ground around it:
 * one bounce, Lambertian, gathered over rings of directions at firstRadius, 4x, 16x ... (each ring 4x the last) from the
 * baked outgoing-radiance texture. Evaluated once per texel in the bake, not per fragment. Each sample is weighted by the form factor
 * cos(receiver) cos(emitter) dA / r^2 and attenuated (smooth ramp, no hard cut) by a single mid-point height test of the path.
 */
vec4 lmlBounceIrradiance(vec3 P, vec3 N, float spacing) {
  float sum = 0.0;
  vec3 gradient = vec3(0.0);
  float firstRadius = max(1.5 * spacing, 0.6);
  for (int ring = 0; ring < LML_RINGS; ring++) {
    float radius = firstRadius * exp2(float(ring));
    // Rings are a factor 2 apart: each sample stands for the annulus from radius / sqrt 2 to radius * sqrt 2.
    float area = LML_PI * 1.5 * radius * radius / float(LML_AZIMUTHS);
    float phase0 = fract(float(ring) * 0.381966);
    for (int a = 0; a < LML_AZIMUTHS; a++) {
      float phi = 2.0 * LML_PI * (float(a) + phase0) / float(LML_AZIMUTHS);
      vec2 xz = P.xz + radius * vec2(cos(phi), sin(phi));
      int level = lmlFindLevel(xz, 0);
      if (level < 0) continue;
      float height = lmlHeightLinear(level, xz);
      vec3 d = vec3(xz.x - P.x, height - P.y, xz.y - P.z);
      float distance2 = dot(d, d);
      vec3 v = d * inversesqrt(distance2);
      float cosReceiver = dot(N, v);
      if (cosReceiver <= 0.0) continue;
      // Two height tests along the path (a third and two thirds of the way), each a smooth ramp, so a ridge between the two
      // patches blocks the light instead of leaking through the gap between samples.
      float open = 1.0;
      for (int m = 0; m < 2; m++) {
        if (m == 1 && radius < 6.0 * spacing) break;
        float t = m == 0 ? 0.4 : 0.75;
        vec2 mid = P.xz + (xz - P.xz) * t;
        int midLevel = lmlFindLevel(mid, 0);
        if (midLevel >= 0) {
          float clearance = P.y + d.y * t + 0.02 * radius - lmlHeightLinear(midLevel, mid);
          open *= smoothstep(-0.08 * radius - 0.3, 0.02 * radius + 0.1, clearance);
        }
      }
      if (open <= 0.0) continue;
      vec4 emitter;
      if (radius < 12.0 * lmlLevel[level].w) {
        emitter = textureLod(lmlBounce, lmlTexUv(level, xz), 0.0);
      } else {
        vec2 cell = lmlTexelCoord(level, xz) / 16.0;
        emitter = textureLod(lmlBounceCoarse, vec3((cell + 0.5) / 17.0, float(level)), 0.0);
      }
      emitter.r /= LML_BOUNCE_SCALE;
      float ny2 = 1.0 - emitter.g * emitter.g - emitter.b * emitter.b;
      vec3 n = normalize(vec3(emitter.g, sqrt(max(ny2, 0.0001)), emitter.b));
      float cosEmitter = max(dot(n, -v), 0.0);
      float groundArea = area / max(n.y, 0.2);
      float weight = open * emitter.r * cosEmitter * groundArea / distance2;
      sum += weight * cosReceiver;
      // How the irradiance changes when the receiver's normal tilts: the derivative of cosReceiver is the direction to the emitter.
      gradient += weight * v;
    }
  }
  return vec4(sum, gradient);
}

/* Irradiance from bounced sunlight at P, baked per texel of the finest level (see bake.ts), relative to direct sunlight. */
float lmlBounceIncidentL(vec3 P, int level) {
  if (level < 0) return 0.0;
  return texture(lmlBounceIn, lmlTexUv(level, P.xz)).r / LML_BOUNCE_SCALE;
}

/*
 * Bounced irradiance on a surface tilted from the geometric normal N to the shading normal Ns: the baked value at N plus its
 * baked derivative with respect to the normal, so ground in shadow keeps its crater and pebble relief in the light that reaches it.
 */
float lmlBounceIncidentTilted(vec3 P, int level, vec3 N, vec3 Ns) {
  if (level < 0) return 0.0;
  vec4 b = texture(lmlBounceIn, lmlTexUv(level, P.xz));
  return max(b.r + dot(Ns - N, b.gba), 0.0) / LML_BOUNCE_SCALE;
}

float lmlSunVisibility(vec3 P) { return lmlSunVisibilityL(P, lmlFindLevel(P.xz, 0), 0); }
float lmlEarthVisibility(vec3 P) { return lmlEarthVisibilityL(P, lmlFindLevel(P.xz, 0)); }
float lmlBounceIncident(vec3 P) { return lmlBounceIncidentL(P, lmlFindLevel(P.xz, 0)); }

/*
 * Radiance reflected toward the viewer at P: the Sun (terrain and object shadows, penumbra from the disc),
 * earthshine (Earth's phase and horizon), and bounced sunlight.
 * N is the geometric normal (visibility and bounce use it); Ns is the shading normal, which carries the
 * roughness below the mesh resolution (N itself when there is none); micro in 0..1 says how much of that
 * roughness is present, since rough facets also shadow each other near grazing sun. albedo scales the
 * whole result (immature or dark material). V is the unit vector from P to the viewer. Linear units where
 * sunlight at normal incidence is 1.
 */
vec3 lmlSurfaceRadianceMarch(vec3 P, vec3 N, vec3 Ns, vec3 V, float albedo, float micro, int level, int marchFrom) {
  float mu = max(dot(Ns, V), 0.02);
  vec3 radiance = vec3(0.0);
  float sunLit = 0.0;
  float mu0Geometric = dot(N, lmlSunDirection);
  if (mu0Geometric > 0.0) {
    sunLit = lmlSunVisibilityL(P, level, marchFrom);
    if (sunLit > 0.0) sunLit *= lmlObjectShadow(P);
    float mu0 = max(dot(Ns, lmlSunDirection), 0.0);
    float facetShadow = mix(1.0, smoothstep(0.0, 0.06, mu0Geometric), micro);
    radiance += vec3(mu0 * lmlBrdf(max(mu0, 0.02), mu, dot(lmlSunDirection, V)) * sunLit * facetShadow);
  }
  float muEarth = dot(Ns, lmlEarthDirection);
  if (dot(N, lmlEarthDirection) > 0.0 && muEarth > 0.0 && lmlEarthIrradiance > 0.0) {
    float earthLit = lmlEarthVisibilityL(P, level);
    radiance += lmlEarthTint * (lmlEarthIrradiance * earthLit * muEarth * lmlBrdf(muEarth, mu, dot(lmlEarthDirection, V)));
  }
  if (sunLit < LML_BOUNCE_SKIP) {
    radiance += vec3(LML_BOUNCE_ALBEDO / LML_PI * lmlBounceIncidentTilted(P, level, N, Ns));
  }
  if (lmlLampOn > 0.5) {
    for (int i = 0; i < 2; i++) {
      vec3 L;
      float e = lmlLampIrradiance(i, P, L);
      float mu0 = dot(Ns, L);
      if (e > 0.0 && dot(N, L) > 0.0 && mu0 > 0.0) radiance += vec3(e * mu0 * lmlBrdf(mu0, mu, dot(L, V)));
    }
  }
  return radiance * albedo;
}

vec3 lmlSurfaceRadianceLevel(vec3 P, vec3 N, vec3 Ns, vec3 V, float albedo, float micro, int level) {
  return lmlSurfaceRadianceMarch(P, N, Ns, V, albedo, micro, level, 0);
}

vec3 lmlSurfaceRadianceShaded(vec3 P, vec3 N, vec3 Ns, vec3 V, float albedo, float micro) {
  return lmlSurfaceRadianceLevel(P, N, Ns, V, albedo, micro, lmlFindLevel(P.xz, 0));
}

vec3 lmlSurfaceRadiance(vec3 P, vec3 N, vec3 V) {
  return lmlSurfaceRadianceShaded(P, N, N, V, 1.0, 0.0);
}
`;
}

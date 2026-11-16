import * as THREE from 'three';
import { lightingGlsl } from '../light/glsl';
import { lightingUniforms } from '../light/uniforms';

export type SurfaceKind = 'plain' | 'foil' | 'cells' | 'lens' | 'camera' | 'blanket' | 'mesh';

const KIND: Record<SurfaceKind, number> = { plain: 0, foil: 1, cells: 2, lens: 3, camera: 4, blanket: 5, mesh: 6 };

export interface RoverSurface {
  /** Diffuse colour of a dielectric (linear); for a metal the specular colour is `f0` and this is unused. */
  base: readonly [number, number, number];
  metal: number;
  roughness: number;
  /** Normal-incidence reflectance of a metal (linear). */
  f0?: readonly [number, number, number];
  kind?: SurfaceKind;
  /** 0 to 1: how much of the surface is coated in regolith. */
  dust?: number;
  /** Solar cells: columns and rows of cells across the panel's UV square. */
  cells?: readonly [number, number];
}

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vObj;
varying vec3 vObjNormal;
varying vec2 vUv;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vObj = position;
  vObjNormal = normal;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}`;

/**
 * Metal, foil, paint and glass lit by the same Sun, terrain horizon, object shadows, earthshine and bounce light as the
 * ground, with a GGX specular term. Specular only reflects things that exist: the Sun's disc, Earth, headlamps, and the
 * sunlit ground below (a radiance estimate from the Sun's elevation and the shadow state under the fragment). Everything
 * else is the black sky, so metals read dark with sharp highlights.
 */
const fragmentShader = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${lightingGlsl()}
uniform vec3 uBase;
uniform float uMetal;
uniform float uRough;
uniform vec3 uF0;
uniform float uKind;
uniform float uDust;
uniform vec2 uCells;
#define ROVER_TREAD_INNER 0.235
#define ROVER_TREAD_OUTER 0.262
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vObj;
varying vec3 vObjNormal;
varying vec2 vUv;

float hash31(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x), mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x), mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float crinkle(vec3 p) {
  return vnoise(p * 14.0) * 0.6 + vnoise(p * 33.0) * 0.3 + vnoise(p * 71.0) * 0.1;
}

float ggxD(float NoH, float a) {
  float a2 = a * a;
  float d = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / (LML_PI * d * d);
}
float smithV(float NoV, float NoL, float a) {
  float a2 = a * a;
  float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1.0e-5);
}
vec3 schlick(vec3 f0, float c) {
  return f0 + (vec3(1.0) - f0) * pow(1.0 - c, 5.0);
}

/* Radiance reflected toward V from a source in direction L delivering irradiance E (relative to normal-incidence sunlight). */
vec3 lit(vec3 L, float E, vec3 N, vec3 V, vec3 diffuseColor, vec3 f0, float a) {
  float NoL = dot(N, L);
  if (NoL <= 0.0 || E <= 0.0) return vec3(0.0);
  vec3 H = normalize(L + V);
  float NoV = max(dot(N, V), 1.0e-3);
  float NoH = max(dot(N, H), 0.0);
  float VoH = max(dot(V, H), 0.0);
  vec3 F = schlick(f0, VoH);
  vec3 specular = F * (ggxD(NoH, a) * smithV(NoV, NoL, a));
  vec3 diffuse = diffuseColor / LML_PI * (vec3(1.0) - F);
  return (diffuse + specular) * (NoL * E);
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 Ng = normalize(vNormal);
  if (!gl_FrontFacing) Ng = -Ng;
  vec3 N = Ng;
  vec3 base = uBase;
  vec3 f0 = uF0;
  float metal = uMetal;
  float rough = uRough;
  float emissive = 0.0;

  if (uKind > 0.5 && uKind < 1.5) {
    // Crinkled foil: the normal wobbles at a few centimetres.
    vec3 q = vObj;
    float e = 0.004;
    float h0 = crinkle(q);
    vec3 grad = vec3(crinkle(q + vec3(e, 0, 0)) - h0, crinkle(q + vec3(0, e, 0)) - h0, crinkle(q + vec3(0, 0, e)) - h0) / e;
    grad -= dot(grad, Ng) * Ng;
    N = normalize(Ng - 0.035 * grad);
  } else if (uKind > 1.5 && uKind < 2.5) {
    // Solar cells: dark cover glass over cells, silver bus bars and cell gaps.
    vec2 g = vUv * uCells;
    vec2 cell = abs(fract(g) - 0.5);
    vec2 w = fwidth(g) * 1.2;
    float gapX = smoothstep(0.5 - 0.03 - w.x, 0.5 - 0.03 + w.x, cell.x);
    float gapY = smoothstep(0.5 - 0.03 - w.y, 0.5 - 0.03 + w.y, cell.y);
    vec2 bus = abs(fract(g * vec2(3.0, 1.0) + vec2(0.5, 0.0)) - 0.5);
    float busLine = 1.0 - smoothstep(0.012, 0.012 + 3.0 * w.x, bus.x);
    float lineMask = max(max(gapX, gapY) * 0.9, busLine * 0.55 * (1.0 - max(gapX, gapY)));
    metal = lineMask;
    f0 = vec3(0.62, 0.62, 0.64);
    base = mix(base, vec3(0.0), lineMask);
    rough = mix(rough, 0.45, lineMask);
  }

  float tread = 0.0;
  if (uKind > 4.5 && uKind < 5.5) {
    // Thermal blanket and painted panels: seams every 28 cm (a few millimetres wide, slightly proud and darker), and a fine
    // crinkle of the surface that the lamps and the Sun rake across.
    vec3 on = abs(normalize(vObjNormal));
    vec3 q = vObj / 0.28 + 0.5;
    vec3 w = fwidth(vObj) / 0.28 * 1.5;
    vec3 d = abs(fract(q) - 0.5);
    vec3 line = 1.0 - smoothstep(vec3(0.007), vec3(0.007) + w, d);
    float seam = max(max(line.x * (1.0 - on.x), line.y * (1.0 - on.y)), line.z * (1.0 - on.z));
    vec3 q2 = vObj;
    float e = 0.004;
    float h0 = crinkle(q2);
    vec3 grad = vec3(crinkle(q2 + vec3(e, 0, 0)) - h0, crinkle(q2 + vec3(0, e, 0)) - h0, crinkle(q2 + vec3(0, 0, e)) - h0) / e;
    grad -= dot(grad, Ng) * Ng;
    N = normalize(Ng - 0.012 * grad + 0.0 * seam);
    base *= 1.0 - 0.45 * seam;
    rough = mix(rough, 0.8, seam);
  } else if (uKind > 5.5) {
    // Wheel mesh: a woven wire skin (5 mm weave) over the rim, dark in the weave gaps, bright on the wire crowns, packed with
    // regolith in the tread (the outer radius).
    float radial = length(vObj.yz);
    vec2 uvm = vec2(atan(vObj.y, vObj.z) * radial, vObj.x) / 0.005;
    vec2 fw = fwidth(uvm) + 1.0e-4;
    vec2 cellm = abs(fract(uvm) - 0.5);
    float crown = 1.0 - smoothstep(0.2, 0.2 + max(fw.x, fw.y) + 0.12, max(cellm.x, cellm.y) * 0.0 + min(cellm.x, cellm.y));
    float weave = mix(0.35, 1.0, clamp(crown * 1.6, 0.0, 1.0));
    f0 *= weave;
    rough = mix(0.55, rough, weave);
    tread = smoothstep(ROVER_TREAD_INNER, ROVER_TREAD_OUTER, radial);
  }

  float aboveGround = vWorld.y - max(lmlGroundHeight(vWorld.xz), -9.0e4);
  // Dust kicked up by the wheels coats the lower surfaces: heaviest right above the ground, gone by about 60 cm.
  float lowDust = 1.0 - smoothstep(0.1, 0.65, aboveGround);
  float dustAmount = clamp(uDust + 0.4 * lowDust * (0.5 + 0.5 * vnoise(vObj * 23.0)) + 0.55 * tread, 0.0, 1.0);

  if (dustAmount > 0.0) {
    float coat = dustAmount * (0.3 + 0.7 * vnoise(vObj * 41.0 + 3.0)) * (0.55 + 0.45 * smoothstep(-0.2, 0.9, Ng.y));
    coat = smoothstep(0.1, 0.7, coat);
    base = mix(base, vec3(0.085), coat);
    metal *= 1.0 - coat;
    rough = mix(rough, 0.92, coat);
  }

  if (uKind > 2.5 && uKind < 3.5) emissive = 10.0 * lmlLampOn * step(0.5, dot(Ng, lmlLampDir[0]));

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 P = vWorld + Ng * 0.012;
  int level = lmlFindLevel(P.xz, 0);
  vec3 diffuseColor = base * (1.0 - metal);
  vec3 f0v = mix(vec3(0.04), f0, metal);
  float a = max(rough * rough, 0.06);
  vec3 color = vec3(0.0);

  // Sun: terrain horizon, then the object shadow maps (the rover's own included).
  float sunTerrain = lmlSunVisibilityL(P, level, 0);
  if (sunTerrain > 0.0 && dot(Ng, lmlSunDirection) > -0.1) {
    float sun = sunTerrain * lmlObjectShadow(P);
    color += lit(lmlSunDirection, sun, N, V, diffuseColor, f0v, a);
  }
  // Earth.
  if (lmlEarthIrradiance > 0.0) {
    float earth = lmlEarthIrradiance * lmlEarthVisibilityL(P, level);
    color += lmlEarthTint * lit(lmlEarthDirection, earth, N, V, diffuseColor, f0v, a);
  }
  // Light from the ground below: radiance of the ground under this fragment as the lighting model computes it
  // for a flat patch (Lambert bounce albedo, Sun elevation, terrain and object shadow at the ground).
  float ground = lmlGroundHeight(vWorld.xz);
  vec3 groundPoint = vec3(vWorld.x, max(ground, -9.0e4) + 0.05, vWorld.z);
  float groundSun = lmlSunVisibilityL(groundPoint, level, 0) * lmlObjectShadow(groundPoint);
  float groundRadiance = LML_BOUNCE_ALBEDO / LML_PI * max(lmlSunDirection.y, 0.0) * groundSun;
  if (lmlLampOn > 0.5) {
    // The ground the headlamps light, a few metres ahead, is a bright floor the body sees: its radiance, from the lamps' irradiance there.
    vec3 aheadDirection = normalize(vec3(lmlLampDir[0].x, 0.0, lmlLampDir[0].z) + 1.0e-4);
    vec3 ahead = groundPoint + aheadDirection * 3.5;
    ahead.y = max(lmlGroundHeight(ahead.xz), -9.0e4) + 0.02;
    float lampGround = 0.0;
    for (int i = 0; i < 2; i++) {
      vec3 Ll;
      lampGround += lmlLampIrradiance(i, ahead, Ll) * max(Ll.y, 0.0);
    }
    groundRadiance += LML_BOUNCE_ALBEDO / LML_PI * lampGround * 0.7;
  }
  float down = 0.5 - 0.5 * N.y;
  float surround = lmlBounceIncidentL(P, level);
  color += diffuseColor / LML_PI * (LML_PI * groundRadiance * down + surround * (1.0 - down));
  vec3 R = reflect(-V, N);
  float t = clamp(0.5 - R.y / (0.3 + rough), 0.0, 1.0);
  float seesGround = t * t * (3.0 - 2.0 * t);
  float NoV = max(dot(N, V), 1.0e-3);
  color += schlick(f0v, NoV) * groundRadiance * seesGround / (1.0 + 3.0 * rough);
  // Headlamps.
  if (lmlLampOn > 0.5) {
    for (int i = 0; i < 2; i++) {
      vec3 L;
      float e = lmlLampIrradiance(i, P, L);
      color += lit(L, e, N, V, diffuseColor, f0v, a);
    }
  }
  color += vec3(1.0, 0.93, 0.8) * emissive;
  gl_FragColor = vec4(color, 1.0);
}`;

export function createRoverMaterial(surface: RoverSurface): THREE.ShaderMaterial {
  const f0 = surface.f0 ?? [0.04, 0.04, 0.04];
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    uniforms: {
      ...lightingUniforms(),
      uBase: { value: new THREE.Vector3(...surface.base) },
      uMetal: { value: surface.metal },
      uRough: { value: surface.roughness },
      uF0: { value: new THREE.Vector3(...f0) },
      uKind: { value: KIND[surface.kind ?? 'plain'] },
      uDust: { value: surface.dust ?? 0 },
      uCells: { value: new THREE.Vector2(...(surface.cells ?? [1, 1])) },
    },
  });
}

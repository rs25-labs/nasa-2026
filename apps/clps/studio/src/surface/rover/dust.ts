import * as THREE from 'three';
import { lightingGlsl } from '../light/glsl';
import { lightingUniforms } from '../light/uniforms';

/**
 * Regolith thrown by the wheels. There is no air: every grain follows a parabola in lunar gravity from the moment it
 * leaves the wheel until it lands, and a landed grain is gone, so nothing drifts or hangs as a cloud. Positions are
 * computed in the vertex shader from the launch state, so a frame costs one small upload of new grains.
 */
export const DUST = {
  gravity: 1.62,
  capacity: 30000,
  /** Grain clump size (metres): what a pixel can show, not a single particle of regolith. */
  sizeMin: 0.003,
  sizeMax: 0.009,
  /** Opacity of one clump. */
  opacity: 0.9,
  /** Henyey-Greenstein asymmetry of the grain clumps: strongly forward scattering. */
  asymmetry: 0.55,
  /** Single-scattering albedo times optical depth of a clump. */
  scattering: 0.45,
  /** Longest flight, seconds; the clump has landed by then. */
  maxLife: 5,
} as const;

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aOrigin;
attribute vec4 aVelocity;
attribute vec4 aShape;
uniform float uTime;
uniform float uPixelScale;
varying vec3 vWorld;
varying float vAlpha;
varying float vCoverage;
void main() {
  float age = uTime - aOrigin.w;
  float rise = aVelocity.y - aShape.y * aVelocity.x - aShape.z * aVelocity.z;
  float landing = (rise + sqrt(max(rise * rise + 2.0 * ${DUST.gravity.toFixed(2)} * aShape.w, 0.0))) / ${DUST.gravity.toFixed(2)};
  float landed = max(age - landing, 0.0);
  float t = min(age, landing);
  vec3 p = aOrigin.xyz + aVelocity.xyz * t + vec3(0.0, -0.5 * ${(DUST.gravity).toFixed(2)} * t * t, 0.0);
  float fade = 1.0 - smoothstep(0.0, 0.25, landed);
  bool alive = age >= 0.0 && landing > 0.02 && fade > 0.0 && age < ${DUST.maxLife.toFixed(1)};
  vAlpha = alive ? fade : 0.0;
  vWorld = p;
  vec4 view = viewMatrix * vec4(p, 1.0);
  gl_Position = alive ? projectionMatrix * view : vec4(2.0, 2.0, 2.0, 1.0);
  // A grain smaller than a pixel is drawn one pixel wide and dimmed by the area it does not cover.
  float physical = aShape.x * uPixelScale / max(-view.z, 0.1);
  gl_PointSize = max(1.5, physical);
  vCoverage = min(1.0, (physical * physical) / (gl_PointSize * gl_PointSize) * 2.0);
  #include <logdepthbuf_vertex>
}`;

const fragmentShader = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${lightingGlsl()}
varying vec3 vWorld;
varying float vAlpha;
varying float vCoverage;
void main() {
  #include <logdepthbuf_fragment>
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = dot(q, q);
  if (d > 1.0 || vAlpha <= 0.0) discard;
  vec3 V = normalize(cameraPosition - vWorld);
  int level = lmlFindLevel(vWorld.xz, 0);
  float sun = lmlSunVisibilityL(vWorld, level, 0) * lmlObjectShadow(vWorld);
  float g = ${DUST.asymmetry.toFixed(2)};
  float cosTheta = -dot(lmlSunDirection, V);
  float phase = (1.0 - g * g) / (4.0 * LML_PI * pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5));
  float earth = lmlEarthIrradiance * lmlEarthVisibilityL(vWorld, level) / (4.0 * LML_PI);
  float radiance = ${DUST.scattering.toFixed(2)} * (sun * phase + earth) + LML_BOUNCE_ALBEDO / LML_PI * 0.5 * lmlBounceIncidentL(vWorld, level);
  gl_FragColor = vec4(vec3(radiance), vAlpha * vCoverage * ${DUST.opacity.toFixed(2)} * exp(-2.5 * d));
}`;

/** Small deterministic generator so staged views repeat exactly. */
function xorshift(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

export interface Launch {
  /** Wheel contact point, world. */
  x: number;
  y: number;
  z: number;
  /** Unit vector of the rover's motion in the horizontal plane and its (visual) speed in m/s. */
  directionX: number;
  directionZ: number;
  speed: number;
  /** Ground slope gradient at the contact, rise per metre in x and z. */
  gradientX: number;
  gradientZ: number;
  /** How hard the wheel is turning, 0 to 1: more grains fan outward. */
  steering: number;
  /** Which side of the rover the wheel is on (-1 left, 1 right). */
  side: number;
}

export class Dust {
  readonly points: THREE.Points;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly origin = new Float32Array(DUST.capacity * 4);
  private readonly velocity = new Float32Array(DUST.capacity * 4);
  private readonly shape = new Float32Array(DUST.capacity * 4);
  private head = 0;
  private dirtyFrom = Number.POSITIVE_INFINITY;
  private dirtyTo = -1;
  private readonly random = xorshift(12345);
  private carry = 0;
  /** Real seconds of dust time (frozen while paused). */
  time = 0;

  constructor() {
    for (let k = 0; k < DUST.capacity; k += 1) this.origin[k * 4 + 3] = 1e9;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST.capacity * 3), 3));
    this.geometry.setAttribute('aOrigin', new THREE.BufferAttribute(this.origin, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aVelocity', new THREE.BufferAttribute(this.velocity, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aShape', new THREE.BufferAttribute(this.shape, 4).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      uniforms: { ...lightingUniforms(), uTime: { value: 0 }, uPixelScale: { value: 1000 } },
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.name = 'dust';
  }

  /**
   * Throw grains from one wheel for a step that lasted `seconds` of real time. Grains leave tangentially off the rim
   * at the rim speed (the rover's speed plus slip), so in the world they go up and back, with a few fanning sideways.
   */
  emit(launch: Launch, seconds: number): void {
    if (launch.speed < 0.05) return;
    const rate = 240 * Math.min(launch.speed, 3) ** 0.8 * (1 + 1.5 * launch.steering);
    this.carry += rate * seconds;
    const count = Math.floor(this.carry);
    this.carry -= count;
    for (let n = 0; n < count; n += 1) {
      const k = this.head;
      this.head = (this.head + 1) % DUST.capacity;
      const rand = this.random;
      const slip = 0.2 + 0.4 * rand();
      const rim = launch.speed * (1 + slip);
      const lift = (20 + 50 * rand()) * (Math.PI / 180);
      const spread = (rand() - 0.5) * (0.5 + launch.steering);
      const gain = 0.35 + 0.8 * rand();
      const forward = launch.speed - rim * Math.cos(lift) * gain;
      const vertical = rim * Math.sin(lift) * gain * 0.6;
      const lateral = (rand() - 0.3 * launch.side) * launch.side * launch.steering * rim * 0.6 + spread * rim * 0.35;
      const dx = launch.directionX;
      const dz = launch.directionZ;
      const o = k * 4;
      this.origin[o] = launch.x + (rand() - 0.5) * 0.12 * -dx - (rand() - 0.5) * 0.1 * -dz;
      this.origin[o + 1] = launch.y + 0.04 + rand() * 0.18;
      this.origin[o + 2] = launch.z + (rand() - 0.5) * 0.12 * -dz + (rand() - 0.5) * 0.1 * -dx;
      this.origin[o + 3] = this.time;
      this.velocity[o] = dx * forward - dz * lateral;
      this.velocity[o + 1] = vertical;
      this.velocity[o + 2] = dz * forward + dx * lateral;
      this.velocity[o + 3] = 0;
      this.shape[o] = DUST.sizeMin + (DUST.sizeMax - DUST.sizeMin) * rand();
      this.shape[o + 1] = launch.gradientX;
      this.shape[o + 2] = launch.gradientZ;
      this.shape[o + 3] = this.origin[o + 1]! - launch.y;
      this.dirtyFrom = Math.min(this.dirtyFrom, k);
      this.dirtyTo = Math.max(this.dirtyTo, k);
      if (k === DUST.capacity - 1) {
        this.flush();
      }
    }
  }

  /** Upload what was written, set the clock and the pixel scale for this frame. */
  update(time: number, pixelScale: number): void {
    this.time = time;
    this.material.uniforms.uTime!.value = time;
    this.material.uniforms.uPixelScale!.value = pixelScale;
    this.flush();
  }

  private flush(): void {
    if (this.dirtyTo < this.dirtyFrom) return;
    for (const name of ['aOrigin', 'aVelocity', 'aShape']) {
      const attribute = this.geometry.getAttribute(name) as THREE.BufferAttribute;
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(this.dirtyFrom * 4, (this.dirtyTo - this.dirtyFrom + 1) * 4);
      attribute.needsUpdate = true;
    }
    this.dirtyFrom = Number.POSITIVE_INFINITY;
    this.dirtyTo = -1;
  }

  clear(): void {
    for (let k = 0; k < DUST.capacity; k += 1) this.origin[k * 4 + 3] = 1e9;
    this.dirtyFrom = 0;
    this.dirtyTo = DUST.capacity - 1;
  }

  /** Grains in flight at the current time (for the report). */
  get alive(): number {
    let n = 0;
    for (let k = 0; k < DUST.capacity; k += 1) {
      const age = this.time - (this.origin[k * 4 + 3] as number);
      if (age >= 0 && age < DUST.maxLife) n += 1;
    }
    return n;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

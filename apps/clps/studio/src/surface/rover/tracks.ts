import * as THREE from 'three';
import type { GroundQuery } from '../core/types';
import { lightingGlsl } from '../light/glsl';
import { lightingUniforms } from '../light/uniforms';
import { microGlsl } from '../ground/microGlsl';
import { ROVER } from './model';

/**
 * Wheel tracks: one ribbon per wheel laid on the visible ground, kept for the last TRACK_METRES. A ribbon is a ring of
 * chunks; a full chunk is followed by the next, and the oldest chunk is reused. Each vertex follows the loaded ground
 * (re-read when terrain levels change), lifted a couple of centimetres so the finer ground mesh cannot cut through it.
 */
export const TRACK = {
  spacingM: 0.2,
  segmentsPerChunk: 64,
  chunks: 48,
  widthM: ROVER.wheelWidth,
  liftM: 0.025,
  /** Albedo of compacted regolith relative to the loose soil around it: one factor, a few per cent. */
  albedoFactor: 0.96,
  /** Share of the surface's micro-relief that is left inside a track (compaction smooths it). */
  microKeep: 0.35,
  /** Pitch of the grouser imprint along the track. */
  treadPitchM: 0.045,
} as const;

const PAIRS_PER_CHUNK = TRACK.segmentsPerChunk + 1;
const PAIRS = PAIRS_PER_CHUNK * TRACK.chunks;
export const TRACK_METRES = TRACK.spacingM * TRACK.segmentsPerChunk * TRACK.chunks;

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aTangent;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vTangent;
varying vec2 vUv;
void main() {
  vWorld = position;
  vNormal = normal;
  vTangent = aTangent;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;

/** The ground's own lighting and micro-relief, with the tread imprint and compaction applied. */
const fragmentShader = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${lightingGlsl()}
${microGlsl()}
uniform float uAlbedo;
uniform float uMicroKeep;
uniform float uPitch;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vTangent;
varying vec2 vUv;
float ridge(float p) {
  float f = fract(p);
  return smoothstep(0.0, 0.14, f) * (1.0 - smoothstep(0.42, 0.56, f));
}
void main() {
  #include <logdepthbuf_fragment>
  vec3 normal = normalize(vNormal);
  vec3 tangent = normalize(vTangent - dot(vTangent, normal) * normal);
  vec3 side = cross(normal, tangent);
  float across = vUv.x * 2.0 - 1.0;
  float alpha = smoothstep(1.0, 0.7, abs(across));
  // Chevron grousers: the ridge phase leans with the distance from the track's centre line.
  float phase = vUv.y / uPitch + abs(across) * 0.9;
  float slope = (ridge(phase + 0.06) - ridge(phase - 0.06)) / 0.12;
  float shoulder = sign(across) * smoothstep(0.55, 0.95, abs(across));
  vec3 imprint = normalize(normal + tangent * (0.25 * slope) + side * (0.4 * shoulder));
  vec3 toViewer = normalize(cameraPosition - vWorld);
  float footprint = sqrt(length(dFdx(vWorld)) * length(dFdy(vWorld)));
  vec2 micro = lmlMicroGradient(vWorld.xz, footprint) * uMicroKeep;
  vec3 shading = normalize(imprint - vec3(micro.x, 0.0, micro.y));
  float microAmount = 1.0 - smoothstep(0.1, 0.5, footprint);
  int level = lmlFindLevel(vWorld.xz, 0);
  vec3 radiance = lmlSurfaceRadianceLevel(vWorld, normal, shading, toViewer, uAlbedo, microAmount * 0.7, level);
  gl_FragColor = vec4(radiance, alpha);
}`;

class Ribbon {
  readonly geometry = new THREE.BufferGeometry();
  readonly mesh: THREE.Mesh;
  /** Ground x, z of each edge vertex (pair p has vertices 2p and 2p + 1). */
  private readonly edgeX = new Float32Array(PAIRS * 2);
  private readonly edgeZ = new Float32Array(PAIRS * 2);
  private readonly pairValid = new Uint8Array(PAIRS);
  private readonly positions = new Float32Array(PAIRS * 2 * 3);
  private readonly normals = new Float32Array(PAIRS * 2 * 3);
  private readonly tangents = new Float32Array(PAIRS * 2 * 3);
  private readonly uvs = new Float32Array(PAIRS * 2 * 2);
  private chunk = -1;
  private segment: number = TRACK.segmentsPerChunk;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private distance = 0;
  lastPair = -1;

  constructor(material: THREE.Material) {
    for (let k = 0; k < PAIRS * 2; k += 1) this.positions[k * 3 + 1] = -1e5;
    const indices: number[] = [];
    for (let c = 0; c < TRACK.chunks; c += 1) {
      for (let s = 0; s < TRACK.segmentsPerChunk; s += 1) {
        const p0 = c * PAIRS_PER_CHUNK + s;
        const p1 = p0 + 1;
        indices.push(2 * p0, 2 * p0 + 1, 2 * p1, 2 * p1, 2 * p0 + 1, 2 * p1 + 1);
      }
    }
    this.geometry.setIndex(indices);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aTangent', new THREE.BufferAttribute(this.tangents, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  clear(): void {
    this.chunk = -1;
    this.segment = TRACK.segmentsPerChunk;
    this.lastX = Number.NaN;
    this.lastZ = Number.NaN;
    this.distance = 0;
    this.lastPair = -1;
    this.pairValid.fill(0);
    for (let k = 0; k < PAIRS * 2; k += 1) this.positions[k * 3 + 1] = -1e5;
    this.touch();
  }

  /** Add a point of the wheel's path; ignored until the wheel has moved a track spacing. */
  lay(x: number, z: number, headingX: number, headingZ: number): boolean {
    if (Number.isFinite(this.lastX)) {
      const step = Math.hypot(x - this.lastX, z - this.lastZ);
      if (step < TRACK.spacingM) return false;
      this.distance += step;
    }
    this.lastX = x;
    this.lastZ = z;
    const length = Math.hypot(headingX, headingZ) || 1;
    const tx = headingX / length;
    const tz = headingZ / length;
    if (this.segment >= TRACK.segmentsPerChunk) this.startChunk(x, z);
    this.segment += 1;
    const pair = this.chunk * PAIRS_PER_CHUNK + this.segment;
    const half = TRACK.widthM / 2;
    for (const side of [0, 1]) {
      const vertex = pair * 2 + side;
      const offset = side === 0 ? -half : half;
      // Right of the heading (tx, tz) in the x-z plane is (-tz, tx).
      this.edgeX[vertex] = x - tz * offset;
      this.edgeZ[vertex] = z + tx * offset;
      this.tangents[vertex * 3] = tx;
      this.tangents[vertex * 3 + 1] = 0;
      this.tangents[vertex * 3 + 2] = tz;
      this.uvs[vertex * 2] = side;
      this.uvs[vertex * 2 + 1] = this.distance;
    }
    this.pairValid[pair] = 1;
    this.lastPair = pair;
    return true;
  }

  /** The next chunk's first pair repeats the previous chunk's last; the rest collapse until they are written. */
  private startChunk(x: number, z: number): void {
    const previousLast = this.chunk >= 0 ? this.chunk * PAIRS_PER_CHUNK + PAIRS_PER_CHUNK - 1 : -1;
    this.chunk = (this.chunk + 1) % TRACK.chunks;
    const first = this.chunk * PAIRS_PER_CHUNK;
    for (let s = 0; s < PAIRS_PER_CHUNK; s += 1) this.pairValid[first + s] = 0;
    for (let s = 0; s < PAIRS_PER_CHUNK; s += 1) {
      for (const side of [0, 1]) {
        const target = (first + s) * 2 + side;
        this.edgeX[target] = x;
        this.edgeZ[target] = z;
        this.positions[target * 3 + 1] = -1e5;
      }
    }
    if (previousLast >= 0) {
      for (const side of [0, 1]) {
        const from = previousLast * 2 + side;
        const to = first * 2 + side;
        this.edgeX[to] = this.edgeX[from] as number;
        this.edgeZ[to] = this.edgeZ[from] as number;
        for (let k = 0; k < 3; k += 1) {
          this.positions[to * 3 + k] = this.positions[from * 3 + k] as number;
          this.normals[to * 3 + k] = this.normals[from * 3 + k] as number;
          this.tangents[to * 3 + k] = this.tangents[from * 3 + k] as number;
        }
        this.uvs[to * 2] = this.uvs[from * 2] as number;
        this.uvs[to * 2 + 1] = this.uvs[from * 2 + 1] as number;
      }
      this.pairValid[first] = 1;
    }
    this.segment = 0;
  }

  /** Read ground heights and normals for pair p. */
  conformPair(p: number, ground: GroundQuery, scratch: THREE.Vector3): void {
    if (!this.pairValid[p]) return;
    for (const side of [0, 1]) {
      const v = p * 2 + side;
      const x = this.edgeX[v] as number;
      const z = this.edgeZ[v] as number;
      const h = ground.heightAt(x, z);
      if (!Number.isFinite(h)) {
        this.positions[v * 3 + 1] = -1e5;
        continue;
      }
      ground.normalAt(x, z, scratch);
      this.positions[v * 3] = x;
      this.positions[v * 3 + 1] = h + TRACK.liftM;
      this.positions[v * 3 + 2] = z;
      this.normals[v * 3] = scratch.x;
      this.normals[v * 3 + 1] = scratch.y;
      this.normals[v * 3 + 2] = scratch.z;
    }
  }

  touch(): void {
    for (const name of ['position', 'normal', 'aTangent', 'uv']) (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  get validPairs(): number {
    let n = 0;
    for (let p = 0; p < PAIRS; p += 1) n += this.pairValid[p] as number;
    return n;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

export class TrackLayer {
  readonly group = new THREE.Group();
  private readonly ribbons: Ribbon[];
  private readonly material: THREE.ShaderMaterial;
  private readonly scratch = new THREE.Vector3();
  private conformedVersion = -1;
  private cursor = PAIRS;
  private dirty = false;
  /** True when every written pair has been conformed to the terrain that is loaded now. */
  settled = true;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        ...lightingUniforms(),
        uAlbedo: { value: TRACK.albedoFactor },
        uMicroKeep: { value: TRACK.microKeep },
        uPitch: { value: TRACK.treadPitchM },
      },
    });
    this.ribbons = [0, 1, 2, 3].map(() => new Ribbon(this.material));
    for (const ribbon of this.ribbons) this.group.add(ribbon.mesh);
    this.group.name = 'tracks';
  }

  clear(): void {
    for (const ribbon of this.ribbons) ribbon.clear();
    this.conformedVersion = -1;
    this.settled = false;
  }

  /** Lay a point of wheel i's path (world x, z) with its heading. */
  lay(wheel: number, x: number, z: number, headingX: number, headingZ: number, ground: GroundQuery): void {
    const ribbon = this.ribbons[wheel] as Ribbon;
    if (!ribbon.lay(x, z, headingX, headingZ)) return;
    ribbon.conformPair(ribbon.lastPair, ground, this.scratch);
    this.dirty = true;
  }

  /** Re-read heights after a terrain change, a slice per call; call every frame. */
  conform(ground: GroundQuery, terrainVersion: number, budgetPairs: number): void {
    if (terrainVersion !== this.conformedVersion) {
      this.conformedVersion = terrainVersion;
      this.cursor = 0;
      this.settled = false;
    }
    if (this.cursor < PAIRS) {
      const end = Math.min(PAIRS, this.cursor + budgetPairs);
      for (const ribbon of this.ribbons) {
        for (let p = this.cursor; p < end; p += 1) ribbon.conformPair(p, ground, this.scratch);
      }
      this.cursor = end;
      this.dirty = true;
    }
    if (this.cursor >= PAIRS) this.settled = true;
    if (this.dirty) {
      for (const ribbon of this.ribbons) ribbon.touch();
      this.dirty = false;
    }
  }

  get pairCount(): number {
    return (this.ribbons[0] as Ribbon).validPairs;
  }

  dispose(): void {
    for (const ribbon of this.ribbons) ribbon.dispose();
    this.material.dispose();
  }
}

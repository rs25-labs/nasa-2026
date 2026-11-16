import * as THREE from 'three';
import { chain, hash2, unit } from './hash';

/**
 * Procedural rock geometry. Every shape starts as an indexed (shared-vertex) icosphere, so vertex normals
 * are smooth, and is displaced radially:
 *   - fractal value noise (low frequencies make the overall lumpiness, higher ones the surface irregularity),
 *   - fracture planes that slice the form (angular fragments are mostly planes, old boulders have few),
 *   - rounding: the planes' corners are softened by taking a soft minimum instead of a hard one, so a plane
 *     meets its neighbours along a worn edge, not a razor.
 * The `kind` sets the mix. Radius 1 before the instance's half sizes are applied.
 */
export type RockKind = 'fragment' | 'blocky' | 'slab' | 'worn' | 'rounded' | 'lumpy';

export const ROCK_KINDS: readonly RockKind[] = ['fragment', 'blocky', 'slab', 'worn', 'rounded', 'lumpy'];

interface KindSpec {
  planes: number;
  /** Plane distance range (fraction of the radius). */
  planeNear: number;
  planeFar: number;
  /** Softness of plane edges: 0 is hard, larger is more worn. */
  soft: number;
  noiseAmplitude: number;
  /** Fractal noise base frequency over the unit sphere. */
  noiseFrequency: number;
  /** Axis scale applied inside the shape, so each kind has its own proportions before instance scaling. */
  stretch: [number, number, number];
}

const SPECS: Record<RockKind, KindSpec> = {
  fragment: { planes: 7, planeNear: 0.55, planeFar: 0.85, soft: 0.035, noiseAmplitude: 0.1, noiseFrequency: 1.6, stretch: [1, 0.8, 0.9] },
  blocky: { planes: 9, planeNear: 0.7, planeFar: 0.92, soft: 0.05, noiseAmplitude: 0.08, noiseFrequency: 1.4, stretch: [1, 0.9, 1] },
  slab: { planes: 6, planeNear: 0.45, planeFar: 0.8, soft: 0.03, noiseAmplitude: 0.07, noiseFrequency: 1.3, stretch: [1, 0.45, 0.8] },
  worn: { planes: 5, planeNear: 0.78, planeFar: 0.95, soft: 0.16, noiseAmplitude: 0.12, noiseFrequency: 1.8, stretch: [1, 0.75, 0.9] },
  rounded: { planes: 2, planeNear: 0.85, planeFar: 0.97, soft: 0.22, noiseAmplitude: 0.1, noiseFrequency: 1.5, stretch: [1, 0.8, 0.9] },
  lumpy: { planes: 0, planeNear: 1, planeFar: 1, soft: 0, noiseAmplitude: 0.2, noiseFrequency: 1.9, stretch: [1, 0.7, 0.85] },
};

function lattice(ix: number, iy: number, iz: number, seed: number): number {
  return unit(hash2(ix + Math.imul(iz, 7919), iy, seed)) * 2 - 1;
}

/** Smooth 3D value noise in [-1, 1]. */
function valueNoise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  let sum = 0;
  for (let dz = 0; dz <= 1; dz += 1) {
    for (let dy = 0; dy <= 1; dy += 1) {
      for (let dx = 0; dx <= 1; dx += 1) {
        const weight = (dx ? ux : 1 - ux) * (dy ? uy : 1 - uy) * (dz ? uz : 1 - uz);
        sum += weight * lattice(ix + dx, iy + dy, iz + dz, seed);
      }
    }
  }
  return sum;
}

/** Icosphere with shared vertices, subdivided `detail` times (each level quadruples the triangles). */
function indexedIcosphere(detail: number): { positions: number[]; indices: number[] } {
  const t = (1 + Math.sqrt(5)) / 2;
  const positions: number[] = [];
  const push = (x: number, y: number, z: number): void => {
    const length = Math.hypot(x, y, z);
    positions.push(x / length, y / length, z / length);
  };
  push(-1, t, 0); push(1, t, 0); push(-1, -t, 0); push(1, -t, 0);
  push(0, -1, t); push(0, 1, t); push(0, -1, -t); push(0, 1, -t);
  push(t, 0, -1); push(t, 0, 1); push(-t, 0, -1); push(-t, 0, 1);
  let indices = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ];
  for (let level = 0; level < detail; level += 1) {
    const cache = new Map<number, number>();
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      const found = cache.get(key);
      if (found !== undefined) return found;
      const index = positions.length / 3;
      push(
        positions[a * 3]! + positions[b * 3]!,
        positions[a * 3 + 1]! + positions[b * 3 + 1]!,
        positions[a * 3 + 2]! + positions[b * 3 + 2]!,
      );
      cache.set(key, index);
      return index;
    };
    const next: number[] = [];
    for (let k = 0; k < indices.length; k += 3) {
      const a = indices[k]!;
      const b = indices[k + 1]!;
      const c = indices[k + 2]!;
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    indices = next;
  }
  return { positions, indices };
}

export function rockGeometry(seed: number, detail: number, kind: RockKind): THREE.BufferGeometry {
  const spec = SPECS[kind];
  const { positions, indices } = indexedIcosphere(detail);
  let h = hash2(seed, detail, 31);
  const next = (): number => {
    h = chain(h);
    return unit(h);
  };
  const planes: { normal: THREE.Vector3; distance: number }[] = [];
  for (let k = 0; k < spec.planes; k += 1) {
    const normal = new THREE.Vector3(next() * 2 - 1, next() * 2 - 1, next() * 2 - 1).normalize();
    planes.push({ normal, distance: spec.planeNear + (spec.planeFar - spec.planeNear) * next() });
  }
  const offset = [next() * 40, next() * 40, next() * 40];
  const noiseSeed = Math.floor(next() * 1e6);
  const count = positions.length / 3;
  const out = new Float32Array(count * 3);
  const direction = new THREE.Vector3();
  for (let k = 0; k < count; k += 1) {
    direction.set(positions[k * 3]!, positions[k * 3 + 1]!, positions[k * 3 + 2]!);
    let noise = 0;
    let amplitude = 1;
    let frequency = spec.noiseFrequency;
    let norm = 0;
    for (let octave = 0; octave < 4; octave += 1) {
      noise += amplitude * valueNoise(direction.x * frequency + offset[0]!, direction.y * frequency + offset[1]!, direction.z * frequency + offset[2]!, noiseSeed + octave);
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2.1;
    }
    let radius = 1 + spec.noiseAmplitude * (noise / norm);
    // Soft minimum of the planes' reach along this direction: smooth worn edges where planes meet.
    if (planes.length > 0) {
      let reach = 1e3;
      let accumulated = 0;
      for (const plane of planes) {
        const along = direction.dot(plane.normal);
        if (along <= 1e-3) continue;
        const distance = plane.distance / along;
        if (spec.soft <= 0) reach = Math.min(reach, distance);
        else accumulated += Math.exp(-distance / spec.soft);
      }
      if (spec.soft > 0 && accumulated > 0) reach = Math.min(reach, -spec.soft * Math.log(accumulated + Math.exp(-1e3 / spec.soft)));
      // Soft minimum against the noisy sphere itself.
      if (spec.soft > 0) radius = -spec.soft * Math.log(Math.exp(-radius / spec.soft) + Math.exp(-reach / spec.soft));
      else radius = Math.min(radius, reach);
    }
    out[k * 3] = direction.x * radius * spec.stretch[0];
    out[k * 3 + 1] = direction.y * radius * spec.stretch[1];
    out[k * 3 + 2] = direction.z * radius * spec.stretch[2];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(out, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Normalise the size so the largest extent is 1: instance half sizes then mean what they say.
  geometry.computeBoundingBox();
  const box = geometry.boundingBox as THREE.Box3;
  const extent = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) / 2;
  const centre = box.getCenter(new THREE.Vector3());
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let k = 0; k < position.count; k += 1) {
    position.setXYZ(k, (position.getX(k) - centre.x) / extent, (position.getY(k) - centre.y) / extent, (position.getZ(k) - centre.z) / extent);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

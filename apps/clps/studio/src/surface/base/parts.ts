import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRoverMaterial, type RoverSurface } from '../rover/roverMaterial';

/** Reflectances of the outpost's materials, lit by the same shader as the rover (linear, relative to normal-incidence sunlight). */
export const SURFACES = {
  white: { base: [0.5, 0.5, 0.48], metal: 0, roughness: 0.55, dust: 0.3 },
  grey: { base: [0.16, 0.16, 0.17], metal: 0, roughness: 0.5, dust: 0.35 },
  anodised: { base: [0, 0, 0], metal: 1, roughness: 0.42, f0: [0.34, 0.34, 0.36], dust: 0.3 },
  aluminium: { base: [0, 0, 0], metal: 1, roughness: 0.38, f0: [0.9, 0.9, 0.88], dust: 0.5 },
  gold: { base: [0, 0, 0], metal: 1, roughness: 0.42, f0: [0.9, 0.66, 0.3], kind: 'foil', dust: 0.25 },
  silver: { base: [0, 0, 0], metal: 1, roughness: 0.38, f0: [0.9, 0.89, 0.86], kind: 'foil', dust: 0.25 },
  black: { base: [0.012, 0.012, 0.013], metal: 0, roughness: 0.6, dust: 0.2 },
  cells: { base: [0.008, 0.013, 0.045], metal: 0, roughness: 0.14, kind: 'cells', cells: [12, 34], dust: 0.08 },
  radiator: { base: [0.72, 0.72, 0.7], metal: 0, roughness: 0.65, dust: 0.5 },
  glass: { base: [0.004, 0.004, 0.006], metal: 0, roughness: 0.05 },
} satisfies Record<string, RoverSurface>;

export type SurfaceName = keyof typeof SURFACES;

export class MaterialSet {
  private readonly made = new Map<SurfaceName, THREE.ShaderMaterial>();

  get(name: SurfaceName): THREE.ShaderMaterial {
    let found = this.made.get(name);
    if (!found) {
      found = createRoverMaterial(SURFACES[name] as RoverSurface);
      this.made.set(name, found);
    }
    return found;
  }

  dispose(): void {
    for (const material of this.made.values()) material.dispose();
    this.made.clear();
  }
}

export function placement(at: [number, number, number], rotation?: [number, number, number]): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...at),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation ?? [0, 0, 0]))),
    new THREE.Vector3(1, 1, 1),
  );
}

/** Collects parts per surface and merges each surface into one mesh. */
export class Parts {
  private readonly lists = new Map<SurfaceName, THREE.BufferGeometry[]>();

  add(surface: SurfaceName, geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4): void {
    const copy = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (matrix) copy.applyMatrix4(matrix);
    for (const name of Object.keys(copy.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') copy.deleteAttribute(name);
    }
    const list = this.lists.get(surface) ?? [];
    list.push(copy);
    this.lists.set(surface, list);
    geometry.dispose();
  }

  box(surface: SurfaceName, size: [number, number, number], at: [number, number, number], rotation?: [number, number, number]): void {
    this.add(surface, new THREE.BoxGeometry(...size), placement(at, rotation));
  }

  /** A cylinder (or cone frustum) standing along Y, optionally rotated. */
  cylinder(surface: SurfaceName, radiusTop: number, radiusBottom: number, length: number, at: [number, number, number], rotation?: [number, number, number], segments = 16): void {
    this.add(surface, new THREE.CylinderGeometry(radiusTop, radiusBottom, length, segments), placement(at, rotation));
  }

  /** A thin round rod between two points. */
  rod(surface: SurfaceName, radius: number, from: THREE.Vector3, to: THREE.Vector3, segments = 8): void {
    const length = from.distanceTo(to);
    if (length < 1e-4) return;
    const matrix = new THREE.Matrix4().compose(
      from.clone().add(to).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()),
      new THREE.Vector3(1, 1, 1),
    );
    this.add(surface, new THREE.CylinderGeometry(radius, radius, length, segments), matrix);
  }

  /** Merge into meshes on `group`. With `into`, replace the geometry of existing meshes by surface name instead of adding. */
  build(group: THREE.Group, materials: MaterialSet, into?: Map<SurfaceName, THREE.Mesh>): void {
    for (const [name, list] of this.lists) {
      const merged = mergeGeometries(list, false);
      for (const geometry of list) geometry.dispose();
      if (!merged) continue;
      const existing = into?.get(name);
      if (existing) {
        existing.geometry.dispose();
        existing.geometry = merged;
      } else {
        const mesh = new THREE.Mesh(merged, materials.get(name));
        group.add(mesh);
        into?.set(name, mesh);
      }
    }
    this.lists.clear();
  }
}

/** Rotate a local (x, z) offset by a model's yaw (local +Z turns toward world (sin yaw, cos yaw)). */
export function toWorld(yaw: number, x: number, z: number, localX: number, localZ: number): [number, number] {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return [x + cos * localX + sin * localZ, z - sin * localX + cos * localZ];
}

import * as THREE from 'three';
import type { BuiltLevel } from '../ground/levelBuild';
import { uploadDetail } from './detailAtlas';

export interface LevelSpec {
  /** Square tile edge in metres. */
  span: number;
  /** Vertices per side. */
  size: 65 | 129 | 257 | 513;
}

interface HoleBox {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

const SKIRT_CAPACITY = 3200;
const SKIRT_DEPTH_FACTOR = 0.75;

/**
 * One square level of the terrain. Vertices lie on a world-fixed grid (spacing = span / (size - 1)) and are
 * displaced on the CPU. Triangles with a missing corner are dropped. The region covered by the next finer
 * level is cut out, and skirts hang below both edges so differences between levels cannot open a crack.
 */
export class TerrainLevel {
  readonly spec: LevelSpec;
  readonly index: number;
  readonly spacing: number;
  readonly half: number;
  readonly mesh: THREE.Mesh;
  /** Scene Y of every grid vertex (NaN where the data has a gap). */
  readonly heights: Float32Array;
  centreX = 0;
  centreZ = 0;
  loaded = false;
  /** Counts installs, so readers of `heights` know when to copy them again. */
  version = 0;

  private readonly size: number;
  private readonly geometry: THREE.BufferGeometry;
  private readonly positions: THREE.BufferAttribute;
  private readonly normals: THREE.BufferAttribute;
  private readonly maturity: THREE.BufferAttribute;
  private readonly indices: THREE.BufferAttribute;
  private readonly indexData: Uint32Array;
  private readonly skirtStamp: Uint32Array;
  private readonly skirtSlot: Int32Array;
  private stamp = 0;
  private skirtCount = 0;
  private hole: HoleBox | null = null;
  private readonly skirtDepth: number;
  private readonly outerSkirtDepth: number;

  constructor(index: number, spec: LevelSpec, outerSpacing: number | null, material: THREE.Material) {
    this.index = index;
    this.spec = spec;
    this.size = spec.size;
    this.spacing = spec.span / (spec.size - 1);
    this.half = spec.span / 2;
    this.skirtDepth = SKIRT_DEPTH_FACTOR * this.spacing;
    this.outerSkirtDepth = outerSpacing === null ? 0 : SKIRT_DEPTH_FACTOR * outerSpacing;
    const vertexTotal = spec.size * spec.size;
    this.heights = new Float32Array(vertexTotal).fill(Number.NaN);
    this.skirtStamp = new Uint32Array(vertexTotal);
    this.skirtSlot = new Int32Array(vertexTotal);
    const cells = (spec.size - 1) * (spec.size - 1);
    this.indexData = new Uint32Array(cells * 6 + SKIRT_CAPACITY * 6);
    this.geometry = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array((vertexTotal + SKIRT_CAPACITY) * 3), 3);
    this.normals = new THREE.BufferAttribute(new Float32Array((vertexTotal + SKIRT_CAPACITY) * 3), 3);
    this.maturity = new THREE.BufferAttribute(new Float32Array(vertexTotal + SKIRT_CAPACITY), 1);
    this.indices = new THREE.BufferAttribute(this.indexData, 1);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    this.normals.setUsage(THREE.DynamicDrawUsage);
    this.maturity.setUsage(THREE.DynamicDrawUsage);
    this.indices.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positions);
    this.geometry.setAttribute('normal', this.normals);
    this.geometry.setAttribute('maturity', this.maturity);
    this.geometry.setIndex(this.indices);
    this.geometry.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = `terrain-level-${index}`;
    if (material instanceof THREE.ShaderMaterial && material.uniforms.uLevel) {
      // One material for all levels: tell the shader which level's data this draw belongs to.
      const uniform = material.uniforms.uLevel;
      this.mesh.onBeforeRender = () => {
        uniform.value = index;
        material.uniformsNeedUpdate = true;
      };
    }
  }

  /**
   * Replace this level's content with a built level (scene heights with synthetic relief, normals, immature-
   * material brightness). Scene row j is at z = centreZ - half + j * spacing, so the data order is the scene order.
   */
  install(built: BuiltLevel, centreX: number, centreZ: number): void {
    const n = this.size;
    this.centreX = centreX;
    this.centreZ = centreZ;
    const x0 = centreX - this.half;
    const z0 = centreZ - this.half;
    const pos = this.positions.array as Float32Array;
    (this.normals.array as Float32Array).set(built.normals);
    (this.maturity.array as Float32Array).set(built.maturity);
    this.heights.set(built.heights);
    uploadDetail(this.index, built.detail);
    for (let j = 0; j < n; j += 1) {
      const z = z0 + j * this.spacing;
      for (let i = 0; i < n; i += 1) {
        const k = j * n + i;
        const y = built.heights[k] as number;
        pos[k * 3] = x0 + i * this.spacing;
        pos[k * 3 + 1] = Number.isFinite(y) ? y : 0;
        pos[k * 3 + 2] = z;
      }
    }
    this.loaded = true;
    this.version += 1;
    this.rebuildIndex();
  }

  /** Cut out the area covered by the next finer level, or none. */
  setHole(finer: TerrainLevel | null): void {
    let next: HoleBox | null = null;
    if (finer && finer.loaded) {
      const cells = this.size - 1;
      const clamp = (value: number): number => Math.min(cells, Math.max(0, Math.round(value)));
      next = {
        i0: clamp((finer.centreX - finer.half - (this.centreX - this.half)) / this.spacing),
        j0: clamp((finer.centreZ - finer.half - (this.centreZ - this.half)) / this.spacing),
        i1: clamp((finer.centreX + finer.half - (this.centreX - this.half)) / this.spacing),
        j1: clamp((finer.centreZ + finer.half - (this.centreZ - this.half)) / this.spacing),
      };
    }
    const same =
      (next === null && this.hole === null) ||
      (next !== null &&
        this.hole !== null &&
        next.i0 === this.hole.i0 &&
        next.j0 === this.hole.j0 &&
        next.i1 === this.hole.i1 &&
        next.j1 === this.hole.j1);
    this.hole = next;
    if (!same && this.loaded) this.rebuildIndex();
  }

  /** Scene Y at (x, z) on the rendered triangles, or NaN outside the level or over a gap. */
  sample(x: number, z: number): number {
    const n = this.size;
    const u = (x - (this.centreX - this.half)) / this.spacing;
    const v = (z - (this.centreZ - this.half)) / this.spacing;
    if (!this.loaded || u < 0 || v < 0 || u > n - 1 || v > n - 1) return Number.NaN;
    const i = Math.min(n - 2, Math.floor(u));
    const j = Math.min(n - 2, Math.floor(v));
    const fu = u - i;
    const fv = v - j;
    const a = this.heights[j * n + i] ?? Number.NaN;
    const b = this.heights[(j + 1) * n + i] ?? Number.NaN;
    const c = this.heights[j * n + i + 1] ?? Number.NaN;
    const d = this.heights[(j + 1) * n + i + 1] ?? Number.NaN;
    // The cell is split along b-c, as in the index buffer.
    return fu + fv <= 1 ? a + (c - a) * fu + (b - a) * fv : d + (b - d) * (1 - fu) + (c - d) * (1 - fv);
  }

  covers(x: number, z: number): boolean {
    return (
      this.loaded && Math.abs(x - this.centreX) <= this.half && Math.abs(z - this.centreZ) <= this.half
    );
  }

  dispose(): void {
    this.geometry.dispose();
  }

  private rebuildIndex(): void {
    const n = this.size;
    const data = this.indexData;
    const h = this.heights;
    const hole = this.hole;
    let count = 0;
    for (let j = 0; j < n - 1; j += 1) {
      const insideRow = hole !== null && j >= hole.j0 && j < hole.j1;
      for (let i = 0; i < n - 1; i += 1) {
        if (insideRow && i >= hole.i0 && i < hole.i1) continue;
        const a = j * n + i;
        const b = a + n;
        const c = a + 1;
        const d = b + 1;
        if (!(Number.isFinite(h[a]) && Number.isFinite(h[b]) && Number.isFinite(h[c]) && Number.isFinite(h[d]))) continue;
        data[count++] = a;
        data[count++] = b;
        data[count++] = c;
        data[count++] = c;
        data[count++] = b;
        data[count++] = d;
      }
    }
    this.stamp += 1;
    this.skirtCount = 0;
    const last = n - 1;
    for (let i = 0; i < last; i += 1) {
      count = this.skirt(count, i, 0, i + 1, 0, this.outerSkirtDepth);
      count = this.skirt(count, i, last, i + 1, last, this.outerSkirtDepth);
      count = this.skirt(count, 0, i, 0, i + 1, this.outerSkirtDepth);
      count = this.skirt(count, last, i, last, i + 1, this.outerSkirtDepth);
    }
    if (hole && hole.i1 > hole.i0 && hole.j1 > hole.j0) {
      for (let i = hole.i0; i < hole.i1; i += 1) {
        count = this.skirt(count, i, hole.j0, i + 1, hole.j0, this.skirtDepth);
        count = this.skirt(count, i, hole.j1, i + 1, hole.j1, this.skirtDepth);
      }
      for (let j = hole.j0; j < hole.j1; j += 1) {
        count = this.skirt(count, hole.i0, j, hole.i0, j + 1, this.skirtDepth);
        count = this.skirt(count, hole.i1, j, hole.i1, j + 1, this.skirtDepth);
      }
    }
    this.geometry.setDrawRange(0, count);
    this.indices.needsUpdate = true;
    this.positions.needsUpdate = true;
    this.normals.needsUpdate = true;
    this.maturity.needsUpdate = true;
    this.mesh.visible = true;
  }

  /** A wall below the edge between two grid vertices, written after the grid vertices. */
  private skirt(count: number, i0: number, j0: number, i1: number, j1: number, depth: number): number {
    if (depth <= 0) return count;
    const n = this.size;
    const k0 = j0 * n + i0;
    const k1 = j1 * n + i1;
    if (!(Number.isFinite(this.heights[k0]) && Number.isFinite(this.heights[k1]))) return count;
    if (this.skirtCount + 2 > SKIRT_CAPACITY) return count;
    const s0 = this.skirtVertex(k0, depth);
    const s1 = this.skirtVertex(k1, depth);
    const data = this.indexData;
    data[count++] = k0;
    data[count++] = s0;
    data[count++] = k1;
    data[count++] = k1;
    data[count++] = s0;
    data[count++] = s1;
    return count;
  }

  private skirtVertex(k: number, depth: number): number {
    if (this.skirtStamp[k] === this.stamp) return this.skirtSlot[k] as number;
    const slot = this.size * this.size + this.skirtCount;
    this.skirtCount += 1;
    const pos = this.positions.array as Float32Array;
    const nor = this.normals.array as Float32Array;
    pos[slot * 3] = pos[k * 3] as number;
    pos[slot * 3 + 1] = (pos[k * 3 + 1] as number) - depth;
    pos[slot * 3 + 2] = pos[k * 3 + 2] as number;
    nor[slot * 3] = nor[k * 3] as number;
    nor[slot * 3 + 1] = nor[k * 3 + 1] as number;
    nor[slot * 3 + 2] = nor[k * 3 + 2] as number;
    (this.maturity.array as Float32Array)[slot] = (this.maturity.array as Float32Array)[k] as number;
    this.skirtStamp[k] = this.stamp;
    this.skirtSlot[k] = slot;
    return slot;
  }
}

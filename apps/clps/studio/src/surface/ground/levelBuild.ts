import { MOON_RADIUS_M } from '../../lib/geo/polar';
import { stampDetail, stampLevel } from './craters';
import { smoothstep } from './hash';

/** Fraction of each level's half span, from its edge, over which it blends into the next coarser level. */
export const RING_FRACTION = 0.2;

export interface TileSource {
  /** Raw heights (metres above the reference sphere, north row first). */
  heights: Float32Array;
  /** Scene centre of the tile. */
  centreX: number;
  centreZ: number;
  spacing: number;
  size: number;
}

export interface LevelJob {
  level: number;
  size: number;
  spacing: number;
  centreX: number;
  centreZ: number;
  siteMapX: number;
  siteMapY: number;
  originHeightM: number;
  pixelSizeM: number;
  /** Spacing of the next coarser level, or 0 for the outermost. */
  coarseSpacing: number;
  /** Raw tile on this level's own grid, or null to resample `parent` instead. */
  own: Float32Array | null;
  /** Coarser raw tile this level is resampled from (fine levels) . */
  parent: TileSource | null;
  /** Next coarser raw tile, for blending the base surface across the outer ring. */
  coarse: TileSource | null;
}

export interface BuiltLevel {
  /** Scene Y of each grid vertex, with synthetic relief; NaN where the data has a gap. */
  heights: Float32Array;
  normals: Float32Array;
  /** Immature-material brightness 0..1. */
  maturity: Float32Array;
  /**
   * Gradient (rise over run, x then z) of the crater relief the mesh cannot carry, on a grid four times finer than the level's
   * (DETAIL_FACTOR * (size - 1) + 1 per side), as half floats, two per texel.
   */
  detail: Uint16Array;
}

/** The detail grid is this many times finer than the level's own grid. */
export const DETAIL_FACTOR = 4;

function bilinear(tile: TileSource, x: number, z: number): number {
  const half = (tile.spacing * (tile.size - 1)) / 2;
  const u = (x - (tile.centreX - half)) / tile.spacing;
  const v = (z - (tile.centreZ - half)) / tile.spacing;
  const n = tile.size;
  if (u < 0 || v < 0 || u > n - 1 || v > n - 1) return Number.NaN;
  const i = Math.min(n - 2, Math.floor(u));
  const j = Math.min(n - 2, Math.floor(v));
  const fu = u - i;
  const fv = v - j;
  const h = tile.heights;
  const a = h[j * n + i] as number;
  const b = h[j * n + i + 1] as number;
  const c = h[(j + 1) * n + i] as number;
  const d = h[(j + 1) * n + i + 1] as number;
  return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
}

function cubicWeights(t: number, out: Float64Array): void {
  const t2 = t * t;
  const t3 = t2 * t;
  out[0] = -0.5 * t3 + t2 - 0.5 * t;
  out[1] = 1.5 * t3 - 2.5 * t2 + 1;
  out[2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
  out[3] = 0.5 * t3 - 0.5 * t2;
}

const weightsU = new Float64Array(4);
const weightsV = new Float64Array(4);

/** Catmull-Rom bicubic height; falls back to bilinear next to data gaps and tile edges. */
function bicubic(tile: TileSource, x: number, z: number): number {
  const half = (tile.spacing * (tile.size - 1)) / 2;
  const u = (x - (tile.centreX - half)) / tile.spacing;
  const v = (z - (tile.centreZ - half)) / tile.spacing;
  const n = tile.size;
  if (u < 0 || v < 0 || u > n - 1 || v > n - 1) return Number.NaN;
  const i = Math.min(n - 2, Math.floor(u));
  const j = Math.min(n - 2, Math.floor(v));
  if (i < 1 || j < 1 || i > n - 3 || j > n - 3) return bilinear(tile, x, z);
  cubicWeights(u - i, weightsU);
  cubicWeights(v - j, weightsV);
  const h = tile.heights;
  let sum = 0;
  for (let dj = 0; dj < 4; dj += 1) {
    let row = 0;
    for (let di = 0; di < 4; di += 1) row += (weightsU[di] as number) * (h[(j - 1 + dj) * n + i - 1 + di] as number);
    sum += (weightsV[dj] as number) * row;
  }
  return Number.isFinite(sum) ? sum : bilinear(tile, x, z);
}

export function computeNormals(h: Float32Array, n: number, spacing: number, out: Float32Array): void {
  const s2 = 2 * spacing;
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const k = j * n + i;
      const centre = h[k] as number;
      let dx = 0;
      let dz = 0;
      if (Number.isFinite(centre)) {
        const west = h[k - (i > 0 ? 1 : 0)] as number;
        const east = h[k + (i < n - 1 ? 1 : 0)] as number;
        const north = h[k - (j > 0 ? n : 0)] as number;
        const south = h[k + (j < n - 1 ? n : 0)] as number;
        const wy = Number.isFinite(west) ? west : centre;
        const ey = Number.isFinite(east) ? east : centre;
        const ny = Number.isFinite(north) ? north : centre;
        const sy = Number.isFinite(south) ? south : centre;
        const runX = (i > 0 ? 1 : 0) + (i < n - 1 ? 1 : 0);
        const runZ = (j > 0 ? 1 : 0) + (j < n - 1 ? 1 : 0);
        dx = (ey - wy) / (s2 * (runX / 2));
        dz = (sy - ny) / (s2 * (runZ / 2));
      }
      const inverse = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
      out[k * 3] = -dx * inverse;
      out[k * 3 + 1] = inverse;
      out[k * 3 + 2] = -dz * inverse;
    }
  }
}

/**
 * Build one terrain level: base heights from the data (own tile, or resampled from a coarser tile), blended
 * into the next coarser tile across the outer ring, plus the synthetic relief this level can represent.
 * Scene Y includes the curvature drop and is relative to the site origin height.
 */
export function buildLevel(job: LevelJob): BuiltLevel {
  const n = job.size;
  const total = n * n;
  const half = (job.spacing * (n - 1)) / 2;
  const x0 = job.centreX - half;
  const z0 = job.centreZ - half;
  const heights = new Float32Array(total);
  const detail = new Float32Array(total);
  const maturity = new Float32Array(total);
  const edgeHalf = (n - 1) / 2;
  const ringed = job.coarse !== null;

  for (let j = 0; j < n; j += 1) {
    const z = z0 + j * job.spacing;
    for (let i = 0; i < n; i += 1) {
      const x = x0 + i * job.spacing;
      const k = j * n + i;
      let base = job.own ? (job.own[k] as number) : job.parent ? bicubic(job.parent, x, z) : Number.NaN;
      if (ringed && job.own && Number.isFinite(base)) {
        const edge = Math.min(i, j, n - 1 - i, n - 1 - j) / edgeHalf;
        if (edge < RING_FRACTION) {
          const outer = bilinear(job.coarse as TileSource, x, z);
          if (Number.isFinite(outer)) base = outer + (base - outer) * smoothstep(0, RING_FRACTION, edge);
        }
      }
      heights[k] = base - job.originHeightM - (x * x + z * z) / (2 * MOON_RADIUS_M);
    }
  }

  stampLevel(
    {
      size: n,
      spacing: job.spacing,
      coarseSpacing: job.coarseSpacing,
      pixelSizeM: job.pixelSizeM,
      mapX0: job.siteMapX + x0,
      mapY0: job.siteMapY - z0,
      ringFraction: RING_FRACTION,
    },
    detail,
    maturity,
  );
  for (let k = 0; k < total; k += 1) heights[k] = (heights[k] as number) + (detail[k] as number);

  const normals = new Float32Array(total * 3);
  computeNormals(heights, n, job.spacing, normals);
  const detailSize = DETAIL_FACTOR * (n - 1) + 1;
  const finer = new Float32Array(detailSize * detailSize);
  stampDetail(
    {
      size: detailSize,
      spacing: job.spacing / DETAIL_FACTOR,
      coarseSpacing: job.coarseSpacing,
      pixelSizeM: job.pixelSizeM,
      mapX0: job.siteMapX + x0,
      mapY0: job.siteMapY - z0,
      ringFraction: RING_FRACTION,
    },
    job.spacing,
    finer,
  );
  return { heights, normals, maturity, detail: gradientHalf(finer, detailSize, job.spacing / DETAIL_FACTOR) };
}

const float32 = new Float32Array(1);
const uint32 = new Uint32Array(float32.buffer);

/** IEEE half float bits of a number (round to nearest; the values here are small slopes, far from the limits). */
function toHalf(value: number): number {
  float32[0] = value;
  const x = uint32[0] as number;
  const sign = (x >>> 16) & 0x8000;
  const exponent = ((x >>> 23) & 0xff) - 127 + 15;
  if (exponent <= 0) return sign;
  if (exponent >= 31) return sign | 0x7bff;
  const mantissa = (x >>> 13) & 0x3ff;
  const rounded = ((exponent << 10) | mantissa) + ((x >>> 12) & 1);
  return sign | rounded;
}

/** Central-difference gradient of a height grid as interleaved half floats (x, z) per texel. */
function gradientHalf(height: Float32Array, n: number, spacing: number): Uint16Array {
  const out = new Uint16Array(n * n * 2);
  const inverse = 1 / (2 * spacing);
  for (let j = 0; j < n; j += 1) {
    const up = (j > 0 ? j - 1 : j) * n;
    const down = (j < n - 1 ? j + 1 : j) * n;
    for (let i = 0; i < n; i += 1) {
      const west = i > 0 ? i - 1 : i;
      const east = i < n - 1 ? i + 1 : i;
      const k = (j * n + i) * 2;
      out[k] = toHalf(((height[j * n + east] as number) - (height[j * n + west] as number)) * inverse);
      out[k + 1] = toHalf(((height[down + i] as number) - (height[up + i] as number)) * inverse);
    }
  }
  return out;
}

import { DETAIL_FIRST_TEXELS, DETAIL_FULL_TEXELS, OCTAVE_REPRESENTATIVE } from './craterBands';
import { chain, hash2, poisson, smoothstep, unit } from './hash';

/**
 * Synthetic lunar relief below the resolution of the terrain data. Everything here is a pure function of
 * map position (polar stereographic metres), so it is fixed to the Moon, identical on every load, and the
 * same for every level of detail that can represent a given feature.
 *
 * Craters follow a size-frequency distribution placed on hashed grids, one grid per diameter octave:
 *   - Cumulative density N(>D) per square metre is a power law. Slope -2 above 8 m (the equilibrium slope of
 *     a mature surface, Gault 1970; Trask 1966; Shoemaker et al. 1970), steepening to -2.6 below 8 m toward
 *     the production slope (Neukum 1975; Neukum, Koenig and Schneider 2001).
 *   - The absolute density is `SATURATION` times geometric saturation (N = 1.54 D^-2 per km2, D in km,
 *     Gault 1970). Mature highland terrain sits at 1 to 5 per cent; 4 per cent is used.
 *   - Profiles: parabolic bowl, rim crest near 4 per cent of D for fresh craters, ejecta thickness falling as
 *     r^-3 (Melosh 1989). Depth/diameter is 0.2 fresh (Pike 1977) and falls to 0.05 when degraded. Small
 *     craters degrade faster (diffusion time scales with R^2), so the majority are shallow and soft and fresh
 *     sharp ones are a few per cent.
 */
export const CRATERS = {
  smallestDiameterM: 0.5,
  octaves: 9,
  /** Fraction of geometric saturation. */
  saturation: 0.04,
  breakDiameterM: 8,
  slopeLarge: 2.0,
  slopeSmall: 2.6,
  /** Grid cell edge as a multiple of the octave's smallest diameter. */
  cellFactor: 4,
  /** Profile reaches this many radii. */
  reach: 2.5,
  /** Brightness halo of fresh craters reaches this many radii. */
  haloReach: 3.0,
} as const;

/** Cumulative number of craters larger than D per square metre. */
export function cumulativeDensity(diameterM: number): number {
  // 1.54 D_km^-2 per km2 is 1.54 D_m^-2 per m2.
  const nBreak = CRATERS.saturation * 1.54 * CRATERS.breakDiameterM ** -2;
  const slope = diameterM >= CRATERS.breakDiameterM ? CRATERS.slopeLarge : CRATERS.slopeSmall;
  return nBreak * (diameterM / CRATERS.breakDiameterM) ** -slope;
}

const SEED_CRATER = 1013;
/** Step between the hash chains of the craters of one cell (also used by `craterGlsl.ts`). */
export const CRATER_STEP = 0x9e3779b1;
export const STRIDE = 12;
const MAX_PER_CELL = 40;

/** Scratch buffer for `generateCell`. */
export function craterBuffer(): Float64Array {
  return new Float64Array(MAX_PER_CELL * STRIDE);
}

export function octaveDiameter(octave: number): number {
  return CRATERS.smallestDiameterM * 2 ** octave;
}

export function octaveCell(octave: number): number {
  return CRATERS.cellFactor * octaveDiameter(octave);
}

/**
 * Craters whose centre lies in cell (ci, cj) of an octave. Fields per crater (see STRIDE): centre x, y,
 * radius, bowl depth, rim height, rim rounding half width, 1/a^2, 1/b^2, cos, sin of the axis angle,
 * diameter, freshness weight.
 */
export function generateCell(octave: number, ci: number, cj: number, out: Float64Array): number {
  const dMin = octaveDiameter(octave);
  const cell = octaveCell(octave);
  const slope = dMin >= CRATERS.breakDiameterM ? CRATERS.slopeLarge : CRATERS.slopeSmall;
  const perArea = cumulativeDensity(dMin) - cumulativeDensity(2 * dMin);
  const lambda = perArea * cell * cell;
  let h = hash2(ci, cj, SEED_CRATER + octave * 7919);
  const count = Math.min(MAX_PER_CELL, poisson(lambda, unit(h)));
  const span = 1 - 2 ** -slope;
  const cellHash = h;
  for (let m = 0; m < count; m += 1) {
    // Each crater starts its own hash chain from the cell's, so the shader can reject most craters after three steps.
    h = chain((cellHash + Math.imul(m + 1, CRATER_STEP)) >>> 0);
    const ux = unit(h);
    h = chain(h);
    const uy = unit(h);
    h = chain(h);
    const uSize = unit(h);
    h = chain(h);
    const uAge = unit(h);
    h = chain(h);
    const uShape = unit(h);
    h = chain(h);
    const uAxis = unit(h);
    h = chain(h);
    const uAngle = unit(h);
    const diameter = dMin * (1 - uSize * span) ** (-1 / slope);
    const radius = diameter / 2;
    // Age: small craters degrade fast (diffusion time scales with R^2) and the population is old, so most are shallow soft bowls
    // and only a few per cent are crisp. Fresh fraction falls as (1 - u)^4; craters smaller than 30 m are capped below fully fresh.
    const fresh = (1 - uAge) ** 4 * Math.min(1, (diameter / 30) ** 0.5);
    const degradation = 1 - fresh;
    const depthRatio = (0.05 + 0.15 * fresh ** 1.5) * (0.85 + 0.3 * uShape);
    const rimRatio = 0.04 * fresh * fresh * (0.8 + 0.4 * uAxis);
    const ellipticity = 0.1 * uAxis * (0.4 + 0.6 * fresh) * (1 - degradation * 0.5);
    const angle = uAngle * Math.PI;
    const semiA = radius * (1 + ellipticity);
    const semiB = radius * (1 - ellipticity);
    const o = m * STRIDE;
    out[o] = (ci + ux) * cell;
    out[o + 1] = (cj + uy) * cell;
    out[o + 2] = radius;
    out[o + 3] = depthRatio * diameter;
    out[o + 4] = rimRatio * diameter;
    out[o + 5] = 0.03 + 0.4 * degradation;
    out[o + 6] = 1 / (semiA * semiA);
    out[o + 7] = 1 / (semiB * semiB);
    out[o + 8] = Math.cos(angle);
    out[o + 9] = Math.sin(angle);
    out[o + 10] = diameter;
    const f = Math.max(0, 1 - degradation / 0.5);
    out[o + 11] = f * f;
  }
  return count;
}

/** Relief of one crater at normalised elliptical radius x (1 = rim crest). */
export function profile(x: number, depth: number, rim: number, rounding: number): number {
  if (x >= CRATERS.reach) return 0;
  const low = 1 - rounding;
  const high = 1 + rounding;
  let value: number;
  if (x <= low) {
    value = -depth + (depth + rim) * x * x;
  } else if (x >= high) {
    value = rim / (x * x * x);
  } else {
    const t = smoothstep(low, high, x);
    const bowl = -depth + (depth + rim) * x * x;
    value = (1 - t) * bowl + (t * rim) / (x * x * x);
  }
  return x > 2 ? value * (1 - smoothstep(2, CRATERS.reach, x)) : value;
}

/** Brightness of immature material at normalised radius x for a crater of freshness `fresh`. */
export function halo(x: number, fresh: number): number {
  if (x >= CRATERS.haloReach) return 0;
  const body = x <= 1 ? 1 : x ** -2.5;
  return fresh * body * (x > 2 ? 1 - smoothstep(2, CRATERS.haloReach, x) : 1);
}

/** Weight of a crater of diameter D on a grid of spacing s: it needs about four samples across. */
export function bandWeight(diameterM: number, spacingM: number): number {
  return smoothstep(2.5 * spacingM, 4 * spacingM, diameterM);
}

/**
 * Share of an octave's craters that the baked detail grid carries (the rest is drawn by the terrain shader, see `craterGlsl.ts` and
 * `smallCraterTile.ts`, with the complementary weight). The detail grid is only used for shading, and a crater needs about eight
 * texels across to keep its shape under bilinear filtering: the share is 0 below five texels and 1 above eight, taken at the octave's
 * representative diameter, so both sides of the split always add up to the full crater population.
 */
export function octaveDetailWeight(octave: number, spacingM: number): number {
  return smoothstep(DETAIL_FIRST_TEXELS * spacingM, DETAIL_FULL_TEXELS * spacingM, OCTAVE_REPRESENTATIVE * octaveDiameter(octave));
}

/** Weight from the terrain data: features the data resolves (about 2.5 to 4 pixels and up) come from the data. */
export function dataWeight(diameterM: number, pixelSizeM: number): number {
  return 1 - smoothstep(2.5 * pixelSizeM, 4 * pixelSizeM, diameterM);
}

// ---------------------------------------------------------------------------------------------------------
// Regolith undulation: smooth value-noise octaves, amplitude proportional to wavelength.
// ---------------------------------------------------------------------------------------------------------

const SEED_UNDULATION = 5003;
export const UNDULATION = {
  smallestWavelengthM: 2,
  octaves: 5,
  /** Amplitude as a fraction of wavelength. */
  amplitude: 0.012,
} as const;

function lattice(ix: number, iy: number, octave: number): number {
  return unit(hash2(ix, iy, SEED_UNDULATION + octave * 131)) * 2 - 1;
}

function valueNoise(x: number, y: number, octave: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = lattice(ix, iy, octave);
  const b = lattice(ix + 1, iy, octave);
  const c = lattice(ix, iy + 1, octave);
  const d = lattice(ix + 1, iy + 1, octave);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export interface Bands {
  /** Spacing of this level's grid. */
  spacing: number;
  /** Spacing of the next coarser level, or 0 when there is none. */
  coarseSpacing: number;
  pixelSizeM: number;
}

/** Undulation at a map position for a level with the given bands and ring blend factor (1 = fully this level). */
export function undulationAt(mapX: number, mapY: number, bands: Bands, ring: number): number {
  let sum = 0;
  for (let k = 0; k < UNDULATION.octaves; k += 1) {
    const wavelength = UNDULATION.smallestWavelengthM * 2 ** k;
    const data = dataWeight(wavelength, bands.pixelSizeM);
    if (data <= 0) break;
    const fine = bandWeight(wavelength, bands.spacing) * data;
    if (fine <= 0) continue;
    const coarse = bands.coarseSpacing > 0 ? bandWeight(wavelength, bands.coarseSpacing) * data : fine;
    const weight = coarse + (fine - coarse) * ring;
    if (weight <= 0) continue;
    sum += weight * UNDULATION.amplitude * wavelength * valueNoise(mapX / wavelength, mapY / wavelength, k);
  }
  return sum;
}

// ---------------------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------------------

/** Crater relief and freshness at one map position, evaluated from the hashed grids: O(1) per point. */
export function detailHeight(mapX: number, mapY: number, pixelSizeM = 10): number {
  const bands: Bands = { spacing: 0, coarseSpacing: 0, pixelSizeM };
  const buffer = craterBuffer();
  let sum = undulationAt(mapX, mapY, bands, 1);
  for (let octave = 0; octave < CRATERS.octaves; octave += 1) {
    const dMin = octaveDiameter(octave);
    if (dMin >= 4 * pixelSizeM) break;
    const cell = octaveCell(octave);
    const ci = Math.floor(mapX / cell);
    const cj = Math.floor(mapY / cell);
    for (let dj = -1; dj <= 1; dj += 1) {
      for (let di = -1; di <= 1; di += 1) {
        const count = generateCell(octave, ci + di, cj + dj, buffer);
        for (let m = 0; m < count; m += 1) {
          const o = m * STRIDE;
          const weight = dataWeight(buffer[o + 10] as number, pixelSizeM);
          if (weight <= 0) continue;
          sum += weight * craterRelief(buffer, o, mapX, mapY);
        }
      }
    }
  }
  return sum;
}

function craterRelief(buffer: Float64Array, o: number, x: number, y: number): number {
  const dx = x - (buffer[o] as number);
  const dy = y - (buffer[o + 1] as number);
  const cos = buffer[o + 8] as number;
  const sin = buffer[o + 9] as number;
  const u = dx * cos + dy * sin;
  const v = -dx * sin + dy * cos;
  const q = Math.sqrt(u * u * (buffer[o + 6] as number) + v * v * (buffer[o + 7] as number));
  return profile(q, buffer[o + 3] as number, buffer[o + 4] as number, buffer[o + 5] as number);
}

/**
 * Brightness of immature material at a map position from fresh craters of at least `minDiameterM`: 0 on
 * ordinary ground, up to 1 inside and just outside the freshest craters. Also marks where boulders gather.
 */
export function freshnessAt(mapX: number, mapY: number, minDiameterM: number): number {
  const buffer = craterBuffer();
  let sum = 0;
  for (let octave = 0; octave < CRATERS.octaves; octave += 1) {
    if (2 * octaveDiameter(octave) < minDiameterM) continue;
    const cell = octaveCell(octave);
    const ci = Math.floor(mapX / cell);
    const cj = Math.floor(mapY / cell);
    for (let dj = -1; dj <= 1; dj += 1) {
      for (let di = -1; di <= 1; di += 1) {
        const count = generateCell(octave, ci + di, cj + dj, buffer);
        for (let m = 0; m < count; m += 1) {
          const o = m * STRIDE;
          const fresh = buffer[o + 11] as number;
          if (fresh <= 0 || (buffer[o + 10] as number) < minDiameterM) continue;
          const dx = mapX - (buffer[o] as number);
          const dy = mapY - (buffer[o + 1] as number);
          const cos = buffer[o + 8] as number;
          const sin = buffer[o + 9] as number;
          const u = dx * cos + dy * sin;
          const v = -dx * sin + dy * cos;
          const q = Math.sqrt(u * u * (buffer[o + 6] as number) + v * v * (buffer[o + 7] as number));
          sum += halo(q, fresh);
        }
      }
    }
  }
  return Math.min(1, sum);
}

export interface LevelGrid extends Bands {
  size: number;
  /** Map coordinates of sample (0, 0); map y falls with the row index. */
  mapX0: number;
  mapY0: number;
  /** Fraction of the half span, from the edge, over which a level blends into the next coarser one. */
  ringFraction: number;
}

/**
 * Add the synthetic relief of one level to `height` (metres, additive) and write immature-material
 * brightness to `maturity`. Craters are stamped octave by octave from the same hashed cells `detailHeight`
 * reads, so both give identical numbers. Each crater is weighted by how well this level can show it; across
 * the outer ring the weights move to those of the next coarser level, so the surface meets that level
 * without a step.
 */
export function stampLevel(grid: LevelGrid, height: Float32Array, maturity: Float32Array): void {
  const { size: n, spacing, mapX0, mapY0, pixelSizeM } = grid;
  const half = (n - 1) / 2;
  const ringWidth = Math.max(grid.ringFraction, 1e-3);
  const xMin = mapX0;
  const xMax = mapX0 + (n - 1) * spacing;
  const yMax = mapY0;
  const yMin = mapY0 - (n - 1) * spacing;
  const buffer = craterBuffer();
  const hasCoarse = grid.coarseSpacing > 0;

  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const edge = Math.min(i, j, n - 1 - i, n - 1 - j) / half;
      const ring = hasCoarse ? smoothstep(0, ringWidth, edge) : 1;
      height[j * n + i] = (height[j * n + i] as number) + undulationAt(mapX0 + i * spacing, mapY0 - j * spacing, grid, ring);
    }
  }

  for (let octave = 0; octave < CRATERS.octaves; octave += 1) {
    const dMin = octaveDiameter(octave);
    if (2 * dMin <= 2.5 * spacing) continue;
    if (dMin >= 4 * pixelSizeM) break;
    const cell = octaveCell(octave);
    const ci0 = Math.floor(xMin / cell) - 1;
    const ci1 = Math.floor(xMax / cell) + 1;
    const cj0 = Math.floor(yMin / cell) - 1;
    const cj1 = Math.floor(yMax / cell) + 1;
    for (let cj = cj0; cj <= cj1; cj += 1) {
      for (let ci = ci0; ci <= ci1; ci += 1) {
        const count = generateCell(octave, ci, cj, buffer);
        for (let m = 0; m < count; m += 1) {
          const o = m * STRIDE;
          const diameter = buffer[o + 10] as number;
          const data = dataWeight(diameter, pixelSizeM);
          const fine = bandWeight(diameter, spacing) * data;
          const coarse = hasCoarse ? bandWeight(diameter, grid.coarseSpacing) * data : fine;
          if (fine <= 0 && coarse <= 0) continue;
          stampCrater(grid, buffer, o, fine, coarse, half, ringWidth, height, maturity);
        }
      }
    }
  }
}

function stampCrater(
  grid: LevelGrid,
  buffer: Float64Array,
  o: number,
  fine: number,
  coarse: number,
  half: number,
  ringWidth: number,
  height: Float32Array,
  maturity: Float32Array,
): void {
  const { size: n, spacing, mapX0, mapY0 } = grid;
  const cx = buffer[o] as number;
  const cy = buffer[o + 1] as number;
  const radius = buffer[o + 2] as number;
  const depth = buffer[o + 3] as number;
  const rim = buffer[o + 4] as number;
  const rounding = buffer[o + 5] as number;
  const invA = buffer[o + 6] as number;
  const invB = buffer[o + 7] as number;
  const cos = buffer[o + 8] as number;
  const sin = buffer[o + 9] as number;
  const fresh = buffer[o + 11] as number;
  const reach = (fresh > 0 ? CRATERS.haloReach : CRATERS.reach) * radius * 1.12;
  const i0 = Math.max(0, Math.floor((cx - reach - mapX0) / spacing));
  const i1 = Math.min(n - 1, Math.ceil((cx + reach - mapX0) / spacing));
  const j0 = Math.max(0, Math.floor((mapY0 - (cy + reach)) / spacing));
  const j1 = Math.min(n - 1, Math.ceil((mapY0 - (cy - reach)) / spacing));
  const ringed = grid.coarseSpacing > 0 && fine !== coarse;
  for (let j = j0; j <= j1; j += 1) {
    const dy = mapY0 - j * spacing - cy;
    for (let i = i0; i <= i1; i += 1) {
      const dx = mapX0 + i * spacing - cx;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      const q = Math.sqrt(u * u * invA + v * v * invB);
      if (q >= CRATERS.haloReach) continue;
      let weight = fine;
      if (ringed) {
        const edge = Math.min(i, j, n - 1 - i, n - 1 - j) / half;
        weight = coarse + (fine - coarse) * smoothstep(0, ringWidth, edge);
      }
      if (weight <= 0) continue;
      const k = j * n + i;
      if (q < CRATERS.reach) height[k] = (height[k] as number) + weight * profile(q, depth, rim, rounding);
      if (fresh > 0) maturity[k] = Math.min(1, (maturity[k] as number) + weight * halo(q, fresh));
    }
  }
}

/**
 * Relief of the craters that a level's mesh cannot show but a finer grid can, on a grid four times finer than the level's
 * (`detail` grid: size, spacing, map origin as for `stampLevel`; `levelSpacing` and `coarseSpacing` are the level's own).
 * Each crater is weighted by (what the fine grid can show) minus (what the level's mesh already carries there, which across
 * the outer ring moves to the coarser level's weights, exactly as `stampLevel` does), so mesh plus detail is always the same
 * crater field at full strength and nothing is counted twice. Only the gradient of this field is used, as a shading normal.
 */
export function stampDetail(grid: LevelGrid, levelSpacing: number, height: Float32Array): void {
  const { size: n, spacing, mapX0, mapY0, pixelSizeM } = grid;
  const half = (n - 1) / 2;
  const ringWidth = Math.max(grid.ringFraction, 1e-3);
  const xMin = mapX0;
  const xMax = mapX0 + (n - 1) * spacing;
  const yMax = mapY0;
  const yMin = mapY0 - (n - 1) * spacing;
  const buffer = craterBuffer();
  const hasCoarse = grid.coarseSpacing > 0;
  for (let octave = 0; octave < CRATERS.octaves; octave += 1) {
    const dMin = octaveDiameter(octave);
    const octaveDetail = octaveDetailWeight(octave, spacing);
    if (octaveDetail <= 0) continue;
    if (dMin >= 4 * pixelSizeM) break;
    const cell = octaveCell(octave);
    const ci0 = Math.floor(xMin / cell) - 1;
    const ci1 = Math.floor(xMax / cell) + 1;
    const cj0 = Math.floor(yMin / cell) - 1;
    const cj1 = Math.floor(yMax / cell) + 1;
    for (let cj = cj0; cj <= cj1; cj += 1) {
      for (let ci = ci0; ci <= ci1; ci += 1) {
        const count = generateCell(octave, ci, cj, buffer);
        for (let m = 0; m < count; m += 1) {
          const o = m * STRIDE;
          const diameter = buffer[o + 10] as number;
          const data = dataWeight(diameter, pixelSizeM);
          const detail = octaveDetail * data;
          const fine = bandWeight(diameter, levelSpacing) * data;
          const coarse = hasCoarse ? bandWeight(diameter, grid.coarseSpacing) * data : fine;
          if (detail - Math.min(fine, coarse) <= 1e-4 && detail - Math.max(fine, coarse) <= 1e-4) continue;
          stampDetailCrater(grid, buffer, o, detail, fine, coarse, half, ringWidth, height);
        }
      }
    }
  }
}

function stampDetailCrater(
  grid: LevelGrid,
  buffer: Float64Array,
  o: number,
  detail: number,
  fine: number,
  coarse: number,
  half: number,
  ringWidth: number,
  height: Float32Array,
): void {
  const { size: n, spacing, mapX0, mapY0 } = grid;
  const cx = buffer[o] as number;
  const cy = buffer[o + 1] as number;
  const radius = buffer[o + 2] as number;
  const depth = buffer[o + 3] as number;
  const rim = buffer[o + 4] as number;
  const rounding = buffer[o + 5] as number;
  const invA = buffer[o + 6] as number;
  const invB = buffer[o + 7] as number;
  const cos = buffer[o + 8] as number;
  const sin = buffer[o + 9] as number;
  const reach = CRATERS.reach * radius * 1.12;
  const i0 = Math.max(0, Math.floor((cx - reach - mapX0) / spacing));
  const i1 = Math.min(n - 1, Math.ceil((cx + reach - mapX0) / spacing));
  const j0 = Math.max(0, Math.floor((mapY0 - (cy + reach)) / spacing));
  const j1 = Math.min(n - 1, Math.ceil((mapY0 - (cy - reach)) / spacing));
  for (let j = j0; j <= j1; j += 1) {
    const dy = mapY0 - j * spacing - cy;
    for (let i = i0; i <= i1; i += 1) {
      const dx = mapX0 + i * spacing - cx;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      const q = Math.sqrt(u * u * invA + v * v * invB);
      if (q >= CRATERS.reach) continue;
      const edge = Math.min(i, j, n - 1 - i, n - 1 - j) / half;
      const mesh = coarse + (fine - coarse) * smoothstep(0, ringWidth, edge);
      const weight = detail - mesh;
      if (weight <= 0) continue;
      const k = j * n + i;
      height[k] = (height[k] as number) + weight * profile(q, depth, rim, rounding);
    }
  }
}

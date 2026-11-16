import { freshnessAt } from './craters';
import { chain, hash2, poisson, unit } from './hash';

/**
 * Rock population. Cumulative number per square metre of rocks larger than D follows a power law
 * (Golombek and Rapp 1997 for lunar and Martian ejecta; Bart and Melosh 2010 give slopes of 2 to 4 for lunar
 * craters' ejecta), set here to N(>D) = 0.35 (D / 0.1 m)^-2.6: about 2 per cent of the ground covered by
 * rocks overall, one boulder over a metre per 1100 square metres. Boulders gather around fresh craters,
 * where they are excavated: the density is multiplied by 1 + boost * freshness.
 */
export const ROCKS = {
  slope: 2.6,
  densityAt100mm: 0.35,
  /** Mean number of rocks of a class per grid cell on ordinary ground. */
  perCell: 0.3,
  variants: 6,
  /** Rocks up to this distance of the camera are drawn; each class has its own radius. */
  classes: [
    { diameterM: 0.05, radiusM: 28, boost: 4 },
    { diameterM: 0.1, radiusM: 56, boost: 4 },
    { diameterM: 0.2, radiusM: 112, boost: 6 },
    { diameterM: 0.4, radiusM: 224, boost: 8 },
    { diameterM: 0.8, radiusM: 450, boost: 12 },
    { diameterM: 1.6, radiusM: 900, boost: 20 },
  ],
} as const;

export const ROCK_STRIDE = 10;
const SEED_ROCK = 7919;

export function rockCumulative(diameterM: number): number {
  return ROCKS.densityAt100mm * (diameterM / 0.1) ** -ROCKS.slope;
}

export function rockCell(classIndex: number): number {
  const c = ROCKS.classes[classIndex];
  if (!c) return 1;
  const density = rockCumulative(c.diameterM) - rockCumulative(2 * c.diameterM);
  return Math.sqrt(ROCKS.perCell / density);
}

export interface RockJob {
  classIndex: number;
  /** Scene centre of the window and the drawn radius. */
  centreX: number;
  centreZ: number;
  siteMapX: number;
  siteMapY: number;
  /** Per variant capacity, in rocks. */
  capacity: number;
  /** Window radius when it is not the class's drawn radius (the rover asks for rocks near itself only). */
  radiusM?: number;
}

export interface RockSet {
  classIndex: number;
  centreX: number;
  centreZ: number;
  /** Per variant: ROCK_STRIDE numbers per rock (x, z, half sizes x y z, yaw, pitch, roll, buried fraction, albedo factor). */
  data: Float32Array[];
  counts: number[];
}

export function generateRocks(job: RockJob): RockSet {
  const c = ROCKS.classes[job.classIndex];
  if (!c) throw new Error('Unknown rock class.');
  const cell = rockCell(job.classIndex);
  const radius = job.radiusM ?? c.radiusM;
  const density = rockCumulative(c.diameterM) - rockCumulative(2 * c.diameterM);
  const data = Array.from({ length: ROCKS.variants }, () => new Float32Array(job.capacity * ROCK_STRIDE));
  const counts = new Array<number>(ROCKS.variants).fill(0);

  // Freshness on a coarse patch grid; it varies over metres, not centimetres.
  const patch = Math.max(2, radius / 14);
  const patches = Math.ceil((2 * radius) / patch) + 2;
  const fresh = new Float32Array(patches * patches);
  const mapLeft = job.siteMapX + job.centreX - radius - patch;
  const mapTop = job.siteMapY - (job.centreZ - radius - patch);
  for (let pj = 0; pj < patches; pj += 1) {
    for (let pi = 0; pi < patches; pi += 1) {
      fresh[pj * patches + pi] = freshnessAt(mapLeft + pi * patch, mapTop - pj * patch, 1.5);
    }
  }
  const freshAt = (mapX: number, mapY: number): number => {
    const u = (mapX - mapLeft) / patch;
    const v = (mapTop - mapY) / patch;
    const i = Math.max(0, Math.min(patches - 2, Math.floor(u)));
    const j = Math.max(0, Math.min(patches - 2, Math.floor(v)));
    const fu = Math.max(0, Math.min(1, u - i));
    const fv = Math.max(0, Math.min(1, v - j));
    const a = fresh[j * patches + i] as number;
    const b = fresh[j * patches + i + 1] as number;
    const cc = fresh[(j + 1) * patches + i] as number;
    const d = fresh[(j + 1) * patches + i + 1] as number;
    return a + (b - a) * fu + (cc - a) * fv + (a - b - cc + d) * fu * fv;
  };

  const mapXMin = job.siteMapX + job.centreX - radius;
  const mapXMax = job.siteMapX + job.centreX + radius;
  const mapYMin = job.siteMapY - (job.centreZ + radius);
  const mapYMax = job.siteMapY - (job.centreZ - radius);
  const span = 1 - 2 ** -ROCKS.slope;
  for (let cj = Math.floor(mapYMin / cell); cj <= Math.floor(mapYMax / cell); cj += 1) {
    for (let ci = Math.floor(mapXMin / cell); ci <= Math.floor(mapXMax / cell); ci += 1) {
      let h = hash2(ci, cj, SEED_ROCK + job.classIndex * 977);
      const centreMapX = (ci + 0.5) * cell;
      const centreMapY = (cj + 0.5) * cell;
      const lambda = density * cell * cell * (1 + c.boost * freshAt(centreMapX, centreMapY));
      const count = poisson(lambda, unit(h));
      for (let m = 0; m < count; m += 1) {
        h = chain(h);
        const ux = unit(h);
        h = chain(h);
        const uy = unit(h);
        h = chain(h);
        const uSize = unit(h);
        h = chain(h);
        const uVariant = unit(h);
        h = chain(h);
        const uA = unit(h);
        h = chain(h);
        const uB = unit(h);
        h = chain(h);
        const uYaw = unit(h);
        h = chain(h);
        const uPitch = unit(h);
        h = chain(h);
        const uRoll = unit(h);
        h = chain(h);
        const uBury = unit(h);
        h = chain(h);
        const uAlbedo = unit(h);
        const mapX = (ci + ux) * cell;
        const mapY = (cj + uy) * cell;
        const x = mapX - job.siteMapX;
        const z = job.siteMapY - mapY;
        const dx = x - job.centreX;
        const dz = z - job.centreZ;
        if (dx * dx + dz * dz > radius * radius) continue;
        const variant = Math.min(ROCKS.variants - 1, Math.floor(uVariant * ROCKS.variants));
        const index = counts[variant] as number;
        if (index >= job.capacity) continue;
        counts[variant] = index + 1;
        const diameter = c.diameterM * (1 - uSize * span) ** (-1 / ROCKS.slope);
        const longHalf = diameter / 2;
        const o = index * ROCK_STRIDE;
        const out = data[variant] as Float32Array;
        out[o] = x;
        out[o + 1] = z;
        out[o + 2] = longHalf;
        out[o + 3] = longHalf * (0.35 + 0.45 * uA);
        out[o + 4] = longHalf * (0.6 + 0.4 * uB);
        out[o + 5] = uYaw * Math.PI * 2;
        out[o + 6] = (uPitch - 0.5) * 0.7;
        out[o + 7] = (uRoll - 0.5) * 0.7;
        out[o + 8] = 0.15 + 0.35 * uBury;
        out[o + 9] = 0.85 + 0.35 * uAlbedo;
      }
    }
  }
  return { classIndex: job.classIndex, centreX: job.centreX, centreZ: job.centreZ, data, counts };
}

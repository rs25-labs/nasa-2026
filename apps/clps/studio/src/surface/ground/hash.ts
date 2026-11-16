/** Integer hashing for deterministic placement: the same cell always yields the same numbers. */

export function hash2(i: number, j: number, seed: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The next number of a hash chain. */
export function chain(h: number): number {
  let x = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  return (x ^ (x >>> 15)) >>> 0;
}

/** Uniform number in [0, 1) from a hash. */
export function unit(h: number): number {
  return h / 4294967296;
}

export function smoothstep(low: number, high: number, value: number): number {
  const t = value <= low ? 0 : value >= high ? 1 : (value - low) / (high - low);
  return t * t * (3 - 2 * t);
}

/** Poisson-distributed count with mean `lambda` from one uniform number. */
export function poisson(lambda: number, u: number): number {
  let p = Math.exp(-lambda);
  let cumulative = p;
  let n = 0;
  while (u > cumulative && n < 40) {
    n += 1;
    p *= lambda / n;
    cumulative += p;
  }
  return n;
}

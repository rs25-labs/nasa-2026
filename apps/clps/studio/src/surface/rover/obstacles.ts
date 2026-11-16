import type { DetailPool } from '../ground/detailPool';
import { generateRocks, ROCK_STRIDE, ROCKS, type RockSet } from '../ground/rockPlacement';
import type { GroundQuery } from '../core/types';

/** Rocks taller than this above the ground are obstacles; lower ones are driven over (the wheels ride up on them). */
export const OBSTACLE_HEIGHT_M = 0.3;
const FIRST_CLASS = 1;
const WINDOW_RADIUS_M = 60;
const REFRESH_DISTANCE_M = 20;
const CAPACITY = 5000;
const CELL_M = 4;
const DIGEST_PER_CALL = 500;

export interface Rock {
  x: number;
  z: number;
  /** Half sizes along the rock's own axes; the footprint is treated as a circle of the larger horizontal one. */
  radius: number;
  /** Height of the top above the ground at the rock's centre, and the ground height there. */
  top: number;
  ground: number;
  halfHeight: number;
  centreY: number;
}

/**
 * Rocks near the rover, from the same deterministic placement the rock field draws, so what the rover bumps into is what
 * is on screen. Obstacles stop the rover; low rocks lift the wheels. The first window is built at once (a staged view
 * must be exact); every later window is generated in a worker and its ground heights are read a slice per frame, so
 * driving never stalls the main thread (generating one on the main thread cost about 24 ms every 20 m).
 */
export class RockQuery {
  private readonly buckets = new Map<number, Rock[]>();
  private centreX = Number.NaN;
  private centreZ = Number.NaN;
  private version = -1;
  private siteMapX = 0;
  private siteMapY = 0;
  obstacles: Rock[] = [];
  private inflight = false;
  private queue: { set: RockSet; variant: number; k: number }[] = [];
  private nextBuckets = new Map<number, Rock[]>();
  private nextObstacles: Rock[] = [];
  private nextCentre: [number, number, number] | null = null;

  setSite(mapX: number, mapY: number): void {
    if (mapX === this.siteMapX && mapY === this.siteMapY) return;
    this.siteMapX = mapX;
    this.siteMapY = mapY;
    this.centreX = Number.NaN;
  }

  /** Refresh when the rover has moved well away from the last window or the terrain changed under it. */
  refresh(x: number, z: number, ground: GroundQuery, terrainVersion: number, pool: DetailPool | null = null, force = false): void {
    if (this.nextCentre !== null) {
      this.digest(ground);
      return;
    }
    const moved = Math.hypot(x - this.centreX, z - this.centreZ);
    if (!force && Number.isFinite(moved) && moved < REFRESH_DISTANCE_M && terrainVersion === this.version) return;
    if (!Number.isFinite(ground.heightAt(x, z))) return;
    if (pool && Number.isFinite(this.centreX) && !force) {
      this.refreshLater(x, z, terrainVersion, pool);
      return;
    }
    this.centreX = x;
    this.centreZ = z;
    this.version = terrainVersion;
    this.buckets.clear();
    this.obstacles = [];
    for (let classIndex = FIRST_CLASS; classIndex < ROCKS.classes.length; classIndex += 1) {
      const set = generateRocks({
        classIndex,
        centreX: x,
        centreZ: z,
        siteMapX: this.siteMapX,
        siteMapY: this.siteMapY,
        capacity: CAPACITY,
        radiusM: WINDOW_RADIUS_M,
      });
      for (let variant = 0; variant < ROCKS.variants; variant += 1) {
        const data = set.data[variant] as Float32Array;
        for (let k = 0; k < (set.counts[variant] as number); k += 1) {
          const rock = this.readRock(data, k, ground);
          if (rock) this.add(rock, this.buckets, this.obstacles);
        }
      }
    }
  }

  private refreshLater(x: number, z: number, terrainVersion: number, pool: DetailPool): void {
    if (this.inflight) return;
    this.inflight = true;
    const jobs: Promise<RockSet>[] = [];
    for (let classIndex = FIRST_CLASS; classIndex < ROCKS.classes.length; classIndex += 1) {
      jobs.push(
        pool.rocks({ classIndex, centreX: x, centreZ: z, siteMapX: this.siteMapX, siteMapY: this.siteMapY, capacity: CAPACITY, radiusM: WINDOW_RADIUS_M }),
      );
    }
    Promise.all(jobs)
      .then((sets) => {
        this.queue = [];
        for (const set of sets) for (let variant = 0; variant < ROCKS.variants; variant += 1) this.queue.push({ set, variant, k: 0 });
        this.nextBuckets = new Map();
        this.nextObstacles = [];
        this.nextCentre = [x, z, terrainVersion];
      })
      .catch(() => undefined)
      .finally(() => {
        this.inflight = false;
      });
  }

  /** Read the ground under a slice of the new window's rocks; install the window when the last slice is done. */
  private digest(ground: GroundQuery): void {
    let budget = DIGEST_PER_CALL;
    while (budget > 0 && this.queue.length > 0) {
      const item = this.queue[0] as { set: RockSet; variant: number; k: number };
      const data = item.set.data[item.variant] as Float32Array;
      const count = item.set.counts[item.variant] as number;
      for (; item.k < count && budget > 0; item.k += 1, budget -= 1) {
        const rock = this.readRock(data, item.k, ground);
        if (rock) this.add(rock, this.nextBuckets, this.nextObstacles);
      }
      if (item.k >= count) this.queue.shift();
    }
    if (this.queue.length === 0 && this.nextCentre) {
      this.centreX = this.nextCentre[0];
      this.centreZ = this.nextCentre[1];
      this.version = this.nextCentre[2];
      this.buckets.clear();
      for (const [key, bucket] of this.nextBuckets) this.buckets.set(key, bucket);
      this.obstacles = this.nextObstacles;
      this.nextCentre = null;
    }
  }

  private readRock(data: Float32Array, k: number, ground: GroundQuery): Rock | null {
    const o = k * ROCK_STRIDE;
    const rx = data[o] as number;
    const rz = data[o + 1] as number;
    const sizeX = data[o + 2] as number;
    const sizeY = data[o + 3] as number;
    const sizeZ = data[o + 4] as number;
    const buried = data[o + 8] as number;
    const base = ground.heightAt(rx, rz);
    if (!Number.isFinite(base)) return null;
    const centreY = base + sizeY * (1 - 2 * buried);
    const top = centreY + sizeY - base;
    if (top < 0.03) return null;
    return { x: rx, z: rz, radius: Math.max(sizeX, sizeZ), top, ground: base, halfHeight: sizeY, centreY };
  }

  private add(rock: Rock, buckets: Map<number, Rock[]>, obstacles: Rock[]): void {
    const key = bucketKey(rock.x, rock.z);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(rock);
    else buckets.set(key, [rock]);
    if (rock.top > OBSTACLE_HEIGHT_M) obstacles.push(rock);
  }

  /** Height of low rocks at (x, z), or -Infinity. A rock is a dome: a flattened ellipsoid cap on the ground. */
  bumpAt(x: number, z: number): number {
    let best = Number.NEGATIVE_INFINITY;
    const cx = Math.floor(x / CELL_M);
    const cz = Math.floor(z / CELL_M);
    for (let i = cx - 1; i <= cx + 1; i += 1) {
      for (let j = cz - 1; j <= cz + 1; j += 1) {
        const bucket = this.buckets.get(i * 73856093 ^ j * 19349663);
        if (!bucket) continue;
        for (const rock of bucket) {
          if (rock.top > OBSTACLE_HEIGHT_M) continue;
          const d = Math.hypot(x - rock.x, z - rock.z) / rock.radius;
          if (d >= 1) continue;
          const height = rock.centreY + rock.halfHeight * Math.sqrt(1 - d * d);
          if (height > best) best = height;
        }
      }
    }
    return best;
  }

  /** Obstacles within `reach` of (x, z). */
  near(x: number, z: number, reach: number, out: Rock[]): Rock[] {
    out.length = 0;
    for (const rock of this.obstacles) {
      if (Math.abs(rock.x - x) < reach + rock.radius && Math.abs(rock.z - z) < reach + rock.radius) out.push(rock);
    }
    return out;
  }
}

function bucketKey(x: number, z: number): number {
  return Math.floor(x / CELL_M) * 73856093 ^ Math.floor(z / CELL_M) * 19349663;
}

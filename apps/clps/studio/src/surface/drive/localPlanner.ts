import type { GroundQuery } from '../core/types';
import type { Rock } from '../rover/obstacles';

/**
 * Local planner: an A* search on a 0.5 m grid around the rover from where it is to a point ahead on the planned route,
 * with every rock taller than 15 cm grown by the rover's footprint. The 40 m route grid cannot see rocks; this steers
 * around them and rejoins the route. It also reads the height field the rover drives on (10 m data and procedural
 * craters): a cell whose slope over the wheelbase is steeper than the limit is blocked, and steepness below it costs extra,
 * so the autopilot goes round crater walls the 10 m route planner could not see. When no way round exists the limit is
 * relaxed in two steps before giving up.
 */
const CELL_M = 0.5;
/** Half the rover's wheelbase: slopes are measured across 1.24 m, not at a point. */
const SLOPE_BASE_M = 0.62;
const SLOPE_COST = 2;
const RELAX_STEPS = [1, 1.5, Number.POSITIVE_INFINITY] as const;
const CACHE_LIFETIME_MS = 3000;
const HALF_CELLS = 48;
const SIZE = 2 * HALF_CELLS + 1;
const STEP_COST = [1, Math.SQRT2];
const NEIGHBOURS: readonly [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [1, 1, 1],
  [1, -1, 1],
  [-1, 1, 1],
  [-1, -1, 1],
];

export interface PlanResult {
  /** Waypoints from the rover toward the goal, in scene metres, string-pulled. Empty when no way through was found. */
  waypoints: { x: number; z: number }[];
  found: boolean;
}

export class LocalPlanner {
  private readonly blocked = new Uint8Array(SIZE * SIZE);
  private readonly cost = new Float32Array(SIZE * SIZE);
  private readonly parent = new Int32Array(SIZE * SIZE);
  private readonly closed = new Uint8Array(SIZE * SIZE);
  private readonly slopeDeg = new Float32Array(SIZE * SIZE);
  private ground: GroundQuery | null = null;
  private limitDeg = Number.POSITIVE_INFINITY;
  /** Slopes on a 1 m world grid, kept for a few seconds so replanning every metre or two re-reads little ground. */
  private readonly slopeCache = new Map<number, number>();
  private cacheClearedAt = 0;
  /** How far the slope limit had to be relaxed for the last plan: 1 is not at all. */
  lastRelax: number = 1;
  private heap: number[] = [];
  private originX = 0;
  private originZ = 0;

  private index(cx: number, cz: number): number {
    return cz * SIZE + cx;
  }

  private cell(x: number, z: number): [number, number] {
    return [Math.round((x - this.originX) / CELL_M) + HALF_CELLS, Math.round((z - this.originZ) / CELL_M) + HALF_CELLS];
  }

  private inside(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < SIZE && cz < SIZE;
  }

  /** Plan from (sx, sz) to (gx, gz); the goal is moved to the nearest free cell inside the window if needed. */
  plan(sx: number, sz: number, gx: number, gz: number, rocks: Rock[], footprint: number, ground: GroundQuery | null = null, slopeLimitDeg = Number.POSITIVE_INFINITY): PlanResult {
    this.ground = ground;
    const now = performance.now();
    if (now - this.cacheClearedAt > CACHE_LIFETIME_MS || this.slopeCache.size > 40_000) {
      this.slopeCache.clear();
      this.cacheClearedAt = now;
    }
    const steps = ground ? RELAX_STEPS : [1];
    let result: PlanResult = { waypoints: [], found: false };
    for (const relax of steps) {
      this.limitDeg = slopeLimitDeg * relax;
      this.lastRelax = relax;
      result = this.search(sx, sz, gx, gz, rocks, footprint);
      if (result.found) break;
    }
    return result;
  }

  /** Slope (degrees) of the ground over the wheelbase at the 1 m world cell holding (x, z). */
  private slopeAtWorld(x: number, z: number): number {
    const ground = this.ground;
    if (!ground) return 0;
    const ix = Math.round(x);
    const iz = Math.round(z);
    const key = (ix + 100_000) * 200_003 + (iz + 100_000);
    const cached = this.slopeCache.get(key);
    if (cached !== undefined) return cached;
    const d = SLOPE_BASE_M;
    const east = ground.heightAt(ix + d, iz);
    const west = ground.heightAt(ix - d, iz);
    const south = ground.heightAt(ix, iz + d);
    const north = ground.heightAt(ix, iz - d);
    const value = [east, west, south, north].every(Number.isFinite) ? (Math.atan(Math.hypot(east - west, south - north) / (2 * d)) * 180) / Math.PI : 0;
    this.slopeCache.set(key, value);
    return value;
  }

  /** Slope of a window cell, read once per plan. */
  private cellSlope(cx: number, cz: number): number {
    const index = this.index(cx, cz);
    const known = this.slopeDeg[index] as number;
    if (!Number.isNaN(known)) return known;
    const value = this.slopeAtWorld(this.originX + (cx - HALF_CELLS) * CELL_M, this.originZ + (cz - HALF_CELLS) * CELL_M);
    this.slopeDeg[index] = value;
    return value;
  }

  private isBlocked(cx: number, cz: number): boolean {
    return this.blocked[this.index(cx, cz)] === 1 || this.cellSlope(cx, cz) > this.limitDeg;
  }

  private search(sx: number, sz: number, gx: number, gz: number, rocks: Rock[], footprint: number): PlanResult {
    this.originX = sx;
    this.originZ = sz;
    this.blocked.fill(0);
    this.closed.fill(0);
    this.slopeDeg.fill(Number.NaN);
    this.cost.fill(Number.POSITIVE_INFINITY);
    for (const rock of rocks) {
      const reach = rock.radius + footprint;
      const [cx, cz] = this.cell(rock.x, rock.z);
      const span = Math.ceil(reach / CELL_M) + 1;
      for (let dz = -span; dz <= span; dz += 1) {
        for (let dx = -span; dx <= span; dx += 1) {
          const x = cx + dx;
          const z = cz + dz;
          if (!this.inside(x, z)) continue;
          const wx = this.originX + (x - HALF_CELLS) * CELL_M;
          const wz = this.originZ + (z - HALF_CELLS) * CELL_M;
          if ((wx - rock.x) ** 2 + (wz - rock.z) ** 2 < reach * reach) this.blocked[this.index(x, z)] = 1;
        }
      }
    }
    // The rover's own surroundings are never blocked: it is already there.
    const [startX, startZ] = this.cell(sx, sz);
    for (let dz = -3; dz <= 3; dz += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        if (dx * dx + dz * dz <= 9 && this.inside(startX + dx, startZ + dz)) {
          this.blocked[this.index(startX + dx, startZ + dz)] = 0;
          this.slopeDeg[this.index(startX + dx, startZ + dz)] = 0;
        }
      }
    }
    // Clamp the goal into the window and onto a free cell.
    let [goalX, goalZ] = this.cell(gx, gz);
    goalX = Math.max(1, Math.min(SIZE - 2, goalX));
    goalZ = Math.max(1, Math.min(SIZE - 2, goalZ));
    if (this.isBlocked(goalX, goalZ)) {
      let best = Number.POSITIVE_INFINITY;
      let bx = goalX;
      let bz = goalZ;
      for (let z = 0; z < SIZE; z += 1) {
        for (let x = 0; x < SIZE; x += 1) {
          const d = (x - goalX) ** 2 + (z - goalZ) ** 2;
          if (d >= best || this.isBlocked(x, z)) continue;
          {
            best = d;
            bx = x;
            bz = z;
          }
        }
      }
      goalX = bx;
      goalZ = bz;
    }
    const start = this.index(startX, startZ);
    const goal = this.index(goalX, goalZ);
    this.cost[start] = 0;
    this.parent[start] = -1;
    this.heap = [start];
    const priority = new Float32Array(SIZE * SIZE);
    const heuristic = (x: number, z: number): number => Math.hypot(x - goalX, z - goalZ);
    priority[start] = heuristic(startX, startZ);
    let found = false;
    let closest = start;
    let closestDistance = heuristic(startX, startZ);
    while (this.heap.length > 0) {
      const current = this.pop(priority);
      if (this.closed[current]) continue;
      this.closed[current] = 1;
      const here = heuristic(current % SIZE, Math.floor(current / SIZE));
      if (here < closestDistance) {
        closestDistance = here;
        closest = current;
      }
      if (current === goal) {
        found = true;
        break;
      }
      const cx = current % SIZE;
      const cz = (current - cx) / SIZE;
      for (const [dx, dz, diagonal] of NEIGHBOURS) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (!this.inside(nx, nz)) continue;
        const next = this.index(nx, nz);
        if (this.closed[next] || this.isBlocked(nx, nz)) continue;
        if (diagonal && (this.isBlocked(cx + dx, cz) || this.isBlocked(cx, cz + dz))) continue;
        const steepness = Number.isFinite(this.limitDeg) ? (this.cellSlope(nx, nz) / this.limitDeg) ** 2 : 0;
        const cost = (this.cost[current] as number) + (STEP_COST[diagonal] as number) * (1 + SLOPE_COST * steepness);
        if (cost < (this.cost[next] as number)) {
          this.cost[next] = cost;
          this.parent[next] = current;
          priority[next] = cost + heuristic(nx, nz);
          this.push(next, priority);
        }
      }
    }
    // The goal may sit in a pocket the rover cannot reach (boulders all round it): go to the nearest cell it can reach.
    const target = found ? goal : closest;
    if (!found && (target === start || closestDistance > heuristic(startX, startZ) - 2)) return { waypoints: [], found: false };
    const cells: number[] = [];
    for (let at = target; at !== -1; at = this.parent[at] as number) cells.push(at);
    cells.reverse();
    const points = cells.map((c) => {
      const x = c % SIZE;
      const z = (c - x) / SIZE;
      return { x: this.originX + (x - HALF_CELLS) * CELL_M, z: this.originZ + (z - HALF_CELLS) * CELL_M };
    });
    return { waypoints: this.pull(points), found: true };
  }

  /** String pulling: keep only the corners the path needs, using a straight-line check over the blocked grid. */
  private pull(points: { x: number; z: number }[]): { x: number; z: number }[] {
    if (points.length <= 2) return points;
    const out = [points[0] as { x: number; z: number }];
    let anchor = 0;
    for (let k = 2; k < points.length; k += 1) {
      if (!this.clear(points[anchor] as { x: number; z: number }, points[k] as { x: number; z: number })) {
        out.push(points[k - 1] as { x: number; z: number });
        anchor = k - 1;
      }
    }
    out.push(points[points.length - 1] as { x: number; z: number });
    return out;
  }

  private clear(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(distance / (CELL_M * 0.5));
    for (let k = 0; k <= steps; k += 1) {
      const t = steps === 0 ? 0 : k / steps;
      const [cx, cz] = this.cell(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
      if (!this.inside(cx, cz) || this.isBlocked(cx, cz)) return false;
    }
    return true;
  }

  private push(node: number, priority: Float32Array): void {
    const heap = this.heap;
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((priority[heap[parent] as number] as number) <= (priority[heap[i] as number] as number)) break;
      [heap[parent], heap[i]] = [heap[i] as number, heap[parent] as number];
      i = parent;
    }
  }

  private pop(priority: Float32Array): number {
    const heap = this.heap;
    const top = heap[0] as number;
    const last = heap.pop() as number;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && (priority[heap[l] as number] as number) < (priority[heap[m] as number] as number)) m = l;
        if (r < heap.length && (priority[heap[r] as number] as number) < (priority[heap[m] as number] as number)) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i] as number, heap[m] as number];
        i = m;
      }
    }
    return top;
  }
}

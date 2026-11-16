import type { DriveResponse } from '../../lib/api/types';
import { polarXY } from '../../lib/geo/polar';

/**
 * A route in scene metres: the planned points joined to the rover's real start by a short connector (the route snaps
 * its ends to the 40 m terrain grid). `s` is distance along the path, metres, from the rover's start.
 */
export interface RoutePath {
  x: Float64Array;
  z: Float64Array;
  s: Float64Array;
  total: number;
  /** Path length before the first planned point (the connector). */
  connectorM: number;
  /** Planned elevation change is not used for driving; the visible ground is. */
  routeDistanceM: number;
  travelSeconds: number;
}

export function buildPath(response: DriveResponse, siteLatitudeDeg: number, siteLongitudeDeg: number, startX = 0, startZ = 0): RoutePath {
  const origin = polarXY(siteLatitudeDeg, siteLongitudeDeg);
  const xs: number[] = [startX];
  const zs: number[] = [startZ];
  for (const point of response.points) {
    const x = point.x_m - origin.x;
    const z = -(point.y_m - origin.y);
    if (Math.hypot(x - (xs.at(-1) as number), z - (zs.at(-1) as number)) < 0.5) continue;
    xs.push(x);
    zs.push(z);
  }
  smooth(xs, zs);
  const s = new Float64Array(xs.length);
  for (let k = 1; k < xs.length; k += 1) {
    s[k] = (s[k - 1] as number) + Math.hypot((xs[k] as number) - (xs[k - 1] as number), (zs[k] as number) - (zs[k - 1] as number));
  }
  const first = response.points[0];
  const connector = first ? Math.hypot(first.x_m - origin.x - startX, -(first.y_m - origin.y) - startZ) : 0;
  return {
    x: Float64Array.from(xs),
    z: Float64Array.from(zs),
    s,
    total: s[s.length - 1] as number,
    connectorM: connector < 0.5 ? 0 : connector,
    routeDistanceM: response.distance_m,
    travelSeconds: response.travel_seconds,
  };
}

/**
 * The planner returns a path on the terrain grid, all straight and diagonal steps. A vehicle cannot follow those corners
 * without weaving, so the path is eased into a curve: a short moving average takes out the staircase and two rounds of
 * corner cutting round what is left. Both ends stay where they are.
 */
function smooth(xs: number[], zs: number[]): void {
  const count = xs.length;
  if (count < 4) return;
  const reach = 2;
  for (let pass = 0; pass < 2; pass += 1) {
    const sx = xs.slice();
    const sz = zs.slice();
    for (let k = 1; k < count - 1; k += 1) {
      const from = Math.max(0, k - reach);
      const to = Math.min(count - 1, k + reach);
      let x = 0;
      let z = 0;
      for (let j = from; j <= to; j += 1) {
        x += sx[j] as number;
        z += sz[j] as number;
      }
      xs[k] = x / (to - from + 1);
      zs[k] = z / (to - from + 1);
    }
  }
  for (let round = 0; round < 2; round += 1) {
    const nx: number[] = [xs[0] as number];
    const nz: number[] = [zs[0] as number];
    for (let k = 0; k + 1 < xs.length; k += 1) {
      const ax = xs[k] as number;
      const az = zs[k] as number;
      const bx = xs[k + 1] as number;
      const bz = zs[k + 1] as number;
      nx.push(ax + (bx - ax) * 0.25, ax + (bx - ax) * 0.75);
      nz.push(az + (bz - az) * 0.25, az + (bz - az) * 0.75);
    }
    nx.push(xs[xs.length - 1] as number);
    nz.push(zs[zs.length - 1] as number);
    xs.length = 0;
    zs.length = 0;
    xs.push(...nx);
    zs.push(...nz);
  }
}

/** Position on the path at arc length s (clamped); writes the unit tangent too. */
export function pointAt(path: RoutePath, s: number, out: { x: number; z: number; tx: number; tz: number }): void {
  const clamped = Math.max(0, Math.min(path.total, s));
  let lo = 0;
  let hi = path.s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((path.s[mid] as number) <= clamped) lo = mid;
    else hi = mid;
  }
  const a = lo;
  const b = Math.min(path.s.length - 1, lo + 1);
  const span = (path.s[b] as number) - (path.s[a] as number);
  const t = span > 1e-9 ? (clamped - (path.s[a] as number)) / span : 0;
  out.x = (path.x[a] as number) + ((path.x[b] as number) - (path.x[a] as number)) * t;
  out.z = (path.z[a] as number) + ((path.z[b] as number) - (path.z[a] as number)) * t;
  const length = Math.hypot((path.x[b] as number) - (path.x[a] as number), (path.z[b] as number) - (path.z[a] as number)) || 1;
  out.tx = ((path.x[b] as number) - (path.x[a] as number)) / length;
  out.tz = ((path.z[b] as number) - (path.z[a] as number)) / length;
}

/** Arc length of the point on the path nearest (x, z), searched near `hint`, and the distance to it. */
export function project(path: RoutePath, x: number, z: number, hint: number, window = 60): { s: number; distance: number } {
  let best = Number.POSITIVE_INFINITY;
  let bestS = hint;
  const from = hint - window;
  const to = hint + window;
  for (let k = 0; k + 1 < path.s.length; k += 1) {
    const sa = path.s[k] as number;
    const sb = path.s[k + 1] as number;
    if (sb < from || sa > to) continue;
    const ax = path.x[k] as number;
    const az = path.z[k] as number;
    const dx = (path.x[k + 1] as number) - ax;
    const dz = (path.z[k + 1] as number) - az;
    const length2 = dx * dx + dz * dz;
    const t = length2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length2)) : 0;
    const distance = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (distance < best) {
      best = distance;
      bestS = sa + (sb - sa) * t;
    }
  }
  return { s: bestS, distance: best };
}

/** Global nearest point (no hint), for "return to route". */
export function nearest(path: RoutePath, x: number, z: number): { s: number; distance: number } {
  return project(path, x, z, path.total / 2, path.total);
}

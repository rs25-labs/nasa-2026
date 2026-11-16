import type { GroundQuery } from '../core/types';
import type { Rock } from '../rover/obstacles';

/** Where a crewed outpost sits around the landing site (scene metres; the rover parks at the origin). */
export interface Placement {
  x: number;
  z: number;
  /** Heading about the vertical, radians. */
  yaw: number;
}

export interface BaseLayout {
  lander: Placement;
  habitat: Placement;
  masts: Placement[];
  /** Where the cluster is centred, for the Stay camera. */
  centre: { x: number; z: number };
}

export const SLOPE_LIMIT_DEG = 8;

interface Spec {
  /** Footprint radius, metres: the ground within it must be flat and clear of rocks. */
  radius: number;
  anchor: [number, number];
  /** Search out to this far from the anchor. */
  reach: number;
}

const LANDER: Spec = { radius: 5.5, anchor: [-4, -19], reach: 14 };
const HABITAT: Spec = { radius: 4, anchor: [-30, -34], reach: 16 };
const MAST_RADIUS = 1.8;
const MAST_ANCHORS: [number, number][] = [
  [26, -52],
  [-52, -8],
  [14, 34],
];
const MAST_REACH = 16;
/** Keep this much clear around the rover's parking place (origin). */
const ROVER_CLEARANCE_M = 7;
const RING_SAMPLES = 12;

/** Largest rise over a ring of the given radius, as a slope in degrees (rise / diameter across the ring). */
export function footprintSlopeDeg(ground: GroundQuery, x: number, z: number, radius: number): number {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  const centre = ground.heightAt(x, z);
  if (!Number.isFinite(centre)) return Number.NaN;
  for (let k = 0; k < RING_SAMPLES; k += 1) {
    const angle = (k / RING_SAMPLES) * Math.PI * 2;
    const h = ground.heightAt(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius);
    if (!Number.isFinite(h)) return Number.NaN;
    low = Math.min(low, h);
    high = Math.max(high, h);
  }
  low = Math.min(low, centre);
  high = Math.max(high, centre);
  return (Math.atan((high - low) / (2 * radius)) * 180) / Math.PI;
}

function clearOfRocks(rocks: Rock[], x: number, z: number, radius: number): boolean {
  for (const rock of rocks) {
    if (Math.hypot(rock.x - x, rock.z - z) < radius + rock.radius) return false;
  }
  return true;
}

interface Placed {
  x: number;
  z: number;
  radius: number;
}

function place(ground: GroundQuery, rocks: Rock[], spec: { radius: number; anchor: [number, number]; reach: number }, placed: Placed[]): Placement | null {
  let best: { x: number; z: number; score: number } | null = null;
  const step = 2;
  for (let ring = 0; ring <= spec.reach; ring += step) {
    const samples = ring === 0 ? 1 : Math.max(8, Math.round((ring * Math.PI * 2) / step));
    for (let k = 0; k < samples; k += 1) {
      const angle = (k / samples) * Math.PI * 2;
      const x = spec.anchor[0] + Math.cos(angle) * ring;
      const z = spec.anchor[1] + Math.sin(angle) * ring;
      if (Math.hypot(x, z) < ROVER_CLEARANCE_M + spec.radius) continue;
      if (placed.some((other) => Math.hypot(other.x - x, other.z - z) < other.radius + spec.radius + 3)) continue;
      const slope = footprintSlopeDeg(ground, x, z, spec.radius);
      if (!Number.isFinite(slope)) continue;
      const rockPenalty = clearOfRocks(rocks, x, z, spec.radius) ? 0 : 6;
      const score = slope + rockPenalty + ring * 0.05;
      if (best === null || score < best.score) best = { x, z, score };
      if (slope <= SLOPE_LIMIT_DEG && rockPenalty === 0) return { x, z, yaw: 0 };
    }
  }
  return best ? { x: best.x, z: best.z, yaw: 0 } : null;
}

/**
 * Choose the places for the lander, the habitat and the solar masts: the first spot nearest each preferred anchor whose
 * ground under the footprint is flatter than SLOPE_LIMIT_DEG and clear of boulders, not touching anything placed before.
 * Null while the ground is not loaded there.
 */
export function layoutBase(ground: GroundQuery, rocks: Rock[]): BaseLayout | null {
  const placed: Placed[] = [{ x: 0, z: 0, radius: 0.1 }];
  const lander = place(ground, rocks, LANDER, placed);
  if (!lander) return null;
  placed.push({ x: lander.x, z: lander.z, radius: LANDER.radius });
  const habitat = place(ground, rocks, HABITAT, placed);
  if (!habitat) return null;
  placed.push({ x: habitat.x, z: habitat.z, radius: HABITAT.radius });
  const masts: Placement[] = [];
  for (const anchor of MAST_ANCHORS) {
    const mast = place(ground, rocks, { radius: MAST_RADIUS, anchor, reach: MAST_REACH }, placed);
    if (!mast) return null;
    placed.push({ x: mast.x, z: mast.z, radius: MAST_RADIUS });
    masts.push(mast);
  }
  // The habitat's door and the lander's ladder face each other, so the path between them is short.
  // Local +Z is the front of each model (ladder, door): it turns toward the other element.
  lander.yaw = Math.atan2(habitat.x - lander.x, habitat.z - lander.z);
  habitat.yaw = Math.atan2(lander.x - habitat.x, lander.z - habitat.z);
  return {
    lander,
    habitat,
    masts,
    centre: { x: (lander.x + habitat.x) / 2, z: (lander.z + habitat.z) / 2 },
  };
}

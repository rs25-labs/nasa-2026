import type { GroundQuery } from '../core/types';
import { ROVER } from '../rover/model';

export interface GroundSlope {
  /** Rise per metre of travel along the heading and to the right. */
  pitchSlope: number;
  rollSlope: number;
  slopeDeg: number;
}

const PITCH_BASE_M = 2 * ROVER.halfBase;
const ROLL_BASE_M = 2 * ROVER.halfTrack;

/**
 * Slope of the visible ground under the rover over its own footprint (wheelbase by track), from six height samples. A
 * crater lip or a rock a few decimetres across does not read as a cliff: only what the whole rover sits across counts.
 * Returns null while any of the ground is not loaded.
 */
export function measureSlope(ground: GroundQuery, x: number, z: number, yaw: number): GroundSlope | null {
  const forwardX = Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = Math.sin(yaw);
  const at = (forward: number, right: number): number => ground.heightAt(x + forwardX * forward + rightX * right, z + forwardZ * forward + rightZ * right);
  const front = [at(ROVER.halfBase, -ROVER.halfTrack), at(ROVER.halfBase, ROVER.halfTrack)];
  const rear = [at(-ROVER.halfBase, -ROVER.halfTrack), at(-ROVER.halfBase, ROVER.halfTrack)];
  const mid = [at(0, -ROVER.halfTrack), at(0, ROVER.halfTrack)];
  const values = [...front, ...rear, ...mid];
  if (!values.every(Number.isFinite)) return null;
  const pitchSlope = (front[0]! + front[1]! - rear[0]! - rear[1]!) / 2 / PITCH_BASE_M;
  const rollSlope = ((front[1]! - front[0]!) + (rear[1]! - rear[0]!) + (mid[1]! - mid[0]!)) / 3 / ROLL_BASE_M;
  return { pitchSlope, rollSlope, slopeDeg: (Math.atan(Math.hypot(pitchSlope, rollSlope)) * 180) / Math.PI };
}

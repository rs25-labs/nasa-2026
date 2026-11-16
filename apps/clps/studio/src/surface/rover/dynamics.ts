import * as THREE from 'three';
import type { GroundQuery } from '../core/types';
import { ROVER } from './model';
import type { RockQuery } from './obstacles';

const GROUSER_REACH = 0.01;
const LONGITUDINAL = [-0.55, -0.27, 0, 0.27, 0.55];
const LATERAL = [-0.07, 0.07];

/** Spring travel and the body's smoothing in real seconds: the body settles on the wheels in about a tenth of a second. */
const BODY_SMOOTH_S = 0.12;

interface Damped {
  value: number;
  velocity: number;
}

/** Critically damped follow (Game Programming Gems 4); stable for any step. */
function smoothDamp(state: Damped, target: number, smoothTime: number, dt: number): void {
  const omega = 2 / Math.max(smoothTime, 1e-4);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = state.value - target;
  const temp = (state.velocity + omega * change) * dt;
  state.velocity = (state.velocity - omega * temp) * exp;
  state.value = target + (change + temp) * exp;
}

export interface WheelContact {
  /** Wheel centre height in the world, from the envelope of the ground and low rocks under the tyre. */
  hub: number;
  /** Offset of the hub from the body's axle plane, after the travel limit. */
  offset: number;
  /** True when the travel limit stopped the wheel short of the ground. */
  limited: boolean;
}

/**
 * Four independently suspended wheels on swing arms. Each wheel's hub height is the envelope of a circle rolling on
 * the visible ground (terrain height and low rocks), so wheels drop into craters and climb the edges of rocks. The
 * body rides on the plane through the four hubs, smoothed, so it pitches and rolls with the terrain; each wheel's
 * remaining offset from that plane is its spring travel, limited to +-ROVER.travel.
 */
export class RoverDynamics {
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  yaw = 0;
  readonly wheels: WheelContact[] = [0, 1, 2, 3].map(() => ({ hub: 0, offset: 0, limited: false }));
  /** Slopes of the body plane: rise per metre forward and to the right. */
  pitchSlope = 0;
  rollSlope = 0;
  valid = false;
  private readonly height: Damped = { value: 0, velocity: 0 };
  private readonly pitch: Damped = { value: 0, velocity: 0 };
  private readonly roll: Damped = { value: 0, velocity: 0 };
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly scratchForward = new THREE.Vector3();
  private readonly scratchRight = new THREE.Vector3();
  /** Wheel nominal positions in the axle frame, in the order front-left, front-right, rear-left, rear-right. */
  static readonly layout: readonly [number, number][] = [
    [-ROVER.halfTrack, -ROVER.halfBase],
    [ROVER.halfTrack, -ROVER.halfBase],
    [-ROVER.halfTrack, ROVER.halfBase],
    [ROVER.halfTrack, ROVER.halfBase],
  ];

  /** World position of wheel i's centre column at the given body position and heading (y not set). */
  wheelXZ(i: number, x: number, z: number, yaw: number, out: THREE.Vector3): THREE.Vector3 {
    const [lx, lz] = RoverDynamics.layout[i] as [number, number];
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    // forward = (sin, -cos); right = (cos, sin); local z is negative forward.
    return out.set(x + cos * lx + sin * -lz, 0, z + sin * lx + -cos * -lz);
  }

  /**
   * Move to (x, z) heading `yaw` and update the pose. `dt` is real seconds of smoothing; 0 snaps. Returns false while
   * the ground under the rover is not loaded (the pose is left as it was).
   */
  update(x: number, z: number, yaw: number, dt: number, ground: GroundQuery, rocks: RockQuery | null): boolean {
    this.yaw = yaw;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    this.forward.set(sin, 0, -cos);
    this.right.set(cos, 0, sin);
    const heights: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const [lx, lz] = RoverDynamics.layout[i] as [number, number];
      const wx = x + this.right.x * lx - this.forward.x * lz;
      const wz = z + this.right.z * lx - this.forward.z * lz;
      let hub = Number.NEGATIVE_INFINITY;
      for (const along of LONGITUDINAL) {
        const s = along * ROVER.wheelRadius;
        const reach = Math.sqrt(ROVER.wheelRadius * ROVER.wheelRadius - s * s) + GROUSER_REACH;
        for (const side of LATERAL) {
          const sx = wx + this.forward.x * s + this.right.x * side;
          const sz = wz + this.forward.z * s + this.right.z * side;
          let h = ground.heightAt(sx, sz);
          if (!Number.isFinite(h)) return false;
          if (rocks) h = Math.max(h, rocks.bumpAt(sx, sz));
          hub = Math.max(hub, h + reach);
        }
      }
      heights.push(hub);
    }
    const mean = (heights[0]! + heights[1]! + heights[2]! + heights[3]!) / 4;
    let sumFh = 0;
    let sumXh = 0;
    let sumF2 = 0;
    let sumX2 = 0;
    for (let i = 0; i < 4; i += 1) {
      const [lx, lz] = RoverDynamics.layout[i] as [number, number];
      const f = -lz;
      sumFh += f * (heights[i]! - mean);
      sumXh += lx * (heights[i]! - mean);
      sumF2 += f * f;
      sumX2 += lx * lx;
    }
    const targetPitch = sumFh / sumF2;
    const targetRoll = sumXh / sumX2;
    if (!this.valid || dt <= 0) {
      this.height.value = mean;
      this.pitch.value = targetPitch;
      this.roll.value = targetRoll;
      this.height.velocity = this.pitch.velocity = this.roll.velocity = 0;
    } else {
      smoothDamp(this.height, mean, BODY_SMOOTH_S, dt);
      smoothDamp(this.pitch, targetPitch, BODY_SMOOTH_S, dt);
      smoothDamp(this.roll, targetRoll, BODY_SMOOTH_S, dt);
    }
    this.valid = true;
    this.pitchSlope = this.pitch.value;
    this.rollSlope = this.roll.value;
    for (let i = 0; i < 4; i += 1) {
      const [lx, lz] = RoverDynamics.layout[i] as [number, number];
      const plane = this.height.value + this.pitch.value * -lz + this.roll.value * lx;
      const wanted = heights[i]! - plane;
      const wheel = this.wheels[i] as WheelContact;
      wheel.hub = heights[i]!;
      wheel.offset = Math.max(-ROVER.travel, Math.min(ROVER.travel, wanted));
      wheel.limited = Math.abs(wanted) > ROVER.travel;
    }
    this.position.set(x, this.height.value, z);
    this.normal.set(-this.pitch.value * this.forward.x - this.roll.value * this.right.x, 1, -this.pitch.value * this.forward.z - this.roll.value * this.right.z).normalize();
    this.scratchForward.copy(this.forward).addScaledVector(this.normal, -this.forward.dot(this.normal)).normalize();
    this.scratchRight.crossVectors(this.scratchForward, this.normal).normalize();
    const alignedForward = this.scratchForward.crossVectors(this.normal, this.scratchRight).normalize();
    this.basis.makeBasis(this.scratchRight, this.normal, alignedForward.negate());
    this.quaternion.setFromRotationMatrix(this.basis);
    return true;
  }

  /** Slope of the ground under the body in degrees, and the slope along the heading (positive uphill). */
  get slopeDeg(): number {
    return (Math.atan(Math.hypot(this.pitchSlope, this.rollSlope)) * 180) / Math.PI;
  }

  get pitchDeg(): number {
    return (Math.atan(this.pitchSlope) * 180) / Math.PI;
  }

  get rollDeg(): number {
    return (Math.atan(this.rollSlope) * 180) / Math.PI;
  }
}

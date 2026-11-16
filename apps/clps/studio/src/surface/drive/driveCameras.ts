import * as THREE from 'three';
import type { CameraController } from '../core/cameras';
import type { GroundQuery } from '../core/types';
import { drive, type CameraKind } from '../../lib/mission/drive.svelte';
import type { RoverExtension } from '../rover/rover';
import type { DriveSim } from './driveSim';

const RAD = Math.PI / 180;
const MIN_CLEARANCE_M = 0.6;

export type DriveView = CameraKind | 'plan' | 'base';

export const FOV = { chase: 50, driver: 66, mast: 40, orbit: 50, plan: 50, base: 40 } as const;

interface Follow {
  value: THREE.Vector3;
  velocity: THREE.Vector3;
}

function dampVector(state: Follow, target: THREE.Vector3, smoothTime: number, dt: number): void {
  const omega = 2 / Math.max(smoothTime, 1e-3);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = state.value.clone().sub(target);
  const temp = state.velocity.clone().addScaledVector(change, omega).multiplyScalar(dt);
  state.velocity.addScaledVector(temp, -omega).multiplyScalar(exp);
  state.value.copy(target).add(change.add(temp).multiplyScalar(exp));
}

/**
 * The four drive cameras and the top-down planning view, behind one controller. Each frame it runs the drive's step
 * first (so the camera sees this frame's pose), then places the camera.
 */
export class DriveCameras implements CameraController {
  view: DriveView = 'chase';
  /** Chase: azimuth offset from straight behind (radians), elevation (radians) and distance (metres). */
  chaseAzimuth = 0.55;
  chaseElevation = 13 * RAD;
  chaseDistance = 11;
  /** Mast: pan and tilt relative to the rover's heading. */
  mastPan = 0;
  mastTilt = -8 * RAD;
  mastFov: number = FOV.mast;
  /** Orbit around the rover: compass azimuth, elevation, distance. */
  orbitAzimuth = 200 * RAD;
  orbitElevation = 25 * RAD;
  orbitDistance = 25;
  /** Planning: the point looked at, and the height above it. */
  planTarget = new THREE.Vector3();
  planDistance = 2500;
  /** Base (Stay): orbit around the outpost's centre; turns slowly until the viewer drags it. */
  baseCentre = new THREE.Vector3();
  baseAzimuth = 0;
  baseElevation = 16 * RAD;
  baseDistance = 62;
  autoOrbit = true;
  /** Per-frame hook that runs before the drive's step (the Stay clock). */
  beforeStep: ((deltaSeconds: number) => void) | null = null;
  fov: number = FOV.chase;
  /** Set when the view was staged: the camera jumps there instead of gliding. */
  snap = true;

  private readonly position: Follow = { value: new THREE.Vector3(0, 5, 0), velocity: new THREE.Vector3() };
  private readonly look: Follow = { value: new THREE.Vector3(0, 0, -5), velocity: new THREE.Vector3() };
  private readonly quaternion = new THREE.Quaternion();
  private readonly driverQuaternion = new THREE.Quaternion();
  private haveDriverQuaternion = false;
  private readonly scratch = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly euler = new THREE.Euler();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private visualSpeed = 0;
  private lastRover = new THREE.Vector3();

  constructor(
    private readonly rover: RoverExtension,
    private readonly sim: DriveSim,
  ) {}

  setView(view: DriveView): void {
    this.view = view;
    this.fov = FOV[view];
    if (view === 'mast') this.fov = this.mastFov;
    this.snap = true;
    this.haveDriverQuaternion = false;
  }

  drag(deltaX: number, deltaY: number): void {
    switch (this.view) {
      case 'chase':
        this.chaseAzimuth -= deltaX * 0.005;
        this.chaseElevation = Math.max(2 * RAD, Math.min(80 * RAD, this.chaseElevation + deltaY * 0.004));
        break;
      case 'mast':
        this.mastPan -= deltaX * 0.003;
        this.mastTilt = Math.max(-85 * RAD, Math.min(80 * RAD, this.mastTilt - deltaY * 0.003));
        break;
      case 'orbit':
        this.orbitAzimuth += deltaX * 0.005;
        this.orbitElevation = Math.max(2 * RAD, Math.min(89 * RAD, this.orbitElevation + deltaY * 0.005));
        break;
      case 'base':
        this.autoOrbit = false;
        this.baseAzimuth += deltaX * 0.005;
        this.baseElevation = Math.max(2 * RAD, Math.min(80 * RAD, this.baseElevation + deltaY * 0.005));
        break;
      case 'plan': {
        const scale = (this.planDistance * 0.0009);
        this.planTarget.x -= deltaX * scale;
        this.planTarget.z -= deltaY * scale;
        break;
      }
      default:
        break;
    }
  }

  wheel(delta: number): void {
    const factor = Math.exp(delta * 0.001);
    if (this.view === 'chase') this.chaseDistance = Math.max(5, Math.min(80, this.chaseDistance * factor));
    else if (this.view === 'orbit') this.orbitDistance = Math.max(4, Math.min(20_000, this.orbitDistance * factor));
    else if (this.view === 'base') this.baseDistance = Math.max(12, Math.min(400, this.baseDistance * factor));
    else if (this.view === 'plan') this.planDistance = Math.max(200, Math.min(14_000, this.planDistance * factor));
    else if (this.view === 'mast') {
      this.mastFov = Math.max(8, Math.min(70, this.mastFov * factor));
      this.fov = this.mastFov;
    }
  }

  update(deltaSeconds: number, keys: ReadonlySet<string>, ground: GroundQuery): void {
    const wasStaging = this.rover.staging;
    this.beforeStep?.(deltaSeconds);
    this.sim.step(deltaSeconds, keys);
    const dt = Math.min(deltaSeconds, 0.1);
    const dyn = this.rover.dynamics;
    const here = dyn.position;
    if (dt > 0) {
      const moved = this.lastRover.distanceTo(here);
      this.visualSpeed = this.visualSpeed * 0.8 + 0.2 * (moved / Math.max(dt, 1e-3));
    }
    this.lastRover.copy(here);
    const jump = this.snap || wasStaging;
    this.snap = this.rover.staging;
    const yaw = dyn.yaw;

    const goalPosition = this.scratch;
    const goalLook = this.scratchB;
    switch (this.view) {
      case 'chase': {
        const speedBoost = Math.min(this.visualSpeed, 120);
        const distance = this.chaseDistance + speedBoost * 0.12;
        const elevation = Math.min(80 * RAD, this.chaseElevation + speedBoost * 0.002);
        const azimuth = yaw + Math.PI + this.chaseAzimuth;
        const level = Math.cos(elevation) * distance;
        goalLook.set(here.x, here.y + 0.55, here.z).addScaledVector(this.forward(yaw), 0.8);
        goalPosition.set(here.x + Math.sin(azimuth) * level, here.y + 0.55 + Math.sin(elevation) * distance, here.z - Math.cos(azimuth) * level);
        break;
      }
      case 'driver':
      case 'mast': {
        this.rover.mastHeadWorld(goalPosition);
        const pitchFollow = this.view === 'driver' ? -16 * RAD + 0.5 * Math.atan(dyn.pitchSlope) : this.mastTilt;
        const pan = this.view === 'mast' ? this.mastPan : 0;
        this.euler.set(pitchFollow, -(yaw + pan), 0, 'YXZ');
        const target = new THREE.Quaternion().setFromEuler(this.euler);
        if (!this.haveDriverQuaternion || jump) {
          this.driverQuaternion.copy(target);
          this.haveDriverQuaternion = true;
        } else {
          this.driverQuaternion.slerp(target, 1 - Math.exp(-dt / 0.08));
        }
        goalLook.copy(goalPosition).add(new THREE.Vector3(0, 0, -1).applyQuaternion(this.driverQuaternion));
        break;
      }
      case 'base': {
        if (this.autoOrbit && drive.stay && !drive.stayPaused) this.baseAzimuth += 0.5 * RAD * dt;
        goalLook.set(this.baseCentre.x, this.baseCentre.y + 3, this.baseCentre.z);
        const level = Math.cos(this.baseElevation) * this.baseDistance;
        goalPosition.set(this.baseCentre.x + Math.sin(this.baseAzimuth) * level, this.baseCentre.y + 3 + Math.sin(this.baseElevation) * this.baseDistance, this.baseCentre.z - Math.cos(this.baseAzimuth) * level);
        break;
      }
      case 'orbit': {
        goalLook.set(here.x, here.y + 0.6, here.z);
        const level = Math.cos(this.orbitElevation) * this.orbitDistance;
        goalPosition.set(here.x + Math.sin(this.orbitAzimuth) * level, here.y + Math.sin(this.orbitElevation) * this.orbitDistance, here.z - Math.cos(this.orbitAzimuth) * level);
        break;
      }
      default: {
        goalLook.copy(this.planTarget);
        const level = Math.cos(88 * RAD) * this.planDistance;
        goalPosition.set(this.planTarget.x, this.planTarget.y + Math.sin(88 * RAD) * this.planDistance, this.planTarget.z + level);
        break;
      }
    }

    if (this.view === 'driver' || this.view === 'mast') {
      this.position.value.copy(goalPosition);
      this.position.velocity.set(0, 0, 0);
      this.look.value.copy(goalLook);
      this.look.velocity.set(0, 0, 0);
      this.quaternion.copy(this.driverQuaternion);
      return;
    }
    if (jump) {
      this.position.value.copy(goalPosition);
      this.position.velocity.set(0, 0, 0);
      this.look.value.copy(goalLook);
      this.look.velocity.set(0, 0, 0);
    } else if (this.view === 'chase') {
      const speed = Math.max(this.visualSpeed, 0);
      const smooth = 0.3 / (1 + speed / 8);
      dampVector(this.position, goalPosition, smooth, dt);
      dampVector(this.look, goalLook, smooth * 0.6, dt);
    } else if (this.view === 'orbit' || this.view === 'base') {
      const smooth = 0.25 / (1 + this.visualSpeed / 8);
      dampVector(this.position, goalPosition, smooth, dt);
      dampVector(this.look, goalLook, smooth, dt);
    } else {
      this.position.value.copy(goalPosition);
      this.look.value.copy(goalLook);
    }
    const floor = ground.heightAt(this.position.value.x, this.position.value.z);
    if (Number.isFinite(floor)) this.position.value.y = Math.max(this.position.value.y, floor + MIN_CLEARANCE_M);
  }

  apply(camera: THREE.PerspectiveCamera): void {
    camera.position.copy(this.position.value);
    if (this.view === 'driver' || this.view === 'mast') {
      camera.quaternion.copy(this.quaternion);
    } else {
      camera.up.copy(this.up);
      camera.lookAt(this.look.value);
    }
  }

  private forward(yaw: number): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
  }
}

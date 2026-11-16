import * as THREE from 'three';
import type { GroundQuery } from './types';

const RAD = Math.PI / 180;
const MIN_CLEARANCE_M = 0.3;
const PITCH_LIMIT = 89 * RAD;

export interface CameraController {
  update(deltaSeconds: number, keys: ReadonlySet<string>, ground: GroundQuery): void;
  apply(camera: THREE.PerspectiveCamera): void;
  drag(deltaX: number, deltaY: number): void;
  wheel(delta: number): void;
}

/** Yaw is a compass bearing in scene axes: 0 looks along -Z (map north), 90 along +X. */
export class WalkCamera implements CameraController {
  readonly position = new THREE.Vector3(0, 2, 0);
  yaw = 0;
  pitch = 0;
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  place(x: number, y: number, z: number, yawDeg: number, pitchDeg: number): void {
    this.position.set(x, y, z);
    this.yaw = yawDeg * RAD;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitchDeg * RAD));
  }

  drag(deltaX: number, deltaY: number): void {
    this.yaw += deltaX * 0.0025;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - deltaY * 0.0025));
  }

  wheel(): void {}

  update(deltaSeconds: number, keys: ReadonlySet<string>, ground: GroundQuery): void {
    const floor = ground.heightAt(this.position.x, this.position.z);
    const above = Number.isFinite(floor) ? Math.max(0, this.position.y - floor) : 0;
    const speed = (3 + 0.5 * above) * (keys.has('shift') ? 8 : 1);
    this.forward.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    this.right.set(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const step = speed * deltaSeconds;
    if (keys.has('w')) this.position.addScaledVector(this.forward, step);
    if (keys.has('s')) this.position.addScaledVector(this.forward, -step);
    if (keys.has('d')) this.position.addScaledVector(this.right, step);
    if (keys.has('a')) this.position.addScaledVector(this.right, -step);
    if (keys.has('e')) this.position.y += step;
    if (keys.has('q')) this.position.y -= step;
    const ground2 = ground.heightAt(this.position.x, this.position.z);
    if (Number.isFinite(ground2)) this.position.y = Math.max(this.position.y, ground2 + MIN_CLEARANCE_M);
  }

  apply(camera: THREE.PerspectiveCamera): void {
    camera.position.copy(this.position);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, -this.yaw, 0);
  }
}

/** Orbit around the site. Azimuth is the compass bearing the camera sits at, seen from the target. */
export class OrbitCamera implements CameraController {
  azimuth = 200 * RAD;
  elevation = 25 * RAD;
  distance = 1800;
  readonly target = new THREE.Vector3(0, 0, 0);
  private readonly position = new THREE.Vector3();

  place(azimuthDeg: number, elevationDeg: number, distance: number): void {
    this.azimuth = azimuthDeg * RAD;
    this.elevation = Math.max(2 * RAD, Math.min(PITCH_LIMIT, elevationDeg * RAD));
    this.distance = Math.max(10, distance);
  }

  drag(deltaX: number, deltaY: number): void {
    this.azimuth += deltaX * 0.005;
    this.elevation = Math.max(2 * RAD, Math.min(PITCH_LIMIT, this.elevation + deltaY * 0.005));
  }

  wheel(delta: number): void {
    this.distance = Math.max(10, Math.min(150_000, this.distance * Math.exp(delta * 0.001)));
  }

  update(_deltaSeconds: number, _keys: ReadonlySet<string>, ground: GroundQuery): void {
    const level = Math.cos(this.elevation) * this.distance;
    this.position.set(
      this.target.x + Math.sin(this.azimuth) * level,
      this.target.y + Math.sin(this.elevation) * this.distance,
      this.target.z - Math.cos(this.azimuth) * level,
    );
    const floor = ground.heightAt(this.position.x, this.position.z);
    if (Number.isFinite(floor)) this.position.y = Math.max(this.position.y, floor + 2);
  }

  apply(camera: THREE.PerspectiveCamera): void {
    camera.position.copy(this.position);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.target);
  }
}

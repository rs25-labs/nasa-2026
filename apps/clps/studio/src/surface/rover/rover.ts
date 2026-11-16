import * as THREE from 'three';
import type { LightingFrame, SurfaceContext, SurfaceExtension } from '../core/types';
import { HEADLIGHT } from '../light/constants';
import { addRoverShadowCaster, removeRoverShadowCaster, roverShadowFocus } from '../light/objectShadow';
import { sharedLight } from '../light/uniforms';
import { Dust, type Launch } from './dust';
import { RoverDynamics } from './dynamics';
import { buildRover, ROVER, type RoverModel } from './model';
import { RockQuery } from './obstacles';
import { TrackLayer } from './tracks';

const RAD = Math.PI / 180;
const CONFORM_BUDGET_PAIRS = 400;
const MAX_LAYS_PER_FRAME = 150;

/**
 * The rover in the scene: model, wheel dynamics on the visible ground, tracks, dust and headlamps. The drive code
 * decides where the rover goes (x, z, heading, wheel speeds); this decides how it sits on the ground and looks.
 */
export class RoverExtension implements SurfaceExtension {
  readonly dynamics = new RoverDynamics();
  readonly rocks = new RockQuery();
  readonly tracks = new TrackLayer();
  readonly dust = new Dust();
  model: RoverModel | null = null;
  readonly steer = [0, 0, 0, 0];
  headlightsOn = false;
  /** Set by the drive code while it stages a view; holds `__surfaceReady` back. */
  staging = false;
  private context: SurfaceContext | null = null;
  private visible = true;
  private readonly scratch = new THREE.Vector3();
  private readonly lampWorld = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly lampLocalDirection = new THREE.Vector3(0, -Math.sin(HEADLIGHT.pitchDownDeg * RAD), -Math.cos(HEADLIGHT.pitchDownDeg * RAD));
  private readonly sunDirection = new THREE.Vector3();
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private lastYaw = 0;
  private dustClock = 0;
  private dustPaused = false;
  private readonly pixelScaleSize = new THREE.Vector2();

  attach(context: SurfaceContext): void {
    this.context = context;
    this.model = buildRover();
    context.scene.add(this.model.root);
    context.scene.add(this.tracks.group);
    context.scene.add(this.dust.points);
    addRoverShadowCaster(this.model.root);
  }

  /** Move the whole rover to a pose and read the ground under it. False while the ground there is not loaded. */
  placeAt(x: number, z: number, yaw: number, smoothSeconds = 0): boolean {
    const context = this.context;
    if (!context) return false;
    const site = context.terrain.site;
    if (site) this.rocks.setSite(site.mapX, site.mapY);
    this.rocks.refresh(x, z, context.ground, context.terrain.version, context.terrain.pool);
    const ok = this.dynamics.update(x, z, yaw, smoothSeconds, context.ground, this.rocks);
    if (ok) this.syncMesh();
    return ok;
  }

  get valid(): boolean {
    return this.dynamics.valid;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.model) this.model.root.visible = visible;
    this.tracks.group.visible = visible;
    this.dust.points.visible = visible;
  }

  /** Apply the dynamics' pose to the meshes: body, wheels on their arms, steering. */
  syncMesh(): void {
    const model = this.model;
    if (!model) return;
    const d = this.dynamics;
    model.root.position.copy(d.position);
    model.root.quaternion.copy(d.quaternion);
    for (let i = 0; i < 4; i += 1) {
      const rig = model.wheels[i]!;
      const offset = d.wheels[i]!.offset;
      rig.arm.rotation.x = Math.asin(Math.max(-0.95, Math.min(0.95, -offset / rig.armDz)));
      rig.steer.rotation.y = -this.steer[i]!;
    }
    model.root.updateMatrixWorld(true);
  }

  /** Spin wheel i by an angle (radians, forward rolling is positive here). */
  spinWheel(i: number, angle: number): void {
    const rig = this.model?.wheels[i];
    // Past a quarter turn per frame the spokes alias into a backward spin (the wagon-wheel effect): show at most that much.
    if (rig) rig.spin.rotation.x -= Math.max(-0.25, Math.min(0.25, angle));
  }

  /** World position of the mast camera and the rover's forward direction. */
  mastHeadWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.model ? this.model.mastHead.getWorldPosition(out) : out.set(0, 0, 0);
  }

  /** Lay track points for every wheel along the move from the last call's pose to this one. */
  layTracks(x: number, z: number, yaw: number): void {
    const context = this.context;
    if (!context) return;
    if (!Number.isFinite(this.lastX)) {
      this.lastX = x;
      this.lastZ = z;
      this.lastYaw = yaw;
    }
    const distance = Math.hypot(x - this.lastX, z - this.lastZ);
    const steps = Math.min(MAX_LAYS_PER_FRAME, Math.max(1, Math.ceil(distance / 0.2)));
    // Past the per-frame cap the move is laid with wider spacing (at time-lapse the tracks are a blur anyway).
    for (let k = 1; k <= steps; k += 1) {
      const t = k / steps;
      const px = this.lastX + (x - this.lastX) * t;
      const pz = this.lastZ + (z - this.lastZ) * t;
      const py = this.lastYaw + (yaw - this.lastYaw) * t;
      for (let i = 0; i < 4; i += 1) {
        this.dynamics.wheelXZ(i, px, pz, py, this.scratch);
        const heading = py + this.steer[i]!;
        this.tracks.lay(i, this.scratch.x, this.scratch.z, Math.sin(heading), -Math.cos(heading), context.ground);
      }
    }
    this.lastX = x;
    this.lastZ = z;
    this.lastYaw = yaw;
  }

  /** Forget where tracks were last laid (after a teleport), so no line joins the two places. */
  breakTracks(): void {
    this.lastX = Number.NaN;
  }

  clearTracks(): void {
    this.tracks.clear();
    this.breakTracks();
  }

  /** Throw dust from every wheel for `seconds` of real time at the given visual speed (m/s) and heading. */
  throwDust(speed: number, yaw: number, steering: number, seconds: number): void {
    const context = this.context;
    if (!context || speed < 0.05) return;
    const dx = Math.sin(yaw);
    const dz = -Math.cos(yaw);
    for (let i = 0; i < 4; i += 1) {
      this.dynamics.wheelXZ(i, this.dynamics.position.x, this.dynamics.position.z, yaw, this.scratch);
      const x = this.scratch.x;
      const z = this.scratch.z;
      const y = context.ground.heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      context.ground.normalAt(x, z, this.lampWorld[0]!);
      const normal = this.lampWorld[0]!;
      const launch: Launch = {
        x,
        y,
        z,
        directionX: dx,
        directionZ: dz,
        speed,
        gradientX: -normal.x / Math.max(normal.y, 0.2),
        gradientZ: -normal.z / Math.max(normal.y, 0.2),
        steering: Math.min(1, Math.abs(this.steer[i]!) / 0.5 + steering),
        side: i % 2 === 0 ? -1 : 1,
      };
      this.dust.emit(launch, seconds);
    }
  }

  /** Freeze or run the dust clock: while the drive is paused nothing is in flight. */
  setDustPaused(paused: boolean): void {
    this.dustPaused = paused;
  }

  /** Move the dust clock on by hand (a staged run happens faster than frames). */
  advanceDust(seconds: number): void {
    this.dustClock += seconds;
    this.dust.time = this.dustClock;
  }

  clearDust(): void {
    this.dust.clear();
  }

  isReady(): boolean {
    if (this.staging) return false;
    const context = this.context;
    if (!context || !this.visible) return true;
    return this.dynamics.valid && this.tracks.settled;
  }

  update(frame: LightingFrame, deltaSeconds: number): void {
    const context = this.context;
    const model = this.model;
    if (!context || !model || !this.visible) {
      sharedLight.lmlLampOn.value = 0;
      return;
    }
    this.sunDirection.copy(frame.sunDirection);
    // The array turns about the vertical to face the Sun's bearing.
    const sunBearing = Math.atan2(frame.sunDirection.x, -frame.sunDirection.z);
    model.array.rotation.y = this.dynamics.yaw + Math.PI - sunBearing;
    model.root.updateMatrixWorld(true);
    roverShadowFocus.copy(this.dynamics.position).y += 0.6;

    // Headlamps: positions and beam directions from the lamp anchors.
    for (let i = 0; i < 2; i += 1) {
      model.lampAnchors[i]!.getWorldPosition(this.lampWorld[i]!);
      sharedLight.lmlLampPos.value[i]!.copy(this.lampWorld[i]!);
      sharedLight.lmlLampDir.value[i]!.copy(this.lampLocalDirection).applyQuaternion(model.root.quaternion).normalize();
    }
    sharedLight.lmlLampOn.value = this.headlightsOn ? 1 : 0;

    this.rocks.refresh(this.dynamics.position.x, this.dynamics.position.z, context.ground, context.terrain.version, context.terrain.pool);
    this.tracks.conform(context.ground, context.terrain.version, CONFORM_BUDGET_PAIRS);

    if (!this.dustPaused) this.dustClock += deltaSeconds;
    context.renderer.getSize(this.pixelScaleSize);
    this.dust.update(this.dustClock, this.pixelScaleSize.y / (2 * Math.tan((context.camera.fov * RAD) / 2)));
  }

  get dustTime(): number {
    return this.dustClock;
  }

  dispose(): void {
    const model = this.model;
    if (model) {
      removeRoverShadowCaster(model.root);
      model.root.removeFromParent();
      model.dispose();
    }
    this.tracks.group.removeFromParent();
    this.dust.points.removeFromParent();
    this.tracks.dispose();
    this.dust.dispose();
    sharedLight.lmlLampOn.value = 0;
    this.context = null;
  }
}

export { ROVER };

import * as THREE from 'three';
import { polarLatLon, polarXY } from '../../lib/geo/polar';
import { drive } from '../../lib/mission/drive.svelte';
import { LRV_CLASS, VIPER_CLASS } from '../../lib/mission/roverPower';
import { actions, mission } from '../../lib/mission/store.svelte';
import type { SurfaceEngine } from '../core/engine';
import type { HashView } from '../core/reviewHooks';
import { overlayUniforms } from '../core/overlay';
import type { LightingFrame, SurfaceContext, SurfaceExtension } from '../core/types';
import { BaseExtension } from '../base/base';
import { RoverExtension } from '../rover/rover';
import { DriveCameras, FOV, type DriveView } from './driveCameras';
import { DriveSim, type SimSnapshot } from './driveSim';
import { RouteOverlay } from './routeLine';

/** Adds the planning overlay to the scene and keeps it on the ground. */
class OverlayExtension implements SurfaceExtension {
  private context: SurfaceContext | null = null;
  private readonly size = new THREE.Vector2();

  constructor(readonly overlay: RouteOverlay) {}

  attach(context: SurfaceContext): void {
    this.context = context;
    context.scene.add(this.overlay.group);
  }

  update(_frame: LightingFrame, _deltaSeconds: number): void {
    const context = this.context;
    if (!context) return;
    context.renderer.getSize(this.size);
    this.overlay.update(context.ground, context.terrain.version, context.camera, this.size);
  }

  dispose(): void {
    this.overlay.dispose();
    this.context = null;
  }
}

declare global {
  interface Window {
    /** Review hook: the drive's state for scripted runs. */
    __surfaceDrive?: {
      telemetry(): unknown;
      prediction(): unknown;
      route(): unknown;
      environment(): unknown;
      state(): unknown;
      debug(): unknown;
      parts(): { rover: { setVisible(v: boolean): void; tracks: { group: { visible: boolean } }; dust: { points: { visible: boolean } }; model: { root: { visible: boolean } } | null }; overlay: { setVisible(v: boolean): void } };
      sim(): { x: number; z: number; yaw: number; s: number; speed: number; battery: number };
      /** Review hook: set the rover's battery charge, kWh. */
      setBattery(kwh: number): void;
    };
  }
}

/** What survives leaving the Surface (to Plan and back): the rover's place, route and battery, and the camera's framing. The route, target and settings themselves live in the `drive` store. */
interface SavedDrive {
  key: string;
  sim: SimSnapshot;
  view: { chaseAzimuth: number; chaseElevation: number; chaseDistance: number; orbitAzimuth: number; orbitElevation: number; orbitDistance: number; planDistance: number; baseAzimuth: number; baseElevation: number; baseDistance: number };
}

let saved: SavedDrive | null = null;

const QUALITY_SCALE = { high: 1, medium: 0.75, low: 0.6 } as const;

/** Everything the Surface drive needs, wired to one engine: the rover, the route overlay, the drive and the cameras. */
export class DriveController {
  readonly rover = new RoverExtension();
  readonly sim: DriveSim;
  readonly cameras: DriveCameras;
  private readonly overlay = new RouteOverlay();
  readonly base = new BaseExtension();
  private readonly overlayExtension: OverlayExtension;
  /** Sun's compass bearing in scene axes, from the Surface screen's estimate effect. */
  sunBearingDeg: number | null = null;
  /** The Stay camera starts this many degrees round from the Sun's bearing, once that bearing is known. */
  private baseOffsetDeg = 100;
  private azimuthPending = false;
  private headlightsBeforeStay: 'auto' | 'on' | 'off' | null = null;
  /** The mission clock and the drive's pause, as they were when Stay began. */
  private beforeStay: { clockIndex: number; paused: boolean } | null = null;
  private readonly key: string;
  private readonly origin: { x: number; y: number };
  private parked = false;
  private generation = 0;

  constructor(
    private readonly engine: SurfaceEngine,
    private readonly site: { latitudeDeg: number; longitudeDeg: number },
  ) {
    this.origin = polarXY(site.latitudeDeg, site.longitudeDeg);
    this.key = `${site.latitudeDeg}|${site.longitudeDeg}|${mission.startUtc}`;
    engine.addExtension(this.rover);
    this.overlayExtension = new OverlayExtension(this.overlay);
    engine.addExtension(this.overlayExtension);
    this.base.roverLampsOn = () => this.rover.headlightsOn;
    engine.addExtension(this.base);
    this.sim = new DriveSim(
      this.rover,
      this.overlay,
      { heightAt: (x, z) => engine.heightAt(x, z), normalAt: (x, z, out) => engine.normalAt(x, z, out) },
      site,
    );
    this.cameras = new DriveCameras(this.rover, this.sim);
    const previous = saved && saved.key === this.key ? saved : null;
    saved = null;
    if (previous) {
      this.restore(previous);
    } else {
      drive.reset();
      drive.camera = 'chase';
    }
    drive.commands = {
      findRoute: async () => {
        await this.sim.findRoute();
        if (drive.route) {
          this.fitPlanning();
          this.sim.predict();
        }
      },
      start: () => this.sim.start(),
      restart: () => this.sim.restart(),
      seek: (fraction) => this.sim.seek(fraction),
      returnToRoute: () => this.sim.returnToRoute(),
      clearTarget: () => this.clearTarget(),
      setTargetFromSite: (latitudeDeg, longitudeDeg) => {
        const p = polarXY(latitudeDeg, longitudeDeg);
        this.setTarget(p.x - this.origin.x, -(p.y - this.origin.y), latitudeDeg, longitudeDeg);
      },
      setTargetAt: (x, z) => {
        const point = polarLatLon(this.origin.x + x, this.origin.y - z);
        this.setTarget(x, z, point.latitudeDeg, point.longitudeDeg);
      },
      refreshPrediction: () => {
        this.sim.predict();
      },
      openPlanning: () => {
        drive.planning = true;
        this.fitPlanning();
      },
      closePlanning: () => {
        drive.planning = false;
      },
      enterStay: () => this.enterStay(true),
      exitStay: () => this.exitStay(),
    };
    this.cameras.beforeStep = (dt) => this.stayStep(dt);
    engine.useController(this.cameras);
    this.sync();
    window.__surfaceDrive = {
      telemetry: () => $state.snapshot(drive.telemetry),
      prediction: () => $state.snapshot(drive.prediction),
      route: () => drive.route,
      environment: () => drive.environment,
      state: () => ({ paused: drive.paused, mode: drive.mode, lapse: drive.lapse, phase: drive.phase, arrived: drive.arrived, error: drive.error, planning: drive.planning }),
      parts: () => ({ rover: this.rover, overlay: this.overlay }),
      debug: () => ({ plan: this.sim.planDebug, obstacles: this.rover.rocks.obstacles.length, near: this.rover.rocks.near(this.sim.x, this.sim.z, 3, []).map((r) => [r.x, r.z, r.radius, r.top]), pitch: this.rover.dynamics.pitchSlope, roll: this.rover.dynamics.rollSlope, steer: this.rover.steer }),
      setBattery: (kwh) => {
        this.sim.batteryKwh = kwh;
      },
      sim: () => ({ x: this.sim.x, z: this.sim.z, yaw: this.sim.yaw, s: this.sim.s, speed: this.sim.speed, battery: this.sim.batteryKwh }),
    };
  }

  private restore(previous: SavedDrive): void {
    this.parked = true;
    this.sim.restore(previous.sim);
    Object.assign(this.cameras, previous.view);
    drive.stay = false;
    drive.stayPaused = false;
    drive.paused = true;
    drive.planning = false;
    drive.menuOpen = false;
    if (drive.target) this.overlay.setTarget(drive.target.x, drive.target.z);
    this.cameras.snap = true;
  }

  /** Called from an effect: pushes the store's choices (camera, quality, overlay) into the scene. */
  sync(): void {
    const view: DriveView = drive.stay ? 'base' : drive.planning ? 'plan' : drive.camera;
    if (this.cameras.view !== view) {
      this.cameras.setView(view);
      this.engine.setFov(FOV[view] === undefined ? 50 : this.cameras.fov);
    }
    this.engine.setFov(this.cameras.fov);
    const firstPerson = view === 'driver' || view === 'mast';
    this.overlay.setVisible(drive.showRoute && (!firstPerson || drive.routeInDriverView));
    this.engine.setRenderScale(QUALITY_SCALE[drive.quality]);
    // An outpost without power has no work lights.
    this.base.forcedLights = drive.stay && drive.outpostFlat ? false : null;
  }

  setSunFraction(fraction: number): void {
    this.base.setSunFraction(fraction);
  }

  /** The clock runs through the whole planned stay at the Stay lapse, from the base's camera. */
  private stayStep(deltaSeconds: number): void {
    const state = this.base.state;
    if (state) this.cameras.baseCentre.set(state.layout.centre.x, this.base.centreHeight(), state.layout.centre.z);
    if (this.azimuthPending && this.sunBearingDeg !== null) {
      this.azimuthPending = false;
      this.cameras.baseAzimuth = ((this.sunBearingDeg + this.baseOffsetDeg) * Math.PI) / 180;
      this.cameras.snap = true;
    }
    if (!drive.stay || drive.stayPaused || drive.menuOpen) return;
    const end = mission.days * 24;
    const next = mission.clockIndex + (Math.min(deltaSeconds, 0.1) * drive.stayLapse) / 3600;
    if (next >= end) {
      actions.setClock(end);
      drive.stayPaused = true;
      return;
    }
    actions.setClock(next);
  }

  /** Camera to the base and the clock to the start of the stay; the rover's lamps stay off so the work lights own the beams. */
  private enterStay(restartClock: boolean): void {
    if (!drive.stay) {
      this.headlightsBeforeStay = drive.headlights;
      this.beforeStay = { clockIndex: mission.clockIndex, paused: drive.paused };
    }
    drive.headlights = 'off';
    drive.planning = false;
    drive.menuOpen = false;
    drive.paused = true;
    drive.stay = true;
    drive.stayPaused = false;
    this.cameras.autoOrbit = true;
    this.azimuthPending = true;
    if (restartClock) actions.setClock(0);
    this.cameras.snap = true;
  }

  private exitStay(): void {
    if (!drive.stay) return;
    drive.stay = false;
    if (this.beforeStay) {
      actions.setClock(this.beforeStay.clockIndex);
      drive.paused = this.beforeStay.paused;
      this.beforeStay = null;
    }
    if (this.headlightsBeforeStay) drive.headlights = this.headlightsBeforeStay;
    this.headlightsBeforeStay = null;
    this.cameras.snap = true;
  }

  /** Per-frame hook for the FOV (mast zoom changes it while dragging). */
  syncFov(): void {
    this.engine.setFov(this.cameras.fov);
  }

  /** Place the parked rover once the Sun's bearing is known, side-on to it. */
  park(sunBearingDeg: number | null): void {
    if (this.parked) return;
    this.parked = true;
    const yaw = (((sunBearingDeg ?? 0) + 90) * Math.PI) / 180;
    this.sim.parkAt(0, 0, yaw);
    this.cameras.snap = true;
  }

  private setTarget(x: number, z: number, latitudeDeg: number, longitudeDeg: number): void {
    const range = Math.hypot(x, z);
    drive.target = { latitudeDeg, longitudeDeg, x, z, label: `${(range / 1000).toFixed(2)} km from the rover, ${latitudeDeg.toFixed(3)}°, ${longitudeDeg.toFixed(3)}°` };
    drive.error = null;
    this.overlay.setTarget(x, z);
  }

  clearTarget(): void {
    drive.target = null;
    this.overlay.clearTarget();
    this.sim.clearRoute();
  }

  /** Click on the ground in the planning view. */
  pickTarget(clientX: number, clientY: number): void {
    const hit = this.engine.pickGround(clientX, clientY);
    if (!hit) return;
    const point = polarLatLon(this.origin.x + hit.x, this.origin.y - hit.z);
    this.setTarget(hit.x, hit.z, point.latitudeDeg, point.longitudeDeg);
  }

  /** Centre and size the top-down view to hold the rover, the target and the route. */
  fitPlanning(): void {
    const points: [number, number][] = [[this.sim.x, this.sim.z]];
    if (drive.target) points.push([drive.target.x, drive.target.z]);
    const path = this.sim.path;
    if (path) for (let k = 0; k < path.x.length; k += 1) points.push([path.x[k] as number, path.z[k] as number]);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const cameras = this.cameras;
    cameras.planTarget.set((minX + maxX) / 2, this.engine.heightAt((minX + maxX) / 2, (minZ + maxZ) / 2) || 0, (minZ + maxZ) / 2);
    const tan = Math.tan((FOV.plan * Math.PI) / 360);
    const aspect = this.engine.canvas.clientWidth / Math.max(1, this.engine.canvas.clientHeight);
    const need = Math.max((maxZ - minZ) * 1.35 / (2 * tan), ((maxX - minX) * 1.35) / (2 * tan * aspect));
    cameras.planDistance = Math.max(1200, need);
    cameras.snap = true;
  }

  /** Stage a view from the hash: class, speed, route to a target, progress, camera, lapse. */
  async applyView(view: HashView): Promise<void> {
    const generation = (this.generation += 1);
    if (view.roverClass === 'lrv') drive.settings = { ...LRV_CLASS };
    else if (view.roverClass === 'viper') drive.settings = { ...VIPER_CLASS };
    if (view.speed !== null) drive.speedKmh = view.speed;
    if (view.headlights) drive.headlights = view.headlights;
    if (view.hud !== null) drive.hudVisible = view.hud;
    if (view.clock !== null) actions.setClock(view.clock);
    if (view.camera) {
      if (view.camera === 'plan') drive.planning = true;
      else {
        drive.planning = false;
        drive.camera = view.camera;
      }
    }
    if (view.base !== null) this.base.setEnabled(view.base);
    if (view.stay && view.chase) {
      this.baseOffsetDeg = view.chase[0];
      this.cameras.baseElevation = (view.chase[1] * Math.PI) / 180;
      this.cameras.baseDistance = view.chase[2];
    } else if (view.chase) {
      this.cameras.chaseAzimuth = (view.chase[0] * Math.PI) / 180;
      this.cameras.chaseElevation = (view.chase[1] * Math.PI) / 180;
      this.cameras.chaseDistance = view.chase[2];
    }
    if (view.planDistance !== null) this.cameras.planDistance = view.planDistance;
    if (view.drive) {
      this.rover.staging = true;
      const point = polarXY(view.drive[0], view.drive[1]);
      this.setTarget(point.x - this.origin.x, -(point.y - this.origin.y), view.drive[0], view.drive[1]);
      await drive.commands?.findRoute();
      if (generation !== this.generation) return;
      if (drive.route) {
        this.sim.stageAt({ progress: view.progress ?? 0, runSeconds: view.run ?? 0 });
        if (view.camera === 'plan') {
          this.fitPlanning();
          if (view.planDistance !== null) this.cameras.planDistance = view.planDistance;
        }
      } else {
        this.rover.staging = false;
      }
    }
    if (view.stay) {
      this.enterStay(view.clock === null);
      if (view.lapse !== null) {
        if (view.lapse > 0) drive.stayLapse = view.lapse;
        drive.stayPaused = view.lapse === 0;
      }
    } else if (view.lapse !== null) {
      if (view.lapse > 0) drive.lapse = view.lapse;
      else drive.paused = true;
    }
    if (new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('run') === '1' && !view.stay) drive.commands?.start();
    this.cameras.snap = true;
  }

  dispose(): void {
    this.generation += 1;
    this.exitStay();
    const cameras = this.cameras;
    saved = {
      key: this.key,
      sim: this.sim.snapshot(),
      view: {
        chaseAzimuth: cameras.chaseAzimuth,
        chaseElevation: cameras.chaseElevation,
        chaseDistance: cameras.chaseDistance,
        orbitAzimuth: cameras.orbitAzimuth,
        orbitElevation: cameras.orbitElevation,
        orbitDistance: cameras.orbitDistance,
        planDistance: cameras.planDistance,
        baseAzimuth: cameras.baseAzimuth,
        baseElevation: cameras.baseElevation,
        baseDistance: cameras.baseDistance,
      },
    };
    drive.commands = null;
    drive.paused = true;
    delete window.__surfaceDrive;
    this.sim.dispose();
    this.engine.removeExtension(this.base);
    this.engine.removeExtension(this.overlayExtension);
    this.engine.removeExtension(this.rover);
    void overlayUniforms;
  }
}

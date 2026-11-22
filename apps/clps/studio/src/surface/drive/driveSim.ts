import * as THREE from 'three';
import { api, ApiError } from '../../lib/api/client';
import type { DriveQuery, WaypointResponse } from '../../lib/api/types';
import { polarLatLon, polarXY } from '../../lib/geo/polar';
import { drive, MAX_SLOPE_LIMIT_DEG, type BodyStatus, type Telemetry } from '../../lib/mission/drive.svelte';
import { environmentAt, type EnvironmentSample } from '../../lib/mission/driveEnvironment';
import {
  loadWatts,
  predictBattery,
  SHADOW_FRACTION,
  solarWatts,
  stepBattery,
  type PowerPrediction,
  type PowerSample,
} from '../../lib/mission/roverPower';
import { mission } from '../../lib/mission/store.svelte';
import type { GroundQuery } from '../core/types';
import { ROVER } from '../rover/model';
import { RoverDynamics } from '../rover/dynamics';
import type { RoverExtension } from '../rover/rover';
import type { Rock } from '../rover/obstacles';
import { LocalPlanner } from './localPlanner';
import { measureSlope, type GroundSlope } from './slope';
import { buildPath, nearest, pointAt, project, type RoutePath } from './route';
import type { RouteOverlay } from './routeLine';

const HOUR_MS = 3_600_000;
const MAX_STEER_RAD = 0.55;
const STEER_RATE = 0.8;
/** The rover's body turns no faster than this, whatever the speed (rad/s, about 25 degrees a second). */
const MAX_YAW_RATE = 0.44;
/** Waypoint answers that come back busy (409) are asked again after these waits, ms. */
const WAYPOINT_RETRY_MS = [400, 900, 1800];
const LOOKAHEAD_M = 5;
const PLAN_GOAL_M = 20;
const MAX_SUBSTEPS = 150;
/** Short steps keep the steering loop steady under time-lapse. */
const MAX_SUBSTEP_S = 0.1;
/** Autopilot: rocks smaller than this are driven over; larger ones are steered round. */
const AUTO_OBSTACLE_RADIUS_M = 0.9;
const BODY_CLEARANCE_M = 1.5;
const RECOVERY_REVERSE_M = 3;
const ARRIVAL_RADIUS_M = 1.2;
const TELEMETRY_INTERVAL_MS = 100;
const WAYPOINT_INTERVAL_MS = 3000;
const WAYPOINT_STALE_S = 10;
/** Past this visual speed (m/s) the picture is a blur: no dust is thrown and tracks are laid coarsely. */
const DUST_VISUAL_SPEED_LIMIT = 12;
const SHADOW_AHEAD_SECONDS = 600;
const WHEEL_BASE = 2 * ROVER.halfBase;

export interface StageRequest {
  progress: number;
  /** Seconds of autopilot at real-time speed to run before freezing (throws dust, lays fresh tracks). */
  runSeconds: number;
}

/** The drive's own state, kept while the Surface is closed so a return finds the rover where it was. */
export interface SimSnapshot {
  path: RoutePath | null;
  x: number;
  z: number;
  yaw: number;
  s: number;
  offRoute: number;
  batteryKwh: number;
  startKwh: number;
  departureMs: number;
  plannedSpeedMs: number;
  arrived: boolean;
}

export interface SimKeys {
  has(key: string): boolean;
  size: number;
}

interface WaypointAnswer {
  atMs: number;
  x: number;
  z: number;
  clockMs: number;
  sun: BodyStatus;
  earth: BodyStatus;
  sunElevationDeg: number;
}

function wrapPi(angle: number): number {
  return ((((angle + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

/**
 * The drive: autopilot and manual control of the rover's kinematics, the mission clock that advances with it, the
 * power model integrated along the way, and the telemetry the HUD shows. It runs inside the camera controller's
 * per-frame update (so the camera sees this frame's pose) and in sub-steps, so time-lapse never skips terrain checks.
 */
export class DriveSim {
  path: RoutePath | null = null;
  x = 0;
  z = 0;
  yaw = 0;
  speed = 0;
  /** Progress along the path (metres) and the distance from the path. */
  s = 0;
  offRoute = 0;
  batteryKwh = 0;
  batteryFlat = false;
  private steerAngle = 0;
  private recoverM = 0;
  private readonly planner = new LocalPlanner();
  private waypoints: { x: number; z: number }[] = [];
  private waypointIndex = 0;
  private planFound = true;
  private planX = Number.NaN;
  private planZ = Number.NaN;
  private planS = 0;
  private stuckSeconds = 0;
  private steerCommand = 0;
  private startKwh = 0;
  private departureMs = 0;
  private clockMs = 0;
  private arrived = false;
  private stage: StageRequest | null = null;
  private lastTelemetry = 0;
  private lastWaypoint = 0;
  private waypoint: WaypointAnswer | null = null;
  private waypointInflight = false;
  private waypointAt = { x: Number.NaN, z: Number.NaN, clockMs: Number.NaN };
  private readonly nearRocks: Rock[] = [];
  private readonly spin = [0, 0, 0, 0];
  private readonly probePoint = { x: 0, z: 0 };
  private lastEnvironmentSun: BodyStatus | null = null;
  private lastEnvironmentEarth: BodyStatus | null = null;
  private sunElevationDeg = 0;
  private lastProbeMs = 0;
  private probeFraction = 1;
  private generation = 0;
  /** Slope over the rover's footprint on the visible ground (HUD and the manual-drive limit). */
  private slope: GroundSlope = { pitchSlope: 0, rollSlope: 0, slopeDeg: 0 };
  /** Running average of the ground speed while driving, m/s, with its time constant in sim seconds. */
  private averageSpeed = 0;
  private averageSamples = 0;
  private plannedSpeedMs = 0;
  private readonly tmp = { x: 0, z: 0, tx: 0, tz: 0 };
  readonly heightProbe = new THREE.Vector3();

  constructor(
    private readonly rover: RoverExtension,
    private readonly overlay: RouteOverlay,
    private readonly ground: GroundQuery,
    private readonly site: { latitudeDeg: number; longitudeDeg: number },
  ) {
    this.batteryKwh = drive.settings.batteryKwh;
    this.startKwh = this.batteryKwh;
  }

  /** The drive's clock now, UTC ms (its own clock, not the Plan screen's). */
  get clockUtcMs(): number {
    return Date.parse(mission.startUtc) + drive.clockIndex * HOUR_MS;
  }

  get speedSettingMs(): number {
    return Math.min(drive.speedKmh, drive.settings.maxSpeedKmh) / 3.6;
  }

  get done(): boolean {
    return this.arrived;
  }

  /** Park the rover (landing site, or wherever it is) and forget any drive in progress. */
  parkAt(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.speed = 0;
    this.steerAngle = 0;
    this.steerCommand = 0;
    this.s = 0;
    this.arrived = false;
    drive.arrived = false;
    this.rover.breakTracks();
    this.rover.placeAt(x, z, yaw, 0);
  }

  setPath(path: RoutePath | null): void {
    this.path = path;
    this.s = 0;
    this.arrived = false;
    drive.arrived = false;
    this.generation += 1;
    this.waypoints = [];
    this.overlay.setRoute(path, drive.environment);
    this.resetSpeedAverage();
    if (path) this.predict();
  }

  snapshot(): SimSnapshot {
    return {
      path: this.path,
      x: this.x,
      z: this.z,
      yaw: this.yaw,
      s: this.s,
      offRoute: this.offRoute,
      batteryKwh: this.batteryKwh,
      startKwh: this.startKwh,
      departureMs: this.departureMs,
      plannedSpeedMs: this.plannedSpeedMs,
      arrived: this.arrived,
    };
  }

  restore(saved: SimSnapshot): void {
    this.setPath(saved.path);
    this.x = saved.x;
    this.z = saved.z;
    this.yaw = saved.yaw;
    this.s = saved.s;
    this.offRoute = saved.offRoute;
    this.batteryKwh = saved.batteryKwh;
    this.startKwh = saved.startKwh;
    this.departureMs = saved.departureMs;
    this.plannedSpeedMs = saved.plannedSpeedMs;
    this.arrived = saved.arrived;
    drive.arrived = saved.arrived;
    this.speed = 0;
    this.rover.breakTracks();
    this.rover.placeAt(this.x, this.z, this.yaw, 0);
    if (saved.path) this.predict();
  }

  /** Predicted battery along the route from the drive response, at the set speed, starting from the current charge. */
  predict(): PowerPrediction | null {
    const path = this.path;
    const response = drive.route;
    if (!path || !response || drive.environment.length === 0) {
      drive.prediction = null;
      return null;
    }
    const speed = this.speedSettingMs;
    const samples: PowerSample[] = [];
    const elevations = response.points.map((p) => ({ d: p.distance_m, e: p.elevation_m }));
    const gradeAt = (distance: number): number => {
      for (let k = 0; k + 1 < elevations.length; k += 1) {
        const a = elevations[k]!;
        const b = elevations[k + 1]!;
        if (distance <= b.d) return Math.atan2(b.e - a.e, Math.max(b.d - a.d, 1e-6));
      }
      return 0;
    };
    // Connector: flat, at the first sample's conditions.
    const first = drive.environment[0] as EnvironmentSample;
    if (path.connectorM > 0) {
      samples.push({ seconds: 0, sunFraction: first.sunFraction, sunElevationDeg: first.sunElevationDeg, speedMs: speed, gradeRad: 0 });
    }
    for (const sample of drive.environment) {
      samples.push({
        seconds: (sample.distanceM + path.connectorM) / speed,
        sunFraction: sample.sunFraction,
        sunElevationDeg: sample.sunElevationDeg,
        speedMs: speed,
        gradeRad: gradeAt(sample.distanceM),
      });
    }
    const prediction = predictBattery(drive.settings, samples, this.s < 1 ? this.batteryKwh : this.startKwh);
    drive.prediction = prediction;
    return prediction;
  }

  /** Request a route from the rover's position to the chosen target, departing at the mission clock. */
  async findRoute(): Promise<void> {
    const target = drive.target;
    if (!target) {
      drive.error = 'Choose a target first: click the ground, or pick a nearby site.';
      return;
    }
    drive.routing = true;
    drive.error = null;
    const here = this.latLon(this.x, this.z);
    const query: DriveQuery = {
      latitude: here.latitudeDeg,
      longitude: here.longitudeDeg,
      target_latitude: target.latitudeDeg,
      target_longitude: target.longitudeDeg,
      slope: Math.max(1, Math.min(35, Number.isFinite(drive.slopeLimitDeg) ? drive.slopeLimitDeg : 15)),
      speed: Math.min(drive.speedKmh, drive.settings.maxSpeedKmh),
      departure: new Date(this.clockUtcMs).toISOString().replace('.000Z', 'Z'),
      samples: 48,
      height: mission.mastHeightM,
    };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const response = await api.expeditionDrive(query);
        drive.setRoute(response);
        this.departureMs = this.clockUtcMs;
        this.plannedSpeedMs = this.speedSettingMs;
        this.batteryKwh = drive.settings.batteryKwh;
        this.startKwh = this.batteryKwh;
        this.setPath(buildPath(response, this.site.latitudeDeg, this.site.longitudeDeg, this.x, this.z));
        drive.paused = true;
        drive.mode = 'auto';
        drive.routing = false;
        return;
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 409 && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          continue;
        }
        this.setPath(null);
        drive.setRoute(null);
        drive.error = routeErrorText(cause, drive.slopeLimitDeg);
        drive.routing = false;
        return;
      }
    }
    drive.routing = false;
  }

  /** The lowest whole-degree slope limit with a route from the rover to the target, or 'none'. */
  async lowestRouteSlope(target: { latitudeDeg: number; longitudeDeg: number }, isCurrent: () => boolean): Promise<number | 'none' | null> {
    const here = this.latLon(this.x, this.z);
    const speed = Math.min(drive.speedKmh, drive.settings.maxSpeedKmh);
    const routes = async (slope: number): Promise<boolean | null> => {
      try {
        await api.expeditionRoute({
          latitude: here.latitudeDeg,
          longitude: here.longitudeDeg,
          target_latitude: target.latitudeDeg,
          target_longitude: target.longitudeDeg,
          slope,
          speed,
        });
        return true;
      } catch (cause) {
        if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && cause.status !== 409) return false;
        return null;
      }
    };
    const top = await routes(MAX_SLOPE_LIMIT_DEG);
    if (top === null || !isCurrent()) return null;
    if (!top) return 'none';
    // A higher limit never removes a route, so search for the lowest limit that has one.
    let low = 1;
    let high = MAX_SLOPE_LIMIT_DEG;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const found = await routes(middle);
      if (found === null || !isCurrent()) return null;
      if (found) high = middle;
      else low = middle + 1;
    }
    return high;
  }

  /** Begin the autopilot from the rover's place on the route. */
  start(): void {
    if (!this.path) return;
    drive.error = null;
    if (this.arrived) this.restart();
    drive.mode = 'auto';
    drive.paused = false;
    drive.planning = false;
    if (this.s < 1) {
      this.departureMs = this.clockUtcMs;
      this.startKwh = this.batteryKwh;
      this.resetSpeedAverage();
    }
  }

  restart(): void {
    const path = this.path;
    if (!path) return;
    this.arrived = false;
    drive.arrived = false;
    this.s = 0;
    this.speed = 0;
    this.resetSpeedAverage();
    this.batteryKwh = this.startKwh;
    this.batteryFlat = false;
    const hours = (this.departureMs - Date.parse(mission.startUtc)) / HOUR_MS;
    drive.setClock(hours);
    this.placeOnPath(0);
    this.rover.clearTracks();
    this.rover.clearDust();
    drive.paused = true;
    drive.mode = 'auto';
  }

  /** Put the rover at fraction 0..1 of the path, set the clock and the battery to what the plan predicts there. */
  seek(fraction: number): void {
    const path = this.path;
    if (!path) return;
    const s = Math.max(0, Math.min(1, fraction)) * path.total;
    this.arrived = false;
    drive.arrived = false;
    this.speed = 0;
    this.s = s;
    this.placeOnPath(s);
    const elapsed = s / this.speedSettingMs;
    drive.setClock((this.departureMs + elapsed * 1000 - Date.parse(mission.startUtc)) / HOUR_MS);
    this.batteryKwh = this.energyAt(s);
    this.rover.clearTracks();
    this.layTrackHistory(s);
  }

  returnToRoute(): void {
    const path = this.path;
    if (!path) return;
    const near = nearest(path, this.x, this.z);
    this.s = near.s;
    this.offRoute = near.distance;
    this.waypoints = [];
    drive.mode = 'auto';
    drive.paused = false;
  }

  clearRoute(): void {
    this.setPath(null);
    drive.setRoute(null);
    this.overlay.clearTarget();
  }

  /** Charge the battery would have at path distance s, from the plan (used by seek). */
  private energyAt(s: number): number {
    const path = this.path;
    const response = drive.route;
    if (!path || !response || s < 1) return this.startKwh;
    const speed = this.speedSettingMs;
    const samples: PowerSample[] = [];
    for (const sample of drive.environment) {
      const along = sample.distanceM + path.connectorM;
      if (along > s) break;
      samples.push({ seconds: along / speed, sunFraction: sample.sunFraction, sunElevationDeg: sample.sunElevationDeg, speedMs: speed, gradeRad: 0 });
    }
    if (samples.length < 2) return this.startKwh;
    return predictBattery(drive.settings, samples, this.startKwh).endKwh;
  }

  private placeOnPath(s: number): void {
    const path = this.path;
    if (!path) return;
    this.waypoints = [];
    pointAt(path, s, this.tmp);
    this.x = this.tmp.x;
    this.z = this.tmp.z;
    this.yaw = Math.atan2(this.tmp.tx, -this.tmp.tz);
    this.rover.breakTracks();
    this.rover.placeAt(this.x, this.z, this.yaw, 0);
  }

  /** Lay tracks for the last TRACK_METRES behind path position s, as if the rover had driven there. */
  private layTrackHistory(s: number): void {
    const path = this.path;
    if (!path) return;
    const from = Math.max(0, s - 600);
    const tmp = { x: 0, z: 0, tx: 0, tz: 0 };
    const scratch = new THREE.Vector3();
    for (let along = from; along <= s; along += 0.2) {
      pointAt(path, along, tmp);
      const yaw = Math.atan2(tmp.tx, -tmp.tz);
      for (let i = 0; i < 4; i += 1) {
        this.rover.dynamics.wheelXZ(i, tmp.x, tmp.z, yaw, scratch);
        this.rover.tracks.lay(i, scratch.x, scratch.z, tmp.tx, tmp.tz, this.ground);
      }
    }
    this.rover.breakTracks();
  }

  /** Stage a deterministic view: the rover at a fraction of the route with tracks behind it, optionally mid-run. */
  stageAt(request: StageRequest): void {
    const path = this.path;
    if (!path) return;
    this.stage = request;
    this.rover.staging = true;
    const s = Math.max(0, Math.min(1, request.progress)) * path.total;
    this.s = s;
    this.arrived = false;
    drive.arrived = false;
    const hours = (this.departureMs - Date.parse(mission.startUtc)) / HOUR_MS + s / this.speedSettingMs / 3600;
    drive.setClock(hours);
    this.batteryKwh = this.energyAt(s);
    this.rover.clearTracks();
    this.rover.clearDust();
    this.placeOnPath(s);
    this.layTrackHistory(s);
  }

  /** The frame's work. `dt` is real seconds; keys are the pressed keys (lower case). */
  step(dt: number, keys: SimKeys): void {
    const rover = this.rover;
    if (this.stage) {
      this.stageStep(this.stage);
      return;
    }
    if (!rover.valid) {
      rover.placeAt(this.x, this.z, this.yaw, 0);
      this.publish(true);
      return;
    }
    this.measure();
    const manualKeys = keys.has('w') || keys.has('s') || keys.has('a') || keys.has('d') || keys.has(' ');
    if (manualKeys && !drive.menuOpen && !drive.planning && drive.mode === 'auto') {
      drive.mode = 'manual';
      drive.paused = false;
    }
    const running = !drive.paused && !drive.menuOpen && !drive.planning && !this.arrived;
    // Hand control runs in real time: at a time-lapse factor the turn and the speed would be wildly out of proportion.
    const lapse = drive.mode === 'manual' ? 1 : Math.max(1, drive.lapse);
    this.clockMs = this.clockUtcMs;
    const startClock = this.clockMs;
    let visualSpeed = 0;
    if (running) {
      const simSeconds = Math.min(dt, 0.1) * lapse;
      const substeps = Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil(simSeconds / MAX_SUBSTEP_S)));
      const sub = simSeconds / substeps;
      let moved = 0;
      for (let k = 0; k < substeps; k += 1) {
        const startX = this.x;
        const startZ = this.z;
        this.substep(sub, keys);
        moved += Math.hypot(this.x - startX, this.z - startZ);
        if (this.arrived) break;
      }
      visualSpeed = dt > 0 ? moved / dt : 0;
      const hours = (this.clockMs - Date.parse(mission.startUtc)) / HOUR_MS;
      if (this.clockMs !== startClock) drive.setClock(hours);
      if (hours >= mission.days * 24 - 1e-6 && this.clockMs > startClock) {
        drive.paused = true;
        drive.error = 'The stay ends here. Pick an earlier departure, or lengthen the stay in Plan.';
      }
    } else {
      this.speed = 0;
    }
    this.applyWheels();
    const ok = rover.placeAt(this.x, this.z, this.yaw, Math.min(dt, 0.1));
    if (ok) {
      if (running) {
        rover.layTracks(this.x, this.z, this.yaw);
        const slow = visualSpeed > DUST_VISUAL_SPEED_LIMIT;
        if (!slow) rover.throwDust(visualSpeed, this.yaw, Math.abs(this.steerAngle) / MAX_STEER_RAD, dt);
      }
      rover.setDustPaused(!running);
    }
    this.measure();
    this.updateHeadlights();
    this.publish(false);
  }

  private measure(): void {
    const measured = measureSlope(this.ground, this.x, this.z, this.yaw);
    if (measured) this.slope = measured;
  }

  /** Fast-forward a staged view: wait for the ground, then run the autopilot for the requested seconds and freeze. */
  private stageStep(request: StageRequest): void {
    const rover = this.rover;
    if (!rover.placeAt(this.x, this.z, this.yaw, 0)) return;
    for (let k = 0; k < 4; k += 1) this.collide();
    if (!rover.placeAt(this.x, this.z, this.yaw, 0)) return;
    this.clockMs = this.clockUtcMs;
    const path = this.path;
    if (request.runSeconds > 0 && path) {
      const dt = 1 / 30;
      this.speed = 0;
      for (let t = 0; t < request.runSeconds; t += dt) {
        this.substep(dt, { has: () => false, size: 0 }, true);
        this.applyWheels();
        if (!rover.placeAt(this.x, this.z, this.yaw, dt)) break;
        rover.layTracks(this.x, this.z, this.yaw);
        rover.throwDust(this.speed, this.yaw, Math.abs(this.steerAngle) / MAX_STEER_RAD, dt);
        rover.advanceDust(dt);
      }
      const hours = (this.clockMs - Date.parse(mission.startUtc)) / HOUR_MS;
      drive.setClock(hours);
    }
    rover.setDustPaused(true);
    this.speed = 0;
    this.stage = null;
    rover.staging = false;
    this.updateHeadlights();
    this.publish(true);
  }

  private substep(dt: number, keys: SimKeys, forceAuto = false): void {
    const settings = drive.settings;
    const auto = forceAuto || (drive.mode === 'auto' && this.path !== null);
    const path = this.path;
    const rover = this.rover;
    const accel = settings.accelerationMs2;
    let targetSpeed = 0;
    let steerTarget = 0;
    const limit = Math.min(drive.speedKmh, settings.maxSpeedKmh) / 3.6;
    const gradeRad = Math.atan(this.slope.pitchSlope);
    const slopeDeg = this.slope.slopeDeg;

    if (auto && path) {
      const projected = project(path, this.x, this.z, this.s, 40 + this.speed * dt * 2);
      this.s = Math.max(this.s, projected.s);
      this.offRoute = projected.distance;
      const remaining = path.total - this.s;
      const aim = this.followPlan(path, dt);
      const heading = wrapPi(Math.atan2(aim.x - this.x, -(aim.z - this.z)) - this.yaw);
      if (this.recoverM > 0) {
        steerTarget = 0;
        targetSpeed = -0.35 * limit;
        this.recoverM -= Math.abs(this.speed) * dt;
      } else {
        // Pure pursuit: the arc through the aim point, which settles onto the line without weaving.
        const reach = Math.max(1, Math.hypot(aim.x - this.x, aim.z - this.z));
        const pursuit = Math.atan(((WHEEL_BASE / 2) * 2 * Math.sin(heading)) / reach);
        steerTarget = Math.max(-MAX_STEER_RAD, Math.min(MAX_STEER_RAD, pursuit));
        const curveFactor = 1 - 0.08 * Math.min(1, Math.abs(heading) / 0.8);
        const stopping = (this.speed * this.speed) / (2 * accel * 0.8) + 0.5;
        const arrival = remaining < stopping ? Math.max(0.1, remaining / stopping) : 1;
        const steep = slopeDeg > drive.slopeLimitDeg + 3 ? 0.4 : 1;
        targetSpeed = limit * curveFactor * arrival * steep * (this.planFound ? 1 : 0.4);
        if (!this.planFound || (Math.abs(this.speed) < 0.3 * limit && targetSpeed > 0.5 * limit)) this.stuckSeconds += dt;
        else this.stuckSeconds = Math.max(0, this.stuckSeconds - dt);
        if (this.stuckSeconds > 8) {
          this.recoverM = RECOVERY_REVERSE_M;
          this.stuckSeconds = 0;
          this.waypoints = [];
        }
      }
      if (remaining <= ARRIVAL_RADIUS_M || (remaining < 4 && this.speed < 0.02)) {
        this.finish();
        return;
      }
    } else {
      const forward = keys.has('w');
      const back = keys.has('s');
      if (forward && !back) targetSpeed = limit;
      else if (back && !forward) targetSpeed = -0.4 * limit;
      if (keys.has('a')) steerTarget -= MAX_STEER_RAD;
      if (keys.has('d')) steerTarget += MAX_STEER_RAD;
      const braking = keys.has(' ');
      if (braking) targetSpeed = 0;
      // Refuse to climb beyond the slope limit: the wheels do not have the traction (sliding is not modelled).
      const uphill = gradeRad * Math.sign(targetSpeed);
      if (targetSpeed !== 0 && (uphill * 180) / Math.PI > drive.slopeLimitDeg) targetSpeed = 0;
      if (path) {
        const projected = project(path, this.x, this.z, this.s, 80);
        this.s = projected.s;
        this.offRoute = projected.distance;
      }
    }

    // Power and the battery: solar from the service's state, load from what the rover is doing.
    const env = this.environmentNow();
    const inShadow = env.sunFraction < SHADOW_FRACTION;
    const lamps = this.lampsWanted(env.sunFraction);
    const flat = this.batteryKwh <= 1e-6;
    const solar = solarWatts(settings, env.sunFraction, env.sunElevationDeg);
    const idleNet = solar - loadWatts(settings, { speedMs: 0, gradeRad: 0, inShadow, headlights: lamps });
    if (flat && idleNet <= 0) targetSpeed = 0;
    this.batteryFlat = flat && idleNet <= 0;

    const brake = keys.has(' ') || targetSpeed === 0 ? 2.5 : 1;
    const delta = targetSpeed - this.speed;
    this.speed += Math.max(-accel * brake * dt, Math.min(accel * dt, delta));
    const steerDelta = steerTarget - this.steerAngle;
    this.steerAngle += Math.max(-STEER_RATE * dt, Math.min(STEER_RATE * dt, steerDelta));
    this.steerCommand = steerTarget;

    const distance = this.speed * dt;
    if (auto && path) this.trackSpeed(Math.max(0, distance), dt);
    if (Math.abs(distance) > 0) {
      // Bicycle-model turn: the heading changes by distance over turning radius (the radius never goes below the steering stop's), and no faster than the body can yaw.
      const curvature = Math.tan(this.steerAngle) / (WHEEL_BASE / 2);
      const limit = MAX_YAW_RATE * dt;
      this.yaw += Math.max(-limit, Math.min(limit, curvature * distance));
      this.x += Math.sin(this.yaw) * distance;
      this.z += -Math.cos(this.yaw) * distance;
    }
    this.collide();

    const load = loadWatts(settings, { speedMs: Math.abs(this.speed), gradeRad: Math.max(0, gradeRad * Math.sign(this.speed || 1)), inShadow, headlights: lamps });
    this.batteryKwh = stepBattery(settings, this.batteryKwh, solar - load, dt);
    if (auto || Math.abs(this.speed) > 0.005) this.clockMs += dt * 1000;
    for (let i = 0; i < 4; i += 1) this.spin[i] = (this.spin[i] as number) + this.wheelSpeed(i) * dt;
  }

  /** Running average of the ground speed actually achieved (stops, detours and slow-downs included), time constant 40 s. */
  private trackSpeed(metres: number, dt: number): void {
    const speed = dt > 0 ? metres / dt : 0;
    if (this.averageSamples === 0) this.averageSpeed = this.speedSettingMs;
    const alpha = 1 - Math.exp(-dt / 40);
    this.averageSpeed += alpha * (speed - this.averageSpeed);
    this.averageSamples += 1;
  }

  private resetSpeedAverage(): void {
    this.averageSamples = 0;
    this.averageSpeed = this.speedSettingMs;
  }

  /** Distance still to drive: along the local plan the rover is following now, then along the route beyond the plan's goal. */
  private remainingLength(): number {
    const path = this.path;
    if (!path) return 0;
    const routeLeft = Math.max(0, path.total - this.s);
    const plan = this.waypoints;
    if (plan.length === 0 || !this.planFound || this.waypointIndex >= plan.length) return routeLeft;
    let local = 0;
    let fromX = this.x;
    let fromZ = this.z;
    for (let k = this.waypointIndex; k < plan.length; k += 1) {
      const point = plan[k] as { x: number; z: number };
      local += Math.hypot(point.x - fromX, point.z - fromZ);
      fromX = point.x;
      fromZ = point.z;
    }
    const beyond = Math.max(0, path.total - (this.planS + PLAN_GOAL_M));
    return local + beyond;
  }

  private finish(): void {
    this.arrived = true;
    drive.arrived = true;
    drive.paused = true;
    this.speed = 0;
    if (this.path) this.s = this.path.total;
  }

  /** Where the four wheels go: steering geometry for four-wheel opposite-phase steering, and rolling. */
  private wheelGeometry(i: number): { angle: number; ratio: number } {
    const [lx, lz] = RoverDynamics.layout[i] as [number, number];
    const curvature = Math.tan(this.steerAngle) / (WHEEL_BASE / 2);
    const forward = -lz;
    const vx = curvature * forward;
    const vf = 1 - curvature * lx;
    return { angle: Math.atan2(vx, vf), ratio: Math.hypot(vx, vf) };
  }

  private wheelSpeed(i: number): number {
    return (this.speed * this.wheelGeometry(i).ratio) / ROVER.wheelRadius;
  }

  private applyWheels(): void {
    for (let i = 0; i < 4; i += 1) {
      this.rover.steer[i] = this.wheelGeometry(i).angle;
      // Wheel spin accumulated over the frame; at high rates it aliases, so only the visible fraction of a turn is applied.
      const angle = this.spin[i] as number;
      this.rover.spinWheel(i, angle % (2 * Math.PI));
      this.spin[i] = 0;
    }
  }

  /** The point to steer at: the next waypoint of the local plan, replanned as the rover moves. */
  /** The autopilot aims at a point on the route a few seconds ahead, further when it is moving faster. */
  private followPlan(path: RoutePath, dt: number): { x: number; z: number } {
    void dt;
    this.planFound = true;
    this.waypoints = [];
    const ahead = Math.max(6, Math.min(16, 4 + 3 * Math.abs(this.speed)));
    pointAt(path, this.s + ahead, this.tmp);
    return { x: this.tmp.x, z: this.tmp.z };
  }

  /** Obstacles are solid: push the rover out of any rock it touched and lose the speed. */
  private collide(): void {
    const rocks = this.rover.rocks.near(this.x, this.z, BODY_CLEARANCE_M + 1, this.nearRocks);
    for (const rock of rocks) {
      const dx = this.x - rock.x;
      const dz = this.z - rock.z;
      const distance = Math.hypot(dx, dz);
      // On autopilot the vehicle rolls over small rocks and slides round large ones; by hand every obstacle is solid.
      const auto = drive.mode === 'auto' && this.path !== null;
      if (auto && rock.radius < AUTO_OBSTACLE_RADIUS_M) continue;
      const minimum = rock.radius + (auto ? BODY_CLEARANCE_M * 0.7 : BODY_CLEARANCE_M);
      if (distance < minimum && distance > 1e-6) {
        this.x = rock.x + (dx / distance) * minimum;
        this.z = rock.z + (dz / distance) * minimum;
        this.speed *= auto ? 0.97 : 0.5;
      }
    }
  }

  private lampsWanted(sunFraction: number): boolean {
    if (drive.headlights === 'on') return true;
    if (drive.headlights === 'off') return false;
    return sunFraction < SHADOW_FRACTION;
  }

  /** Auto headlights follow what the renderer shows (the Sun's visible fraction at the mast, from the lighting probe), since small craters shadow the rover below the route service's 40 m terrain. */
  private updateHeadlights(): void {
    const service = this.environmentNow().sunFraction;
    const probe = window.__surfaceDebug ? this.probeSun(performance.now()) : service;
    this.rover.headlightsOn = this.lampsWanted(Math.min(service, probe));
  }

  /** Sun and Earth at the rover now, from the route's service answer when on the route, else the last waypoint answer. */
  private environmentNow(): { sunFraction: number; sunElevationDeg: number } {
    const status = this.bodies(false);
    return { sunFraction: status.sun.fraction, sunElevationDeg: this.sunElevationDeg };
  }

  private bodies(refresh: boolean): { sun: BodyStatus; earth: BodyStatus } {
    const clock = this.clockMs || this.clockUtcMs;
    const path = this.path;
    const samples = drive.environment;
    if (path && samples.length > 0 && this.offRoute < 30) {
      const at = environmentAt(samples, Math.max(0, this.s - path.connectorM));
      if (at && at.valid) {
        const sun = at.nearest;
        this.sunElevationDeg = at.sunElevationDeg;
        const sunStatus: BodyStatus = { fraction: at.sunFraction, elevationDeg: at.sunElevationDeg, eventKind: sun.sunEventKind, eventMs: sun.sunEventMs, source: 'route', ageSeconds: 0 };
        const earthStatus: BodyStatus = { fraction: at.earthFraction, elevationDeg: at.earthElevationDeg, eventKind: sun.earthEventKind, eventMs: sun.earthEventMs, source: 'route', ageSeconds: 0 };
        this.lastEnvironmentSun = sunStatus;
        this.lastEnvironmentEarth = earthStatus;
        return { sun: sunStatus, earth: earthStatus };
      }
    }
    const now = performance.now();
    if (refresh) this.maybeQueryWaypoint(now, clock);
    const answer = this.waypoint;
    if (answer) {
      const age = (now - answer.atMs) / 1000;
      this.sunElevationDeg = answer.sunElevationDeg;
      return {
        sun: { ...answer.sun, ageSeconds: age, source: 'waypoint' },
        earth: { ...answer.earth, ageSeconds: age, source: 'waypoint' },
      };
    }
    // Nothing from the services yet: the lighting module's own reading of the Sun at the mast.
    const fraction = this.probeSun(now);
    const debugState = window.__surfaceDebug?.state();
    const elevation = typeof debugState?.sunElevationDeg === 'number' ? debugState.sunElevationDeg : this.sunElevationDeg;
    this.sunElevationDeg = elevation;
    return {
      sun: { fraction, elevationDeg: elevation, eventKind: null, eventMs: null, source: 'probe', ageSeconds: 0 },
      earth: this.lastEnvironmentEarth ?? { fraction: 0, elevationDeg: 0, eventKind: null, eventMs: null, source: 'probe', ageSeconds: 0 },
    };
  }

  private probeSun(now: number): number {
    if (now - this.lastProbeMs > 250) {
      this.lastProbeMs = now;
      const debug = window.__surfaceDebug;
      if (debug) {
        try {
          this.probeFraction = debug.sunFractionAt(this.x, this.z, mission.mastHeightM);
        } catch {
          // The probe needs a loaded terrain; keep the last value.
        }
      }
    }
    return this.probeFraction;
  }

  private maybeQueryWaypoint(now: number, clock: number): void {
    if (this.waypointInflight || now - this.lastWaypoint < WAYPOINT_INTERVAL_MS) return;
    const moved = Math.hypot(this.x - this.waypointAt.x, this.z - this.waypointAt.z);
    const clockMoved = Math.abs(clock - this.waypointAt.clockMs);
    if (this.waypoint && moved < 40 && clockMoved < 600_000 && (now - this.waypoint.atMs) / 1000 < WAYPOINT_STALE_S) return;
    this.lastWaypoint = now;
    this.waypointInflight = true;
    const x = this.x;
    const z = this.z;
    const here = this.latLon(x, z);
    void this.fetchWaypoint(x, z, here, clock);
  }

  /** Busy (409) means another calculation holds the server for a moment: ask again with a short backoff before giving up. */
  private async fetchWaypoint(x: number, z: number, here: { latitudeDeg: number; longitudeDeg: number }, clock: number): Promise<void> {
    const generation = this.generation;
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const response = await api.expeditionWaypoint({
            latitude: here.latitudeDeg,
            longitude: here.longitudeDeg,
            height: mission.mastHeightM,
            arrival: new Date(clock).toISOString().replace('.000Z', 'Z'),
          });
          this.waypoint = waypointAnswer(response, x, z, clock);
          this.waypointAt = { x, z, clockMs: clock };
          return;
        } catch (cause) {
          const wait = WAYPOINT_RETRY_MS[attempt];
          if (!(cause instanceof ApiError) || cause.status !== 409 || wait === undefined || generation !== this.generation) return;
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
      }
    } finally {
      this.waypointInflight = false;
    }
  }

  private latLon(x: number, z: number): { latitudeDeg: number; longitudeDeg: number } {
    const origin = polarXY(this.site.latitudeDeg, this.site.longitudeDeg);
    return polarLatLon(origin.x + x, origin.y - z);
  }

  /** Publish telemetry to the HUD store at about 10 Hz. */
  private publish(force: boolean): void {
    this.overlay.setProgress(this.s);
    const now = performance.now();
    if (!force && now - this.lastTelemetry < TELEMETRY_INTERVAL_MS) return;
    this.lastTelemetry = now;
    const settings = drive.settings;
    const { sun, earth } = this.bodies(true);
    const path = this.path;
    const inShadow = sun.fraction < SHADOW_FRACTION;
    const lamps = this.rover.headlightsOn;
    const gradeRad = Math.max(0, Math.atan(this.slope.pitchSlope) * Math.sign(this.speed || 1));
    const solar = solarWatts(settings, sun.fraction, this.sunElevationDeg);
    const load = loadWatts(settings, { speedMs: Math.abs(this.speed), gradeRad, inShadow, headlights: lamps });
    const total = path?.total ?? 0;
    const remaining = this.remainingLength();
    const setting = this.speedSettingMs;
    const speedForEta = Math.max(this.averageSamples > 0 ? this.averageSpeed : setting, 0.15 * setting);
    let ahead: number | null = null;
    if (path && drive.environment.length > 0 && this.offRoute < 30) {
      const lookahead = this.s + speedForEta * SHADOW_AHEAD_SECONDS;
      ahead = environmentAt(drive.environment, Math.max(0, Math.min(path.total, lookahead) - path.connectorM))?.sunFraction ?? null;
    }
    const telemetry: Telemetry = {
      x: this.x,
      z: this.z,
      progressM: this.s,
      totalM: total,
      offRouteM: this.offRoute,
      speedMs: this.speed,
      slopeDeg: this.slope.slopeDeg,
      pitchDeg: (Math.atan(this.slope.pitchSlope) * 180) / Math.PI,
      rollDeg: (Math.atan(this.slope.rollSlope) * 180) / Math.PI,
      batteryKwh: this.batteryKwh,
      solarW: solar,
      loadW: load,
      netW: solar - load,
      sun,
      earth,
      headlightsOn: lamps,
      clockMs: this.clockMs || this.clockUtcMs,
      secondsToTarget: path ? remaining / speedForEta : null,
      plannedDurationMs: path && this.plannedSpeedMs > 0 ? (path.total / this.plannedSpeedMs) * 1000 : 0,
      plannedArrivalMs: path && this.plannedSpeedMs > 0 ? this.departureMs + (path.total / this.plannedSpeedMs) * 1000 : null,
      sunFractionAhead: ahead,
      batteryFlat: this.batteryFlat,
    };
    drive.setTelemetry(telemetry);
  }

  get planDebug(): unknown {
    return { found: this.planFound, waypoints: this.waypoints.length, index: this.waypointIndex, recover: this.recoverM, stuck: this.stuckSeconds, steer: this.steerAngle, wp: this.waypoints.slice(0, 4), s: this.s, off: this.offRoute };
  }

  /** Re-stage helper for the screen: set the camera's idea of the rover heading. */
  get heading(): number {
    return this.yaw;
  }

  dispose(): void {
    this.generation += 1;
  }
}

function routeErrorText(cause: unknown, slopeLimit: number): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'no_route_in_window' || /no route|no path/i.test(cause.message)) {
      return `No route under a ${slopeLimit}° slope limit. Try a closer target or a higher limit.`;
    }
    if (cause.code === 'search_limit' || /search/i.test(cause.message)) {
      return 'The target is too far or too rough to search. Try a target within about 8 km, or a higher slope limit.';
    }
    if (cause.status === 409) return 'The route service is busy. Try again in a moment.';
    if (cause.status === 0) return cause.message;
    return cause.message;
  }
  return 'The route could not be calculated.';
}

function waypointAnswer(response: WaypointResponse, x: number, z: number, clockMs: number): WaypointAnswer {
  const status = (body: 'SUN' | 'EARTH'): BodyStatus => {
    const state = response.bodies[body];
    const rise = state.next_events.rise;
    const set = state.next_events.set;
    const up = state.visible_fraction > 0.005;
    const event = up ? set : rise;
    return {
      fraction: state.visible_fraction,
      elevationDeg: state.center_elevation_deg,
      eventKind: event ? event.kind : null,
      eventMs: event ? Date.parse(event.utc) : null,
      source: 'waypoint',
      ageSeconds: 0,
    };
  };
  const sun = status('SUN');
  return { atMs: performance.now(), x, z, clockMs, sun, earth: status('EARTH'), sunElevationDeg: sun.elevationDeg };
}

import type { DriveResponse } from '../api/types';
import { environmentSamples, type EnvironmentSample } from './driveEnvironment';
import { CREW_CLASS, type PowerPrediction, type RoverSettings } from './roverPower';

export type CameraKind = 'chase' | 'driver' | 'mast' | 'orbit';
export type DriveMode = 'auto' | 'manual';
export type HeadlightMode = 'auto' | 'on' | 'off';
export type Quality = 'high' | 'medium' | 'low';
export type BodySource = 'route' | 'waypoint' | 'probe';

export const LAPSE_OPTIONS = [1, 5, 10, 60, 600, 3600] as const;
export const DEFAULT_LAPSE = 5;
/** Stay time-lapse factors: mission seconds per real second. */
export const STAY_LAPSE_OPTIONS = [600, 3600, 21600] as const;
export const DEFAULT_STAY_LAPSE = 3600;
export const DEFAULT_SPEED_KMH = 6;
export const DEFAULT_SLOPE_LIMIT_DEG = 15;
/** Targets are limited by the route service to about this far from the start. */
export const MAX_TARGET_RANGE_M = 8000;

/** What the Sun or Earth is doing at the rover, from the calculation services (the probe only fills gaps between answers). */
export interface BodyStatus {
  fraction: number;
  elevationDeg: number;
  eventKind: 'rise' | 'set' | null;
  eventMs: number | null;
  source: BodySource;
  /** Real seconds since the answer was received (route answers do not age). */
  ageSeconds: number;
}

export interface Telemetry {
  /** Rover position in scene metres (origin at the landing site, x east, z south). */
  x: number;
  z: number;
  progressM: number;
  totalM: number;
  offRouteM: number;
  speedMs: number;
  slopeDeg: number;
  pitchDeg: number;
  rollDeg: number;
  batteryKwh: number;
  solarW: number;
  loadW: number;
  netW: number;
  sun: BodyStatus;
  earth: BodyStatus;
  headlightsOn: boolean;
  /** Mission time of the rover now, UTC ms. */
  clockMs: number;
  /** Time to the target at the current speed (or the set speed while stopped), seconds. */
  secondsToTarget: number | null;
  /** Arrival UTC the plan promised (departure plus route length over the set speed), ms. Null without a route. */
  plannedArrivalMs: number | null;
  plannedDurationMs: number;
  /** Visible fraction of the Sun at the planned position 10 minutes of mission time ahead, when on the route. */
  sunFractionAhead: number | null;
  batteryFlat: boolean;
}

export interface DriveCommands {
  findRoute(): Promise<void>;
  start(): void;
  restart(): void;
  seek(fraction: number): void;
  returnToRoute(): void;
  clearTarget(): void;
  setTargetFromSite(latitudeDeg: number, longitudeDeg: number): void;
  /** Target at a point in scene metres (from the route map). */
  setTargetAt(x: number, z: number): void;
  refreshPrediction(): void;
  openPlanning(): void;
  closePlanning(): void;
  enterStay(): void;
  exitStay(): void;
}

const emptyBody: BodyStatus = { fraction: 1, elevationDeg: 0, eventKind: null, eventMs: null, source: 'probe', ageSeconds: 0 };

class DriveState {
  /** Plan drive: top-down view with the target picker open. */
  planning = $state(false);
  /** The Plan drive panel (target, speed, slope limit, route) is open; it starts open. */
  panelOpen = $state(true);
  menuOpen = $state(false);
  hudVisible = $state(true);
  camera = $state<CameraKind>('chase');
  mode = $state<DriveMode>('auto');
  paused = $state(true);
  lapse = $state<number>(DEFAULT_LAPSE);
  headlights = $state<HeadlightMode>('on');
  showRoute = $state(true);
  /** The route line is hidden in driver and mast views unless this is on. */
  routeInDriverView = $state(false);
  quality = $state<Quality>('high');
  settingsOpen = $state(false);
  /** Stay: the camera is on the base and the clock runs through the planned stay. */
  stay = $state(false);
  stayLapse = $state<number>(DEFAULT_STAY_LAPSE);
  stayPaused = $state(false);
  /** Stay: the base battery is empty right now, so the work lights are out. */
  outpostFlat = $state(false);

  speedKmh = $state(DEFAULT_SPEED_KMH);
  slopeLimitDeg = $state(DEFAULT_SLOPE_LIMIT_DEG);
  settings = $state<RoverSettings>({ ...CREW_CLASS });

  /** Target in scene metres and degrees. */
  target = $state.raw<{ latitudeDeg: number; longitudeDeg: number; x: number; z: number; label: string } | null>(null);
  routing = $state(false);
  error = $state<string | null>(null);
  route = $state.raw<DriveResponse | null>(null);
  environment = $state.raw<EnvironmentSample[]>([]);
  prediction = $state.raw<PowerPrediction | null>(null);
  /** The route is on the ground, the rover is placed and (if staged) the tracks are laid. */
  arrived = $state(false);
  telemetry = $state.raw<Telemetry>({
    x: 0,
    z: 0,
    progressM: 0,
    totalM: 0,
    offRouteM: 0,
    speedMs: 0,
    slopeDeg: 0,
    pitchDeg: 0,
    rollDeg: 0,
    batteryKwh: CREW_CLASS.batteryKwh,
    solarW: 0,
    loadW: 0,
    netW: 0,
    sun: emptyBody,
    earth: emptyBody,
    headlightsOn: false,
    clockMs: 0,
    secondsToTarget: null,
    plannedArrivalMs: null,
    plannedDurationMs: 0,
    sunFractionAhead: null,
    batteryFlat: false,
  });
  commands = $state.raw<DriveCommands | null>(null);

  get hasRoute(): boolean {
    return this.route !== null;
  }

  get phase(): 'idle' | 'ready' | 'driving' | 'paused' | 'arrived' {
    if (!this.route) return 'idle';
    if (this.arrived) return 'arrived';
    if (this.telemetry.progressM <= 0.01 && this.paused && this.mode === 'auto') return 'ready';
    return this.paused ? 'paused' : 'driving';
  }

  setRoute(response: DriveResponse | null): void {
    this.route = response;
    this.environment = response ? environmentSamples(response) : [];
    this.arrived = false;
    this.prediction = null;
  }

  setTelemetry(value: Telemetry): void {
    this.telemetry = value;
  }

  reset(): void {
    this.setRoute(null);
    this.target = null;
    this.error = null;
    this.paused = true;
    this.mode = 'auto';
    this.planning = false;
    this.stay = false;
    this.stayPaused = false;
  }
}

export const drive = new DriveState();

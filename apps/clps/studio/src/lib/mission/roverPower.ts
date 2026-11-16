/**
 * Rover power model: a battery, a solar array that follows the Sun in azimuth, and loads. Every constant is named and
 * documented here; the Surface menu's "Rover settings" sheet edits them. Nothing in the model reads pixels.
 */
export interface RoverSettings {
  /** Usable battery energy, kWh. */
  batteryKwh: number;
  /** Array output with the Sun fully visible and square on, watts. */
  arrayPeakW: number;
  /** Elevation of the array's normal above the horizon, degrees. The array turns about the vertical to face the Sun. */
  arrayNormalElevationDeg: number;
  /** Rover mass on the Moon, kg. */
  massKg: number;
  /** Rolling resistance coefficient of a wheel on loose regolith (Bekker-type fits give 0.1 to 0.25 for small wheels). */
  rollingResistance: number;
  /** Battery to ground: motors, gearing and controllers. */
  drivetrainEfficiency: number;
  /** Avionics, radio and thermal control when sunlit, watts. */
  idleW: number;
  /** Extra heater power while the rover is in shadow, watts. */
  shadowHeaterW: number;
  /** Electrical power of the two headlamps together, watts. */
  headlightW: number;
  chargeEfficiency: number;
  dischargeEfficiency: number;
  /** Top speed the speed setting may reach, km/h. */
  maxSpeedKmh: number;
  /** Acceleration and braking limit, m/s2. */
  accelerationMs2: number;
}

export const MOON_GRAVITY_MS2 = 1.62;
/** Ground in shadow below this visible fraction of the Sun: heaters on and, in auto, headlights on. */
export const SHADOW_FRACTION = 0.05;
export const LOW_BATTERY_FRACTION = 0.2;

export const VIPER_CLASS: RoverSettings = {
  batteryKwh: 5,
  arrayPeakW: 450,
  arrayNormalElevationDeg: 20,
  massKg: 450,
  rollingResistance: 0.15,
  drivetrainEfficiency: 0.5,
  idleW: 120,
  shadowHeaterW: 80,
  headlightW: 40,
  chargeEfficiency: 0.9,
  dischargeEfficiency: 0.9,
  maxSpeedKmh: 3,
  accelerationMs2: 0.3,
};

/** A crewed rover in the Apollo LRV mould, scaled up for a polar traverse: heavier, faster, larger battery and array. */
export const LRV_CLASS: RoverSettings = {
  batteryKwh: 15,
  arrayPeakW: 1500,
  arrayNormalElevationDeg: 20,
  massKg: 1200,
  rollingResistance: 0.15,
  drivetrainEfficiency: 0.5,
  idleW: 400,
  shadowHeaterW: 250,
  headlightW: 40,
  chargeEfficiency: 0.9,
  dischargeEfficiency: 0.9,
  maxSpeedKmh: 10,
  accelerationMs2: 1.2,
};

/** A pressurised two-crew surface vehicle: large battery, roof array, bright lamps, fast on open ground. */
export const CREW_CLASS: RoverSettings = {
  batteryKwh: 80,
  arrayPeakW: 3000,
  arrayNormalElevationDeg: 20,
  massKg: 3500,
  rollingResistance: 0.12,
  drivetrainEfficiency: 0.6,
  idleW: 900,
  shadowHeaterW: 600,
  headlightW: 600,
  chargeEfficiency: 0.92,
  dischargeEfficiency: 0.92,
  maxSpeedKmh: 15,
  accelerationMs2: 1,
};

export const ROVER_PRESETS = [
  { id: 'crew', label: 'Crew vehicle', settings: CREW_CLASS },
  { id: 'viper', label: 'VIPER class', settings: VIPER_CLASS },
  { id: 'lrv', label: 'LRV class (crewed)', settings: LRV_CLASS },
] as const;

/**
 * Array power, watts: peak x visible fraction of the Sun x cos(elevation mismatch). The array tracks the Sun's
 * azimuth but not its elevation, so the mismatch is the angle between the Sun's elevation and the array normal's.
 */
export function solarWatts(settings: RoverSettings, sunFraction: number, sunElevationDeg: number): number {
  if (sunFraction <= 0 || sunElevationDeg <= 0) return 0;
  const mismatch = ((sunElevationDeg - settings.arrayNormalElevationDeg) * Math.PI) / 180;
  return settings.arrayPeakW * Math.min(1, sunFraction) * Math.max(0, Math.cos(mismatch));
}

/**
 * Electrical power to drive, watts. Mechanical power is m g v (Crr cos(grade) + sin(grade)) in lunar gravity, never
 * negative (no regeneration is assumed), divided by the drivetrain efficiency.
 */
export function driveWatts(settings: RoverSettings, speedMs: number, gradeRad: number): number {
  if (speedMs <= 0) return 0;
  const force = settings.massKg * MOON_GRAVITY_MS2 * (settings.rollingResistance * Math.cos(gradeRad) + Math.sin(gradeRad));
  return Math.max(0, (force * speedMs) / settings.drivetrainEfficiency);
}

export interface LoadInput {
  speedMs: number;
  gradeRad: number;
  inShadow: boolean;
  headlights: boolean;
}

export function loadWatts(settings: RoverSettings, input: LoadInput): number {
  return (
    settings.idleW +
    (input.inShadow ? settings.shadowHeaterW : 0) +
    (input.headlights ? settings.headlightW : 0) +
    driveWatts(settings, input.speedMs, input.gradeRad)
  );
}

/** New battery energy after `seconds` at net power `netW` (solar minus load), clamped to 0 and the capacity. */
export function stepBattery(settings: RoverSettings, kwh: number, netW: number, seconds: number): number {
  const joulesKwh = seconds / 3_600_000;
  const delta = netW >= 0 ? netW * settings.chargeEfficiency * joulesKwh : (netW / settings.dischargeEfficiency) * joulesKwh;
  return Math.max(0, Math.min(settings.batteryKwh, kwh + delta));
}

export interface PowerSample {
  /** Seconds from the start of the drive. */
  seconds: number;
  sunFraction: number;
  sunElevationDeg: number;
  speedMs: number;
  gradeRad: number;
}

export interface PowerPrediction {
  minKwh: number;
  minFraction: number;
  endKwh: number;
  /** Seconds at which the battery first reaches zero, or null. */
  emptyAtSeconds: number | null;
}

/** Integrate the model over samples (assumed in time order, linear between them) in steps of at most `stepSeconds`. */
export function predictBattery(settings: RoverSettings, samples: PowerSample[], startKwh: number, stepSeconds = 10): PowerPrediction {
  let kwh = startKwh;
  let min = startKwh;
  let emptyAt: number | null = null;
  for (let k = 0; k + 1 < samples.length; k += 1) {
    const a = samples[k] as PowerSample;
    const b = samples[k + 1] as PowerSample;
    const span = b.seconds - a.seconds;
    if (span <= 0) continue;
    const steps = Math.max(1, Math.ceil(span / stepSeconds));
    const dt = span / steps;
    for (let i = 0; i < steps; i += 1) {
      const t = (i + 0.5) / steps;
      const fraction = a.sunFraction + (b.sunFraction - a.sunFraction) * t;
      const elevation = a.sunElevationDeg + (b.sunElevationDeg - a.sunElevationDeg) * t;
      const inShadow = fraction < SHADOW_FRACTION;
      const load = loadWatts(settings, { speedMs: a.speedMs, gradeRad: a.gradeRad + (b.gradeRad - a.gradeRad) * t, inShadow, headlights: inShadow });
      kwh = stepBattery(settings, kwh, solarWatts(settings, fraction, elevation) - load, dt);
      if (kwh < min) min = kwh;
      if (kwh <= 0 && emptyAt === null) emptyAt = a.seconds + (i + 1) * dt;
    }
  }
  return { minKwh: min, minFraction: settings.batteryKwh > 0 ? min / settings.batteryKwh : 0, endKwh: kwh, emptyAtSeconds: emptyAt };
}

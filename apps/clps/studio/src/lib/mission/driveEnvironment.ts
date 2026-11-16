import type { DriveResponse } from '../api/types';

/** Sun and Earth at one sample along a planned route, from the calculation service. */
export interface EnvironmentSample {
  distanceM: number;
  elapsedSeconds: number;
  utcMs: number;
  slopeDeg: number;
  sunFraction: number;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  sunEventKind: 'rise' | 'set' | null;
  sunEventMs: number | null;
  earthFraction: number;
  earthElevationDeg: number;
  earthEventKind: 'rise' | 'set' | null;
  earthEventMs: number | null;
  /** False when the service could not evaluate this point. */
  valid: boolean;
}

export function environmentSamples(response: DriveResponse): EnvironmentSample[] {
  return response.environment.map((point) => {
    const sun = point.sun;
    const earth = point.earth;
    return {
      distanceM: point.distance_m,
      elapsedSeconds: point.elapsed_seconds,
      utcMs: Date.parse(point.utc),
      slopeDeg: point.slope_deg,
      sunFraction: sun?.fraction ?? 0,
      sunAzimuthDeg: sun?.azimuth_deg ?? 0,
      sunElevationDeg: sun?.elevation_deg ?? 0,
      sunEventKind: sun?.next_event?.kind ?? null,
      sunEventMs: sun?.next_event ? Date.parse(sun.next_event.utc) : null,
      earthFraction: earth?.fraction ?? 0,
      earthElevationDeg: earth?.elevation_deg ?? 0,
      earthEventKind: earth?.next_event?.kind ?? null,
      earthEventMs: earth?.next_event ? Date.parse(earth.next_event.utc) : null,
      valid: sun !== null && earth !== null && !point.error,
    };
  });
}

export interface EnvironmentAt {
  sunFraction: number;
  sunElevationDeg: number;
  earthFraction: number;
  earthElevationDeg: number;
  /** The sample whose events are shown: the nearer of the two around the position. */
  nearest: EnvironmentSample;
  valid: boolean;
}

/** Fractions and elevations interpolated by distance along the route; events come from the nearest sample. */
export function environmentAt(samples: EnvironmentSample[], distanceM: number): EnvironmentAt | null {
  if (samples.length === 0) return null;
  let upper = samples.findIndex((s) => s.distanceM >= distanceM);
  if (upper < 0) upper = samples.length - 1;
  const b = samples[upper] as EnvironmentSample;
  const a = (samples[Math.max(0, upper - 1)] as EnvironmentSample) ?? b;
  const span = b.distanceM - a.distanceM;
  const t = span > 1e-9 ? Math.min(1, Math.max(0, (distanceM - a.distanceM) / span)) : 1;
  const mix = (x: number, y: number): number => x + (y - x) * t;
  return {
    sunFraction: mix(a.sunFraction, b.sunFraction),
    sunElevationDeg: mix(a.sunElevationDeg, b.sunElevationDeg),
    earthFraction: mix(a.earthFraction, b.earthFraction),
    earthElevationDeg: mix(a.earthElevationDeg, b.earthElevationDeg),
    nearest: t < 0.5 ? a : b,
    valid: a.valid && b.valid,
  };
}

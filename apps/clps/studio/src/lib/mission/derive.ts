import type { Body, BatchEstimateOk, BatchEstimateResult, BodySeries, BodySummary, EstimateEvent } from '../api/types';
import type { PowerSetup } from './store.svelte';

/** Simple battery rules, shared with the old outpost model. */
export const CHARGE_EFFICIENCY = 0.9;
export const DISCHARGE_EFFICIENCY = 0.9;
export const MAX_CHARGE_KW = 2;
export const MAX_DISCHARGE_KW = 2;
export const STEP_HOURS = 1;

const HOUR_MS = 3_600_000;
const EPSILON = 1e-9;

export interface BodySample {
  fraction: number;
  azimuthDeg: number;
  elevationDeg: number;
  angularRadiusDeg: number;
}

/** What the calculated visible fraction of the disc means for a viewer. */
export type Visibility = 'visible' | 'partial' | 'hidden';

const FULLY_VISIBLE = 0.995;
const FULLY_HIDDEN = 0.005;

export function visibilityOf(fraction: number): Visibility {
  if (fraction <= FULLY_HIDDEN) return 'hidden';
  return fraction >= FULLY_VISIBLE ? 'visible' : 'partial';
}

export interface Countdown {
  kind: 'set' | 'rise' | 'none';
  ms: number | null;
  /** Clock time of the next event, UTC milliseconds. */
  eventMs: number | null;
  up: boolean;
  state: Visibility;
}

export interface BatterySeries {
  /** State of charge in kWh at each hourly sample; index 0 is the start, full. */
  socKwh: number[];
  lowestKwh: number;
  hoursEmpty: number;
}

export interface SiteMetrics {
  sunMeanFraction: number;
  sunLongestDarkHours: number;
  earthMeanFraction: number;
  earthLongestLossHours: number;
  sunElevationDeg: number;
  earthElevationDeg: number;
  sunCountdown: Countdown;
  earthCountdown: Countdown;
  batteryLowestKwh: number;
  batteryHoursEmpty: number;
  batterySocNowKwh: number;
}

export function clockTimeMs(startUtc: string, clockIndex: number): number {
  return Date.parse(startUtc) + clockIndex * HOUR_MS;
}

function at(values: number[], index: number): number {
  return values[index] ?? 0;
}

function clampIndex(index: number, length: number): number {
  return Math.min(length - 1, Math.max(0, index));
}

/** Shortest-arc interpolation between two bearings in degrees, result in 0..360. */
function lerpAzimuth(from: number, to: number, t: number): number {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return (((from + delta * t) % 360) + 360) % 360;
}

/** Position is interpolated; visible fraction is the calculated value for the earlier whole hour. */
export function sampleAt(series: BodySeries, clockIndex: number): BodySample {
  const last = series.fraction.length - 1;
  const clamped = clampIndex(clockIndex, series.fraction.length);
  const lower = Math.floor(clamped);
  const upper = Math.min(lower + 1, last);
  const t = clamped - lower;
  const mix = (values: number[]): number => at(values, lower) + (at(values, upper) - at(values, lower)) * t;
  return {
    fraction: at(series.fraction, lower),
    azimuthDeg: lerpAzimuth(at(series.azimuth_deg, lower), at(series.azimuth_deg, upper), t),
    elevationDeg: mix(series.elevation_deg),
    angularRadiusDeg: mix(series.angular_radius_deg),
  };
}

export function isUp(series: BodySeries, clockIndex: number): boolean {
  return at(series.fraction, Math.floor(clampIndex(clockIndex, series.fraction.length))) > 0;
}

export function nextEvent(events: EstimateEvent[], body: Body, timeMs: number): EstimateEvent | null {
  for (const event of events) {
    if (event.body === body && Date.parse(event.utc) > timeMs) return event;
  }
  return null;
}

export function countdown(
  events: EstimateEvent[],
  series: BodySeries,
  body: Body,
  clockIndex: number,
  startUtc: string,
): Countdown {
  const up = isUp(series, clockIndex);
  const state = visibilityOf(sampleAt(series, clockIndex).fraction);
  const now = clockTimeMs(startUtc, clockIndex);
  const event = nextEvent(events, body, now);
  if (!event) return { kind: 'none', ms: null, eventMs: null, up, state };
  const eventMs = Date.parse(event.utc);
  return { kind: event.kind, ms: eventMs - now, eventMs, up, state };
}

/** Interpolated terrain horizon elevation at a bearing; the table has 2 degree spacing. */
export function horizonAt(horizonElevationDeg: number[], azimuthDeg: number): number {
  const count = horizonElevationDeg.length;
  const step = 360 / count;
  const position = ((((azimuthDeg % 360) + 360) % 360) / step) % count;
  const lower = Math.floor(position);
  const upper = (lower + 1) % count;
  const t = position - lower;
  const from = at(horizonElevationDeg, lower);
  return from + (at(horizonElevationDeg, upper) - from) * t;
}

export function batterySeries(sunFraction: number[], power: PowerSetup, stepHours: number = STEP_HOURS): BatterySeries {
  const capacity = Math.max(0, power.batteryKwh);
  const socKwh = [capacity];
  let soc = capacity;
  let lowestKwh = capacity;
  let hoursEmpty = 0;
  for (let hour = 0; hour < sunFraction.length - 1; hour += 1) {
    const solarKw = power.arrayKw * at(sunFraction, hour);
    const netKw = solarKw - power.loadKw;
    if (netKw >= 0) {
      const storedKwh = Math.min(netKw, MAX_CHARGE_KW) * CHARGE_EFFICIENCY * stepHours;
      soc = Math.min(capacity, soc + storedKwh);
    } else {
      const needKw = -netKw;
      const deliverableKw = Math.min(needKw, MAX_DISCHARGE_KW, (soc * DISCHARGE_EFFICIENCY) / stepHours);
      soc = Math.max(0, soc - (deliverableKw * stepHours) / DISCHARGE_EFFICIENCY);
      if (deliverableKw < needKw - EPSILON) hoursEmpty += stepHours;
    }
    socKwh.push(soc);
    lowestKwh = Math.min(lowestKwh, soc);
  }
  return { socKwh, lowestKwh, hoursEmpty };
}

function summaryFor(result: BatchEstimateOk, body: Body): BodySummary | undefined {
  return result.summaries.find((summary) => summary.body === body);
}

export function siteMetrics(
  result: BatchEstimateOk,
  clockIndex: number,
  startUtc: string,
  power: PowerSetup,
): SiteMetrics {
  const sun = summaryFor(result, 'SUN');
  const earth = summaryFor(result, 'EARTH');
  const battery = batterySeries(result.series.sun.fraction, power);
  const socIndex = Math.floor(clampIndex(clockIndex, battery.socKwh.length));
  return {
    sunMeanFraction: sun?.mean_visible_fraction ?? 0,
    sunLongestDarkHours: sun?.longest_blocked_hours ?? 0,
    earthMeanFraction: earth?.mean_visible_fraction ?? 0,
    earthLongestLossHours: earth?.longest_blocked_hours ?? 0,
    sunElevationDeg: sampleAt(result.series.sun, clockIndex).elevationDeg,
    earthElevationDeg: sampleAt(result.series.earth, clockIndex).elevationDeg,
    sunCountdown: countdown(result.events, result.series.sun, 'SUN', clockIndex, startUtc),
    earthCountdown: countdown(result.events, result.series.earth, 'EARTH', clockIndex, startUtc),
    batteryLowestKwh: battery.lowestKwh,
    batteryHoursEmpty: battery.hoursEmpty,
    batterySocNowKwh: at(battery.socKwh, socIndex),
  };
}

/** Charge in kWh at a fractional clock index (the earlier whole hour). */
export function socAt(battery: BatterySeries, clockIndex: number): number {
  return at(battery.socKwh, Math.floor(clampIndex(clockIndex, battery.socKwh.length)));
}

export function okResult(result: BatchEstimateResult | undefined): BatchEstimateOk | null {
  return result && result.ok ? result : null;
}

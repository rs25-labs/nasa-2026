import { formatDuration, formatUtc } from '../../lib/format';
import type { BodyStatus, Telemetry } from '../../lib/mission/drive.svelte';
import { LOW_BATTERY_FRACTION, SHADOW_FRACTION } from '../../lib/mission/roverPower';

const NBSP = ' ';
const HOUR_MS = 3_600_000;
const PLAN_DIFFERENCE = 0.05;

export function percentText(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** "visible 100%", "partly 40%" or "hidden". */
export function bodyState(fraction: number, words: { up: string; down: string }): string {
  if (fraction <= 0.005) return words.down;
  if (fraction >= 0.995) return `${words.up} 100%`;
  return `partly ${percentText(fraction)}`;
}

function wait(ms: number): string {
  return formatDuration(Math.max(0, ms)).replaceAll(' ', NBSP);
}

/** What the next event is and when, against the mission clock; "stays visible 72 h+" when the service found none. */
export function eventText(status: BodyStatus, clockMs: number, lookaheadHours: number, stays: { up: string; down: string }): string {
  if (status.eventKind === null || status.eventMs === null) return `stays ${status.fraction > 0.005 ? stays.up : stays.down} ${lookaheadHours}${NBSP}h+`;
  const ms = status.eventMs - clockMs;
  return `${status.eventKind === 'set' ? 'sets' : 'rises'} in ${wait(ms)}`;
}

export interface SunField {
  text: string;
  detail: string;
}

export function sunField(sun: BodyStatus, clockMs: number): SunField {
  return {
    text: bodyState(sun.fraction, { up: 'visible', down: 'hidden' }),
    detail: eventText(sun, clockMs, 72, { up: 'visible', down: 'hidden' }),
  };
}

export function earthField(earth: BodyStatus, clockMs: number): SunField {
  const up = earth.fraction > 0.005;
  return {
    text: up ? 'in view' : 'out of view',
    detail: eventText(earth, clockMs, 72, { up: 'in view', down: 'out of view' }),
  };
}

export function sourceNote(status: BodyStatus): string {
  if (status.source === 'waypoint' && status.ageSeconds > 10) return ` · ${Math.round(status.ageSeconds)}${NBSP}s old`;
  if (status.source === 'probe') return ' · estimate';
  return '';
}

export function kilometres(metres: number): string {
  return (metres / 1000).toFixed(metres < 10_000 ? 2 : 1);
}

export function clockText(ms: number): string {
  return formatUtc(ms);
}

function utcHourMinute(ms: number): string {
  return `${new Date(ms).toISOString().slice(11, 16)}${NBSP}UTC`;
}

export function arrivalText(telemetry: Telemetry, arrived: boolean): string {
  if (arrived) return `Arrived ${utcHourMinute(telemetry.clockMs)}`;
  if (telemetry.secondsToTarget === null) return '—';
  const arrival = telemetry.clockMs + telemetry.secondsToTarget * 1000;
  const text = `${wait(telemetry.secondsToTarget * 1000)} · ${utcHourMinute(arrival)}`;
  const planned = telemetry.plannedArrivalMs;
  if (planned === null || telemetry.plannedDurationMs <= 0 || telemetry.progressM < 1) return text;
  // Show the plan's arrival beside the current one when they differ by more than 5 per cent of the planned duration.
  return Math.abs(arrival - planned) > PLAN_DIFFERENCE * telemetry.plannedDurationMs ? `${text} · planned ${new Date(planned).toISOString().slice(11, 16)}` : text;
}

export interface Warning {
  id: 'battery' | 'shadow' | 'earth' | 'steep';
  word: string;
  sentence: string;
}

/** Battery below 20% (low), shadow within 10 minutes on the route (shadow ahead), Earth sets within 30 minutes (losing Earth), slope within 2 degrees of the limit (near limit) or above it (over limit). */
export function warningsFor(telemetry: Telemetry, capacityKwh: number, slopeLimitDeg: number): Warning[] {
  const list: Warning[] = [];
  const fraction = capacityKwh > 0 ? telemetry.batteryKwh / capacityKwh : 0;
  if (telemetry.batteryFlat) list.push({ id: 'battery', word: 'flat', sentence: 'Battery flat. The rover waits for sunlight.' });
  else if (fraction < LOW_BATTERY_FRACTION) list.push({ id: 'battery', word: 'low', sentence: `Battery low, ${percentText(fraction)}.` });
  if (telemetry.sun.fraction >= SHADOW_FRACTION && telemetry.sunFractionAhead !== null && telemetry.sunFractionAhead < SHADOW_FRACTION) {
    list.push({ id: 'shadow', word: 'shadow ahead', sentence: 'Entering shadow within 10 minutes.' });
  }
  if (telemetry.earth.fraction > 0.005 && telemetry.earth.eventKind === 'set' && telemetry.earth.eventMs !== null && telemetry.earth.eventMs - telemetry.clockMs < 30 * 60_000) {
    list.push({ id: 'earth', word: 'losing Earth', sentence: 'Earth sets within 30 minutes.' });
  }
  if (telemetry.slopeDeg > slopeLimitDeg) list.push({ id: 'steep', word: 'over limit', sentence: 'Slope is over the limit.' });
  else if (telemetry.slopeDeg >= slopeLimitDeg - 2) list.push({ id: 'steep', word: 'near limit', sentence: 'Slope is within 2 degrees of the limit.' });
  return list;
}

export function hoursBetween(a: number, b: number): number {
  return (b - a) / HOUR_MS;
}

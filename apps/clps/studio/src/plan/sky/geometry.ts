import type { BodySeries } from '../../lib/api/types';
import { sampleAt } from '../../lib/mission/derive';

export interface AxisRange {
  low: number;
  high: number;
  step: number;
}

export interface TrackPoint {
  azimuthDeg: number;
  elevationDeg: number;
}

const STEP_CHOICES = [0.5, 1, 2, 5, 10, 20, 30];

export function niceStep(roughStep: number): number {
  return STEP_CHOICES.find((choice) => choice >= roughStep) ?? 30;
}

/** Range that includes every value and 0, padded, at least minSpan wide, snapped to whole steps. */
export function rangeFor(values: number[], minSpan: number, targetTicks: number): AxisRange {
  let low = Math.min(0, ...values);
  let high = Math.max(0, ...values);
  const pad = 0.1 * (high - low) + 0.3;
  low -= pad;
  high += pad;
  if (high - low < minSpan) {
    const middle = (high + low) / 2;
    low = middle - minSpan / 2;
    high = middle + minSpan / 2;
  }
  const step = niceStep((high - low) / targetTicks);
  return { low: Math.floor(low / step) * step, high: Math.ceil(high / step) * step, step };
}

export function ticksFor(range: AxisRange): number[] {
  const ticks: number[] = [];
  for (let value = range.low; value <= range.high + 1e-9; value += range.step) ticks.push(Math.round(value * 100) / 100);
  return ticks;
}

/** Splits a track wherever azimuth wraps through north, so no line crosses the panel. */
function pushPoint(segments: TrackPoint[][], point: TrackPoint): void {
  const current = segments[segments.length - 1];
  const previous = current?.[current.length - 1];
  if (!current || !previous || Math.abs(point.azimuthDeg - previous.azimuthDeg) > 180) {
    segments.push([point]);
  } else {
    current.push(point);
  }
}

/** Track from the start to the clock (or the whole stay when clockIndex is omitted). */
export function trackSegments(series: BodySeries, clockIndex?: number): TrackPoint[][] {
  const segments: TrackPoint[][] = [];
  const last = series.azimuth_deg.length - 1;
  const lastWhole = clockIndex === undefined ? last : Math.min(last, Math.floor(clockIndex));
  for (let hour = 0; hour <= lastWhole; hour += 1) {
    pushPoint(segments, { azimuthDeg: series.azimuth_deg[hour] ?? 0, elevationDeg: series.elevation_deg[hour] ?? 0 });
  }
  if (clockIndex !== undefined && clockIndex > lastWhole && lastWhole < last) {
    const sample = sampleAt(series, clockIndex);
    pushPoint(segments, { azimuthDeg: sample.azimuthDeg, elevationDeg: sample.elevationDeg });
  }
  return segments;
}

/** Path with x in azimuth degrees and y in pixels, drawn once per 360 degree copy. */
export function segmentsPath(segments: TrackPoint[][], yOf: (elevationDeg: number) => number, copies: number[]): string {
  const parts: string[] = [];
  for (const copy of copies) {
    for (const segment of segments) {
      segment.forEach((point, index) => {
        parts.push(`${index === 0 ? 'M' : 'L'}${(point.azimuthDeg + copy).toFixed(2)} ${yOf(point.elevationDeg).toFixed(1)}`);
      });
    }
  }
  return parts.join('');
}

export function linePath(xs: number[], ys: number[]): string {
  return xs.map((x, index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${(ys[index] ?? 0).toFixed(1)}`).join('');
}

/** Closest equivalent of azimuth to a centre bearing, as a continuous degree value. */
export function unwrapNear(azimuthDeg: number, centreDeg: number): number {
  return azimuthDeg + 360 * Math.round((centreDeg - azimuthDeg) / 360);
}

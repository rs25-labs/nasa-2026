import { visibilityOf } from './derive';

/** Hourly visible fractions of the Sun and Earth over the stay, from the plan's estimate for one site. */
export interface SkySeries {
  sun: number[];
  earth: number[];
}

export interface DriveWindow {
  /** Hours from the landing time. */
  startIndex: number;
  /** Hours from the start with both the Sun up and Earth in view (or the Sun only, when `both` is false). */
  clearHours: number;
  /** True when Earth is in view as well as the Sun; false when no hour of the stay has both. */
  both: boolean;
}

/** Long enough for any drive the route service plans (about 8 km); a longer clear spell earns no extra credit. */
const ENOUGH_HOURS = 24;

const up = (fraction: number | undefined): boolean => fraction !== undefined && visibilityOf(fraction) === 'visible';

/** Consecutive hours from `index` on which `clear` holds, up to ENOUGH_HOURS. */
function runFrom(index: number, length: number, clear: (hour: number) => boolean): number {
  let hours = 0;
  while (index + hours < length && hours < ENOUGH_HOURS && clear(index + hours)) hours += 1;
  return hours;
}

/** Hours from `index` with both the Sun up and Earth in view. */
export function clearHoursFrom(series: SkySeries, index: number): { both: number; sun: number; earth: number } {
  const start = Math.max(0, Math.floor(index));
  const length = Math.min(series.sun.length, series.earth.length);
  return {
    both: runFrom(start, length, (hour) => up(series.sun[hour]) && up(series.earth[hour])),
    sun: runFrom(start, length, (hour) => up(series.sun[hour])),
    earth: runFrom(start, length, (hour) => up(series.earth[hour])),
  };
}

/**
 * The best time in the stay to start a drive: the earliest hour with the longest spell of the Sun up (solar power)
 * and Earth in view (direct radio contact), up to a day. With no such hour, the earliest longest sunlit spell.
 */
export function bestDriveWindow(series: SkySeries): DriveWindow | null {
  const length = Math.min(series.sun.length, series.earth.length);
  if (length === 0) return null;
  let best: DriveWindow | null = null;
  for (const both of [true, false]) {
    for (let index = 0; index < length - 1; index += 1) {
      const clear = runFrom(index, length, (hour) => up(series.sun[hour]) && (!both || up(series.earth[hour])));
      if (clear > (best?.clearHours ?? 0)) best = { startIndex: index, clearHours: clear, both };
      if (clear >= ENOUGH_HOURS) break;
    }
    if (best) return best;
  }
  return null;
}

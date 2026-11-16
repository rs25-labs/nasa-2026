import { untrack } from 'svelte';
import { api, ApiError } from '../api/client';
import { mission } from './store.svelte';

export const FIRST_YEAR = 1969;
export const LAST_YEAR = 2035;

const CHUNK_DAYS = 30;
const HOURS_PER_DAY = 24;
const DAY_MS = 86_400_000;
const DEBOUNCE_MS = 250;

export type YearStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface YearData {
  status: YearStatus;
  siteId: string | null;
  year: number;
  /** Daily mean visible fraction per day of the year; NaN for days not loaded yet. */
  sun: number[];
  earth: number[];
  loadedDays: number;
  error: string | null;
}

interface CacheEntry {
  sun: number[];
  earth: number[];
  loadedDays: number;
}

export function daysInYear(year: number): number {
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS;
}

export function yearStartMs(year: number): number {
  return Date.UTC(year, 0, 1);
}

function startYear(): number {
  return new Date(mission.startUtc).getUTCFullYear();
}

/** The year on show. It follows the mission start and can be stepped with the year buttons. */
export const yearView = $state({ year: startYear() });

export function stepYear(delta: number): void {
  yearView.year = Math.min(LAST_YEAR, Math.max(FIRST_YEAR, yearView.year + delta));
}

export const yearData: YearData = $state({
  status: 'idle',
  siteId: null,
  year: yearView.year,
  sun: [],
  earth: [],
  loadedDays: 0,
  error: null,
});

const cache = new Map<string, CacheEntry>();

function mean(values: number[], from: number): number {
  let total = 0;
  for (let hour = 0; hour < HOURS_PER_DAY; hour += 1) total += values[from + hour] ?? 0;
  return total / HOURS_PER_DAY;
}

function publish(entry: CacheEntry, siteId: string, year: number, status: YearStatus, error: string | null): void {
  yearData.status = status;
  yearData.siteId = siteId;
  yearData.year = year;
  yearData.sun = entry.sun.slice();
  yearData.earth = entry.earth.slice();
  yearData.loadedDays = entry.loadedDays;
  yearData.error = error;
}

async function load(
  entry: CacheEntry,
  site: { id: string; latitudeDeg: number; longitudeDeg: number },
  mastHeightM: number,
  year: number,
  signal: AbortSignal,
): Promise<void> {
  const total = daysInYear(year);
  try {
    while (entry.loadedDays < total) {
      const firstDay = entry.loadedDays;
      const days = Math.min(CHUNK_DAYS, total - firstDay);
      const response = await api.estimates(
        {
          start: new Date(yearStartMs(year) + firstDay * DAY_MS).toISOString(),
          days,
          observer_height_m: mastHeightM,
          sites: [{ site_id: 'year', latitude_deg: site.latitudeDeg, longitude_deg: site.longitudeDeg }],
        },
        signal,
      );
      if (signal.aborted) return;
      const result = response.results[0];
      if (!result || !result.ok) throw new ApiError(result && !result.ok ? result.error : 'No result for this site.', 502);
      for (let day = 0; day < days; day += 1) {
        entry.sun[firstDay + day] = mean(result.series.sun.fraction, day * HOURS_PER_DAY);
        entry.earth[firstDay + day] = mean(result.series.earth.fraction, day * HOURS_PER_DAY);
      }
      entry.loadedDays = firstDay + days;
      publish(entry, site.id, year, entry.loadedDays >= total ? 'ready' : 'loading', null);
    }
  } catch (cause) {
    if (signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) return;
    publish(entry, site.id, year, 'error', cause instanceof ApiError ? cause.message : 'Year calculation failed.');
  }
}

$effect.root(() => {
  // The year on show follows the mission start whenever that changes.
  $effect(() => {
    const year = startYear();
    untrack(() => {
      yearView.year = year;
    });
  });

  // Daily means for the selected site: consecutive 30-day batches, cached, latest site wins.
  $effect(() => {
    const site = mission.sites.find((s) => s.id === mission.selectedSiteId);
    const mastHeightM = mission.mastHeightM;
    const year = yearView.year;
    if (!site) {
      untrack(() => {
        yearData.status = 'idle';
        yearData.sun = [];
        yearData.earth = [];
        yearData.loadedDays = 0;
      });
      return;
    }
    const target = { id: site.id, latitudeDeg: site.latitudeDeg, longitudeDeg: site.longitudeDeg };
    const key = `${target.latitudeDeg.toFixed(5)},${target.longitudeDeg.toFixed(5)},${mastHeightM},${year}`;
    let entry = cache.get(key);
    if (!entry) {
      const total = daysInYear(year);
      entry = { sun: new Array<number>(total).fill(Number.NaN), earth: new Array<number>(total).fill(Number.NaN), loadedDays: 0 };
      cache.set(key, entry);
    }
    const chosen = entry;
    const complete = chosen.loadedDays >= chosen.sun.length;
    untrack(() => publish(chosen, target.id, year, complete ? 'ready' : 'loading', null));
    if (complete) return;
    const controller = new AbortController();
    const timer = setTimeout(() => void load(chosen, target, mastHeightM, year, controller.signal), DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });
});

import { untrack } from 'svelte';
import { api, ApiError } from '../api/client';
import type { BatchEstimateResult } from '../api/types';
import { formatEventUtc } from '../format';
import { okResult } from './derive';
import { mission, type MissionState } from './store.svelte';

export type EstimateStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface EstimateState {
  status: EstimateStatus;
  bySiteId: Record<string, BatchEstimateResult>;
  error: string | null;
}

const DEBOUNCE_MS = 250;

export interface BaselineValue {
  /** Sunlight, % of stay, whole number as shown in the table. */
  sunPercent: number;
  /** Longest dark, whole hours as shown in the table. */
  darkHours: number;
}

/** Metrics of the window before the latest landing or stay change, for before/after deltas. */
export const comparison: { active: boolean; label: string; bySiteId: Record<string, BaselineValue> } = $state({
  active: false,
  label: '',
  bySiteId: {},
});

export function clearComparison(): void {
  comparison.active = false;
  comparison.label = '';
  comparison.bySiteId = {};
}

interface StayWindow {
  start: string;
  days: number;
}

function keyOf(value: StayWindow): string {
  return `${value.start}|${value.days}`;
}

function captureBaseline(from: StayWindow, to: StayWindow, estimates: EstimateState): void {
  const bySiteId: Record<string, BaselineValue> = {};
  for (const [id, result] of Object.entries(estimates.bySiteId)) {
    const ok = okResult(result);
    if (!ok) continue;
    const sun = ok.summaries.find((summary) => summary.body === 'SUN');
    if (!sun) continue;
    bySiteId[id] = {
      sunPercent: Math.round(sun.mean_visible_fraction * 100),
      darkHours: Math.round(sun.longest_blocked_hours),
    };
  }
  if (Object.keys(bySiteId).length === 0) return;
  const stayNote = from.days === to.days ? '' : `, stay ${from.days} d`;
  comparison.bySiteId = bySiteId;
  comparison.label = `landing ${formatEventUtc(Date.parse(from.start))}${stayNote}`;
  comparison.active = true;
}

/**
 * Keeps one estimate result in step with a mission: recalculates (debounced) whenever its sites, dates or mast
 * change. The previous result stays in place while a new one loads. `onWindowChange` hears about a new stay
 * window while the old results are still in hand.
 */
export function createEstimates(
  source: MissionState,
  onWindowChange?: (from: StayWindow, to: StayWindow, current: EstimateState) => void,
): EstimateState {
  const estimates: EstimateState = $state({ status: 'idle', bySiteId: {}, error: null });
  /** The window the current results were calculated for. */
  let resultWindow: StayWindow | null = null;
  let lastKey: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: AbortController | undefined;

  async function run(request: Parameters<typeof api.estimates>[0], signal: AbortSignal): Promise<void> {
    const stay: StayWindow = { start: request.start, days: request.days };
    try {
      const response = await api.estimates(request, signal);
      if (signal.aborted) return;
      const bySiteId: Record<string, BatchEstimateResult> = {};
      for (const result of response.results) bySiteId[result.site_id] = result;
      estimates.bySiteId = bySiteId;
      resultWindow = stay;
      estimates.error = null;
      estimates.status = 'ready';
    } catch (cause) {
      if (signal.aborted) return;
      estimates.error = cause instanceof ApiError ? cause.message : 'Calculation failed.';
      estimates.status = 'error';
    }
  }

  $effect.root(() => {
    $effect(() => {
      const request = {
        start: source.startUtc,
        days: source.days,
        observer_height_m: source.mastHeightM,
        sites: source.sites.map((s) => ({
          site_id: s.id,
          latitude_deg: s.latitudeDeg,
          longitude_deg: s.longitudeDeg,
        })),
      };
      const next: StayWindow = { start: request.start, days: request.days };
      untrack(() => {
        const key = keyOf(next);
        if (lastKey !== null && key !== lastKey && resultWindow !== null && keyOf(resultWindow) !== key) {
          onWindowChange?.(resultWindow, next, estimates);
        }
        lastKey = key;
      });
      clearTimeout(timer);
      inflight?.abort();
      if (request.sites.length === 0) {
        estimates.bySiteId = {};
        estimates.status = 'idle';
        estimates.error = null;
        return;
      }
      estimates.status = 'loading';
      const controller = new AbortController();
      timer = setTimeout(() => {
        inflight = controller;
        void run(request, controller.signal);
      }, DEBOUNCE_MS);
      return () => {
        clearTimeout(timer);
        controller.abort();
      };
    });
  });

  return estimates;
}

/** The plan's results, with before/after deltas whenever its landing or stay changes. */
export const estimates: EstimateState = createEstimates(mission, captureBaseline);

import { api, ApiError, type NotableSite } from '../lib/api/client';
import { createClock } from '../lib/mission/clock.svelte';
import { createEstimates } from '../lib/mission/estimates.svelte';
import type { MissionSession } from '../lib/mission/session';
import {
  clampStartIso,
  createCoreActions,
  defaultState,
  floorToHourIso,
  MAX_DAYS,
  MIN_DAYS,
  type MissionState,
} from '../lib/mission/store.svelte';

/**
 * Real Landings keeps its own mission: one landing, at its documented date. Nothing here reads or writes the
 * plan, so looking at a landing never moves the plan's dates. Held in memory only.
 */
const starter = defaultState();
const landingMission: MissionState = $state({ ...starter, sites: [], selectedSiteId: null });
const landingActions = createCoreActions(landingMission);

export const landingSession: MissionSession = {
  mission: landingMission,
  actions: landingActions,
  estimates: createEstimates(landingMission),
  clock: createClock(landingMission, landingActions),
};

export const landingList: { status: 'idle' | 'loading' | 'ready' | 'error'; sites: NotableSite[]; notice: string; error: string } =
  $state({ status: 'idle', sites: [], notice: '', error: '' });

/** Fetch the landings once; a failed load can be retried. */
export function loadLandings(): void {
  if (landingList.status === 'loading' || landingList.status === 'ready') return;
  landingList.status = 'loading';
  api.notableSites().then(
    (response) => {
      landingList.sites = [...response.sites].sort((a, b) => Date.parse(a.landing_utc) - Date.parse(b.landing_utc));
      landingList.notice = response.coordinate_notice;
      landingList.error = '';
      landingList.status = 'ready';
    },
    (cause: unknown) => {
      landingList.error = cause instanceof ApiError ? cause.message : 'Landings could not be loaded.';
      landingList.status = 'error';
    },
  );
}

/** Show one landing from its documented time, rounded down to the hour, for its documented stay. */
export function showLanding(site: NotableSite): void {
  const days = Math.round(Math.min(MAX_DAYS, Math.max(MIN_DAYS, Number.isFinite(site.days) ? site.days : starter.days)));
  Object.assign(landingMission, {
    sites: [
      { id: site.id, name: site.name, latitudeDeg: site.latitude_deg, longitudeDeg: site.longitude_deg, source: 'landing' },
    ],
    selectedSiteId: site.id,
    startUtc: clampStartIso(floorToHourIso(site.landing_utc), days),
    days,
    clockIndex: 0,
    playing: false,
  });
}

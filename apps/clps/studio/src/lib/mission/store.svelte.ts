import { coordinateName, isLegacyCustomName, siteLabel } from './labels';
import { decodeShare } from './share';

export type SiteSource = 'catalog' | 'landing' | 'custom';

export interface MissionSite {
  id: string;
  name: string;
  latitudeDeg: number;
  longitudeDeg: number;
  source: SiteSource;
}

export interface PowerSetup {
  arrayKw: number;
  batteryKwh: number;
  loadKw: number;
}

export interface MissionState {
  sites: MissionSite[];
  selectedSiteId: string | null;
  startUtc: string;
  days: number;
  mastHeightM: number;
  power: PowerSetup;
  /** People staying at the site and the continuous power each one needs, for the outpost stay plan. */
  crew: number;
  crewKw: number;
  /** Fractional index into the hourly series: 0 is the window start, days*24 its end. */
  clockIndex: number;
  playing: boolean;
}

export const MAX_SITES = 8;
export const MIN_DAYS = 1;
export const MAX_DAYS = 30;
export const MAX_MAST_M = 20;
export const MAX_CREW = 40;
export const MIN_CREW_KW = 0.5;
export const MAX_CREW_KW = 10;
const STORAGE_KEY = 'lml-studio-mission-v2';
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** The server's dates run from 1969-01-01 to the end of 2035; a whole stay must fit inside. */
export const FIRST_START_MS = Date.UTC(1969, 0, 1);
export const END_MS = Date.UTC(2036, 0, 1);

export function defaultState(): MissionState {
  return {
    sites: [
      { id: 'pub-mmo01', name: 'Mons Mouton MMO01', latitudeDeg: -85.416, longitudeDeg: 31.851, source: 'catalog' },
      { id: 'pub-cr01', name: 'Connecting Ridge CR01', latitudeDeg: -89.527, longitudeDeg: -154.592, source: 'catalog' },
      { id: 'pub-mma01', name: 'Mons Malapert MMA01', latitudeDeg: -85.942, longitudeDeg: -0.944, source: 'catalog' },
    ],
    selectedSiteId: 'pub-mmo01',
    // Three contrasting sites on a date when they differ clearly in sunlight and Earth in view.
    startUtc: '2026-12-14T00:00:00Z',
    days: 7,
    mastHeightM: 2,
    power: { arrayKw: 2, batteryKwh: 12, loadKw: 0.4 },
    crew: 4,
    crewKw: 2,
    clockIndex: 0,
    playing: false,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Number of hourly samples for a window: start inclusive to end inclusive. */
export function sampleCount(days: number): number {
  return days * 24 + 1;
}

export function clampClock(index: number, days: number): number {
  if (!Number.isFinite(index)) return 0;
  return clamp(index, 0, sampleCount(days) - 1);
}

export function floorToHourIso(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return defaultState().startUtc;
  return new Date(Math.floor(ms / HOUR_MS) * HOUR_MS).toISOString().replace('.000Z', 'Z');
}

export function addSite(state: MissionState, site: MissionSite): MissionState {
  if (state.sites.some((s) => s.id === site.id) || state.sites.length >= MAX_SITES) return state;
  return { ...state, sites: [...state.sites, site], selectedSiteId: site.id };
}

export function removeSite(state: MissionState, id: string): MissionState {
  const sites = state.sites.filter((s) => s.id !== id);
  const selectedSiteId = state.selectedSiteId === id ? (sites[0]?.id ?? null) : state.selectedSiteId;
  return { ...state, sites, selectedSiteId };
}

export function selectSite(state: MissionState, id: string): MissionState {
  return state.sites.some((s) => s.id === id) ? { ...state, selectedSiteId: id } : state;
}

/** Keeps the whole stay inside the supported dates. */
export function clampStartIso(iso: string, days: number): string {
  const ms = Date.parse(floorToHourIso(iso));
  const latest = END_MS - days * DAY_MS;
  return new Date(clamp(ms, FIRST_START_MS, latest)).toISOString().replace('.000Z', 'Z');
}

export function setWindow(state: MissionState, startUtc: string, days: number): MissionState {
  const nextDays = Math.round(clamp(days, MIN_DAYS, MAX_DAYS));
  return {
    ...state,
    startUtc: clampStartIso(startUtc, nextDays),
    days: nextDays,
    clockIndex: clampClock(state.clockIndex, nextDays),
  };
}

export function setMastHeight(state: MissionState, meters: number): MissionState {
  return { ...state, mastHeightM: clamp(meters, 0, MAX_MAST_M) };
}

export function setClock(state: MissionState, index: number): MissionState {
  return { ...state, clockIndex: clampClock(index, state.days) };
}

function isSite(value: unknown): value is MissionSite {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.latitudeDeg === 'number' &&
    typeof v.longitudeDeg === 'number' &&
    (v.source === 'catalog' || v.source === 'landing' || v.source === 'custom')
  );
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Build a valid state from untrusted stored JSON, falling back per field. */
export function restoreState(raw: unknown): MissionState {
  const base = defaultState();
  if (typeof raw !== 'object' || raw === null) return base;
  const v = raw as Record<string, unknown>;
  const sites = Array.isArray(v.sites)
    ? v.sites
        .filter(isSite)
        .slice(0, MAX_SITES)
        .map((site) =>
          site.source === 'custom' && isLegacyCustomName(site.name)
            ? { ...site, name: coordinateName(site.latitudeDeg, site.longitudeDeg) }
            : site,
        )
    : [];
  const first = sites[0];
  if (!first) return base;
  const power = (typeof v.power === 'object' && v.power !== null ? v.power : {}) as Record<string, unknown>;
  const days = Math.round(clamp(finiteNumber(v.days, base.days), MIN_DAYS, MAX_DAYS));
  const selected = typeof v.selectedSiteId === 'string' && sites.some((s) => s.id === v.selectedSiteId);
  return {
    sites,
    selectedSiteId: selected ? (v.selectedSiteId as string) : first.id,
    startUtc: clampStartIso(typeof v.startUtc === 'string' ? v.startUtc : base.startUtc, days),
    days,
    mastHeightM: clamp(finiteNumber(v.mastHeightM, base.mastHeightM), 0, MAX_MAST_M),
    power: {
      arrayKw: Math.max(0, finiteNumber(power.arrayKw, base.power.arrayKw)),
      batteryKwh: Math.max(0, finiteNumber(power.batteryKwh, base.power.batteryKwh)),
      loadKw: Math.max(0, finiteNumber(power.loadKw, base.power.loadKw)),
    },
    crew: Math.round(clamp(finiteNumber(v.crew, base.crew), 1, MAX_CREW)),
    crewKw: clamp(finiteNumber(v.crewKw, base.crewKw), MIN_CREW_KW, MAX_CREW_KW),
    clockIndex: clampClock(finiteNumber(v.clockIndex, 0), days),
    playing: false,
  };
}

function load(): MissionState {
  const shared = decodeShare(window.location.hash);
  if (shared !== null) {
    // A shared link wins over the stored session. Drop the query so later edits are not undone by a reload.
    const route = window.location.hash.replace(/\?.*$/, '') || '#/plan';
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${route}`);
    return restoreState(shared);
  }
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    return text ? restoreState(JSON.parse(text)) : defaultState();
  } catch {
    return defaultState();
  }
}

function save(state: MissionState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, playing: false }));
  } catch {
    // Storage may be unavailable or full; the mission still works in memory.
  }
}

/** The one mission store. Both modes read and write only this. */
export const mission: MissionState = $state(load());

function apply(next: MissionState): void {
  Object.assign(mission, next);
}

/** The edits every mission view shares: selection, dates, mast, power and the clock. */
export function createCoreActions(target: MissionState) {
  const put = (next: MissionState): void => {
    Object.assign(target, next);
  };
  return {
    selectSite: (id: string) => put(selectSite(target, id)),
    setWindow: (startUtc: string, days: number) => put(setWindow(target, startUtc, days)),
    setMastHeight: (meters: number) => put(setMastHeight(target, meters)),
    setPower: (power: Partial<PowerSetup>) => {
      target.power = { ...target.power, ...power };
    },
    setCrew: (people: number, kwEach?: number) => {
      target.crew = Math.round(clamp(people, 1, MAX_CREW));
      if (kwEach !== undefined) target.crewKw = clamp(kwEach, MIN_CREW_KW, MAX_CREW_KW);
    },
    setClock: (index: number) => put(setClock(target, index)),
    setPlaying: (playing: boolean) => {
      target.playing = playing;
    },
  };
}

export type CoreActions = ReturnType<typeof createCoreActions>;

const NOTICE_MS = 4000;
const UNDO_MS = 8000;

interface RemovedSite {
  site: MissionSite;
  index: number;
  wasSelected: boolean;
}

/** The screen's one status message. A removal keeps its Undo for a few seconds; one level only. */
export const status: { text: string; undoable: boolean } = $state({ text: '', undoable: false });

let removed: RemovedSite | null = null;
let statusTimer: ReturnType<typeof setTimeout> | undefined;

function say(text: string, undoable: boolean): void {
  status.text = text;
  status.undoable = undoable;
  if (!undoable) removed = null;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    status.text = '';
    status.undoable = false;
    removed = null;
  }, undoable ? UNDO_MS : NOTICE_MS);
}

function removeAndRemember(id: string): void {
  const index = mission.sites.findIndex((s) => s.id === id);
  const site = mission.sites[index];
  if (!site || mission.sites.length <= 1) return;
  const wasSelected = mission.selectedSiteId === id;
  apply(removeSite(mission, id));
  removed = { site: $state.snapshot(site) as MissionSite, index, wasSelected };
  say(`Removed ${siteLabel(site).short}.`, true);
}

function undoRemove(): void {
  const record = removed;
  if (!record) return;
  clearTimeout(statusTimer);
  status.text = '';
  status.undoable = false;
  removed = null;
  if (mission.sites.length >= MAX_SITES || mission.sites.some((s) => s.id === record.site.id)) return;
  const sites = [...mission.sites];
  sites.splice(Math.min(record.index, sites.length), 0, record.site);
  apply({ ...mission, sites, selectedSiteId: record.wasSelected ? record.site.id : mission.selectedSiteId });
}

export const actions = {
  addSite: (site: MissionSite) => apply(addSite(mission, site)),
  removeSite: (id: string) => removeAndRemember(id),
  undoRemove,
  notify: (text: string) => say(text, false),
  /** Back to the starter mission: one site, the starter date, stay, mast and power, clock at the start. */
  reset: () => apply(defaultState()),
  /** Load a whole saved mission (checked like a stored one), as the demo walkthrough does on start and stop. */
  replace: (saved: unknown) => apply(restoreState(saved)),
  ...createCoreActions(mission),
};

$effect.root(() => {
  $effect(() => {
    save($state.snapshot(mission) as MissionState);
  });
});

// Demo walkthrough engine: which step is showing, the Play timer, and saving and restoring the visitor's own plan.
import { tick } from 'svelte';
import { clock } from '../lib/mission/clock.svelte';
import { drive, type CameraKind } from '../lib/mission/drive.svelte';
import { clearComparison } from '../lib/mission/estimates.svelte';
import { actions, defaultState, mission, type MissionSite, type MissionState } from '../lib/mission/store.svelte';
import { DEMO_DRIVE_TARGET, STEP_TEXT, type TourContext, type TourStep } from './steps';

/** The visitor's plan while the tour runs; also read on load in case a tab closed mid-tour. */
const SAVED_KEY = 'lml-tour-saved-plan';
/** Reading pace for Play: words per second, plus time to look, with a floor per step. */
const WORDS_PER_SECOND = 3;
const LOOK_MS = 2000;
const MIN_STEP_MS = 5000;
const DAY_MS = 86_400_000;

export const tour = $state({
  active: false,
  index: 0,
  playing: false,
  /** True while a step's action (navigation, route finding) is still running. */
  busy: false,
  /** Play timer: when the current step's time started counting, and how long it lasts. */
  startedMs: 0,
  durationMs: 0,
  /** Time already counted before the last pause. */
  elapsedBeforeMs: 0,
});

/** The demo uses the app's starter mission: three contrasting sites on a date where they clearly differ. */
const STARTER = defaultState();
const DEMO_SITES: MissionSite[] = STARTER.sites;
const FIRST_SITE = DEMO_SITES[0]!;

let timer: ReturnType<typeof setTimeout> | undefined;
/** Increases on every step change, so a step's unfinished action stops when the step is left. */
let generation = 0;

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function readMs(step: TourStep): number {
  return Math.max(MIN_STEP_MS, (words(step.text) / WORDS_PER_SECOND) * 1000 + LOOK_MS) + (step.extraMs ?? 0);
}

function shift(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString().replace('.000Z', 'Z');
}

function ensureSites(): void {
  for (const site of DEMO_SITES) {
    if (!mission.sites.some((candidate) => candidate.id === site.id)) actions.addSite(site);
  }
  actions.selectSite(STARTER.selectedSiteId ?? FIRST_SITE.id);
}

const CAMERA_ORDER: CameraKind[] = ['chase', 'driver', 'mast', 'orbit'];
let cameraTimer: ReturnType<typeof setInterval> | undefined;

/** What each step does on top of pointing at something. */
const BEHAVIOUR: Record<string, Pick<TourStep, 'enter' | 'leave' | 'extraMs'>> = {
  welcome: {
    enter: () => actions.replace({ ...STARTER, sites: [FIRST_SITE], selectedSiteId: FIRST_SITE.id } satisfies MissionState),
  },
  'year-strip': {
    extraMs: 3000,
    enter: async (ctx) => {
      if (!(await ctx.wait(2500))) return;
      actions.setWindow(shift(STARTER.startUtc, 3), STARTER.days);
    },
    leave: () => {
      actions.setWindow(STARTER.startUtc, STARTER.days);
      void tick().then(clearComparison);
    },
  },
  map: {
    extraMs: 1500,
    enter: async (ctx) => {
      for (const site of DEMO_SITES.slice(1)) {
        if (!(await ctx.wait(1000))) return;
        if (!mission.sites.some((candidate) => candidate.id === site.id)) actions.addSite(site);
      }
      actions.selectSite(STARTER.selectedSiteId ?? FIRST_SITE.id);
    },
  },
  table: { enter: ensureSites },
  expand: { enter: ensureSites },
  'compare-page': { enter: ensureSites },
  recommendation: { extraMs: 2000, enter: ensureSites },
  'time-strip': {
    extraMs: 4000,
    enter: () => {
      actions.setClock(0);
      clock.setSpeed(6);
      clock.play();
    },
    leave: () => clock.pause(),
  },
  expedition: {
    extraMs: 3000,
    enter: async (ctx) => {
      clock.pause();
      ensureSites();
      actions.selectSite(FIRST_SITE.id);
      await ctx.until(() => drive.commands !== null, 25_000);
    },
  },
  'drive-plan': {
    extraMs: 3000,
    enter: async (ctx) => {
      if (!(await ctx.until(() => drive.commands !== null, 25_000))) return;
      drive.commands?.setTargetFromSite(DEMO_DRIVE_TARGET.latitudeDeg, DEMO_DRIVE_TARGET.longitudeDeg);
      if (!(await ctx.wait(1500))) return;
      await drive.commands?.findRoute();
    },
  },
  drive: {
    extraMs: 4000,
    enter: async (ctx) => {
      if (!(await ctx.until(() => drive.commands !== null && drive.route !== null, 20_000))) return;
      drive.planning = false;
      drive.commands?.start();
    },
  },
  cameras: {
    extraMs: 4000,
    enter: () => {
      let next = 0;
      drive.planning = false;
      drive.camera = CAMERA_ORDER[next] ?? 'chase';
      clearInterval(cameraTimer);
      cameraTimer = setInterval(() => {
        next = (next + 1) % CAMERA_ORDER.length;
        drive.camera = CAMERA_ORDER[next] ?? 'chase';
      }, 2500);
    },
    leave: () => {
      clearInterval(cameraTimer);
      drive.camera = 'chase';
    },
  },
  outpost: {
    extraMs: 5000,
    enter: async (ctx) => {
      if (!(await ctx.until(() => drive.commands !== null, 20_000))) return;
      drive.commands?.enterStay();
      await ctx.until(() => document.querySelector('[aria-label="Outpost status"]') !== null, 8000);
    },
    leave: () => {
      if (drive.stay) drive.commands?.exitStay();
    },
  },
};

export const STEPS: TourStep[] = STEP_TEXT.map((step) => ({ ...step, ...BEHAVIOUR[step.id] }));

function clearTimer(): void {
  clearTimeout(timer);
  timer = undefined;
}

function context(mine: number): TourContext {
  const alive = (): boolean => mine === generation && tour.active;
  return {
    wait: (ms) =>
      new Promise((resolve) => {
        setTimeout(() => resolve(alive()), ms);
      }),
    until: async (check, timeoutMs) => {
      const end = Date.now() + timeoutMs;
      while (alive() && Date.now() < end) {
        if (check()) return true;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return alive() && check();
    },
  };
}

function schedule(): void {
  clearTimer();
  if (!tour.playing || tour.busy) return;
  const remaining = Math.max(0, tour.durationMs - tour.elapsedBeforeMs);
  tour.startedMs = performance.now();
  timer = setTimeout(() => {
    if (tour.index >= STEPS.length - 1) {
      tour.playing = false;
      tour.elapsedBeforeMs = tour.durationMs;
      return;
    }
    void go(tour.index + 1);
  }, remaining);
}

async function go(index: number): Promise<void> {
  const step = STEPS[index];
  if (!step) return;
  STEPS[tour.index]?.leave?.();
  clearTimer();
  generation += 1;
  const mine = generation;
  tour.index = index;
  tour.durationMs = readMs(step);
  tour.elapsedBeforeMs = 0;
  tour.startedMs = performance.now();
  tour.busy = true;
  if (window.location.hash !== step.hash) window.location.hash = step.hash;
  await tick();
  try {
    await step.enter?.(context(mine));
  } catch {
    // A demo action that fails (for example no WebGL) must not stop the tour.
  }
  if (mine !== generation) return;
  tour.busy = false;
  schedule();
}

export async function startTour(): Promise<void> {
  if (tour.active) return;
  try {
    if (window.localStorage.getItem(SAVED_KEY) === null) {
      window.localStorage.setItem(SAVED_KEY, JSON.stringify($state.snapshot(mission)));
    }
  } catch {
    // Without storage the plan is still restored from memory below.
  }
  savedInMemory = $state.snapshot(mission) as MissionState;
  tour.active = true;
  tour.playing = true;
  await go(0);
}

let savedInMemory: MissionState | null = null;

function restorePlan(): void {
  let saved: unknown = savedInMemory;
  try {
    const text = window.localStorage.getItem(SAVED_KEY);
    if (text) saved = JSON.parse(text);
    window.localStorage.removeItem(SAVED_KEY);
  } catch {
    // Fall back to the copy kept in memory.
  }
  savedInMemory = null;
  if (saved) {
    actions.replace(saved);
    void tick().then(clearComparison);
  }
}

export function stopTour(): void {
  if (!tour.active) return;
  STEPS[tour.index]?.leave?.();
  generation += 1;
  clearTimer();
  clock.pause();
  drive.commands?.clearTarget();
  tour.active = false;
  tour.playing = false;
  tour.busy = false;
  restorePlan();
  // Back to the start page, where Plan a Mission is the next step; the visitor's own plan is already restored.
  window.location.hash = '#/';
  actions.notify('Tour ended. Your own plan is back.');
}

/** A tab closed mid-tour leaves the visitor's plan saved; put it back on the next visit. */
export function recoverInterruptedTour(): void {
  try {
    if (!tour.active && window.localStorage.getItem(SAVED_KEY) !== null) restorePlan();
  } catch {
    // Nothing saved, or storage unavailable.
  }
}

export function nextStep(): void {
  if (tour.index < STEPS.length - 1) void go(tour.index + 1);
}

export function previousStep(): void {
  if (tour.index > 0) void go(tour.index - 1);
}

export function togglePlay(): void {
  if (tour.playing) {
    tour.elapsedBeforeMs += performance.now() - tour.startedMs;
    tour.playing = false;
    clearTimer();
    return;
  }
  if (tour.index >= STEPS.length - 1 && tour.elapsedBeforeMs >= tour.durationMs) {
    void go(0).then(() => undefined);
    tour.playing = true;
    return;
  }
  tour.playing = true;
  schedule();
}

/** Fraction of the current step's Play time used, for the progress line. */
export function stepProgress(now: number): number {
  if (tour.durationMs <= 0) return 0;
  const running = tour.playing && !tour.busy ? now - tour.startedMs : 0;
  return Math.min(1, (tour.elapsedBeforeMs + running) / tour.durationMs);
}

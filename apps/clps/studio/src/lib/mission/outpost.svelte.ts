import { api } from '../api/client';
import { okResult } from './derive';
import { estimates } from './estimates.svelte';
import { siteLabel } from './labels';
import { blackoutTone, darkTone, energyText, planStay, slipTone, workTone, type StayPlan, type Stretch, type Tone } from './stayPlan';
import { MAX_DAYS, mission } from './store.svelte';

const DAY_MS = 86_400_000;
const RANK: Record<Tone, number> = { good: 0, warn: 1, bad: 2 };

export const TONE_COLOURS: Record<Tone, string> = { good: '#3ddc84', warn: '#ff9f1a', bad: '#ff3b30' };

export interface Watch {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
  flag: string;
}

/**
 * What a crew needs to stay at the selected site for the whole stay: the array and battery to bring, what to watch,
 * which compared site is cheapest to support, and whether a late or early landing changes the answer.
 * Call while a component initialises; the landing-slip check fetches its own estimate while the component is mounted.
 */
export function createOutpostPlan() {
  const site = $derived(mission.sites.find((item) => item.id === mission.selectedSiteId) ?? null);
  const result = $derived(okResult(site ? estimates.bySiteId[site.id] : undefined));
  const loadKw = $derived(mission.crew * mission.crewKw);
  const plan = $derived(result ? planStay(result.series.sun.fraction, result.series.earth.fraction, loadKw) : null);

  const compared = $derived.by(() => {
    const rows: { id: string; name: string; plan: StayPlan }[] = [];
    for (const item of mission.sites) {
      const ok = okResult(estimates.bySiteId[item.id]);
      if (ok) rows.push({ id: item.id, name: siteLabel(item).short, plan: planStay(ok.series.sun.fraction, ok.series.earth.fraction, loadKw) });
    }
    const most = Math.max(1, ...rows.map((row) => row.plan.batteryKwh));
    return rows.map((row) => ({ ...row, share: row.plan.batteryKwh / most }));
  });

  // Landing slip: the same stay started up to three days early or late (fewer when the stay is long).
  const slipDays = $derived(Math.min(3, Math.floor((MAX_DAYS - mission.days) / 2)));
  let slipSeries = $state.raw<{ key: string; sun: number[]; earth: number[] } | null>(null);
  const slipKey = $derived(site ? `${site.latitudeDeg},${site.longitudeDeg},${mission.startUtc},${mission.days},${mission.mastHeightM},${slipDays}` : '');

  $effect(() => {
    const key = slipKey;
    const target = site;
    const days = slipDays;
    if (!key || !target || days <= 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .estimates(
          {
            start: new Date(Date.parse(mission.startUtc) - days * DAY_MS).toISOString().replace('.000Z', 'Z'),
            days: mission.days + 2 * days,
            observer_height_m: mission.mastHeightM,
            sites: [{ site_id: 'slip', latitude_deg: target.latitudeDeg, longitude_deg: target.longitudeDeg }],
          },
          controller.signal,
        )
        .then((response) => {
          const item = response.results[0];
          if (item && item.ok) slipSeries = { key, sun: item.series.sun.fraction, earth: item.series.earth.fraction };
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  const slip = $derived.by(() => {
    if (!plan || slipDays <= 0 || !slipSeries || slipSeries.key !== slipKey) return null;
    const hours = mission.days * 24 + 1;
    let worst = 0;
    let worstShift = 0;
    for (let shift = -slipDays; shift <= slipDays; shift += 1) {
      const from = (shift + slipDays) * 24;
      const need = planStay(slipSeries.sun.slice(from, from + hours), slipSeries.earth.slice(from, from + hours), loadKw).batteryKwh;
      if (need > worst) {
        worst = need;
        worstShift = shift;
      }
    }
    return { ratio: worst / Math.max(1e-6, plan.batteryKwh), shift: worstShift, batteryKwh: worst };
  });

  const length = (stretch: Stretch): string => (stretch.hours >= 48 ? `${(stretch.hours / 24).toFixed(1)} d` : `${stretch.hours} h`);
  const day = (stretch: Stretch): string => `day ${Math.floor(stretch.startHour / 24) + 1}`;

  const watch = $derived.by((): Watch[] => {
    if (!plan) return [];
    const workShare = plan.workHours / plan.hours;
    const dark = darkTone(plan.longestDark.hours);
    const gap = blackoutTone(plan.longestBlackout.hours);
    const work = workTone(workShare);
    const items: Watch[] = [
      {
        label: 'Darkness',
        value: plan.longestDark.hours > 0 ? length(plan.longestDark) : 'none',
        detail: plan.longestDark.hours > 0 ? `longest spell, from ${day(plan.longestDark)}` : 'Sun up all stay',
        tone: dark,
        flag: dark === 'bad' ? 'long night' : '',
      },
      {
        label: 'Earth link',
        value: plan.longestBlackout.hours > 0 ? length(plan.longestBlackout) : 'always',
        detail: plan.longestBlackout.hours > 0 ? `longest gap, from ${day(plan.longestBlackout)}` : 'Earth in view all stay',
        tone: gap,
        flag: gap === 'bad' ? 'relay needed' : '',
      },
      {
        label: 'Work outside',
        value: `${Math.round(workShare * 100)}%`,
        detail: `${plan.workHours} of ${plan.hours} h lit with Earth link`,
        tone: work,
        flag: work === 'bad' ? 'little time' : '',
      },
    ];
    if (slip) {
      const more = Math.round((slip.ratio - 1) * 100);
      const tone = slipTone(slip.ratio);
      items.push({
        label: `Landing slip ±${slipDays} d`,
        value: more <= 2 ? 'holds' : `+${more}%`,
        detail: more <= 2 ? 'same battery covers any slip' : `battery if ${Math.abs(slip.shift)} d ${slip.shift < 0 ? 'early' : 'late'}: ${energyText(slip.batteryKwh)}`,
        tone,
        flag: tone === 'bad' ? 'fragile' : '',
      });
    }
    return items;
  });

  const verdict = $derived.by(() => {
    if (!plan) return null;
    if (!plan.solarViable) return { tone: 'bad' as Tone, text: 'Solar cannot carry this stay' };
    const worst = watch.reduce<Tone>((tone, item) => (RANK[item.tone] > RANK[tone] ? item.tone : tone), 'good');
    if (worst === 'good') return { tone: worst, text: 'Good to go' };
    if (worst === 'warn') return { tone: worst, text: `Workable · ${watch.filter((item) => item.tone === 'warn').length} to watch` };
    const names = watch.filter((item) => item.tone === 'bad').map((item) => item.label.toLowerCase().replace(/ ±.*/, ''));
    return { tone: worst, text: `At risk · ${names.join(', ')}` };
  });

  return {
    get site() {
      return site;
    },
    get loadKw() {
      return loadKw;
    },
    get plan() {
      return plan;
    },
    get compared() {
      return compared;
    },
    get watch() {
      return watch;
    },
    get verdict() {
      return verdict;
    },
  };
}

/** Runs of true values as spans across a strip `width` wide, for the hour-by-hour stay strip. */
export function stripSpans(flags: boolean[], width: number): { x: number; width: number }[] {
  const out: { x: number; width: number }[] = [];
  const scale = width / Math.max(1, flags.length);
  let start = -1;
  for (let hour = 0; hour <= flags.length; hour += 1) {
    const on = hour < flags.length && flags[hour];
    if (on && start < 0) start = hour;
    if (!on && start >= 0) {
      out.push({ x: start * scale, width: Math.max(1, (hour - start) * scale) });
      start = -1;
    }
  }
  return out;
}

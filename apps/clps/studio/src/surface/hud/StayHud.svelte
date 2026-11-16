<script lang="ts">
  import { api } from '../../lib/api/client';
  import { formatUtc } from '../../lib/format';
  import { clockTimeMs, okResult } from '../../lib/mission/derive';
  import { drive } from '../../lib/mission/drive.svelte';
  import { estimates } from '../../lib/mission/estimates.svelte';
  import { siteLabel } from '../../lib/mission/labels';
  import { blackoutTone, darkTone, energyText, planStay, slipTone, workTone, type StayPlan, type Stretch, type Tone } from '../../lib/mission/stayPlan';
  import { actions, MAX_DAYS, MIN_DAYS, mission } from '../../lib/mission/store.svelte';

  const DAY_MS = 86_400_000;
    const STRIP_WIDTH = 368;
  const COLOURS: Record<Tone, string> = { good: '#3ddc84', warn: '#ff9f1a', bad: '#ff3b30' };
  const RANK: Record<Tone, number> = { good: 0, warn: 1, bad: 2 };

  const site = $derived(mission.sites.find((item) => item.id === mission.selectedSiteId) ?? null);
  const result = $derived(okResult(site ? estimates.bySiteId[site.id] : undefined));
  const loadKw = $derived(mission.crew * mission.crewKw);
  const plan = $derived(result ? planStay(result.series.sun.fraction, result.series.earth.fraction, loadKw) : null);
  const lapseText = $derived(drive.stayPaused ? 'paused' : `${drive.stayLapse}×`);

  // The outpost is sized to last, so its lights stay on.
  $effect(() => {
    drive.outpostFlat = false;
  });

  /** The same plan for every compared site, to show which is cheapest to support. */
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
    const slip = slipDays;
    if (!key || !target || slip <= 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .estimates(
          {
            start: new Date(Date.parse(mission.startUtc) - slip * DAY_MS).toISOString().replace('.000Z', 'Z'),
            days: mission.days + 2 * slip,
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

  interface Watch {
    label: string;
    value: string;
    detail: string;
    tone: Tone;
    flag: string;
  }

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

  /** Runs of true values as pixel spans on the timeline strip. */
  function spans(flags: boolean[]): { x: number; width: number }[] {
    const out: { x: number; width: number }[] = [];
    const scale = STRIP_WIDTH / Math.max(1, flags.length);
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

  const rows = $derived(
    plan
      ? [
          { flags: plan.sunUp, y: 0, colour: '#f2b24a' },
          { flags: plan.earthUp, y: 16, colour: '#6ea8e0' },
          { flags: plan.work, y: 32, colour: '#3ddc84' },
        ]
      : [],
  );
  const marker = $derived(plan ? (Math.min(plan.hours, mission.clockIndex) / plan.hours) * STRIP_WIDTH : 0);

  function setCrew(next: number): void {
    actions.setCrew(next);
  }

  function setDays(next: number): void {
    actions.setWindow(mission.startUtc, Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.round(next))));
    actions.setClock(0);
  }

  const stepper = 'h-7 w-7 rounded-sm border border-[rgb(255_255_255/0.35)] text-[16px] font-bold leading-none text-ink hover:bg-[rgb(255_255_255/0.15)]';
</script>

<section class="pointer-events-none absolute right-4 top-4 w-[400px] border border-[rgb(255_255_255/0.28)] bg-[rgb(6_8_10/0.86)] px-4 pb-3 pt-3 text-ink" aria-label="Outpost status">
  <header class="flex items-start justify-between">
    <div class="min-w-0">
      <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Outpost plan</div>
      <div class="truncate text-[17px] font-bold leading-6">{site ? siteLabel(site).short : 'No site'}</div>
    </div>
    <div class="shrink-0 text-right">
      <div class="whitespace-nowrap font-mono text-[12px] font-semibold">{formatUtc(clockTimeMs(mission.startUtc, mission.clockIndex))}</div>
      <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{lapseText}</div>
    </div>
  </header>

  <div class="pointer-events-auto mt-2 grid grid-cols-2 gap-3 border-y border-[rgb(255_255_255/0.2)] py-2">
    <div>
      <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Crew</div>
      <div class="mt-1 flex items-center gap-2">
        <button type="button" class={stepper} aria-label="Fewer crew" onclick={() => setCrew(mission.crew - 1)}>−</button>
        <span class="w-[58px] text-center font-mono text-[24px] font-bold leading-7">{mission.crew}</span>
        <button type="button" class={stepper} aria-label="More crew" onclick={() => setCrew(mission.crew + 1)}>+</button>
      </div>
    </div>
    <div>
      <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Stay, days</div>
      <div class="mt-1 flex items-center gap-2">
        <button type="button" class={stepper} aria-label="Shorter stay" onclick={() => setDays(mission.days - 1)}>−</button>
        <span class="w-[58px] text-center font-mono text-[24px] font-bold leading-7">{mission.days}</span>
        <button type="button" class={stepper} aria-label="Longer stay" onclick={() => setDays(mission.days + 1)}>+</button>
      </div>
    </div>
    <label class="col-span-2 flex items-center gap-2 text-[11px] text-muted">
      Power per person
      <input
        type="number"
        min="0.5"
        max="10"
        step="0.5"
        value={mission.crewKw}
        class="w-[58px] rounded-sm border border-[rgb(255_255_255/0.35)] bg-transparent px-1 py-[1px] text-right font-mono text-[12px] text-ink"
        oninput={(event) => {
          const value = event.currentTarget.valueAsNumber;
          if (Number.isFinite(value) && value >= 0.5 && value <= 10) actions.setCrew(mission.crew, value);
        }}
      />
      kW <span class="ml-auto font-mono text-[12px] font-semibold text-ink">{loadKw.toFixed(1)} kW load</span>
    </label>
  </div>

  {#if plan && verdict}
    <p class="mt-2 px-2 py-[5px] text-center text-[15px] font-bold uppercase tracking-[0.08em] text-black" style="background: {COLOURS[verdict.tone]}" role="status">{verdict.text}</p>

    <div class="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-sun">Bring</div>
    <div class="mt-1 grid grid-cols-2 gap-2">
      <div class="border border-[rgb(255_255_255/0.2)] px-2 py-[6px]">
        <div class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Solar array</div>
        <div class="font-mono text-[24px] font-bold leading-7">{plan.solarViable ? `${Math.round(plan.arrayKw)} kW` : '—'}</div>
        <div class="text-[11px] text-ink">{plan.solarViable ? `${Math.round(plan.arrayM2)} m² of panel` : 'too little sunlight'}</div>
      </div>
      <div class="border border-[rgb(255_255_255/0.2)] px-2 py-[6px]">
        <div class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Battery</div>
        <div class="font-mono text-[24px] font-bold leading-7">{energyText(plan.batteryKwh)}</div>
        <div class="text-[11px] text-ink">{plan.batteryTonnes >= 0.95 ? `${plan.batteryTonnes.toFixed(1)} t` : `${Math.round(plan.batteryTonnes * 1000)} kg`} of cells</div>
      </div>
    </div>

    {#if compared.length > 1}
      <div class="mt-2">
        <div class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Battery needed, by site</div>
        {#each compared as row (row.id)}
          <div class="mt-[3px] flex w-full items-center gap-2 text-[11px]">
            <span class="w-[118px] shrink-0 truncate {row.id === mission.selectedSiteId ? 'font-bold text-ink' : 'text-muted'}">{row.name}</span>
            <span class="h-[10px] min-w-0 flex-1 bg-[rgb(255_255_255/0.1)]">
              <span class="block h-full" style="width: {Math.max(2, row.share * 100)}%; background: {row.id === mission.selectedSiteId ? '#f2b24a' : 'rgb(255 255 255 / 0.45)'}"></span>
            </span>
            <span class="w-[64px] shrink-0 text-right font-mono {row.id === mission.selectedSiteId ? 'font-bold text-ink' : 'text-muted'}">{energyText(row.plan.batteryKwh)}</span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-sun">Watch</div>
    <div class="mt-1 grid grid-cols-2 gap-2">
      {#each watch as item (item.label)}
        <div class="border-l-4 bg-[rgb(255_255_255/0.05)] px-2 py-[5px]" style="border-left-color: {COLOURS[item.tone]}">
          <div class="flex items-baseline justify-between gap-1">
            <span class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{item.label}</span>
            {#if item.flag}<span class="px-1 text-[10px] font-bold uppercase text-black" style="background: {COLOURS[item.tone]}">{item.flag}</span>{/if}
          </div>
          <div class="font-mono text-[22px] font-bold leading-7" style="color: {COLOURS[item.tone]}">{item.value}</div>
          <div class="text-[11px] leading-[14px] text-ink">{item.detail}</div>
        </div>
      {/each}
    </div>

    <div class="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-sun">The stay, hour by hour</div>
    <svg viewBox="0 0 {STRIP_WIDTH} 46" width="100%" height="46" class="mt-1 block" role="img" aria-label="Sunlight, Earth link and work windows over the stay">
      {#each rows as row (row.y)}
        <rect x="0" y={row.y} width={STRIP_WIDTH} height="12" fill="rgb(255 255 255 / 0.08)" />
        {#each spans(row.flags) as span (span.x)}
          <rect x={span.x} y={row.y} width={span.width} height="12" fill={row.colour} />
        {/each}
      {/each}
      <line x1={marker} y1="0" x2={marker} y2="46" stroke="#ecebe6" stroke-width="2" />
    </svg>
    <div class="mt-[2px] flex gap-3 text-[11px] text-ink">
      <span><span style="color: #f2b24a">■</span> Sun</span>
      <span><span style="color: #6ea8e0">■</span> Earth link</span>
      <span><span style="color: #3ddc84">■</span> Work outside</span>
      <span class="ml-auto text-muted">day 1 to {mission.days}</span>
    </div>
  {:else}
    <p class="mt-3 text-[13px] text-muted">Calculating this stay…</p>
  {/if}
</section>

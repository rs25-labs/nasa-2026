<script lang="ts">
  import { formatUtc } from '../../lib/format';
  import { clockTimeMs } from '../../lib/mission/derive';
  import { drive } from '../../lib/mission/drive.svelte';
  import { siteLabel } from '../../lib/mission/labels';
  import { createOutpostPlan, stripSpans, TONE_COLOURS } from '../../lib/mission/outpost.svelte';
  import { energyText } from '../../lib/mission/stayPlan';
  import { mission } from '../../lib/mission/store.svelte';

  // The outpost on the ground during a time-lapse of the stay. Sizing it (crew, stay, what to bring and what to
  // watch) is Plan's job; this readout shows the same answer and points back there.

  const STRIP_WIDTH = 368;
  const outpost = createOutpostPlan();
  const lapseText = $derived(drive.stayPaused ? 'paused' : `${drive.stayLapse}×`);

  // The outpost is sized to last, so its lights stay on.
  $effect(() => {
    drive.outpostFlat = false;
  });

  const rows = $derived(
    outpost.plan
      ? [
          { flags: outpost.plan.sunUp, y: 0, colour: '#f2b24a' },
          { flags: outpost.plan.earthUp, y: 16, colour: '#6ea8e0' },
          { flags: outpost.plan.work, y: 32, colour: '#3ddc84' },
        ]
      : [],
  );
  const marker = $derived(outpost.plan ? (Math.min(outpost.plan.hours, drive.stayClockIndex) / outpost.plan.hours) * STRIP_WIDTH : 0);
</script>

<section class="pointer-events-none absolute right-4 top-4 w-[400px] border border-[rgb(255_255_255/0.28)] bg-[rgb(6_8_10/0.86)] px-4 pb-3 pt-3 text-ink" aria-label="Outpost status">
  <header class="flex items-start justify-between">
    <div class="min-w-0">
      <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Outpost on site</div>
      <div class="truncate text-[17px] font-bold leading-6">{outpost.site ? siteLabel(outpost.site).short : 'No site'}</div>
    </div>
    <div class="shrink-0 text-right">
      <div class="whitespace-nowrap font-mono text-[12px] font-semibold">{formatUtc(clockTimeMs(mission.startUtc, drive.stayClockIndex))}</div>
      <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{lapseText}</div>
    </div>
  </header>

  <p class="mt-2 border-y border-[rgb(255_255_255/0.2)] py-2 text-[13px]">
    Crew of {mission.crew} for {mission.days} days · {outpost.loadKw.toFixed(1)} kW load
  </p>

  {#if outpost.plan && outpost.verdict}
    <p class="mt-2 px-2 py-[5px] text-center text-[15px] font-bold uppercase tracking-[0.08em] text-black" style="background: {TONE_COLOURS[outpost.verdict.tone]}" role="status">{outpost.verdict.text}</p>
    <p class="mt-2 text-[13px]">
      Bring a <strong>{outpost.plan.solarViable ? `${Math.round(outpost.plan.arrayKw)} kW` : '—'}</strong> solar array and a
      <strong>{energyText(outpost.plan.batteryKwh)}</strong> battery.
    </p>

    <div class="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">The stay, hour by hour</div>
    <svg viewBox="0 0 {STRIP_WIDTH} 46" width="100%" height="46" class="mt-1 block" role="img" aria-label="Sunlight, Earth link and work windows over the stay">
      {#each rows as row (row.y)}
        <rect x="0" y={row.y} width={STRIP_WIDTH} height="12" fill="rgb(255 255 255 / 0.08)" />
        {#each stripSpans(row.flags, STRIP_WIDTH) as span (span.x)}
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

  <a
    href="#/plan"
    class="pointer-events-auto mt-3 inline-block rounded-sm border border-[rgb(255_255_255/0.35)] px-3 py-1.5 text-[13px] text-ink hover:bg-[rgb(255_255_255/0.12)]"
  >Change the crew, stay or power in Plan →</a>
</section>

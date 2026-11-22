<script lang="ts">
  import { createOutpostPlan, stripSpans, TONE_COLOURS } from '../lib/mission/outpost.svelte';
  import { energyText } from '../lib/mission/stayPlan';
  import { actions, MAX_CREW, MAX_CREW_KW, MAX_DAYS, MIN_CREW_KW, MIN_DAYS, mission } from '../lib/mission/store.svelte';

  // What a crew needs to stay at the chosen site for the whole stay, from the same hourly Sun and Earth data as the
  // sections above. Changing the crew or the stay here changes the plan everywhere.

  const outpost = createOutpostPlan();
  const STRIP_WIDTH = 1000;

  const rows = $derived(
    outpost.plan
      ? [
          { flags: outpost.plan.sunUp, y: 0, colour: 'var(--color-sun)', label: 'Sun' },
          { flags: outpost.plan.earthUp, y: 16, colour: 'var(--color-earth)', label: 'Earth link' },
          { flags: outpost.plan.work, y: 32, colour: '#3ddc84', label: 'Work outside' },
        ]
      : [],
  );
  const marker = $derived(outpost.plan ? (Math.min(outpost.plan.hours, mission.clockIndex) / outpost.plan.hours) * STRIP_WIDTH : 0);

  function setDays(next: number): void {
    actions.setWindow(mission.startUtc, Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.round(next))));
  }

  const stepper = 'h-9 w-9 rounded-sm border border-rule bg-ground text-lg leading-none text-ink hover:border-muted disabled:opacity-40';
  const label = 'text-sm text-muted';
  const big = 'text-2xl font-semibold tabular-nums';
</script>

<div class="grid gap-6 px-5 py-5" style="grid-template-columns: minmax(260px, 1fr) minmax(300px, 1.3fr) minmax(260px, 1fr);">
  <!-- Who stays, and for how long. -->
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap gap-6">
      <div class="flex flex-col gap-1">
        <span class={label}>Crew</span>
        <div class="flex items-center gap-2">
          <button type="button" class={stepper} aria-label="Fewer crew" disabled={mission.crew <= 1} onclick={() => actions.setCrew(mission.crew - 1)}>−</button>
          <span class="{big} w-10 text-center">{mission.crew}</span>
          <button type="button" class={stepper} aria-label="More crew" disabled={mission.crew >= MAX_CREW} onclick={() => actions.setCrew(mission.crew + 1)}>+</button>
        </div>
      </div>
      <div class="flex flex-col gap-1">
        <span class={label}>Stay, days</span>
        <div class="flex items-center gap-2">
          <button type="button" class={stepper} aria-label="Shorter stay" disabled={mission.days <= MIN_DAYS} onclick={() => setDays(mission.days - 1)}>−</button>
          <span class="{big} w-10 text-center">{mission.days}</span>
          <button type="button" class={stepper} aria-label="Longer stay" disabled={mission.days >= MAX_DAYS} onclick={() => setDays(mission.days + 1)}>+</button>
        </div>
      </div>
    </div>
    <label class="flex items-center gap-2 {label}">
      Power per person
      <input
        type="number"
        min={MIN_CREW_KW}
        max={MAX_CREW_KW}
        step="0.5"
        value={mission.crewKw}
        class="h-9 w-20 rounded-sm border border-rule bg-ground px-2 text-right text-base text-ink"
        oninput={(event) => {
          const value = event.currentTarget.valueAsNumber;
          if (Number.isFinite(value) && value >= MIN_CREW_KW && value <= MAX_CREW_KW) actions.setCrew(mission.crew, value);
        }}
      />
      kW <span class="ml-2 text-ink">= {outpost.loadKw.toFixed(1)} kW for the crew</span>
    </label>
    {#if outpost.verdict}
      <p class="m-0 rounded-sm px-3 py-2 text-base font-semibold text-[#1a1a1a]" style="background: {TONE_COLOURS[outpost.verdict.tone]}" role="status">
        {outpost.verdict.text}
      </p>
    {/if}
  </div>

  <!-- What to bring, and what to watch. -->
  <div class="flex flex-col gap-4">
    {#if outpost.plan}
      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-sm border border-rule bg-ground px-4 py-3">
          <div class={label}>Solar array to bring</div>
          <div class={big}>{outpost.plan.solarViable ? `${Math.round(outpost.plan.arrayKw)} kW` : '—'}</div>
          <div class="text-sm text-muted">{outpost.plan.solarViable ? `${Math.round(outpost.plan.arrayM2)} m² of panel` : 'too little sunlight'}</div>
        </div>
        <div class="rounded-sm border border-rule bg-ground px-4 py-3">
          <div class={label}>Battery to bring</div>
          <div class={big}>{energyText(outpost.plan.batteryKwh)}</div>
          <div class="text-sm text-muted">
            {outpost.plan.batteryTonnes >= 0.95 ? `${outpost.plan.batteryTonnes.toFixed(1)} t` : `${Math.round(outpost.plan.batteryTonnes * 1000)} kg`} of cells
          </div>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        {#each outpost.watch as item (item.label)}
          <div class="rounded-sm border border-rule bg-ground px-3 py-2" style="border-left: 4px solid {TONE_COLOURS[item.tone]};">
            <div class="flex items-baseline justify-between gap-2">
              <span class={label}>{item.label}</span>
              {#if item.flag}<span class="rounded-sm px-1.5 text-xs font-semibold text-[#1a1a1a]" style="background: {TONE_COLOURS[item.tone]}">{item.flag}</span>{/if}
            </div>
            <div class="text-xl font-semibold tabular-nums">{item.value}</div>
            <div class="text-sm text-muted">{item.detail}</div>
          </div>
        {/each}
      </div>
    {:else}
      <p class="m-0 text-muted">Calculating this stay…</p>
    {/if}
  </div>

  <!-- Which compared site is cheapest to support. -->
  <div class="flex flex-col gap-2">
    <span class={label}>Battery needed, by site</span>
    {#each outpost.compared as row (row.id)}
      <div class="flex items-center gap-3 text-sm">
        <span class="w-40 shrink-0 truncate {row.id === mission.selectedSiteId ? 'font-semibold text-ink' : 'text-muted'}">{row.name}</span>
        <span class="h-2.5 min-w-0 flex-1 bg-rule">
          <span class="block h-full" style="width: {Math.max(2, row.share * 100)}%; background: {row.id === mission.selectedSiteId ? 'var(--color-ink)' : 'var(--color-muted)'}"></span>
        </span>
        <span class="w-20 shrink-0 text-right tabular-nums {row.id === mission.selectedSiteId ? 'font-semibold text-ink' : 'text-muted'}">{energyText(row.plan.batteryKwh)}</span>
      </div>
    {/each}
    {#if outpost.compared.length > 1}<p class="m-0 text-sm text-muted">Shorter bars are cheaper to support.</p>{/if}
  </div>
</div>

{#if outpost.plan}
  <div class="border-t border-rule px-5 py-4">
    <div class="mb-2 flex flex-wrap items-center gap-4 text-sm">
      <span class={label}>The stay, hour by hour</span>
      {#each rows as row (row.y)}
        <span class="flex items-center gap-1.5"><span aria-hidden="true" class="inline-block size-2.5" style="background: {row.colour}"></span>{row.label}</span>
      {/each}
      <span class="ml-auto text-muted">day 1 to {mission.days}</span>
    </div>
    <svg viewBox="0 0 {STRIP_WIDTH} 46" preserveAspectRatio="none" width="100%" height="46" class="block" role="img" aria-label="Sunlight, Earth link and work windows over the stay">
      {#each rows as row (row.y)}
        <rect x="0" y={row.y} width={STRIP_WIDTH} height="12" fill="var(--color-rule)" />
        {#each stripSpans(row.flags, STRIP_WIDTH) as span (span.x)}
          <rect x={span.x} y={row.y} width={span.width} height="12" fill={row.colour} />
        {/each}
      {/each}
      <line x1={marker} y1="0" x2={marker} y2="46" stroke="var(--color-ink)" stroke-width="2" vector-effect="non-scaling-stroke" />
    </svg>
  </div>
{/if}

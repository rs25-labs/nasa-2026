<script lang="ts">
  import { formatDegrees, formatUtc, visibilityWord } from '../../lib/format';
  import { batterySeries, clockTimeMs, okResult, sampleAt, socAt, visibilityOf } from '../../lib/mission/derive';
  import { clock, SPEED_OPTIONS } from '../../lib/mission/clock.svelte';
  import { estimates } from '../../lib/mission/estimates.svelte';
  import { siteLabel } from '../../lib/mission/labels';
  import { actions, mission, sampleCount } from '../../lib/mission/store.svelte';
  import { expeditionBlockReason, openExpedition } from '../expedition';

  // The one stay clock for the Plan page, pinned to the bottom of the window so it never scrolls away. While the
  // selected site's section is off screen it also shows that site's Sun, Earth and battery, so playing visibly
  // moves everything the clock drives.

  let { siteInView, onshowsite }: { siteInView: boolean; onshowsite: () => void } = $props();

  const lastIndex = $derived(sampleCount(mission.days) - 1);
  const timeText = $derived(formatUtc(clockTimeMs(mission.startUtc, mission.clockIndex)));
  const site = $derived(mission.sites.find((s) => s.id === mission.selectedSiteId) ?? null);

  const readout = $derived.by(() => {
    const result = okResult(site ? estimates.bySiteId[site.id] : undefined);
    if (!result) return null;
    const sun = sampleAt(result.series.sun, mission.clockIndex);
    const earth = sampleAt(result.series.earth, mission.clockIndex);
    const soc = socAt(batterySeries(result.series.sun.fraction, mission.power), mission.clockIndex);
    return {
      sun: `${formatDegrees(sun.elevationDeg)} ${visibilityWord(visibilityOf(sun.fraction), true)}`,
      earth: `${formatDegrees(earth.elevationDeg)} ${visibilityWord(visibilityOf(earth.fraction), true)}`,
      battery: mission.power.batteryKwh > 0 ? Math.round((soc / mission.power.batteryKwh) * 100) : 0,
    };
  });

  function onSlide(input: HTMLInputElement): void {
    clock.pause();
    actions.setClock(input.valueAsNumber);
  }

  const button = 'h-9 rounded-sm border border-rule bg-ground px-3 text-sm text-ink hover:border-muted';
</script>

<section aria-label="Stay clock" class="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-t-2 border-ink bg-panel px-4 py-2.5">
  <div class="flex items-center gap-2">
    <button
      type="button"
      onclick={clock.toggle}
      class="h-9 min-w-[5.5rem] rounded-sm border border-ink bg-ink px-3 text-sm font-semibold text-ground hover:opacity-90"
    >{mission.playing ? 'Pause' : 'Play'}</button>
    <button type="button" class={button} onclick={() => actions.setClock(0)}>Start</button>
    <label class="flex items-center text-sm text-muted">
      <span class="sr-only">Speed</span>
      <select
        title="Playback speed"
        class="h-9 rounded-sm border border-rule bg-ground px-2 text-sm text-ink"
        value={String(clock.speedHoursPerSecond)}
        onchange={(event) => clock.setSpeed(Number(event.currentTarget.value))}
      >
        {#each SPEED_OPTIONS as option (option.hoursPerSecond)}
          <option value={String(option.hoursPerSecond)}>{option.label}</option>
        {/each}
      </select>
    </label>
  </div>

  <label class="flex min-w-[9rem] flex-1 items-center gap-3">
    <span class="whitespace-nowrap text-base font-semibold tabular-nums">{timeText}</span>
    <input
      type="range"
      min="0"
      max={lastIndex}
      step="any"
      value={mission.clockIndex}
      aria-label="Stay clock"
      aria-valuetext={timeText}
      oninput={(event) => onSlide(event.currentTarget)}
      class="h-2 min-w-0 flex-1 cursor-pointer accent-[var(--color-ink)]"
    />
  </label>

  {#if !siteInView && site}
    <div class="flex items-center gap-3 text-sm" aria-live="off">
      <span class="font-semibold">{siteLabel(site).short}</span>
      {#if readout}
        <span class="flex items-center gap-1.5"><span aria-hidden="true" class="size-2 rounded-full bg-sun"></span>Sun {readout.sun}</span>
        <span class="flex items-center gap-1.5"><span aria-hidden="true" class="size-2 rounded-full bg-earth"></span>Earth {readout.earth}</span>
        <span>Battery {readout.battery}%</span>
      {/if}
      <button type="button" class={button} onclick={onshowsite} title="Scroll to the selected site's sky">Sky ↓</button>
    </div>
  {/if}

  {#if site}
    <button
      type="button"
      onclick={openExpedition}
      disabled={expeditionBlockReason(site) !== ''}
      title={expeditionBlockReason(site) || `Open Expedition at ${siteLabel(site).short} on the plan's dates`}
      class="ml-auto h-9 whitespace-nowrap rounded-sm border border-ink bg-ink px-4 text-sm font-semibold text-ground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >Plan the expedition →</button>
  {/if}
</section>

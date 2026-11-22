<script lang="ts">
  import { capitalise, countdownText, formatDegrees, formatEventUtc, formatUtc, visibilityWord } from '../../lib/format';
  import Busy from '../Busy.svelte';
  import { siteLabel } from '../../lib/mission/labels';
  import { expeditionBlockReason } from '../expedition';
  import { useSession } from '../../lib/mission/session';
  import { batterySeries, clockTimeMs, countdown, horizonAt, okResult, sampleAt, socAt, visibilityOf } from '../../lib/mission/derive';

  let { class: className = '', expeditionLink = true }: { class?: string; expeditionLink?: boolean } = $props();

  const { mission, estimates } = useSession();

  const result = $derived(okResult(mission.selectedSiteId ? estimates.bySiteId[mission.selectedSiteId] : undefined));
  const site = $derived(mission.sites.find((s) => s.id === mission.selectedSiteId));
  const label = $derived(site ? siteLabel(site) : null);
  const surfaceReason = $derived(expeditionBlockReason(site));

  let reasonShown = $state(false);
  let reasonTimer: ReturnType<typeof setTimeout> | undefined;

  function goToSurface(): void {
    if (surfaceReason !== '') {
      reasonShown = true;
      clearTimeout(reasonTimer);
      reasonTimer = setTimeout(() => (reasonShown = false), 4000);
      return;
    }
    window.location.hash = '#/surface';
  }

  function skylineText(marginDeg: number): string {
    const size = formatDegrees(Math.abs(marginDeg));
    if (Math.abs(marginDeg) < 0.05) return 'At skyline';
    return marginDeg > 0 ? `Above skyline by ${size}` : `Below skyline by ${size}`;
  }

  const numbers = $derived.by(() => {
    if (!result) return null;
    const index = mission.clockIndex;
    const view = (body: 'SUN' | 'EARTH') => {
      const series = body === 'SUN' ? result.series.sun : result.series.earth;
      const sample = sampleAt(series, index);
      const horizon = horizonAt(result.horizon_elevation_deg, sample.azimuthDeg);
      return {
        elevation: sample.elevationDeg,
        state: visibilityOf(sample.fraction),
        margin: sample.elevationDeg - horizon,
        countdown: countdown(result.events, series, body, index, mission.startUtc),
      };
    };
    const battery = batterySeries(result.series.sun.fraction, mission.power);
    const soc = socAt(battery, index);
    return {
      sun: view('SUN'),
      earth: view('EARTH'),
      socKwh: soc,
      socPercent: mission.power.batteryKwh > 0 ? soc / mission.power.batteryKwh : 0,
    };
  });
</script>

{#snippet body(name: string, body: 'sun' | 'earth', dotClass: string, view: NonNullable<typeof numbers>['sun'])}
  <div class="min-w-0 border-t border-rule pt-2 text-ink">
    <dt class="flex items-center gap-1.5 text-[14px] text-muted"><span aria-hidden="true" class="size-2 rounded-full {dotClass}"></span>{name} · {visibilityWord(view.state)}</dt>
    <dd class="m-0 text-base font-semibold">{capitalise(countdownText(view.countdown, body))}</dd>
    {#if view.countdown.eventMs !== null}<dd class="m-0 text-[14px]">{formatEventUtc(view.countdown.eventMs)}</dd>{/if}
    <dd class="m-0 text-[14px]">Elevation {formatDegrees(view.elevation)}</dd>
    <dd class="m-0 text-[14px]">{skylineText(view.margin)}</dd>
  </div>
{/snippet}

<section aria-label="Key numbers" class="plan-scroll flex min-h-0 min-w-0 flex-col gap-2 overflow-auto bg-panel px-5 py-3 {className}">
  <header class="group relative flex min-w-0 items-start justify-between gap-2">
    <h2
      class="m-0 flex min-w-0 items-baseline gap-1.5 whitespace-nowrap text-base font-semibold"
      title="{site?.name ?? 'No site'}, {formatUtc(clockTimeMs(mission.startUtc, mission.clockIndex))}"
    >
      <span class="shrink-0">{label?.short ?? 'No site'}</span>
      {#if label?.long}<span class="min-w-0 truncate font-normal text-muted">{label.long}</span>{/if}
    </h2>
    <p class="sr-only">{formatUtc(clockTimeMs(mission.startUtc, mission.clockIndex))}</p>
    {#if expeditionLink}
      <button
        type="button"
        aria-disabled={surfaceReason !== ''}
        aria-describedby={surfaceReason !== '' ? 'surface-reason' : undefined}
        onclick={goToSurface}
        class="shrink-0 whitespace-nowrap rounded-sm border border-rule bg-ground px-2 py-1 text-[14px] text-ink hover:border-muted aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:hover:border-rule"
      >Go to expedition</button>
      {#if surfaceReason !== ''}
        <span
          id="surface-reason"
          class="pointer-events-none absolute right-0 top-full z-10 mt-0.5 whitespace-nowrap border border-rule bg-panel px-1.5 py-0.5 text-[12px] leading-[14px] text-ink {reasonShown ? 'block' : 'hidden group-focus-within:block group-hover:block'}"
        >{surfaceReason}</span>
      {/if}
    {/if}
  </header>
  {#if numbers}
    <p class="m-0 text-xs leading-4 text-muted">{result?.terrain}</p>
    <p class="m-0 text-[14px]">
      <span class="text-muted">Battery</span>
      <span class="text-base font-semibold">{Math.round(numbers.socPercent * 100)}%</span>
      <span class="text-muted">· {numbers.socKwh.toFixed(1)} of {mission.power.batteryKwh} kWh</span>
    </p>
    <dl class="m-0 grid grid-cols-2 gap-3">
      {@render body('Sun', 'sun', 'bg-sun', numbers.sun)}
      {@render body('Earth', 'earth', 'bg-earth', numbers.earth)}
    </dl>
  {:else}
    {#if estimates.status === 'loading'}
      <Busy text="Calculating…" class="py-2" />
    {:else}
      <p class="text-sm text-muted">No numbers for this site.</p>
    {/if}
  {/if}
</section>

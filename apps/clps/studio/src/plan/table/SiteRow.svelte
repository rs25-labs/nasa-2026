<script lang="ts">
  import { countdownText, formatDegrees, formatDelta, formatHours, formatPercent, visibilityWord } from '../../lib/format';
  import type { Countdown, SiteMetrics } from '../../lib/mission/derive';
  import type { BaselineValue } from '../../lib/mission/estimates.svelte';
  import { siteLabel } from '../../lib/mission/labels';
  import type { MissionSite } from '../../lib/mission/store.svelte';
  import Busy from '../Busy.svelte';

  let {
    site,
    metrics,
    error,
    loading,
    selected,
    canRemove,
    batteryKwh,
    baseline,
    onselect,
    onremove,
    onblocked,
  }: {
    site: MissionSite;
    metrics: SiteMetrics | null;
    error: string | null;
    loading: boolean;
    selected: boolean;
    canRemove: boolean;
    batteryKwh: number;
    /** Metrics of the previous landing window, or undefined when nothing is being compared. */
    baseline: BaselineValue | undefined;
    onselect: () => void;
    onremove: (viaKeyboard: boolean) => void;
    onblocked: () => void;
  } = $props();

  // A site without numbers yet shows placeholders only while a calculation is running.
  const pending = $derived(metrics === null && error === null && loading);
  const empty = $derived(metrics === null && error === null && !loading);
  const batteryPercent = $derived(metrics && batteryKwh > 0 ? metrics.batteryLowestKwh / batteryKwh : 0);

  const label = $derived(siteLabel(site));

  const REMOVE_REASON = 'Keep at least one site.';
  const sunDelta = $derived(
    baseline && metrics ? formatDelta(Math.round(metrics.sunMeanFraction * 100) - baseline.sunPercent) : null,
  );
  const darkDelta = $derived(
    baseline && metrics ? formatDelta(Math.round(metrics.sunLongestDarkHours) - baseline.darkHours) : null,
  );

  function nowTitle(name: string, body: 'sun' | 'earth', elevationDeg: number, value: Countdown): string {
    return `${name}: ${formatDegrees(elevationDeg)} elevation, ${visibilityWord(value.state)}, ${countdownText(value, body)}`;
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onselect();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      if (canRemove) onremove(true);
      else onblocked();
    }
  }
</script>

{#snippet now(elevationDeg: number, value: Countdown, body: 'sun' | 'earth')}
  <span class="block leading-[14px] min-[1400px]:inline">{formatDegrees(elevationDeg)} · {visibilityWord(value.state, true)}</span><span class="hidden min-[1400px]:inline">&nbsp;·&nbsp;</span><span class="block leading-[14px] min-[1400px]:inline">{countdownText(value, body)}</span>
{/snippet}

<tr
  tabindex="0"
  aria-selected={selected}
  onclick={onselect}
  {onkeydown}
  class="h-[30px] cursor-pointer border-b border-rule border-l-2 hover:bg-ground {selected ? 'border-l-ink bg-ground' : 'border-l-transparent'} {loading && metrics ? 'opacity-70' : ''}"
>
  <th
    scope="row"
    class="px-1 py-0 text-left font-normal"
    title="{site.name}, {formatDegrees(site.latitudeDeg, 3, true)}, {formatDegrees(site.longitudeDeg, 3, true)}"
  >
    <span class="block max-w-[8rem] whitespace-nowrap leading-[14px] min-[1400px]:w-[9.5rem] min-[1400px]:max-w-[9.5rem]">
      <span class="flex items-baseline gap-1.5">
        <span class="min-w-0 shrink-0 truncate {selected ? 'font-semibold' : ''}">{label.short}{#if selected}<span class="sr-only"> (selected)</span>{/if}</span>
        {#if label.long}<span class="hidden min-w-0 truncate text-muted min-[1400px]:inline">{label.long}</span>{/if}
      </span>
      {#if site.source !== 'custom'}
        <span class="hidden truncate text-muted min-[1400px]:block">{formatDegrees(site.latitudeDeg, 2, true)}, {formatDegrees(site.longitudeDeg, 2, true)}</span>
      {/if}
    </span>
  </th>
  {#if error !== null}
    <td colspan="7" class="px-1 py-0 text-muted">{error}</td>
  {:else if pending}
    <td colspan="7" class="px-1 py-0"><Busy text="Calculating…" /></td>
  {:else if metrics === null}
    {#each [0, 1, 2, 3, 4, 5, 6] as cell (cell)}
      <td class="px-1 py-0 text-right text-muted">{empty ? '…' : ''}</td>
    {/each}
  {:else}
    <td class="whitespace-nowrap px-1 py-0 text-right text-sun">
      <span class="block leading-[14px]">{formatPercent(metrics.sunMeanFraction)}</span>
      {#if sunDelta !== null}<span class="block leading-[14px]" title="Change in percentage points from the compared landing">{sunDelta} pt</span>{/if}
    </td>
    <td class="whitespace-nowrap px-1 py-0 text-right text-sun">
      <span class="block leading-[14px]">{formatHours(metrics.sunLongestDarkHours)}</span>
      {#if darkDelta !== null}<span class="block leading-[14px]" title="Change in hours from the compared landing">{darkDelta} h</span>{/if}
    </td>
    <td class="whitespace-nowrap px-1 py-0 text-right text-earth">{formatPercent(metrics.earthMeanFraction)}</td>
    <td class="whitespace-nowrap px-1 py-0 text-right text-earth">{formatHours(metrics.earthLongestLossHours)}</td>
    <td class="whitespace-nowrap px-1 py-0 text-right text-sun" title={nowTitle('Sun', 'sun', metrics.sunElevationDeg, metrics.sunCountdown)}>
      {@render now(metrics.sunElevationDeg, metrics.sunCountdown, 'sun')}
    </td>
    <td class="whitespace-nowrap px-1 py-0 text-right text-earth" title={nowTitle('Earth', 'earth', metrics.earthElevationDeg, metrics.earthCountdown)}>
      {@render now(metrics.earthElevationDeg, metrics.earthCountdown, 'earth')}
    </td>
    <td class="whitespace-nowrap px-1 py-0 text-right" title="Lowest charge during the stay{metrics.batteryHoursEmpty > 0 ? `; empty, with the load unmet, for ${formatHours(metrics.batteryHoursEmpty)}` : ''}">
      {formatPercent(batteryPercent)}{#if metrics.batteryHoursEmpty > 0}<span class="text-muted"> · {formatHours(metrics.batteryHoursEmpty)} empty</span>{/if}
    </td>
  {/if}
  <td class="group relative p-0 text-right">
    {#if !canRemove}
      <span class="pointer-events-none absolute right-full top-1/2 z-10 hidden -translate-y-1/2 whitespace-nowrap bg-panel px-1 text-[11px] leading-[14px] text-muted group-focus-within:block group-hover:block">{REMOVE_REASON}</span>
    {/if}
    <button
      type="button"
      tabindex="-1"
      aria-disabled={!canRemove}
      aria-label="Remove {label.short}"
      onclick={(event) => {
        event.stopPropagation();
        if (canRemove) onremove(false);
        else onblocked();
      }}
      class="px-2 py-1.5 text-muted hover:text-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
    >
      <svg aria-hidden="true" viewBox="0 0 10 10" class="size-3">
        <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.5" fill="none" />
      </svg>
    </button>
  </td>
</tr>

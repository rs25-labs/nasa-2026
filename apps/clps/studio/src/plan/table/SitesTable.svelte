<script lang="ts">
  import { tick } from 'svelte';
  import { comparison, estimates } from '../../lib/mission/estimates.svelte';
  import { formatUtc } from '../../lib/format';
  import { clock } from '../../lib/mission/clock.svelte';
  import { actions, MAX_SITES, mission, sampleCount, type MissionSite } from '../../lib/mission/store.svelte';
  import { clockTimeMs, okResult, siteMetrics, type SiteMetrics } from '../../lib/mission/derive';
  import { dayTicks, labelStep } from '../timeline/axis';
  import SortHeader from './SortHeader.svelte';
  import SiteRow from './SiteRow.svelte';
  import Recommendation from './Recommendation.svelte';
  import SmallChange from './SmallChange.svelte';
  import { COLUMNS, FIRST_CLICK_DESCENDING, SORT_VALUES, type SortKey } from './columns';

  /**
   * expanded: shown on its own full page, so the open-in-full-page control is hidden.
   * strips: each row also carries the site's Sun, Earth and battery strip, under one clock and its play controls.
   */
  let {
    class: className = '',
    expanded = false,
    strips = false,
  }: { class?: string; expanded?: boolean; strips?: boolean } = $props();

  let body: HTMLTableSectionElement | undefined = $state();
  let sortKey = $state<SortKey | null>(null);
  let descending = $state(false);

  interface Row {
    site: MissionSite;
    metrics: SiteMetrics | null;
    error: string | null;
  }

  const rows = $derived.by(() => {
    const built: Row[] = mission.sites.map((site) => {
      const result = estimates.bySiteId[site.id];
      const ok = okResult(result);
      return {
        site,
        metrics: ok ? siteMetrics(ok, mission.clockIndex, mission.startUtc, mission.power) : null,
        error: result && !result.ok ? result.error : null,
      };
    });
    const key = sortKey;
    if (key === null) return built;
    const direction = descending ? -1 : 1;
    const valueOf = (row: Row): number | string | null =>
      SORT_VALUES[key](row.site, row.metrics, mission.power.batteryKwh);
    return [...built].sort((a, b) => {
      const left = valueOf(a);
      const right = valueOf(b);
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      if (typeof left === 'string' || typeof right === 'string') {
        return String(left).localeCompare(String(right)) * direction;
      }
      return (left - right) * direction;
    });
  });

  // First click puts the better value on top, second click reverses, third restores the original order.
  function sortBy(key: SortKey): void {
    if (sortKey !== key) {
      sortKey = key;
      descending = FIRST_CLICK_DESCENDING[key];
    } else if (descending === FIRST_CLICK_DESCENDING[key]) {
      descending = !descending;
    } else {
      sortKey = null;
      descending = false;
    }
  }

  async function remove(id: string, viaKeyboard: boolean): Promise<void> {
    const index = rows.findIndex((row) => row.site.id === id);
    actions.removeSite(id);
    if (!viaKeyboard) return;
    await tick();
    const next = body?.querySelectorAll('tr')[Math.min(index, mission.sites.length - 1)];
    if (next instanceof HTMLElement) next.focus();
  }

  function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (sortKey !== key) return 'none';
    return descending ? 'descending' : 'ascending';
  }

  // The one clock: a slider over the strip column, above every row.
  let axisLeft = $state(0);
  let axisWidth = $state(0);
  let dragging = false;

  const lastIndex = $derived(sampleCount(mission.days) - 1);
  const clockFraction = $derived(lastIndex > 0 ? mission.clockIndex / lastIndex : 0);
  const clockPercent = $derived(clockFraction * 100);
  const timeText = $derived(formatUtc(clockTimeMs(mission.startUtc, mission.clockIndex)));
  const ticks = $derived(dayTicks(mission.startUtc, mission.days));
  const tickStep = $derived(labelStep(axisWidth, mission.days));
  const TICK_LABEL_PX = 50;
  const labelledTicks = $derived(
    ticks.filter(
      (tick, position) => position % tickStep === 0 && (tick.index / lastIndex) * axisWidth + TICK_LABEL_PX <= axisWidth,
    ),
  );

  function observeAxis(node: HTMLElement): () => void {
    const observer = new ResizeObserver(() => {
      axisLeft = node.offsetLeft;
      axisWidth = node.clientWidth;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }

  function indexFromPointer(event: PointerEvent): number {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return ((event.clientX - rect.left) / rect.width) * lastIndex;
  }

  function onClockDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    dragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    clock.pause();
    actions.setClock(indexFromPointer(event));
  }

  function onClockMove(event: PointerEvent): void {
    if (dragging) actions.setClock(indexFromPointer(event));
  }

  function onClockUp(event: PointerEvent): void {
    dragging = false;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  }

  function onClockKeydown(event: KeyboardEvent): void {
    const stepHours = event.shiftKey ? 24 : 1;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = mission.clockIndex + stepHours;
    else if (event.key === 'ArrowLeft') next = mission.clockIndex - stepHours;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = lastIndex;
    if (next === null) return;
    event.preventDefault();
    actions.setClock(next);
  }

  function markerFor(key: SortKey): string | null {
    if (sortKey !== key) return null;
    if (key === 'site') return descending ? 'Z to A' : 'A to Z';
    return descending ? 'high first' : 'low first';
  }
</script>

<section aria-label="Sites table" class="flex min-w-0 flex-col bg-panel {expanded ? 'min-h-0' : ''} {className}">
  <Recommendation part="site" />
  {#if strips}
    <div class="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b border-rule px-5 py-2">
      <p class="m-0 ml-auto text-[14px] text-muted">
        Each strip, top to bottom: <span class="text-sun">Sun</span>, <span class="text-earth">Earth</span>, battery charge
      </p>
    </div>
  {/if}
  <!-- On the Plan page every row shows and the page scrolls; the full-page comparison scrolls inside. -->
  <div class="plan-scroll {expanded ? 'min-h-0 flex-1 overflow-auto' : 'overflow-x-auto'}">
    <div class="relative">
    <table class="w-full border-collapse text-[14px]">
      <thead class="sticky top-0 z-10 bg-panel">
        <tr class="border-b border-rule">
          {#each COLUMNS as column (column.key)}
            <th
              scope="col"
              aria-sort={ariaSort(column.key)}
              class="p-0 align-top font-normal {column.key === 'site' ? 'text-left' : ''} {strips && (column.key === 'sunNow' || column.key === 'earthNow') ? 'hidden' : ''}"
            >
              <SortHeader
                label={column.label}
                unit={column.unit}
                definition={column.definition}
                marker={markerFor(column.key)}
                {descending}
                align={column.key === 'site' ? 'left' : 'right'}
                tone={column.tone}
                onsort={() => sortBy(column.key)}
              />
            </th>
            {#if strips && column.key === 'site'}
              <th scope="col" class="w-full min-w-[120px] p-0 align-bottom font-normal" {@attach observeAxis}>
                <span class="sr-only">Sun, Earth and battery over the stay</span>
                <div class="relative h-10" aria-hidden="true">
                  {#each ticks as tick (tick.index)}
                    <span class="absolute bottom-0 w-px bg-muted" style="left: {(tick.index / lastIndex) * 100}%; height: 6px;"></span>
                  {/each}
                  {#each labelledTicks as tick (tick.index)}
                    <span
                      class="absolute whitespace-nowrap pl-1 text-xs leading-[14px] text-muted"
                      style="left: {(tick.index / lastIndex) * 100}%; bottom: 2px;"
                    >{tick.label}</span>
                  {/each}
                </div>
              </th>
            {/if}
          {/each}
          <th scope="col" class="p-0 text-right align-middle">
            {#if expanded}
              <span class="sr-only">Remove</span>
            {:else}
              <a
                href="#/compare"
                data-tour="expand"
                title="Open the comparison in a full page"
                aria-label="Open the comparison in a full page"
                class="mx-1 inline-flex h-7 w-7 items-center justify-center rounded-sm border border-muted text-ink hover:border-ink hover:bg-rule"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8">
                  <path d="M8.5 1.5h4v4M12.5 1.5 8 6M5.5 12.5h-4v-4M1.5 12.5 6 8" />
                </svg>
              </a>
            {/if}
          </th>
        </tr>
      </thead>
      <tbody bind:this={body}>
        {#each rows as row (row.site.id)}
          <SiteRow
            site={row.site}
            metrics={row.metrics}
            error={row.error}
            loading={estimates.status === 'loading'}
            selected={mission.selectedSiteId === row.site.id}
            canRemove={mission.sites.length > 1}
            batteryKwh={mission.power.batteryKwh}
            onselect={() => actions.selectSite(row.site.id)}
            baseline={comparison.active && estimates.status === 'ready' ? comparison.bySiteId[row.site.id] : undefined}
            strip={strips}
            onremove={(viaKeyboard) => void remove(row.site.id, viaKeyboard)}
            onblocked={() => actions.notify('Keep at least one site.')}
          />
        {/each}
      </tbody>
    </table>
    {#if strips}
      <div
        role="slider"
        tabindex="0"
        aria-label="Mission clock"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={lastIndex}
        aria-valuenow={Math.round(mission.clockIndex * 100) / 100}
        aria-valuetext={timeText}
        class="absolute bottom-0 top-0 z-20 cursor-ew-resize touch-none select-none focus-visible:outline-offset-[-2px]"
        style="left: {axisLeft}px; width: {axisWidth}px;"
        onpointerdown={onClockDown}
        onpointermove={onClockMove}
        onpointerup={onClockUp}
        onpointercancel={onClockUp}
        onkeydown={onClockKeydown}
      >
        <!-- The time label stays at the top of the list while the rows scroll under it. -->
        <div class="pointer-events-none sticky top-0 h-4" aria-hidden="true">
          <span
            class="absolute top-0 whitespace-nowrap bg-ink px-1 text-xs leading-4 text-ground"
            style="left: {clockPercent}%; transform: translateX(-{clockPercent}%);"
          >{timeText}</span>
        </div>
        <span
          aria-hidden="true"
          class="pointer-events-none absolute bottom-0 top-4 w-px bg-ink"
          style="left: calc({clockPercent}% - {clockFraction}px);"
        ></span>
      </div>
    {/if}
    </div>
    {#if mission.sites.length < MAX_SITES && (!strips || mission.sites.length < 2)}
      <p class="m-0 px-5 py-3 text-[14px] text-muted">
        Sites you add for comparison appear here, side by side. Search above the map, type coordinates, or click the
        map to add up to {MAX_SITES - mission.sites.length} more.
      </p>
    {/if}
  </div>
  <SmallChange />
</section>

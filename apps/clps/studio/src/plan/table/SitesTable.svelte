<script lang="ts">
  import { tick } from 'svelte';
  import { comparison, estimates } from '../../lib/mission/estimates.svelte';
  import { actions, MAX_SITES, mission, type MissionSite } from '../../lib/mission/store.svelte';
  import { okResult, siteMetrics, type SiteMetrics } from '../../lib/mission/derive';
  import SortHeader from './SortHeader.svelte';
  import SiteRow from './SiteRow.svelte';
  import Recommendation from './Recommendation.svelte';
  import SmallChange from './SmallChange.svelte';
  import { COLUMNS, FIRST_CLICK_DESCENDING, SORT_VALUES, type SortKey } from './columns';

  /** expanded: shown on its own full page, so the open-in-full-page control is hidden. */
  let { class: className = '', expanded = false }: { class?: string; expanded?: boolean } = $props();

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

  function markerFor(key: SortKey): string | null {
    if (sortKey !== key) return null;
    if (key === 'site') return descending ? 'Z to A' : 'A to Z';
    return descending ? 'high first' : 'low first';
  }
</script>

<section aria-label="Sites table" class="flex min-h-0 min-w-0 flex-col bg-panel {className}">
  <Recommendation />
  <div class="plan-scroll min-h-0 flex-1 overflow-auto">
    <table class="w-full border-collapse text-xs">
      <thead class="sticky top-0 z-10 bg-panel">
        <tr class="border-b border-rule">
          {#each COLUMNS as column (column.key)}
            <th
              scope="col"
              aria-sort={ariaSort(column.key)}
              class="p-0 align-top font-normal {column.key === 'site' ? 'text-left' : ''}"
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
            onremove={(viaKeyboard) => void remove(row.site.id, viaKeyboard)}
            onblocked={() => actions.notify('Keep at least one site.')}
          />
        {/each}
      </tbody>
    </table>
    {#if mission.sites.length < MAX_SITES}
      <p class="m-0 px-3 py-3 text-xs text-muted">
        Sites you add for comparison appear here, side by side. Search above the map, type coordinates, or click the
        map to add up to {MAX_SITES - mission.sites.length} more.
      </p>
    {/if}
  </div>
  <SmallChange />
</section>

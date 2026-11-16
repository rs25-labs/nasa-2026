<script lang="ts">
  import { okResult, siteMetrics } from '../../lib/mission/derive';
  import { estimates } from '../../lib/mission/estimates.svelte';
  import { siteLabel } from '../../lib/mission/labels';
  import { actions, mission } from '../../lib/mission/store.svelte';
  import { yearData, yearStartMs } from '../../lib/mission/year.svelte';

  // The answer a planner came for: which of the compared sites to land at for this stay, and the best landing date in
  // the year for the selected site. Scores weigh sunlight first (power and warmth), then Earth in view (direct
  // communications), then whether the battery lasts.
  const DAY_MS = 86_400_000;
  const SUN_WEIGHT = 0.5;
  const EARTH_WEIGHT = 0.3;
  const BATTERY_WEIGHT = 0.2;
  const DATE_EARTH_WEIGHT = 0.5;
  /** A date is "already among the best" within this much of the top score. */
  const CLOSE = 0.03;

  const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

  const ranked = $derived.by(() => {
    const rows = [];
    for (const site of mission.sites) {
      const result = okResult(estimates.bySiteId[site.id]);
      if (!result) continue;
      const m = siteMetrics(result, mission.clockIndex, mission.startUtc, mission.power);
      const hours = mission.days * 24;
      const powered = hours > 0 ? 1 - Math.min(1, m.batteryHoursEmpty / hours) : 1;
      rows.push({ site, m, powered, score: SUN_WEIGHT * m.sunMeanFraction + EARTH_WEIGHT * m.earthMeanFraction + BATTERY_WEIGHT * powered });
    }
    return rows.sort((a, b) => b.score - a.score);
  });

  const bestSite = $derived(ranked.length >= 2 && ranked.length === mission.sites.length ? ranked[0]! : null);

  function batteryText(hoursEmpty: number, lowestKwh: number): string {
    if (hoursEmpty >= 0.5) return `battery flat for ${Math.round(hoursEmpty)} h`;
    const capacity = mission.power.batteryKwh;
    return `battery never below ${percent(capacity > 0 ? lowestKwh / capacity : 0)}`;
  }

  const selected = $derived(mission.sites.find((site) => site.id === mission.selectedSiteId) ?? null);

  /** Best stay of this length in the year on show, from the year strip's daily means. */
  const bestDate = $derived.by(() => {
    if (!selected || yearData.siteId !== selected.id || yearData.status !== 'ready') return null;
    const days = mission.days;
    const total = yearData.sun.length;
    if (total < days) return null;
    const score = (first: number): { sun: number; earth: number; score: number } => {
      let sun = 0;
      let earth = 0;
      for (let day = first; day < first + days; day += 1) {
        sun += yearData.sun[day] ?? 0;
        earth += yearData.earth[day] ?? 0;
      }
      sun /= days;
      earth /= days;
      return { sun, earth, score: sun + DATE_EARTH_WEIGHT * earth };
    };
    let top = { first: 0, ...score(0) };
    for (let first = 1; first + days <= total; first += 1) {
      const value = score(first);
      if (value.score > top.score + 1e-9) top = { first, ...value };
    }
    const nowFirst = Math.floor((Date.parse(mission.startUtc) - yearStartMs(yearData.year)) / DAY_MS);
    const now = nowFirst >= 0 && nowFirst + days <= total ? score(nowFirst) : null;
    const startMs = yearStartMs(yearData.year) + top.first * DAY_MS;
    return {
      startMs,
      label: new Date(startMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
      sun: top.sun,
      earth: top.earth,
      now,
      alreadyBest: now !== null && top.score - now.score <= CLOSE,
    };
  });

  function useDate(): void {
    if (!bestDate) return;
    actions.setWindow(new Date(bestDate.startMs).toISOString().replace('.000Z', 'Z'), mission.days);
    actions.setClock(0);
  }
</script>

<!-- The plan's answer on the left, and the export of the whole plan on the right. -->
<div class="flex shrink-0 items-center gap-3 border-b border-rule border-l-4 border-l-sun bg-ground px-3 py-2 text-[13px] leading-5 text-ink">
  <div class="min-w-0 flex-1" role="status" aria-label="Recommendation">
    {#if bestSite}
      <p class="m-0">
        <span class="font-semibold uppercase tracking-wide text-sun">Recommended site</span>
        <span class="ml-2 font-semibold">{siteLabel(bestSite.site).short}</span>
        <span class="text-muted">
          for this stay: sunlight {percent(bestSite.m.sunMeanFraction)}, Earth in view {percent(bestSite.m.earthMeanFraction)}, {batteryText(
            bestSite.m.batteryHoursEmpty,
            bestSite.m.batteryLowestKwh,
          )}.
        </span>
        {#if bestSite.site.id !== mission.selectedSiteId}
          <button type="button" class="ml-2 rounded-sm border border-sun px-2 text-xs font-semibold text-sun hover:bg-rule" onclick={() => actions.selectSite(bestSite.site.id)}>Select it</button>
        {/if}
      </p>
    {/if}
    {#if selected}
      <p class="m-0">
        <span class="font-semibold uppercase tracking-wide text-sun">Best landing date</span>
        {#if bestDate}
          {#if bestDate.alreadyBest}
            <span class="ml-2 text-muted">This date is among the best of {yearData.year} for {siteLabel(selected).short}.</span>
          {:else}
            <span class="ml-2 font-semibold">{bestDate.label}</span>
            <span class="text-muted">
              for {siteLabel(selected).short}: about {percent(bestDate.sun)} sunlight and {percent(bestDate.earth)} Earth in view{#if bestDate.now}, against {percent(bestDate.now.sun)} and {percent(
                  bestDate.now.earth,
                )} now{/if}.
            </span>
            <button type="button" class="ml-2 rounded-sm border border-sun bg-sun px-2 text-xs font-semibold text-black hover:opacity-90" onclick={useDate}>Use this date</button>
          {/if}
        {:else if yearData.status === 'error'}
          <span class="ml-2 text-muted">The year scan failed.</span>
        {:else}
          <span class="ml-2 text-muted">Scanning {yearData.year} for {siteLabel(selected).short}… {Math.round((yearData.loadedDays / Math.max(1, yearData.sun.length)) * 100)}%</span>
        {/if}
      </p>
    {/if}
  </div>
</div>

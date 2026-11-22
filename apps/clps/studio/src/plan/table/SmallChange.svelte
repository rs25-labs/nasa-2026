<script lang="ts">
  import { api } from '../../lib/api/client';
  import { okResult, siteMetrics } from '../../lib/mission/derive';
  import { estimates } from '../../lib/mission/estimates.svelte';
  import { siteLabel } from '../../lib/mission/labels';
  import { mission, type MissionSite } from '../../lib/mission/store.svelte';
  import { yearData, yearStartMs } from '../../lib/mission/year.svelte';

  // One line on why small changes matter: the biggest effect of landing a few days early or late, and the biggest
  // difference to another site in the table within a few kilometres. The year strip's daily means pick the slip;
  // the numbers shown are the stay's own estimate and an exact estimate for the slipped stay.
  const DAY_MS = 86_400_000;
  const MAX_SLIP_DAYS = 3;
  const NEARBY_M = 10_000;
  const NOTABLE = 0.05;
  const MOON_RADIUS_M = 1_737_400;

  const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

  function distanceM(a: MissionSite, b: MissionSite): number {
    const toRad = Math.PI / 180;
    const dLat = (b.latitudeDeg - a.latitudeDeg) * toRad;
    const dLon = (b.longitudeDeg - a.longitudeDeg) * toRad;
    const h =
      Math.sin(dLat / 2) ** 2 + Math.cos(a.latitudeDeg * toRad) * Math.cos(b.latitudeDeg * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * MOON_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** Mean of the daily values for a stay starting on day `first`, or null when any day is missing. */
  function stayMean(values: number[], first: number, days: number): number | null {
    if (first < 0 || first + days > values.length) return null;
    let total = 0;
    for (let day = first; day < first + days; day += 1) {
      const value = values[day];
      if (value === undefined || !Number.isFinite(value)) return null;
      total += value;
    }
    return total / days;
  }

  const selected = $derived(mission.sites.find((site) => site.id === mission.selectedSiteId) ?? null);

  type Body = 'SUN' | 'EARTH';

  /** The slip, within a few days, that the year strip says changes sunlight or Earth in view the most. */
  const candidate = $derived.by(() => {
    if (!selected || yearData.siteId !== selected.id) return null;
    const firstDay = Math.floor((Date.parse(mission.startUtc) - yearStartMs(yearData.year)) / DAY_MS);
    let best: { days: number; body: Body; change: number } | null = null;
    for (const [body, values] of [['SUN', yearData.sun], ['EARTH', yearData.earth]] as const) {
      const base = stayMean(values, firstDay, mission.days);
      if (base === null) continue;
      for (let shift = -MAX_SLIP_DAYS; shift <= MAX_SLIP_DAYS; shift += 1) {
        if (shift === 0) continue;
        const moved = stayMean(values, firstDay + shift, mission.days);
        if (moved !== null && (!best || Math.abs(moved - base) > best.change)) best = { days: shift, body, change: Math.abs(moved - base) };
      }
    }
    return best && best.change >= NOTABLE ? best : null;
  });

  let exact = $state<{ key: string; to: number } | null>(null);
  const candidateKey = $derived(
    candidate && selected
      ? `${selected.latitudeDeg},${selected.longitudeDeg},${mission.startUtc},${mission.days},${mission.mastHeightM},${candidate.days},${candidate.body}`
      : '',
  );

  $effect(() => {
    const key = candidateKey;
    const pick = candidate;
    const site = selected;
    if (!key || !pick || !site) return;
    const controller = new AbortController();
    const start = new Date(Date.parse(mission.startUtc) + pick.days * DAY_MS).toISOString().replace('.000Z', 'Z');
    api
      .estimates(
        {
          start,
          days: mission.days,
          observer_height_m: mission.mastHeightM,
          sites: [{ site_id: 'slip', latitude_deg: site.latitudeDeg, longitude_deg: site.longitudeDeg }],
        },
        controller.signal,
      )
      .then((response) => {
        const result = response.results[0];
        const summary = result && result.ok ? result.summaries.find((item) => item.body === pick.body) : undefined;
        if (summary) exact = { key, to: summary.mean_visible_fraction };
      })
      .catch(() => {});
    return () => controller.abort();
  });

  const slip = $derived.by(() => {
    const ok = selected ? okResult(estimates.bySiteId[selected.id]) : null;
    if (!candidate || !ok || !exact || exact.key !== candidateKey) return null;
    const from = ok.summaries.find((item) => item.body === candidate.body)?.mean_visible_fraction;
    if (from === undefined || Math.abs(exact.to - from) < NOTABLE) return null;
    return { days: candidate.days, body: candidate.body === 'SUN' ? 'sunlight' : 'Earth in view', from, to: exact.to };
  });

  const nearby = $derived.by(() => {
    const ok = selected ? okResult(estimates.bySiteId[selected.id]) : null;
    if (!selected || !ok) return null;
    const own = siteMetrics(ok, mission.clockIndex, mission.startUtc, mission.power).sunMeanFraction;
    let best: { site: MissionSite; km: number; theirs: number } | null = null;
    for (const site of mission.sites) {
      if (site.id === selected.id) continue;
      const other = okResult(estimates.bySiteId[site.id]);
      const metres = distanceM(selected, site);
      if (!other || metres > NEARBY_M) continue;
      const theirs = siteMetrics(other, mission.clockIndex, mission.startUtc, mission.power).sunMeanFraction;
      if (!best || Math.abs(theirs - own) > Math.abs(best.theirs - own)) best = { site, km: metres / 1000, theirs };
    }
    return best && Math.abs(best.theirs - own) >= NOTABLE ? { ...best, own } : null;
  });

  const text = $derived.by(() => {
    const parts: string[] = [];
    if (slip && selected) {
      const when = `${Math.abs(slip.days)} day${Math.abs(slip.days) === 1 ? '' : 's'} ${slip.days > 0 ? 'later' : 'earlier'}`;
      parts.push(`Landing ${when} changes ${slip.body} at ${siteLabel(selected).short} from ${percent(slip.from)} to ${percent(slip.to)}.`);
    }
    if (nearby && selected) {
      parts.push(
        `${siteLabel(nearby.site).short}, ${nearby.km.toFixed(1)} km away, gets ${percent(nearby.theirs)} sunlight against ${percent(nearby.own)} at ${siteLabel(selected).short}.`,
      );
    }
    return parts.join(' ');
  });
</script>

{#if text}
  <p class="m-0 shrink-0 border-t border-rule bg-[#f3f1ea] px-5 py-2.5 text-[14px] text-[#1a1a1a]" role="status" aria-label="Small changes">
    <span class="font-bold">If you change the plan a little:</span>
    {text}
  </p>
{/if}

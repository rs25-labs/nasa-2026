<script lang="ts">
  import { ApiError } from '../lib/api/base';
  import { formatDate, formatUtc } from '../lib/format';
  import { bestDriveWindow } from '../lib/mission/driveTime';
  import { energyText, planStay } from '../lib/mission/stayPlan';
  import { okResult, siteMetrics } from '../lib/mission/derive';
  import { estimates } from '../lib/mission/estimates.svelte';
  import { siteLabel } from '../lib/mission/labels';
  import { actions, mission } from '../lib/mission/store.svelte';
  import { downloadPdfReport } from './export/files.svelte';
  import { expeditionBlockReason, openExpedition } from './expedition';

  // The decision the page leads to: the selected site on the chosen dates, and what to do with it next.

  const DAY_MS = 86_400_000;
  const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

  const site = $derived(mission.sites.find((s) => s.id === mission.selectedSiteId) ?? null);
  const blocked = $derived(expeditionBlockReason(site));
  const startMs = $derived(Date.parse(mission.startUtc));

  const result = $derived(okResult(site ? estimates.bySiteId[site.id] : undefined));
  const metrics = $derived(result ? siteMetrics(result, mission.clockIndex, mission.startUtc, mission.power) : null);

  /** The best time in the stay to start a drive; Expedition starts its own clock there. */
  const driveWindow = $derived(result ? bestDriveWindow({ sun: result.series.sun.fraction, earth: result.series.earth.fraction }) : null);
  const HOUR_MS = 3_600_000;

  /** The outpost section's answer, in one line: what the crew needs to bring for this stay. */
  const outpost = $derived(
    result ? planStay(result.series.sun.fraction, result.series.earth.fraction, mission.crew * mission.crewKw) : null,
  );

  const batteryText = $derived.by(() => {
    if (!metrics) return '';
    if (metrics.batteryHoursEmpty >= 0.5) return `battery flat for ${Math.round(metrics.batteryHoursEmpty)} h`;
    const capacity = mission.power.batteryKwh;
    return `battery never below ${percent(capacity > 0 ? metrics.batteryLowestKwh / capacity : 0)}`;
  });

  let downloading = $state(false);

  async function download(): Promise<void> {
    if (downloading) return;
    downloading = true;
    actions.notify('Preparing the PDF plan…');
    try {
      await downloadPdfReport('sites');
      actions.notify('Landing plan downloaded.');
    } catch (cause) {
      actions.notify(cause instanceof ApiError ? `Download failed: ${cause.message}` : 'Download failed. Try again in a moment.');
    } finally {
      downloading = false;
    }
  }

  function otherFormats(): void {
    document.getElementById('export-menu')?.showPopover();
  }
</script>

<div class="flex flex-col gap-4 px-5 py-5">
  {#if site}
    <p class="m-0 text-lg leading-7 text-ink">
      Land at <strong>{siteLabel(site).short}</strong> on <strong>{formatDate(startMs)}</strong> and stay
      <strong>{mission.days} days</strong>, to {formatDate(startMs + mission.days * DAY_MS)}.
      {#if metrics}
        <span class="text-muted">
          Sunlight {percent(metrics.sunMeanFraction)}, Earth in view {percent(metrics.earthMeanFraction)}, {batteryText}.
        </span>
      {/if}
    </p>
    {#if outpost}
      <p class="m-0 text-base text-ink">
        Outpost for a crew of {mission.crew}:
        {#if outpost.solarViable}
          bring a <strong>{Math.round(outpost.arrayKw)} kW</strong> solar array and a <strong>{energyText(outpost.batteryKwh)}</strong> battery.
        {:else}
          <strong>solar power cannot carry this stay</strong>; see section 4.
        {/if}
      </p>
    {/if}
    {#if driveWindow}
      <p class="m-0 text-base text-ink">
        Best time to drive: <strong>{formatUtc(startMs + driveWindow.startIndex * HOUR_MS)}</strong>
        <span class="text-muted">
          {#if driveWindow.both}
            (Sun up and Earth in view for {driveWindow.clearHours >= 24 ? 'a day or more' : `the next ${driveWindow.clearHours} h`}).
          {:else}
            (Sun up for {driveWindow.clearHours >= 24 ? 'a day or more' : `the next ${driveWindow.clearHours} h`}; Earth is never in view at the same time, so no direct radio contact).
          {/if}
        </span>
      </p>
    {/if}
    <p class="m-0 text-sm text-muted">To choose differently, pick another date in section 1, another site in section 2, or change the crew in section 4.</p>
  {:else}
    <p class="m-0 text-lg text-ink">Pick a site in section 2 to make your choice.</p>
  {/if}
  <div class="flex flex-wrap items-center gap-3">
    <button
      type="button"
      onclick={openExpedition}
      disabled={blocked !== ''}
      class="h-11 rounded-sm border border-ink bg-ink px-5 text-base font-semibold text-ground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >Plan the expedition at {site ? siteLabel(site).short : 'this site'} →</button>
    <button
      type="button"
      onclick={() => void download()}
      disabled={downloading}
      class="h-11 rounded-sm border border-rule bg-ground px-5 text-base text-ink hover:border-muted disabled:opacity-60"
    >{downloading ? 'Preparing…' : 'Download the landing plan (PDF)'}</button>
    <button type="button" onclick={otherFormats} class="text-sm text-muted underline hover:text-ink">Other formats</button>
    {#if blocked}<p class="m-0 text-sm text-ink" role="status">{blocked}</p>{/if}
  </div>
</div>

<script lang="ts">
  import { formatDegrees, formatUtc } from '../lib/format';
  import { route } from '../lib/router.svelte';
  import { provideSession } from '../lib/mission/session';
  import { actions, mission } from '../lib/mission/store.svelte';
  import { addCustomSite, FULL_REASON, isFull } from '../plan/map/adding';
  import Busy from '../plan/Busy.svelte';
  import Sky from '../plan/sky/Sky.svelte';
  import KeyNumbers from '../plan/sky/KeyNumbers.svelte';
  import TimeStrip from '../plan/timeline/TimeStrip.svelte';
  import { landingList, landingSession, loadLandings, showLanding } from './landings.svelte';

  provideSession(landingSession);
  loadLandings();

  const sectionBar = 'm-0 flex items-center justify-center bg-ink text-xs font-semibold leading-none text-ground';

  // The landing named in the address, else the first one.
  const chosen = $derived(
    landingList.sites.find((site) => site.id === route.landingId) ?? landingList.sites[0] ?? null,
  );

  $effect(() => {
    if (chosen && landingSession.mission.selectedSiteId !== chosen.id) showLanding(chosen);
  });

  let planReason = $state('');

  function planHere(): void {
    if (!chosen) return;
    if (isFull()) {
      planReason = FULL_REASON;
      return;
    }
    planReason = '';
    const before = mission.sites.length;
    addCustomSite(chosen.latitude_deg, chosen.longitude_deg);
    if (mission.sites.length > before) {
      actions.notify(`Added the ${chosen.name.split(' · ')[0]} site. Plan dates unchanged.`);
    }
    window.location.hash = '#/plan';
  }

  function landingDate(iso: string): string {
    return iso.slice(0, 10);
  }
</script>

<div
  class="grid h-full gap-px bg-rule"
  style="grid-template-columns: minmax(300px, 24%) minmax(0, 1fr) minmax(320px, 27%); grid-template-rows: 22px minmax(0, 1fr) 22px minmax(0, 1fr);"
>
  <h2 class="{sectionBar} [grid-area:1/1/2/4]">Choose a Real Landing</h2>

  <section aria-label="Real landings" class="plan-scroll flex min-h-0 flex-col overflow-y-auto bg-panel [grid-area:2/1/5/2]">
    {#if landingList.status === 'loading' || landingList.status === 'idle'}
      <Busy text="Loading landings…" class="px-3 py-2" />
    {:else if landingList.status === 'error'}
      <p class="m-0 px-3 py-2 text-sm">{landingList.error} Reload the page to try again.</p>
    {:else}
      <ul class="m-0 list-none p-0">
        {#each landingList.sites as site (site.id)}
          {@const current = chosen?.id === site.id}
          <li class="border-b border-rule">
            <a
              href="#/landings/{encodeURIComponent(site.id)}"
              aria-current={current ? 'true' : undefined}
              class="flex items-baseline justify-between gap-3 border-l-2 px-3 py-1.5 text-sm text-ink hover:bg-ground {current ? 'border-l-ink font-semibold' : 'border-l-transparent'}"
            >
              <span class="min-w-0 truncate">{site.name}</span>
              <span class="shrink-0 text-xs font-normal text-muted">{landingDate(site.landing_utc)}</span>
            </a>
          </li>
        {/each}
      </ul>

      {#if chosen}
        <div class="flex flex-col gap-1.5 px-3 py-3 text-xs">
          <h3 class="m-0 text-sm font-semibold">{chosen.name}</h3>
          <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt class="text-muted">Agency</dt>
            <dd class="m-0">{chosen.category}</dd>
            <dt class="text-muted">Landed</dt>
            <dd class="m-0">{formatUtc(Date.parse(chosen.landing_utc))}</dd>
            <dt class="text-muted">Shown from</dt>
            <dd class="m-0">{formatUtc(Date.parse(landingSession.mission.startUtc))}, {landingSession.mission.days} days</dd>
            <dt class="text-muted">Time</dt>
            <dd class="m-0">{chosen.time_precision}</dd>
            <dt class="text-muted">Place</dt>
            <dd class="m-0">{formatDegrees(chosen.latitude_deg, 3, true)}, {formatDegrees(chosen.longitude_deg, 3, true)}</dd>
          </dl>
          {#if chosen.note}<p class="m-0 text-muted">{chosen.note}</p>{/if}
          {#if chosen.sources.length > 0}
            <ul class="m-0 list-none p-0">
              {#each chosen.sources as source (source.url)}
                <li><a href={source.url} target="_blank" rel="noopener noreferrer" class="text-earth hover:underline">{source.title}</a></li>
              {/each}
            </ul>
          {/if}
          <div class="mt-1">
            <button
              type="button"
              onclick={planHere}
              class="rounded-sm border border-rule bg-ground px-2.5 py-1 text-xs text-ink hover:border-muted"
            >Plan a mission here</button>
            <p class="m-0 mt-1 text-muted">Adds this place to your plan as a custom site. Your plan's dates stay as they are.</p>
            {#if planReason}<p class="m-0 mt-1 text-ink" role="alert">{planReason}</p>{/if}
          </div>
          {#if landingList.notice}<p class="m-0 mt-2 text-[11px] leading-4 text-muted">{landingList.notice}</p>{/if}
        </div>
      {/if}
    {/if}
  </section>

  <Sky class="[grid-area:2/2/3/3]" />
  <KeyNumbers class="[grid-area:2/3/3/4]" expeditionLink={false} />
  <h2 class="{sectionBar} [grid-area:3/2/4/4]">Review Sun/Earth Visibility and Battery</h2>
  <TimeStrip class="[grid-area:4/2/5/4]" addHint={false} />
</div>

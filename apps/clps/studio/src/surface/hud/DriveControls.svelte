<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { api } from '../../lib/api/client';
  import type { CatalogSite } from '../../lib/api/types';
  import { formatDuration, formatPercent, formatUtc } from '../../lib/format';
  import { okResult } from '../../lib/mission/derive';
  import { bestDriveWindow, clearHoursFrom } from '../../lib/mission/driveTime';
  import { estimates } from '../../lib/mission/estimates.svelte';
  import { greatCircleDistanceM } from '../../lib/geo/polar';
  import {
    drive,
    LAPSE_OPTIONS,
    MAX_SLOPE_LIMIT_DEG,
    MAX_TARGET_RANGE_M,
    STAY_LAPSE_OPTIONS,
    STEEP_SLOPE_DEG,
    type CameraKind,
  } from '../../lib/mission/drive.svelte';
  import { mission } from '../../lib/mission/store.svelte';

  interface Props {
    originLatitudeDeg: number;
    originLongitudeDeg: number;
    /** The small map, drawn under the panel at the size the column has room for. */
    map?: Snippet<[number]>;
  }
  let { originLatitudeDeg, originLongitudeDeg, map }: Props = $props();

  // The panel and the small map share the left column. The panel always shows in full; the map takes the height left
  // over, down to a usable minimum, and is left out below that (Minimize gives it the room back).
  /** The panel's width less the map box's padding and border, so the two line up. */
  const MAP_FULL_PX = 322;
  const MAP_MIN_PX = 140;
  /** The map's title row, scale row, padding and border around the square. */
  const MAP_CHROME_PX = 60;
  const COLUMN_GAP_PX = 12;
  let columnHeight = $state(0);
  let panelHeight = $state(0);
  const mapSize = $derived(Math.min(MAP_FULL_PX, Math.floor(columnHeight - panelHeight - COLUMN_GAP_PX - MAP_CHROME_PX)));
  const mapShown = $derived(map !== undefined && mapSize >= MAP_MIN_PX);

  const cameras: { id: CameraKind; label: string; hint: string }[] = [
    { id: 'chase', label: 'Chase', hint: 'Follows behind the rover' },
    { id: 'driver', label: 'Driver', hint: "Driver's seat view ahead" },
    { id: 'mast', label: 'Mast', hint: "The rover's mast camera; drag to pan and tilt" },
    { id: 'orbit', label: 'Orbit', hint: 'Circles the rover; drag to move around it' },
  ];

  let nearby: { id: string; name: string; latitudeDeg: number; longitudeDeg: number; distanceM: number }[] = $state([]);
  /** The list folds away by default so the panel leaves room for the small map. */
  let nearbyOpen = $state(false);

  onMount(() => {
    const controller = new AbortController();
    api
      .sites(controller.signal)
      .then((response) => {
        nearby = response.sites
          .map((site: CatalogSite) => ({
            id: site.site_id,
            name: site.name,
            latitudeDeg: site.latitude_deg,
            longitudeDeg: site.longitude_deg,
            distanceM: greatCircleDistanceM({ latitudeDeg: originLatitudeDeg, longitudeDeg: originLongitudeDeg }, { latitudeDeg: site.latitude_deg, longitudeDeg: site.longitude_deg }),
          }))
          .filter((site) => site.distanceM > 50 && site.distanceM <= MAX_TARGET_RANGE_M)
          .sort((a, b) => a.distanceM - b.distanceM)
          .slice(0, 8);
      })
      .catch(() => undefined);
    return () => controller.abort();
  });

  const t = $derived(drive.telemetry);
  const route = $derived(drive.route);
  const phase = $derived(drive.phase);
  const prediction = $derived(drive.prediction);
  const total = $derived(t.totalM);
  const progress = $derived(total > 0 ? Math.min(1, t.progressM / total) : 0);
  const targetFar = $derived(drive.target !== null && greatCircleDistanceM({ latitudeDeg: originLatitudeDeg, longitudeDeg: originLongitudeDeg }, drive.target) > MAX_TARGET_RANGE_M);

  /** The next thing to do: pick a target, then find a route; the Drive button below then takes over. */
  const stepNow = $derived(!drive.target ? 1 : !route ? 4 : 0);

  function stateOf(number: number): 'done' | 'now' | 'later' {
    if (number === stepNow) return 'now';
    // The departure is filled in from the start, with the recommended time.
    if (number === 2) return 'done';
    if (!drive.target) return 'later';
    return number === 1 || number === 3 || route ? 'done' : 'later';
  }

  // Finished steps fold to one line; Change opens one again. A new target or route folds them all.
  let opened = $state(new Set<number>());

  $effect(() => {
    void drive.target;
    void route;
    opened = new Set();
    nearbyOpen = false;
  });

  function toggle(number: number): void {
    const next = new Set(opened);
    if (next.has(number)) next.delete(number);
    else next.add(number);
    opened = next;
  }

  const recommended = $derived(drive.recommendedSlopeDeg);
  const limit = $derived(drive.slopeLimitDeg);
  /** Something about the slope the planner should know before driving, or ''. */
  const slopeWarning = $derived.by(() => {
    if (recommended === 'none') return `No route even at ${MAX_SLOPE_LIMIT_DEG}°. Pick a different target.`;
    if (typeof recommended === 'number' && recommended > STEEP_SLOPE_DEG) {
      return `Steep: this target needs slopes of ${recommended}° or more. Above ${STEEP_SLOPE_DEG}° the rover risks sliding or tipping; consider a different target.`;
    }
    if (typeof recommended === 'number' && limit < recommended) return `Below ${recommended}° there is no route to this target.`;
    if (limit > STEEP_SLOPE_DEG) return `A limit above ${STEEP_SLOPE_DEG}° lets the route use slopes that are steep for this rover.`;
    return '';
  });

  // When to leave. The drive has its own clock; before the first drive it follows the recommended time.
  const HOUR_MS = 3_600_000;
  const stayStartMs = $derived(Date.parse(mission.startUtc));
  const sky = $derived.by(() => {
    const result = okResult(mission.selectedSiteId ? estimates.bySiteId[mission.selectedSiteId] : undefined);
    return result ? { sun: result.series.sun.fraction, earth: result.series.earth.fraction } : null;
  });
  const bestWindow = $derived(sky ? bestDriveWindow(sky) : null);
  const departureMs = $derived(stayStartMs + drive.clockIndex * HOUR_MS);
  const onRecommended = $derived(bestWindow !== null && Math.abs(drive.clockIndex - bestWindow.startIndex) < 0.01);
  /** The departure can change until the rover sets off on this route. */
  const departureEditable = $derived(phase === 'idle' || phase === 'ready');

  $effect(() => {
    if (bestWindow && !drive.departureChosen && departureEditable) drive.setClock(bestWindow.startIndex);
  });

  function pickerValue(ms: number): string {
    return new Date(ms).toISOString().slice(0, 16);
  }

  function setDeparture(input: HTMLInputElement): void {
    const ms = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.value) ? Date.parse(`${input.value}:00Z`) : Number.NaN;
    if (!Number.isFinite(ms)) {
      input.value = pickerValue(departureMs);
      return;
    }
    drive.departureChosen = true;
    drive.setClock((ms - stayStartMs) / HOUR_MS);
    input.value = pickerValue(stayStartMs + drive.clockIndex * HOUR_MS);
    // The route's light and contact depend on when it starts, so a ready route is worked out again.
    if (route) void drive.commands?.findRoute();
  }

  function useRecommended(): void {
    if (!bestWindow) return;
    drive.departureChosen = false;
    drive.setClock(bestWindow.startIndex);
    if (route) void drive.commands?.findRoute();
  }

  /** How long the Sun and Earth stay up from the departure, and whether the drive outlasts either. */
  const clear = $derived(sky ? clearHoursFrom(sky, drive.clockIndex) : null);
  const driveHours = $derived(route ? route.travel_seconds / 3600 : 0);
  const timeWarning = $derived.by(() => {
    if (!clear || !departureEditable) return '';
    if (clear.sun === 0) return 'The Sun is down at this time: the rover runs on its battery from the start.';
    if (route && driveHours > clear.sun) return `The Sun sets about ${Math.max(1, Math.floor(clear.sun))} h into this drive.`;
    if (clear.earth === 0) return 'Earth is out of view at this time: no direct radio contact.';
    if (route && driveHours > clear.earth) return `Earth goes out of view about ${Math.max(1, Math.floor(clear.earth))} h into this drive.`;
    return '';
  });

  function hoursText(hours: number): string {
    return hours >= 24 ? 'a day or more' : `${hours} h`;
  }

  const driveLabel = $derived(
    phase === 'driving' ? 'Pause' : phase === 'arrived' ? 'Drive again' : phase === 'paused' ? 'Resume' : 'Drive selected route',
  );

  /** Why Drive cannot start yet, or ''. */
  const waitingFor = $derived(
    route ? '' : !drive.target ? 'Pick a target (step 1) and find a route (step 4).' : drive.routing ? 'Finding the route…' : 'Find a route (step 4) first.',
  );

  function drivePressed(): void {
    if (phase === 'driving') drive.paused = true;
    else if (phase === 'paused') drive.paused = false;
    else {
      // From here on the clock carries on from wherever the drives leave it.
      drive.departureChosen = true;
      drive.commands?.start();
    }
  }
</script>

<div class="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-center">
  <div class="pointer-events-auto flex items-center gap-2 rounded-sm border border-rule bg-[rgb(10_10_11/0.82)] px-2 py-1 text-xs text-muted">
    {#if drive.stay}
      <button type="button" class="rounded-sm px-2 py-1 text-ink hover:bg-rule" onclick={() => (drive.stayPaused = !drive.stayPaused)}>{drive.stayPaused ? 'Play' : 'Pause'}</button>
      <label class="flex items-center gap-1">
        <span class="sr-only">Stay time-lapse</span>
        <select class="rounded-sm border border-rule bg-panel px-1 py-1 text-ink" bind:value={drive.stayLapse} aria-label="Stay time-lapse">
          {#each STAY_LAPSE_OPTIONS as option (option)}<option value={option}>{option}×</option>{/each}
        </select>
      </label>
      <button type="button" class="rounded-sm px-2 py-1 hover:bg-rule hover:text-ink" onclick={() => drive.commands?.enterStay()}>Restart</button>
      <button type="button" class="rounded-sm px-2 py-1 text-sun hover:bg-rule" onclick={() => drive.commands?.exitStay()}>Exit outpost</button>
    {:else}
    {#if route}
      <button type="button" class="rounded-sm px-2 py-1 text-ink hover:bg-rule" onclick={drivePressed}>
        {phase === 'driving' ? 'Pause' : phase === 'arrived' ? 'Drive again' : phase === 'paused' ? 'Resume' : 'Drive'}
      </button>
      <button type="button" class="rounded-sm px-2 py-1 hover:bg-rule hover:text-ink" onclick={() => drive.commands?.restart()}>Restart</button>
      <input
        type="range"
        min="0"
        max="1000"
        value={Math.round(progress * 1000)}
        class="h-1 w-28 accent-[var(--color-sun)]"
        aria-label="Position along the route"
        oninput={(event) => drive.commands?.seek(Number(event.currentTarget.value) / 1000)}
      />
      {#if drive.mode === 'manual'}
        <button type="button" class="rounded-sm px-2 py-1 text-sun hover:bg-rule" onclick={() => drive.commands?.returnToRoute()}>Return to route</button>
      {/if}
    {/if}
    <label class="flex items-center gap-1">
      <span class="sr-only">Time-lapse</span>
      <select class="rounded-sm border border-rule bg-panel px-1 py-1 text-ink" bind:value={drive.lapse} aria-label="Time-lapse">
        {#each LAPSE_OPTIONS as option (option)}<option value={option}>{option}×</option>{/each}
      </select>
    </label>
    <button
      type="button"
      class="rounded-sm px-2 py-1 hover:bg-rule hover:text-ink {drive.planning ? 'text-ink' : ''}"
      onclick={() => {
        drive.panelOpen = true;
        if (drive.planning) drive.commands?.closePlanning();
        else drive.commands?.openPlanning();
      }}
      aria-pressed={drive.planning}
      title="Top-down view for choosing a target"
    >
      Top view
    </button>
    <span class="flex items-center gap-0.5" role="group" aria-label="Camera">
      {#each cameras as camera, index (camera.id)}
        <!-- An instant tooltip above the bar on hover or keyboard focus: the native title was slow and easy to miss. -->
        <span class="group relative">
          <button
            type="button"
            class="rounded-sm px-1.5 py-1 hover:bg-rule {drive.camera === camera.id && !drive.planning ? 'bg-rule text-ink' : ''}"
            aria-pressed={drive.camera === camera.id && !drive.planning}
            aria-label="{camera.label} camera: {camera.hint}. Key {index + 1}."
            onclick={() => {
              drive.planning = false;
              drive.camera = camera.id;
            }}>{index + 1}</button
          >
          <span
            aria-hidden="true"
            class="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden w-max max-w-[16rem] -translate-x-1/2 rounded-sm border border-rule bg-panel px-2 py-1 text-left text-xs text-ink shadow group-focus-within:block group-hover:block"
          >
            <span class="font-semibold">{camera.label} camera</span> <span class="text-muted">· key {index + 1}</span><br />
            <span class="text-muted">{camera.hint}</span>
          </span>
        </span>
      {/each}
    </span>
    <button type="button" class="rounded-sm border border-sun px-2 py-1 font-semibold text-sun hover:bg-rule" title="The outpost on the ground here, over a time-lapse of the stay" onclick={() => drive.commands?.enterStay()}>Outpost view</button>
    {/if}
    <span class="text-muted">Esc menu</span>
  </div>
</div>

{#snippet step(number: number, title: string, colour: string, state: 'done' | 'now' | 'later', body: import('svelte').Snippet, summary: import('svelte').Snippet)}
  <li
    class="flex flex-col gap-2 rounded-sm border border-rule px-3 py-2 {state === 'later' ? 'opacity-55' : ''}"
    style="border-left: 3px solid {colour};{state === 'now' ? ` background: color-mix(in srgb, ${colour} 12%, transparent);` : ''}"
    aria-current={state === 'now' ? 'step' : undefined}
  >
    <h3 class="m-0 flex items-center gap-2 text-sm font-semibold text-ink">
      <span
        aria-hidden="true"
        class="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-[#1a1a1a]"
        style="background: {colour};"
      >{state === 'done' ? '✓' : number}</span>
      {title}
      {#if state === 'done'}
        <span class="sr-only">(done)</span>
        <button
          type="button"
          class="ml-auto rounded-sm border border-rule px-2 py-0.5 text-xs font-normal text-muted hover:border-muted hover:text-ink"
          aria-expanded={opened.has(number)}
          onclick={() => toggle(number)}
        >{opened.has(number) ? 'Done' : 'Change'}</button>
      {/if}
    </h3>
    {#if state === 'now' || opened.has(number)}
      {@render body()}
    {:else if state === 'done'}
      {@render summary()}
    {/if}
  </li>
{/snippet}

{#snippet targetBody()}
  <p class="m-0 text-muted">Click the ground{mapShown ? ' or the small map' : ''}, or pick a nearby site.</p>
  {#if nearby.length > 0}
    <button type="button" class="self-start text-ink underline hover:text-sun" aria-expanded={nearbyOpen} onclick={() => (nearbyOpen = !nearbyOpen)}>
      {nearbyOpen ? 'Hide nearby sites' : `Nearby sites within 8 km (${nearby.length})`}
    </button>
  {/if}
  {#if nearby.length > 0 && nearbyOpen}
    <ul class="m-0 list-none border-y border-rule p-0">
      {#each nearby as site (site.id)}
        <li>
          <button type="button" class="flex w-full justify-between px-1 py-1 text-left hover:bg-rule" onclick={() => drive.commands?.setTargetFromSite(site.latitudeDeg, site.longitudeDeg)}>
            <span class="truncate">{site.name}</span><span class="text-muted">{(site.distanceM / 1000).toFixed(1)} km</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if drive.target}<p class="m-0">Target: <strong>{drive.target.label}</strong></p>{/if}
{/snippet}

{#snippet targetSummary()}
  <p class="m-0">Target: <strong>{drive.target?.label}</strong>{#if targetFar}<span class="text-sun"> More than 8 km away.</span>{/if}</p>
{/snippet}

{#snippet slopeAdvice()}
  {#if drive.recommending}
    <p class="m-0 text-muted">Finding the lowest slope limit with a route…</p>
  {:else if typeof recommended === 'number'}
    <p class="m-0 text-muted">Recommended limit: <strong class="text-ink">{recommended}°</strong>, the lowest with a route to this target.</p>
  {/if}
  {#if slopeWarning}<p class="m-0 text-sun" role="alert">⚠ {slopeWarning}</p>{/if}
{/snippet}

{#snippet timeAdvice()}
  {#if clear && departureEditable}
    <p class="m-0 text-muted">From then: Sun up for {hoursText(clear.sun)}, Earth in view for {hoursText(clear.earth)}.</p>
  {/if}
  {#if timeWarning}<p class="m-0 text-sun" role="alert">⚠ {timeWarning}</p>{/if}
{/snippet}

{#snippet timeBody()}
  <label class="flex flex-col gap-1 text-muted">Leave at (UTC)
    <input
      type="datetime-local"
      step="3600"
      min={pickerValue(stayStartMs)}
      max={pickerValue(stayStartMs + mission.days * 24 * HOUR_MS)}
      value={pickerValue(departureMs)}
      disabled={!departureEditable}
      onchange={(event) => setDeparture(event.currentTarget)}
      class="h-8 rounded-sm border border-rule bg-panel px-2 text-ink [color-scheme:dark] disabled:opacity-60"
    />
  </label>
  {#if bestWindow && !onRecommended && departureEditable}
    <button type="button" class="self-start text-ink underline hover:text-sun" onclick={useRecommended}>Use the recommended time, {formatUtc(stayStartMs + bestWindow.startIndex * HOUR_MS)}</button>
  {/if}
  {@render timeAdvice()}
{/snippet}

{#snippet timeSummary()}
  {#if departureEditable}
    <p class="m-0 text-muted">{formatUtc(departureMs)}{#if onRecommended}&nbsp;(recommended){/if}</p>
    {#if timeWarning}<p class="m-0 text-sun" role="alert">⚠ {timeWarning}</p>{/if}
  {:else}
    <p class="m-0 text-muted">Drive clock: {formatUtc(departureMs)}</p>
  {/if}
{/snippet}

{#snippet limitsBody()}
  <div class="grid grid-cols-2 gap-2">
    <label class="flex flex-col gap-1 text-muted">Speed, km/h
      <input type="number" min="0.1" max={drive.settings.maxSpeedKmh} step="0.1" bind:value={drive.speedKmh} class="h-8 rounded-sm border border-rule bg-panel px-2 text-ink" />
    </label>
    <label class="flex flex-col gap-1 text-muted">Slope limit, °
      <input type="number" min="1" max={MAX_SLOPE_LIMIT_DEG} step="1" bind:value={drive.slopeLimitDeg} class="h-8 rounded-sm border border-rule bg-panel px-2 text-ink" />
    </label>
  </div>
  {@render slopeAdvice()}
{/snippet}

{#snippet limitsSummary()}
  <p class="m-0 text-muted">{drive.speedKmh} km/h, slopes up to {drive.slopeLimitDeg}°{#if recommended === drive.slopeLimitDeg}&nbsp;(recommended){/if}</p>
  {#if drive.recommending || slopeWarning}{@render slopeAdvice()}{/if}
{/snippet}

{#snippet routeBody()}
  <button
    type="button"
    class="h-9 self-start rounded-sm border px-4 text-sm disabled:opacity-50 {stepNow === 4 ? 'border-ink bg-ink font-semibold text-ground hover:opacity-90' : 'border-rule text-ink hover:bg-rule'}"
    disabled={!drive.target || drive.routing || drive.recommending}
    onclick={() => void drive.commands?.findRoute()}
  >
    {drive.routing ? 'Finding route…' : route ? 'Find the route again' : 'Find route'}
  </button>
  {#if drive.error && !route}
    <p class="m-0 text-sun" role="alert">
      {drive.error}
      {#if /slope limit/i.test(drive.error) && !opened.has(3)}
        <button type="button" class="text-ink underline hover:text-sun" onclick={() => toggle(3)}>Change the slope limit</button>
      {/if}
    </p>
  {/if}
  {#if route}{@render routeSummary()}{/if}
{/snippet}

{#snippet routeSummary()}
  {#if route}
    <p class="m-0 text-muted">{(route.distance_m / 1000).toFixed(2)} km, {formatDuration(route.travel_seconds * 1000)}, steepest {route.max_slope_deg.toFixed(1)}°{#if prediction}, lowest battery <span class={prediction.minFraction < 0.2 ? 'text-sun' : ''}>{formatPercent(prediction.minFraction)}</span>{/if}</p>
  {/if}
{/snippet}

{#if !drive.stay}
<div class="pointer-events-none absolute bottom-3 left-3 top-3 flex w-[340px] flex-col justify-between gap-3" bind:clientHeight={columnHeight}>
  <div class="pointer-events-auto flex flex-col items-start" bind:clientHeight={panelHeight}>
  {#if drive.panelOpen || drive.planning}
    <section class="flex w-full flex-col rounded-sm border border-rule bg-[rgb(10_10_11/0.92)] text-sm text-ink" aria-label="Plan a drive">
      <header class="flex items-center gap-2 px-3 pt-3">
        <h2 class="m-0 text-lg font-bold">Plan a drive</h2>
        <!-- The other thing to do at this site, not part of a drive: what a crew needs to stay here. -->
        <button
          type="button"
          class="ml-auto shrink-0 rounded-sm border border-rule px-2 py-1 text-xs text-ink hover:border-muted"
          title="The outpost on the ground here, over a time-lapse of the stay"
          onclick={() => drive.commands?.enterStay()}
        >See the outpost →</button>
        <button
          type="button"
          class="shrink-0 rounded-sm border border-rule px-2 py-1 text-xs text-muted hover:border-muted hover:text-ink"
          onclick={() => {
            drive.panelOpen = false;
            drive.commands?.closePlanning();
          }}
          title="Fold this panel into a small bar; click the bar to open it again"
        >Minimize</button>
      </header>
      <ol class="m-0 flex list-none flex-col gap-2 p-3">
        {@render step(1, 'Pick a target', 'var(--color-sec-date)', stateOf(1), targetBody, targetSummary)}
        {@render step(2, 'When to leave', 'var(--color-sec-sites)', stateOf(2), timeBody, timeSummary)}
        {@render step(3, 'Speed and slope limit', 'var(--color-sec-site)', stateOf(3), limitsBody, limitsSummary)}
        {@render step(4, 'Find a route', 'var(--color-sec-choice)', stateOf(4), routeBody, routeSummary)}
      </ol>
      <!-- Always in view: the action the steps lead to, and anything stopping it. -->
      <footer class="flex flex-col gap-2 border-t border-rule px-3 py-3" style="border-top-color: var(--color-sec-choice);">
        <button
          type="button"
          class="h-10 rounded-sm border text-sm font-semibold disabled:cursor-not-allowed {route
            ? 'border-ink bg-ink text-ground hover:opacity-90'
            : 'border-rule text-muted'}"
          disabled={!route || drive.routing}
          title={waitingFor || undefined}
          onclick={drivePressed}
        >{drive.routing ? 'Finding the route…' : driveLabel}</button>
        {#if drive.error && route}<p class="m-0 text-sun" role="alert">⚠ {drive.error}</p>{/if}
      </footer>
    </section>
  {:else}
    <button
      type="button"
      class="flex items-center gap-3 rounded-sm border border-rule bg-[rgb(10_10_11/0.92)] px-3 py-2 text-left text-sm text-ink hover:border-muted"
      onclick={() => (drive.panelOpen = true)}
      aria-label="Open Plan a drive"
    >
      <span class="whitespace-nowrap font-bold">Plan a drive</span>
      <span class="whitespace-nowrap text-muted">{route ? (phase === 'driving' ? 'Driving' : 'Route ready') : drive.target ? 'Next: find a route' : 'Next: pick a target'}</span>
      <span aria-hidden="true" class="text-muted">▸</span>
    </button>
  {/if}
  </div>
  {#if map && mapShown}
    <div class="pointer-events-auto">{@render map(mapSize)}</div>
  {:else if map && (drive.panelOpen || drive.planning)}
    <!-- Too little height for the map under the open panel: say so, and fold the panel to make room. -->
    <button
      type="button"
      class="pointer-events-auto self-start rounded-sm border border-rule bg-[rgb(10_10_11/0.92)] px-3 py-2 text-sm text-ink hover:border-muted"
      onclick={() => {
        drive.panelOpen = false;
        drive.commands?.closePlanning();
      }}
    >Show the map <span class="text-muted">(folds this panel)</span></button>
  {/if}
</div>
{/if}

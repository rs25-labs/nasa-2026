<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../../lib/api/client';
  import type { CatalogSite } from '../../lib/api/types';
  import { formatDuration, formatPercent } from '../../lib/format';
  import { greatCircleDistanceM } from '../../lib/geo/polar';
  import { drive, LAPSE_OPTIONS, MAX_TARGET_RANGE_M, STAY_LAPSE_OPTIONS, type CameraKind } from '../../lib/mission/drive.svelte';

  interface Props {
    originLatitudeDeg: number;
    originLongitudeDeg: number;
  }
  let { originLatitudeDeg, originLongitudeDeg }: Props = $props();

  const cameras: { id: CameraKind; label: string; hint: string }[] = [
    { id: 'chase', label: 'Chase', hint: 'Follows behind the rover' },
    { id: 'driver', label: 'Driver', hint: "Driver's seat view ahead" },
    { id: 'mast', label: 'Mast', hint: "The rover's mast camera; drag to pan and tilt" },
    { id: 'orbit', label: 'Orbit', hint: 'Circles the rover; drag to move around it' },
  ];

  let nearby: { id: string; name: string; latitudeDeg: number; longitudeDeg: number; distanceM: number }[] = $state([]);

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

  function drivePressed(): void {
    if (phase === 'driving') drive.paused = true;
    else if (phase === 'paused') drive.paused = false;
    else drive.commands?.start();
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
    <button type="button" class="rounded-sm border border-sun px-2 py-1 font-semibold text-sun hover:bg-rule" title="What a crew needs to stay here, and what to watch" onclick={() => drive.commands?.enterStay()}>Outpost plan</button>
    {/if}
    <span class="text-muted">Esc menu</span>
  </div>
</div>

{#if (drive.planning || drive.panelOpen) && !drive.stay}
  <section class="absolute left-3 top-3 w-[300px] rounded-sm border-2 border-sun bg-[rgb(10_10_11/0.92)] p-3 text-xs text-ink" aria-label="Plan a drive">
    <h2 class="mb-1 text-base font-bold">Plan a Drive</h2>
    <p class="mb-2 text-muted">Click the map to set a target, or pick a site within 8 km.</p>
    {#if nearby.length > 0}
      <ul class="mb-2 max-h-28 overflow-y-auto border-y border-rule">
        {#each nearby as site (site.id)}
          <li>
            <button type="button" class="flex w-full justify-between px-1 py-1 text-left hover:bg-rule" onclick={() => drive.commands?.setTargetFromSite(site.latitudeDeg, site.longitudeDeg)}>
              <span class="truncate">{site.name}</span><span class="text-muted">{(site.distanceM / 1000).toFixed(1)} km</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <p class="mb-2">{drive.target ? `Target: ${drive.target.label}` : 'No target yet.'}{#if targetFar}<span class="text-sun"> More than 8 km away.</span>{/if}</p>
    <div class="mb-2 grid grid-cols-2 gap-2">
      <label class="flex flex-col gap-1 text-muted">Speed, km/h
        <input type="number" min="0.1" max={drive.settings.maxSpeedKmh} step="0.1" bind:value={drive.speedKmh} class="rounded-sm border border-rule bg-panel px-1 py-1 text-ink" />
      </label>
      <label class="flex flex-col gap-1 text-muted">Slope limit, °
        <input type="number" min="1" max="35" step="1" bind:value={drive.slopeLimitDeg} class="rounded-sm border border-rule bg-panel px-1 py-1 text-ink" />
      </label>
    </div>
    <div class="flex gap-2">
      <!-- With a target and no route yet, Find route is the next step, so it takes the action colour. -->
      <button
        type="button"
        class="rounded-sm border px-2 py-1 disabled:opacity-50 {drive.target && !route && !drive.routing
          ? 'border-sun bg-sun font-semibold text-[#231c12] hover:bg-[#f6c672]'
          : 'border-rule hover:bg-rule'}"
        disabled={!drive.target || drive.routing}
        onclick={() => void drive.commands?.findRoute()}
      >
        {drive.routing ? 'Finding route…' : 'Find route'}
      </button>
      <button type="button" class="rounded-sm border border-sun px-2 py-1 text-sun hover:bg-rule disabled:border-rule disabled:text-muted disabled:opacity-50" disabled={!route} onclick={() => drive.commands?.start()}>Drive</button>
    </div>
    {#if drive.error}<p class="mt-2 text-sun" role="alert">{drive.error}</p>{/if}
    {#if route}
      <dl class="mt-2 grid grid-cols-[110px_1fr] gap-x-2 border-t border-rule pt-2">
        <dt class="text-muted">Route</dt><dd>{(route.distance_m / 1000).toFixed(2)} km, {formatDuration(route.travel_seconds * 1000)}</dd>
        <dt class="text-muted">Steepest</dt><dd>{route.max_slope_deg.toFixed(1)}°</dd>
        {#if prediction}
          <dt class="text-muted">Lowest battery</dt>
          <dd class={prediction.minFraction < 0.2 ? 'text-sun' : ''}>
            {formatPercent(prediction.minFraction)} · {prediction.minKwh.toFixed(2)} kWh{#if prediction.emptyAtSeconds !== null} · flat after {formatDuration(prediction.emptyAtSeconds * 1000)}{/if}
          </dd>
        {/if}
      </dl>
    {/if}
  </section>
{/if}

<script lang="ts">
  import { batterySeries, okResult } from '../../lib/mission/derive';
  import { useSession } from '../../lib/mission/session';
  import { sampleCount, type MissionSite } from '../../lib/mission/store.svelte';
  import { siteLabel } from '../../lib/mission/labels';
  import { dayTicks } from './axis';
  import { drawBlock, readPalette, type BlockData } from './draw';
  import { BLOCK_HEIGHT, BLOCK_PAD, LABEL_WIDTH } from './layout';
  import Busy from '../Busy.svelte';

  let { site, selected }: { site: MissionSite; selected: boolean } = $props();

  const { mission, actions, estimates } = useSession();

  let canvas: HTMLCanvasElement | undefined = $state();
  let width = $state(0);

  const label = $derived(siteLabel(site));
  const result = $derived(estimates.bySiteId[site.id]);
  const ok = $derived(okResult(result));
  const failure = $derived(result && !result.ok ? result.error : null);
  const fresh = $derived(ok !== null && ok.series.sun.fraction.length === sampleCount(mission.days));
  const loading = $derived(estimates.status === 'loading');
  const unavailable = $derived(!fresh && failure === null && estimates.status === 'error' ? estimates.error : null);
  const message = $derived(failure ?? unavailable);

  const data = $derived.by((): BlockData | null => {
    if (!ok || !fresh) return null;
    const battery = batterySeries(ok.series.sun.fraction, mission.power);
    return {
      sunFraction: ok.series.sun.fraction,
      earthFraction: ok.series.earth.fraction,
      events: ok.events,
      socKwh: battery.socKwh,
      capacityKwh: mission.power.batteryKwh,
      startMs: Date.parse(mission.startUtc),
      dayMarkIndexes: dayTicks(mission.startUtc, mission.days).map((tick) => tick.index),
    };
  });

  $effect(() => {
    if (!canvas || width <= 0 || message !== null) return;
    drawBlock(canvas, width, BLOCK_HEIGHT, readPalette(), data);
  });

  function measure(node: HTMLElement): () => void {
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) width = entry.contentRect.width;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }
</script>

<div
  class="flex border-b border-rule border-l-2 {selected ? 'border-l-ink' : 'border-l-transparent'}"
  style="height: {BLOCK_HEIGHT + 1}px;"
>
  <button
    type="button"
    onclick={() => actions.selectSite(site.id)}
    aria-pressed={selected}
    title={site.name}
    class="flex shrink-0 items-center px-2 text-left text-xs hover:bg-ground {selected ? 'font-semibold' : ''}"
    style="width: {LABEL_WIDTH - 2}px;"
  >
    <span class="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
      <span class="shrink-0">{label.short}{#if selected}<span class="sr-only"> (selected)</span>{/if}</span>
      {#if label.long}<span class="min-w-0 truncate font-normal text-muted">{label.long}</span>{/if}
    </span>
  </button>
  <div class="relative min-w-0 flex-1" style="height: {BLOCK_HEIGHT}px;" {@attach measure}>
    {#if message !== null}
      <p class="absolute inset-0 flex items-center text-xs text-muted">{message}</p>
    {:else}
      <canvas
        bind:this={canvas}
        aria-hidden="true"
        class="absolute left-0 top-0 block {loading && data ? 'opacity-60' : ''}"
        style="width: {width}px; height: {BLOCK_HEIGHT}px;"
      ></canvas>
      {#if !data}
        {#if loading}
          <Busy text="Calculating Sun, Earth and battery…" class="absolute left-2" style="top: {BLOCK_PAD}px;" />
        {:else}
          <span class="absolute left-1 text-xs text-muted" style="top: {BLOCK_PAD}px;">…</span>
        {/if}
      {/if}
    {/if}
  </div>
</div>

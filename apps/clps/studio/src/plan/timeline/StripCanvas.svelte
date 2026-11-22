<script lang="ts">
  import { batterySeries, okResult } from '../../lib/mission/derive';
  import { useSession } from '../../lib/mission/session';
  import { sampleCount, type MissionSite } from '../../lib/mission/store.svelte';
  import { dayTicks } from './axis';
  import { blockHeight, DEFAULT_ROWS, drawBlock, readPalette, type BlockData, type BlockRows } from './draw';
  import { BLOCK_PAD } from './layout';
  import Busy from '../Busy.svelte';

  // One site's Sun, Earth and battery rows across the stay, as wide as the space it is given.
  let { site, rows = DEFAULT_ROWS }: { site: MissionSite; rows?: BlockRows } = $props();

  const { mission, estimates } = useSession();

  let canvas: HTMLCanvasElement | undefined = $state();
  let width = $state(0);

  const height = $derived(blockHeight(rows));
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
    drawBlock(canvas, width, height, readPalette(), data, rows);
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

<div class="relative min-w-0 flex-1" style="height: {height}px;" {@attach measure}>
  {#if message !== null}
    <p class="absolute inset-0 m-0 flex items-center text-xs text-muted">{message}</p>
  {:else}
    <canvas
      bind:this={canvas}
      aria-hidden="true"
      class="absolute left-0 top-0 block {loading && data ? 'opacity-60' : ''}"
      style="width: {width}px; height: {height}px;"
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

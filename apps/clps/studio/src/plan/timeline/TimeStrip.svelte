<script lang="ts">
  import { formatUtc } from '../../lib/format';
  import { clockTimeMs } from '../../lib/mission/derive';
  import { useSession } from '../../lib/mission/session';
  import { MAX_SITES, sampleCount } from '../../lib/mission/store.svelte';
  import { dayTicks, labelStep } from './axis';
  import { HEADER_HEIGHT, LABEL_WIDTH, TIME_LABEL_HEIGHT } from './layout';
  import PowerInputs from './PowerInputs.svelte';
  import SiteBlock from './SiteBlock.svelte';
  import Transport from './Transport.svelte';

  let { class: className = '', addHint = true }: { class?: string; addHint?: boolean } = $props();

  const { mission, actions, clock } = useSession();

  let axisWidth = $state(0);
  let gutter = $state(0);
  let scroller: HTMLDivElement | undefined = $state();
  let dragging = false;

  const lastIndex = $derived(sampleCount(mission.days) - 1);
  const fraction = $derived(lastIndex > 0 ? mission.clockIndex / lastIndex : 0);
  const percent = $derived(fraction * 100);
  const timeText = $derived(formatUtc(clockTimeMs(mission.startUtc, mission.clockIndex)));
  const ticks = $derived(dayTicks(mission.startUtc, mission.days));
  const step = $derived(labelStep(axisWidth, mission.days));

  const LABEL_WIDTH_PX = 46;
  const labelledTicks = $derived(
    ticks.filter(
      (tick, position) =>
        position % step === 0 && (tick.index / lastIndex) * axisWidth + LABEL_WIDTH_PX <= axisWidth,
    ),
  );

  function observeScroller(node: HTMLElement): () => void {
    const observer = new ResizeObserver(() => {
      gutter = node.offsetWidth - node.clientWidth;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }

  function observeAxis(node: HTMLElement): () => void {
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) axisWidth = entry.contentRect.width;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }

  function indexFromPointer(event: PointerEvent): number {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return ((event.clientX - rect.left) / rect.width) * lastIndex;
  }

  function onpointerdown(event: PointerEvent): void {
    if (event.button !== 0) return;
    dragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    clock.pause();
    actions.setClock(indexFromPointer(event));
  }

  function onpointermove(event: PointerEvent): void {
    if (dragging) actions.setClock(indexFromPointer(event));
  }

  function onpointerup(event: PointerEvent): void {
    dragging = false;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  }

  function onkeydown(event: KeyboardEvent): void {
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

  function onwheel(event: WheelEvent): void {
    if (scroller) scroller.scrollTop += event.deltaY;
  }
</script>

<section aria-label="Time strip" class="flex min-h-0 min-w-0 flex-col bg-panel {className}">
  <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-rule px-3 py-1">
    <Transport />
    <PowerInputs />
  </div>

  <div class="relative flex min-h-0 flex-1 flex-col">
    <div
      class="relative shrink-0 border-b border-rule"
      style="height: {HEADER_HEIGHT}px; padding-left: {LABEL_WIDTH}px; padding-right: {gutter}px;"
    >
      <span
        class="absolute left-2 bottom-1 whitespace-nowrap text-[11px] leading-[12px]"
        title="Rows in each block, top to bottom: Sun, Earth, battery charge"
      ><span class="text-sun">Sun</span> <span class="text-earth">Earth</span> <span class="text-ink">Battery</span></span>
      <div class="relative h-full" {@attach observeAxis}>
        {#each ticks as tick (tick.index)}
          <span
            aria-hidden="true"
            class="absolute bottom-0 w-px bg-muted"
            style="left: {(tick.index / lastIndex) * 100}%; height: 6px;"
          ></span>
        {/each}
        {#each labelledTicks as tick (tick.index)}
          <span
            class="absolute whitespace-nowrap pl-1 text-[12px] leading-[14px] text-muted"
            style="left: {(tick.index / lastIndex) * 100}%; bottom: 2px;"
          >{tick.label}</span>
        {/each}
      </div>
    </div>

    <div class="plan-scroll min-h-0 flex-1 overflow-y-auto" bind:this={scroller} {@attach observeScroller}>
      {#each mission.sites as site (site.id)}
        <SiteBlock {site} selected={site.id === mission.selectedSiteId} />
      {:else}
        <p class="px-3 py-2 text-xs text-muted">No sites.</p>
      {/each}
      {#if addHint && mission.sites.length > 0 && mission.sites.length < MAX_SITES}
        <!-- Starts right of the name column, clear of the clock line at the start of the stay; drawn above the
             clock so the line passes behind it during playback, and ignores the pointer so scrubbing still works. -->
        <p class="pointer-events-none relative z-10 m-0 py-3 pr-3 text-xs text-muted" style="padding-left: {LABEL_WIDTH + 12}px;">
          <span class="bg-panel">Each site you add gets its own Sun, Earth and battery rows here, on the same clock.</span>
        </p>
      {/if}
    </div>

    <!-- The one clock: a slider over the shared axis, above every block. -->
    <div
      role="slider"
      tabindex="0"
      aria-label="Mission clock"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={lastIndex}
      aria-valuenow={Math.round(mission.clockIndex * 100) / 100}
      aria-valuetext={timeText}
      class="absolute top-0 bottom-0 cursor-ew-resize touch-none select-none focus-visible:outline-offset-[-2px]"
      style="left: {LABEL_WIDTH}px; right: {gutter}px;"
      {onpointerdown}
      {onpointermove}
      {onpointerup}
      onpointercancel={onpointerup}
      {onkeydown}
      {onwheel}
    >
      <span
        aria-hidden="true"
        class="pointer-events-none absolute top-0 whitespace-nowrap bg-ink px-1 text-[12px] leading-[14px] text-ground"
        style="left: {percent}%; transform: translateX(-{percent}%); height: {TIME_LABEL_HEIGHT - 2}px;"
      >{timeText}</span>
      <span
        aria-hidden="true"
        class="pointer-events-none absolute bottom-0 w-px bg-ink"
        style="left: calc({percent}% - {fraction}px); top: {TIME_LABEL_HEIGHT - 2}px;"
      ></span>
    </div>
  </div>
</section>

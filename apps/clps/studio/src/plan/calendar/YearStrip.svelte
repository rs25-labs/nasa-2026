<script lang="ts">
  import { formatDate, formatEventUtc } from '../../lib/format';
  import { actions, END_MS, FIRST_START_MS, MAX_DAYS, MIN_DAYS, mission } from '../../lib/mission/store.svelte';
  import { daysInYear, yearData, yearStartMs, yearView } from '../../lib/mission/year.svelte';
  import Busy from '../Busy.svelte';
  import EstimateStatus from '../EstimateStatus.svelte';
  import { drawYear, MONTH_NAMES, monthStartDays, YEAR_HEIGHT, MONTH_ROW, STRIP_ROW } from './draw';
  import { readPalette } from '../timeline/draw';

  let { class: className = '' }: { class?: string } = $props();

  const DAY_MS = 86_400_000;
  const HOUR_MS = 3_600_000;
  const EDGE_PX = 8;

  interface Drag {
    mode: 'move' | 'resize';
    pointerStartX: number;
    originStartMs: number;
    originDays: number;
    startMs: number;
    days: number;
  }

  let canvas: HTMLCanvasElement | undefined = $state();
  let width = $state(0);
  let drag = $state<Drag | null>(null);
  let hoverDay = $state<number | null>(null);

  const year = $derived(yearView.year);
  const dayCount = $derived(daysInYear(year));
  const yearStart = $derived(yearStartMs(year));
  const pxPerDay = $derived(width > 0 ? width / dayCount : 0);
  const months = $derived(monthStartDays(year));

  const shownStartMs = $derived(drag ? drag.startMs : Date.parse(mission.startUtc));
  const shownDays = $derived(drag ? drag.days : mission.days);
  const startDay = $derived((shownStartMs - yearStart) / DAY_MS);
  const endDay = $derived(startDay + shownDays);
  const bracketVisible = $derived(endDay > 0 && startDay < dayCount);
  const bracketLeft = $derived(Math.max(0, startDay) / dayCount);
  const bracketRight = $derived(Math.min(dayCount, endDay) / dayCount);
  const slipDays = $derived(drag ? Math.round((drag.startMs - drag.originStartMs) / DAY_MS) : 0);

  const dragText = $derived.by(() => {
    if (!drag) return '';
    if (drag.mode === 'resize') return `Stay ${drag.days} d`;
    const slip = slipDays === 0 ? '0 d' : `${slipDays > 0 ? '+' : '−'}${Math.abs(slipDays)} d`;
    return `${slip} · ${formatEventUtc(drag.startMs)}`;
  });

  const hoverText = $derived.by(() => {
    if (hoverDay === null || !yearData.sun.length) return undefined;
    const sun = yearData.sun[hoverDay];
    const earth = yearData.earth[hoverDay];
    if (sun === undefined || earth === undefined || Number.isNaN(sun)) return undefined;
    const date = new Date(yearStart + hoverDay * DAY_MS);
    return `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]} ${year}: Sun ${Math.round(sun * 100)}%, Earth ${Math.round(earth * 100)}% (daily mean). Click to start the stay on this day.`;
  });

  const sliderText = $derived(
    `Landing ${formatEventUtc(shownStartMs)}, stay ${shownDays} ${shownDays === 1 ? 'day' : 'days'}`,
  );

  $effect(() => {
    if (!canvas || width <= 0) return;
    drawYear(canvas, width, readPalette(), {
      year,
      sun: yearData.siteId ? yearData.sun : [],
      earth: yearData.siteId ? yearData.earth : [],
    });
  });

  function measure(node: HTMLElement): () => void {
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) width = entry.contentRect.width;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }

  function clampStart(ms: number, days: number): number {
    return Math.min(END_MS - days * DAY_MS, Math.max(FIRST_START_MS, ms));
  }

  function commit(startMs: number, days: number): void {
    const nextDays = Math.min(MAX_DAYS, Math.max(MIN_DAYS, days));
    actions.setWindow(new Date(clampStart(startMs, nextDays)).toISOString(), nextDays);
  }

  function beginDrag(event: PointerEvent, mode: Drag['mode']): void {
    if (event.button !== 0 || pxPerDay <= 0) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const originStartMs = Date.parse(mission.startUtc);
    drag = {
      mode,
      pointerStartX: event.clientX,
      originStartMs,
      originDays: mission.days,
      startMs: originStartMs,
      days: mission.days,
    };
  }

  function moveDrag(event: PointerEvent): void {
    if (!drag || pxPerDay <= 0) return;
    const delta = Math.round((event.clientX - drag.pointerStartX) / pxPerDay);
    if (drag.mode === 'move') {
      drag.startMs = clampStart(drag.originStartMs + delta * DAY_MS, drag.days);
    } else {
      const longest = Math.min(MAX_DAYS, Math.floor((END_MS - drag.originStartMs) / DAY_MS));
      drag.days = Math.min(longest, Math.max(MIN_DAYS, drag.originDays + delta));
    }
  }

  function endDrag(event: PointerEvent): void {
    const finished = drag;
    drag = null;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    if (!finished || event.type === 'pointercancel') return;
    if (finished.startMs !== finished.originStartMs || finished.days !== finished.originDays) {
      commit(finished.startMs, finished.days);
    }
  }

  function onSliderKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const amount = direction * (event.shiftKey ? 7 : 1);
    if (event.altKey) commit(Date.parse(mission.startUtc), mission.days + amount);
    else commit(Date.parse(mission.startUtc) + amount * DAY_MS, mission.days);
  }

  function dayFromEvent(event: MouseEvent): number | null {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.width <= 0) return null;
    const day = Math.floor(((event.clientX - rect.left) / rect.width) * dayCount);
    return Math.min(dayCount - 1, Math.max(0, day));
  }

  function onStripClick(event: MouseEvent): void {
    const day = dayFromEvent(event);
    if (day === null) return;
    const hour = new Date(mission.startUtc).getUTCHours();
    commit(yearStart + day * DAY_MS + hour * HOUR_MS, mission.days);
  }

  function onStripMove(event: PointerEvent): void {
    hoverDay = drag ? null : dayFromEvent(event);
  }

  const landingYear = $derived(new Date(mission.startUtc).getUTCFullYear());
  const outsideSide = $derived(!bracketVisible ? (endDay <= 0 ? 'left' : 'right') : null);

  function jumpToLanding(): void {
    yearView.year = landingYear;
  }

</script>

<section
  aria-label="Landing window"
  class="flex min-w-0 flex-col bg-panel px-5 pb-2 pt-3 {className}"
>
  <div class="flex min-w-0 items-stretch gap-3" style="height: {YEAR_HEIGHT + 2}px;">
  <div class="flex shrink-0 flex-col text-[14px]" style="width: 4rem; padding-top: 2px;">
    <div style="height: {MONTH_ROW}px;"></div>
    <div class="flex items-center text-sun" style="height: {STRIP_ROW + 1}px;">Sun</div>
    <div class="flex items-center text-earth" style="height: {STRIP_ROW}px;">Earth</div>
  </div>

  <div class="relative min-w-0 flex-1" style="padding-top: 2px;" data-tour="year-strip">
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="relative cursor-pointer"
      style="height: {YEAR_HEIGHT}px;"
      title={hoverText}
      {@attach measure}
      onclick={onStripClick}
      onpointermove={onStripMove}
      onpointerleave={() => (hoverDay = null)}
    >
      {#each months as month, index (index)}
        <span
          class="pointer-events-none absolute whitespace-nowrap pl-1 text-xs leading-[14px] text-muted"
          style="left: {(month / dayCount) * 100}%; top: 0;"
        >{MONTH_NAMES[index]}</span>
      {/each}
      <canvas
        bind:this={canvas}
        aria-hidden="true"
        class="pointer-events-none absolute left-0 top-0 block"
        style="width: {width}px; height: {YEAR_HEIGHT}px;"
      ></canvas>

      {#if yearData.status === 'error'}
        <p class="pointer-events-none absolute inset-x-0 flex items-center bg-panel/80 px-1 text-xs text-sun" style="top: {MONTH_ROW}px; height: {STRIP_ROW * 2}px;">
          {yearData.error ?? 'The year could not be calculated.'}
        </p>
      {/if}

      {#if yearData.status === 'loading' && yearData.year === year && yearData.loadedDays < dayCount}
        <!-- Over the days not calculated yet, so the empty part of the strip says why it is empty. -->
        <div
          class="pointer-events-none absolute right-0 flex items-center bg-panel/80 px-2"
          style="left: {(yearData.loadedDays / dayCount) * 100}%; top: {MONTH_ROW}px; height: {STRIP_ROW * 2}px;"
        >
          <Busy text="Calculating {year}: {yearData.loadedDays} of {dayCount} days" class="truncate" />
        </div>
      {/if}

      {#if outsideSide}
        <button
          type="button"
          class="absolute z-10 flex items-center gap-1 whitespace-nowrap border border-ink bg-panel px-1.5 text-[12px] leading-[16px] text-ink hover:bg-rule"
          style="top: {MONTH_ROW + 12}px; {outsideSide}: 0;"
          onclick={(event) => {
            event.stopPropagation();
            jumpToLanding();
          }}
        >
          {#if outsideSide === 'left'}<svg aria-hidden="true" viewBox="0 0 6 8" class="h-2 w-1.5"><path d="M5 0L1 4l4 4" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>{/if}
          Landing {formatDate(Date.parse(mission.startUtc))}
          {#if outsideSide === 'right'}<svg aria-hidden="true" viewBox="0 0 6 8" class="h-2 w-1.5"><path d="M1 0l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>{/if}
        </button>
      {/if}

      {#if bracketVisible}
        {#if drag}
          <span
            aria-hidden="true"
            class="pointer-events-none absolute z-10 whitespace-nowrap bg-ink px-1 text-[12px] leading-[14px] text-ground"
            style="top: 0; left: {bracketLeft * 100}%; transform: translateX(-{bracketLeft * 100}%); height: {MONTH_ROW}px;"
          >{dragText}</span>
        {/if}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          role="slider"
          tabindex="0"
          aria-label="Landing window"
          aria-orientation="horizontal"
          aria-valuemin={1}
          aria-valuemax={dayCount}
          aria-valuenow={Math.min(dayCount, Math.max(1, Math.floor(startDay) + 1))}
          aria-valuetext={sliderText}
          class="absolute box-border cursor-grab touch-none select-none border border-ink bg-ink/15 {drag ? 'cursor-grabbing' : ''}"
          style="left: {bracketLeft * 100}%; width: {(bracketRight - bracketLeft) * 100}%; top: {MONTH_ROW}px; height: {STRIP_ROW * 2 + 1}px; min-width: 3px;"
          onclick={(event) => event.stopPropagation()}
          onpointerdown={(event) => beginDrag(event, 'move')}
          onpointermove={moveDrag}
          onpointerup={endDrag}
          onpointercancel={endDrag}
          onkeydown={onSliderKeydown}
        >
          <span class="sr-only">Arrow keys move the landing by a day, Shift by a week, Alt changes the stay.</span>
        </div>
        <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
        <div
          aria-hidden="true"
          class="absolute z-10 cursor-ew-resize touch-none"
          style="left: calc({bracketRight * 100}% - {EDGE_PX / 2}px); width: {EDGE_PX}px; top: {MONTH_ROW}px; height: {STRIP_ROW * 2 + 1}px;"
          onclick={(event) => event.stopPropagation()}
          onpointerdown={(event) => beginDrag(event, 'resize')}
          onpointermove={moveDrag}
          onpointerup={endDrag}
          onpointercancel={endDrag}
        >
          <span class="absolute inset-y-0 right-[3px] w-[2px] bg-ink"></span>
        </div>
      {/if}
    </div>
  </div>

  </div>
  <EstimateStatus />
</section>

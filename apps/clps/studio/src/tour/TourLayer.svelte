<script lang="ts">
  import { onMount } from 'svelte';
  import { STEPS, stopTour, tour } from './tour.svelte';

  // Spotlight and tooltip for the current step. It never takes the pointer, so the app stays usable underneath.
  const GAP = 14;
  const MARGIN = 12;
  const CARD_WIDTH = 340;
  const RING_PAD = 4;

  interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
  }

  const step = $derived(STEPS[tour.index]);
  let target = $state<Box | null>(null);
  let cardHeight = $state(0);
  let viewport = $state({ width: window.innerWidth, height: window.innerHeight });

  function find(): Box | null {
    for (const selector of step?.targets ?? []) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }
    return null;
  }

  // Follows the target every frame: panels resize, load and move while steps run.
  onMount(() => {
    let frame = 0;
    const follow = (): void => {
      const next = find();
      const same =
        next === target ||
        (next !== null &&
          target !== null &&
          Math.abs(next.left - target.left) < 0.5 &&
          Math.abs(next.top - target.top) < 0.5 &&
          Math.abs(next.width - target.width) < 0.5 &&
          Math.abs(next.height - target.height) < 0.5);
      if (!same) target = next;
      if (viewport.width !== window.innerWidth || viewport.height !== window.innerHeight) {
        viewport = { width: window.innerWidth, height: window.innerHeight };
      }
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  });

  // The Plan page scrolls, so bring each step's target into view once when the step opens.
  $effect(() => {
    const selectors = step?.targets ?? [];
    const timer = setTimeout(() => {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          return;
        }
      }
    }, 300);
    return () => clearTimeout(timer);
  });

  /** The ring around the target, kept inside the window so all four edges show even for full-width panels. */
  const ring = $derived.by(() => {
    if (!target) return null;
    const left = Math.max(2, target.left - RING_PAD);
    const top = Math.max(2, target.top - RING_PAD);
    const right = Math.min(viewport.width - 2, target.left + target.width + RING_PAD);
    const bottom = Math.min(viewport.height - 2, target.top + target.height + RING_PAD);
    return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  });

  /** Below the target if it fits, else above, else beside it; always inside the window. */
  const card = $derived.by(() => {
    const width = Math.min(CARD_WIDTH, viewport.width - MARGIN * 2);
    const height = cardHeight || 160;
    const clampX = (x: number): number => Math.min(Math.max(MARGIN, x), viewport.width - width - MARGIN);
    const clampY = (y: number): number => Math.min(Math.max(MARGIN, y), viewport.height - height - MARGIN);
    if (!target) return { left: clampX((viewport.width - width) / 2), top: clampY(viewport.height * 0.28), width };
    const below = target.top + target.height + GAP;
    const above = target.top - GAP - height;
    if (below + height <= viewport.height - MARGIN) return { left: clampX(target.left), top: below, width };
    if (above >= MARGIN) return { left: clampX(target.left), top: above, width };
    const right = target.left + target.width + GAP;
    if (right + width <= viewport.width - MARGIN) return { left: right, top: clampY(target.top), width };
    return { left: clampX(target.left - GAP - width), top: clampY(target.top), width };
  });
</script>

{#if step}
  <div class="pointer-events-none fixed inset-0 z-50" aria-live="polite">
    <!-- Tour colours (beige cards and ring, black text) appear nowhere else in the app, so tour callouts never read as app UI. -->
    {#if ring}
      <div
        class="absolute rounded-md border-[3px] border-[#efe4c8] shadow-[0_0_0_9999px_rgb(0_0_0/0.5),0_0_16px_3px_rgb(239_228_200/0.6)] transition-all duration-300 motion-reduce:transition-none"
        style="left: {ring.left}px; top: {ring.top}px; width: {ring.width}px; height: {ring.height}px;"
      ></div>
    {:else}
      <div class="absolute inset-0 bg-black/50"></div>
    {/if}
    <div
      bind:clientHeight={cardHeight}
      role="dialog"
      aria-label="Walkthrough step {tour.index + 1}: {step.title}"
      class="absolute rounded-md border-2 border-[#b9a77a] bg-[#f5efe0] p-3.5 text-[#1a1a1a] shadow-[0_8px_30px_rgb(0_0_0/0.5)] transition-all duration-300 motion-reduce:transition-none"
      style="left: {card.left}px; top: {card.top}px; width: {card.width}px;"
    >
      <p class="m-0 text-[11px] font-semibold text-[#4a4a4a]">Tour, step {tour.index + 1} of {STEPS.length}</p>
      <h2 class="m-0 mt-0.5 text-base font-bold text-[#1a1a1a]">{step.title}</h2>
      <p class="m-0 mt-1.5 text-sm leading-snug text-[#1a1a1a]">{step.text}</p>
      {#if tour.busy && step.enter}
        <p class="m-0 mt-2 flex items-center gap-1.5 text-xs text-[#1a1a1a]">
          <span aria-hidden="true" class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#d8cba7] border-t-[#1a1a1a] motion-reduce:animate-none"></span>
          Getting this ready…
        </p>
      {/if}
      {#if tour.index === STEPS.length - 1}
        <button
          type="button"
          onclick={stopTour}
          class="pointer-events-auto mt-3 w-full rounded-md bg-[#1a1a1a] px-4 py-2 text-sm font-semibold text-[#f5efe0] hover:bg-[#333] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a1a1a]"
        >End Tour</button>
      {/if}
    </div>
  </div>
{/if}

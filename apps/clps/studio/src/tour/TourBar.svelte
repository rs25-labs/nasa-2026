<script lang="ts">
  import { onMount } from 'svelte';
  import { nextStep, previousStep, stepProgress, STEPS, stopTour, togglePlay, tour } from './tour.svelte';

  // The walkthrough's fixed bottom bar. It sits in the page layout, so it never covers the app's own controls.
  const step = $derived(STEPS[tour.index]);
  const last = $derived(tour.index >= STEPS.length - 1);
  let progress = $state(0);

  onMount(() => {
    let frame = 0;
    const update = (now: number): void => {
      progress = stepProgress(now);
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  });

  const arrow =
    'flex h-9 w-9 items-center justify-center rounded-md border border-[#1a1a1a] text-[#1a1a1a] hover:bg-[#e8dcc0] disabled:opacity-30 disabled:hover:bg-transparent';
</script>

<nav aria-label="Demo walkthrough" class="relative z-[60] flex h-14 shrink-0 items-center gap-3 border-t-2 border-[#b9a77a] bg-[#f5efe0] px-4 text-[#1a1a1a]">
  <button
    type="button"
    onclick={stopTour}
    class="flex h-9 items-center gap-2 rounded-md border border-[#1a1a1a] px-3 text-sm font-semibold text-[#1a1a1a] hover:bg-[#e8dcc0]"
  >
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" fill="currentColor" /></svg>
    End Tour
  </button>

  <div class="mx-auto flex min-w-0 items-center gap-3">
    <button type="button" class={arrow} onclick={previousStep} disabled={tour.index === 0} aria-label="Previous step">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M8 1 3 6l5 5" fill="none" stroke="currentColor" stroke-width="2" /></svg>
    </button>
    <div class="w-[26rem] max-w-[50vw] min-w-0 text-center">
      <p class="m-0 text-[11px] text-[#4a4a4a]">Demo walkthrough, step {tour.index + 1} of {STEPS.length}</p>
      <p class="m-0 truncate text-sm font-semibold text-[#1a1a1a]">{step?.title ?? ''}</p>
      <div class="mt-1 h-[3px] w-full bg-[#e2d6b8]" aria-hidden="true">
        <div class="h-full bg-[#1a1a1a]" style="width: {progress * 100}%;"></div>
      </div>
    </div>
    <button type="button" class={arrow} onclick={nextStep} disabled={last} aria-label="Next step">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m4 1 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" /></svg>
    </button>
  </div>

  <button
    type="button"
    onclick={togglePlay}
    aria-pressed={tour.playing}
    class="flex h-9 min-w-24 items-center justify-center gap-2 rounded-md bg-[#1a1a1a] px-4 text-sm font-semibold text-[#f5efe0] hover:bg-[#333]"
  >
    {#if tour.playing}
      <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><rect width="3" height="12" fill="currentColor" /><rect x="7" width="3" height="12" fill="currentColor" /></svg>
      Pause
    {:else}
      <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><path d="M0 0v12l10-6z" fill="currentColor" /></svg>
      {last && progress >= 1 ? 'Replay' : 'Play'}
    {/if}
  </button>
</nav>

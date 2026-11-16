<script lang="ts">
  import { onMount } from 'svelte';
  import { MoonGlobe, risingPose } from './moonGlobe';
  import { startTour } from '../tour/tour.svelte';

  let canvas: HTMLCanvasElement | undefined = $state();
  let webgl = $state(true);

  onMount(() => {
    if (!canvas) return;
    let globe: MoonGlobe;
    try {
      globe = new MoonGlobe(canvas, `${import.meta.env.BASE_URL}moon/lroc_color_2k.jpg`);
    } catch {
      webgl = false;
      return;
    }
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let start: number | null = null;
    let seconds = still ? 2 : 0;
    const render = (now: number): void => {
      if (start === null) start = now;
      if (!still) seconds = (now - start) / 1000;
      globe.draw(risingPose(seconds, window.innerWidth <= 800));
      if (seconds < 2) frame = requestAnimationFrame(render);
    };
    const redraw = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(render);
    };
    globe.onTexture = redraw;
    window.addEventListener('resize', redraw);
    redraw();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', redraw);
    };
  });
</script>

<section aria-labelledby="landing-title" class="relative isolate h-full min-h-[34rem] overflow-hidden bg-[#04070c]">
  <div class="stars pointer-events-none absolute inset-0 -z-10" aria-hidden="true"></div>
  {#if webgl}
    <canvas bind:this={canvas} class="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true"></canvas>
  {:else}
    <div class="fallback pointer-events-none absolute rounded-full" aria-hidden="true"></div>
  {/if}

  <div class="relative z-10 ml-[max(6vw,16px)] w-[min(38rem,calc(100%-32px))] pt-[clamp(3rem,12vh,7.5rem)] [text-shadow:0_2px_24px_#000]">
    <h1 id="landing-title" class="text-[clamp(3rem,7vw,7rem)] leading-[0.95] font-semibold tracking-[-0.06em]">
      Plan a mission<br />to the Moon.
    </h1>
    <p class="mt-6 max-w-[37ch] text-base leading-relaxed text-[#dedfd8]">
      Choose a landing site, follow the sunlight and chart a rover drive across the lunar surface.
    </p>
    <div class="mt-8 flex flex-wrap gap-3">
      <button
        type="button"
        onclick={() => void startTour()}
        class="inline-flex min-h-11 items-center rounded-sm border border-[#798080] bg-[#10151ac9] px-5 text-sm font-semibold text-ink hover:border-ink"
        >Demo Walkthrough</button
      >
      <a
        href="#/plan"
        class="inline-flex min-h-11 items-center rounded-sm bg-sun px-5 text-sm font-semibold text-[#231c12] [text-shadow:none] hover:bg-[#f6c672]"
        >Plan a Mission</a
      >
    </div>
  </div>

  <p class="absolute right-[6vw] bottom-5 z-10 text-[11px] text-[#b0bccb]">
    <a href="https://svs.gsfc.nasa.gov/4720/" target="_blank" rel="noopener noreferrer" class="underline-offset-2 hover:underline"
      >Moon imagery: NASA SVS</a
    >
  </p>
</section>

<style>
  .stars {
    background-image:
      radial-gradient(1px 1px at 12% 22%, #e6e6e6 50%, transparent),
      radial-gradient(1px 1px at 78% 16%, #ccc 50%, transparent),
      radial-gradient(1px 1px at 44% 58%, #ccc 50%, transparent),
      radial-gradient(1px 1px at 65% 43%, #aaa 50%, transparent);
    background-size:
      370px 310px,
      490px 450px,
      620px 510px,
      740px 630px;
    opacity: 0.5;
  }

  .fallback {
    width: 110vw;
    height: 110vw;
    left: 15%;
    top: 32%;
    background: radial-gradient(circle at 32% 24%, #b2b6ba, #535b63 38%, #111922 65%, #020408 80%);
  }
</style>

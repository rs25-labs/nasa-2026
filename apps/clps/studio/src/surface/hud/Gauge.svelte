<script lang="ts">
  export type Tone = 'good' | 'warn' | 'bad' | 'info';

  interface Props {
    label: string;
    value: string;
    detail?: string;
    /** Filled share of the bar, 0 to 1. */
    fraction: number;
    tone: Tone;
    flag?: string;
  }

  const { label, value, detail = '', fraction, tone, flag = '' }: Props = $props();

  const SEGMENTS = 16;
  const colours: Record<Tone, string> = { good: '#3ddc84', warn: '#ff9f1a', bad: '#ff3b30', info: '#6ea8e0' };
  const colour = $derived(colours[tone]);
  const filled = $derived(Math.round(Math.max(0, Math.min(1, fraction)) * SEGMENTS));
</script>

<div class="py-[5px]">
  <div class="flex items-baseline justify-between gap-2">
    <span class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</span>
    {#if flag}<span class="hud-flag px-1 text-[11px] font-bold uppercase tracking-[0.1em] text-black" style="background: {colour}">{flag}</span>{/if}
  </div>
  <div class="mt-[2px] flex items-baseline justify-between gap-3">
    <span class="shrink-0 whitespace-nowrap font-mono text-[22px] font-bold leading-[28px]" style="color: {colour}">{value}</span>
    <span class="text-right text-[11px] leading-[14px] text-ink">{detail}</span>
  </div>
  <div class="mt-[5px] flex gap-[3px]" aria-hidden="true">
    {#each Array(SEGMENTS) as _, index (index)}
      <span class="h-[8px] flex-1" style="background: {index < filled ? colour : 'rgb(255 255 255 / 0.12)'}"></span>
    {/each}
  </div>
</div>

<style>
  .hud-flag {
    animation: hud-blink 1s steps(2, start) infinite;
  }
  @keyframes hud-blink {
    to {
      visibility: hidden;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .hud-flag {
      animation: none;
    }
  }
</style>

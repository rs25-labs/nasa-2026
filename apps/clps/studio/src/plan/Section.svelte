<script lang="ts">
  import type { Snippet } from 'svelte';

  // One numbered part of the Plan page: a tinted title bar in the section's own colour, then its content.

  const TONES = {
    date: 'var(--color-sec-date)',
    sites: 'var(--color-sec-sites)',
    site: 'var(--color-sec-site)',
    outpost: 'var(--color-sec-outpost)',
    choice: 'var(--color-sec-choice)',
  } as const;

  let {
    number,
    title,
    hint = '',
    tone,
    tools,
    children,
    element = $bindable(),
    focus = 'none',
  }: {
    element?: HTMLElement;
    /** While the stay plays: 'active' outlines the section in its colour, 'dimmed' fades it back. */
    focus?: 'none' | 'active' | 'dimmed';
    number: number;
    title: string;
    hint?: string;
    tone: keyof typeof TONES;
    tools?: Snippet;
    children: Snippet;
  } = $props();

  const colour = $derived(TONES[tone]);
</script>

<section
  bind:this={element}
  aria-label={title}
  class="flex min-w-0 flex-col overflow-hidden rounded-sm border border-rule bg-panel transition-opacity duration-300 motion-reduce:transition-none {focus === 'dimmed' ? 'opacity-40' : ''}"
  style="border-top: 3px solid {colour};{focus === 'active' ? ` outline: 2px solid ${colour}; outline-offset: 2px;` : ''}"
>
  <header
    class="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-rule px-5 py-3"
    style="background: color-mix(in srgb, {colour} 12%, var(--color-panel));"
  >
    <div class="flex min-w-[18rem] flex-1 items-start gap-3">
      <span
        aria-hidden="true"
        class="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-[#1a1a1a]"
        style="background: {colour};"
      >{number}</span>
      <div class="flex min-w-0 flex-col">
        <h2 class="m-0 text-lg font-semibold text-ink">{title}</h2>
        {#if hint}<p class="m-0 text-sm text-muted">{hint}</p>{/if}
      </div>
    </div>
    {#if tools}<div class="flex flex-wrap items-center gap-3">{@render tools()}</div>{/if}
  </header>
  {@render children()}
</section>

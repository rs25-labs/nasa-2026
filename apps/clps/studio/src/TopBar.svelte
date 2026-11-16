<script lang="ts">
  import type { Mode } from './lib/router.svelte';
  import ExportMenu from './plan/export/ExportMenu.svelte';

  let { mode }: { mode: Mode } = $props();

  // The full-page comparison belongs to Plan, so Plan stays the highlighted tab there.
  const tabs: { href: string; label: string; modes: Mode[] }[] = [
    { href: '#/plan', label: 'Plan', modes: ['plan', 'compare'] },
    { href: '#/surface', label: 'Expedition', modes: ['surface'] },
    { href: '#/landings', label: 'Real Landings', modes: ['landings'] },
  ];
</script>

<header class="flex h-12 shrink-0 items-center justify-between border-b border-rule bg-panel px-4">
  <a href="#/" class="text-sm font-semibold text-ink">Lunar Mission Lab - NASA Space Challenge 2026</a>
  <div class="flex items-center gap-4">
    <nav aria-label="Mode" class="flex gap-1 text-[15px]">
      {#each tabs as tab (tab.href)}
        {@const active = tab.modes.includes(mode)}
        <!-- The open tab is solid amber with bold dark text and a bar underneath; the others are plain grey text. -->
        <a
          href={tab.href}
          aria-current={active ? 'page' : undefined}
          class="relative rounded-sm border px-4 py-1 {active
            ? 'border-sun bg-sun font-bold text-[#1a1a1a] after:absolute after:inset-x-1 after:-bottom-[7px] after:h-[3px] after:rounded-full after:bg-sun'
            : 'border-transparent font-semibold text-muted hover:border-rule hover:text-ink'}"
          >{tab.label}</a
        >
      {/each}
    </nav>
    {#if mode === 'plan' || mode === 'compare' || mode === 'surface'}<ExportMenu />{/if}
  </div>
</header>

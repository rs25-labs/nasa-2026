<script lang="ts">
  import { useSession } from '../../lib/mission/session';
  import type { MissionSite } from '../../lib/mission/store.svelte';
  import { siteLabel } from '../../lib/mission/labels';
  import { BLOCK_HEIGHT, LABEL_WIDTH } from './layout';
  import StripCanvas from './StripCanvas.svelte';

  let { site, selected }: { site: MissionSite; selected: boolean } = $props();

  const { actions } = useSession();

  const label = $derived(siteLabel(site));
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
  <StripCanvas {site} />
</div>

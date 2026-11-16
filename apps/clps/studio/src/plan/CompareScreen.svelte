<script lang="ts">
  import { MAX_SITES, mission } from '../lib/mission/store.svelte';
  import SitesTable from './table/SitesTable.svelte';

  // The site comparison on its own page, for when several sites make the Plan screen's table cramped.
</script>

<div class="flex h-full flex-col bg-panel">
  <div class="flex shrink-0 items-center gap-4 border-b-[3px] border-ink px-4 py-2">
    <a
      href="#/plan"
      class="inline-flex items-center gap-2 rounded-sm bg-sun px-4 py-1.5 text-sm font-semibold text-[#231c12] hover:bg-[#f6c672]"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M8 1 3 6l5 5" fill="none" stroke="currentColor" stroke-width="2" /></svg>
      Return to Planning
    </a>
    <h1 class="m-0 text-base font-bold text-ink">Compare Landing Sites</h1>
    <p class="m-0 ml-auto text-xs text-muted">{mission.sites.length} of {MAX_SITES} sites · add sites on the Plan page</p>
  </div>
  <SitesTable class="min-h-0 flex-1" expanded />
</div>

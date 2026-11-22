<script lang="ts">
  import { FIRST_YEAR, LAST_YEAR, stepYear, yearView } from '../../lib/mission/year.svelte';

  // Which year the year strip shows, as a labelled control rather than small numbers beside the strip.
  const year = $derived(yearView.year);
  const button =
    'inline-flex h-9 items-center gap-1.5 rounded-sm border border-rule bg-ground px-3 text-sm text-ink hover:border-muted disabled:cursor-not-allowed disabled:opacity-40';
</script>

<div class="flex items-center gap-2" role="group" aria-label="Year shown">
  <span class="text-sm text-muted">Year</span>
  <button type="button" class={button} disabled={year <= FIRST_YEAR} onclick={() => stepYear(-1)} aria-label="Show {year - 1}">
    <svg aria-hidden="true" viewBox="0 0 6 10" class="h-2.5 w-1.5"><path d="M5 1 1 5l4 4" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
    {year - 1}
  </button>
  <span class="min-w-[4ch] text-center text-lg font-semibold" aria-live="polite">{year}</span>
  <button type="button" class={button} disabled={year >= LAST_YEAR} onclick={() => stepYear(1)} aria-label="Show {year + 1}">
    {year + 1}
    <svg aria-hidden="true" viewBox="0 0 6 10" class="h-2.5 w-1.5"><path d="M1 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
  </button>
</div>

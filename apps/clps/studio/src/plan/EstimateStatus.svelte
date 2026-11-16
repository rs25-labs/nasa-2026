<script lang="ts">
  import { clearComparison, comparison, estimates } from '../lib/mission/estimates.svelte';
  import { actions, mission, status } from '../lib/mission/store.svelte';
  import Busy from './Busy.svelte';

  let { class: className = '' }: { class?: string } = $props();

  const text = $derived.by(() => {
    const count = mission.sites.length;
    const noun = count === 1 ? 'site' : 'sites';
    if (estimates.status === 'loading') return `Calculating ${count} ${noun}…`;
    if (estimates.status === 'error') return estimates.error ?? 'Calculation failed.';
    if (estimates.status === 'ready') return `${count} ${noun} calculated.`;
    return '';
  });

  const link = 'shrink-0 rounded-sm border border-rule bg-ground px-1.5 text-[11px] leading-[16px] text-ink hover:border-muted';
</script>

<div class="flex min-w-0 flex-col items-end justify-end gap-px text-xs {className}" role="status" aria-live="polite">
  {#if status.text}
    <p class="m-0 flex max-w-full items-center gap-1.5 text-ink">
      <span class="truncate" title={status.text}>{status.text}</span>
      {#if status.undoable}<button type="button" class={link} onclick={actions.undoRemove}>Undo</button>{/if}
    </p>
  {/if}
  {#if comparison.active}
    <p class="m-0 flex max-w-full items-center gap-1.5 text-muted">
      <span class="truncate" title="Compared with {comparison.label}">Compared with {comparison.label}</span>
      <button type="button" class={link} onclick={clearComparison}>Clear</button>
    </p>
  {/if}
  {#if estimates.status === 'loading'}
    <Busy {text} class="max-w-full truncate" />
  {:else}
    <p class="m-0 max-w-full truncate {estimates.status === 'error' ? 'text-sun' : 'text-muted'}" title={text}>{text}</p>
  {/if}
</div>

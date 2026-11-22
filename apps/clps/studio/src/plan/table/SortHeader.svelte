<script lang="ts">
  let {
    label,
    unit,
    definition,
    marker,
    descending,
    align = 'left',
    tone = 'plain',
    onsort,
  }: {
    label: string;
    unit: string;
    definition: string;
    /** Direction in words while this column sorts the table, otherwise null. */
    marker: string | null;
    descending: boolean;
    align?: 'left' | 'right';
    tone?: 'plain' | 'sun' | 'earth';
    onsort: () => void;
  } = $props();

  const dotClass = $derived(tone === 'sun' ? 'bg-sun' : tone === 'earth' ? 'bg-earth' : '');
</script>

<button
  type="button"
  onclick={onsort}
  title={definition}
  class="flex w-full flex-col px-2 py-1 leading-4 hover:bg-ground {align === 'right' ? 'items-end text-right' : 'items-start text-left'} text-ink"
>
  <span class="flex items-center gap-1.5 whitespace-nowrap">
    {#if dotClass}<span aria-hidden="true" class="size-2 shrink-0 rounded-full {dotClass}"></span>{/if}
    {label}
    {#if marker !== null}
      <svg aria-hidden="true" viewBox="0 0 8 8" class="size-2 shrink-0 text-ink">
        {#if descending}
          <path d="M0 2h8L4 7z" fill="currentColor" />
        {:else}
          <path d="M0 6h8L4 1z" fill="currentColor" />
        {/if}
      </svg>
      <span class="sr-only">{marker}</span>
    {/if}
  </span>
  <span class="whitespace-nowrap text-xs text-muted">{unit}</span>
</button>

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

  const toneClass = $derived(tone === 'sun' ? 'text-sun' : tone === 'earth' ? 'text-earth' : 'text-ink');
</script>

<button
  type="button"
  onclick={onsort}
  title={definition}
  class="flex w-full flex-col px-1 py-1 leading-[14px] hover:bg-ground {align === 'right' ? 'items-end text-right' : 'items-start text-left'} {toneClass}"
>
  <span class="flex items-center gap-1 whitespace-nowrap">
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
  <span class="whitespace-nowrap text-[11px] text-muted">{unit}</span>
</button>

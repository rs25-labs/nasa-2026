<script lang="ts">
  import type { CatalogSite } from '../../lib/api/client';
  import { addCatalogSite, addCustomSite, isFull } from './adding';
  import { PLANNED_CLPS } from './planned-clps';

  interface Option {
    key: string;
    name: string;
    group: 'Catalog candidates' | 'Planned CLPS regions';
    choose: () => void;
  }

  let { catalog, loadError }: { catalog: CatalogSite[]; loadError: string } = $props();

  let query = $state('');
  let open = $state(false);
  let activeIndex = $state(0);
  let latitudeInput = $state<number | null>(null);
  let longitudeInput = $state<number | null>(null);
  let customError = $state('');

  const full = $derived(isFull());

  const options = $derived.by((): Option[] => {
    const needle = query.trim().toLowerCase();
    const matches = (name: string) => needle === '' || name.toLowerCase().includes(needle);
    const list: Option[] = [];
    for (const site of catalog) {
      if (matches(site.name)) {
        list.push({ key: `c-${site.site_id}`, name: site.name, group: 'Catalog candidates', choose: () => addCatalogSite(site) });
      }
    }
    for (const site of PLANNED_CLPS) {
      if (matches(site.name)) {
        list.push({ key: `p-${site.site_id}`, name: site.name, group: 'Planned CLPS regions', choose: () => addCatalogSite(site) });
      }
    }
    return list;
  });

  const activeOption = $derived(options[Math.min(activeIndex, options.length - 1)]);

  function choose(option: Option): void {
    option.choose();
    query = '';
    open = false;
    activeIndex = 0;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      open = true;
      activeIndex = Math.min(options.length - 1, activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
    } else if (event.key === 'Enter' && open && activeOption) {
      event.preventDefault();
      choose(activeOption);
    } else if (event.key === 'Escape') {
      open = false;
    }
  }

  function onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !(event.currentTarget instanceof Node) || !event.currentTarget.contains(next)) {
      open = false;
    }
  }

  function parseCoordinate(value: number | null, low: number, high: number): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high ? value : null;
  }

  // A refused coordinate keeps its reason until the field holds a valid value again.
  function clearReasonWhenValid(): void {
    if (parseCoordinate(latitudeInput, -90, 90) !== null && parseCoordinate(longitudeInput, -180, 180) !== null) {
      customError = '';
    }
  }

  function addCustom(event: SubmitEvent): void {
    event.preventDefault();
    const latitude = parseCoordinate(latitudeInput, -90, 90);
    const longitude = parseCoordinate(longitudeInput, -180, 180);
    if (latitude === null) {
      customError = 'Latitude must be a number from −90 to 90.';
      return;
    }
    if (longitude === null) {
      customError = 'Longitude must be a number from −180 to 180.';
      return;
    }
    customError = '';
    addCustomSite(latitude, longitude);
    latitudeInput = null;
    longitudeInput = null;
  }

  // With no submit button, Enter in either coordinate field adds the point.
  function submitOnEnter(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || !(event.currentTarget instanceof HTMLInputElement)) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  const field =
    'h-7 min-w-0 rounded-sm border border-rule bg-ground px-2 text-sm text-ink placeholder:text-muted disabled:opacity-50';
</script>

<div class="relative z-30 flex flex-col gap-1.5">
  <div class="relative" onfocusout={onFocusOut}>
    <label class="sr-only" for="site-search">Add a site by name</label>
    <input
      id="site-search"
      class="{field} w-full"
      type="text"
      role="combobox"
      autocomplete="off"
      placeholder="Search catalog sites"
      aria-expanded={open}
      aria-controls="site-search-list"
      aria-autocomplete="list"
      aria-activedescendant={open && activeOption ? `site-option-${activeOption.key}` : undefined}
      disabled={full}
      bind:value={query}
      oninput={() => {
        open = true;
        activeIndex = 0;
      }}
      onfocus={() => (open = true)}
      onkeydown={onKeydown}
    />
    {#if open && !full}
      <ul
        id="site-search-list"
        role="listbox"
        aria-label="Sites"
        class="absolute left-0 right-0 top-full z-30 mt-px max-h-56 overflow-auto border border-rule bg-panel text-sm"
        onpointerdown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {#each options as option, index (option.key)}
          {#if index === 0 || options[index - 1]?.group !== option.group}
            <li role="presentation" class="px-2 pt-2 pb-1 text-xs text-muted">{option.group}</li>
          {/if}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <li
            id="site-option-{option.key}"
            role="option"
            aria-selected={option === activeOption}
            class="cursor-pointer px-2 py-1 text-ink {option === activeOption ? 'bg-rule' : ''}"
            onclick={() => choose(option)}
          >
            {option.name}
          </li>
        {:else}
          <li role="presentation" class="px-2 py-2 text-muted">No match.</li>
        {/each}
      </ul>
    {/if}
  </div>

  <form class="flex flex-wrap items-end gap-1.5" onsubmit={addCustom} novalidate>
    <label class="flex min-w-0 flex-1 basis-20 flex-col gap-1 text-xs text-muted">
      <input
        class="{field} text-ink"
        type="number"
        step="any"
        min="-90"
        max="90"
        inputmode="decimal"
        aria-label="Latitude in degrees, −90 to 90"
        placeholder="Lat −89.5"
        disabled={full}
        bind:value={latitudeInput}
        oninput={clearReasonWhenValid}
        onkeydown={submitOnEnter}
      />
    </label>
    <label class="flex min-w-0 flex-1 basis-20 flex-col gap-1 text-xs text-muted">
      <input
        class="{field} text-ink"
        type="number"
        step="any"
        min="-180"
        max="180"
        inputmode="decimal"
        aria-label="Longitude in degrees, −180 to 180"
        placeholder="Lon −154.6"
        disabled={full}
        bind:value={longitudeInput}
        oninput={clearReasonWhenValid}
        onkeydown={submitOnEnter}
      />
    </label>
  </form>

  {#if customError}
    <p class="text-xs text-ink" role="alert">{customError}</p>
  {/if}
  {#if loadError}
    <p class="text-xs text-muted" role="status">{loadError}</p>
  {/if}
</div>

<script lang="ts">
  import { useSession } from '../../lib/mission/session';
  import type { PowerSetup } from '../../lib/mission/store.svelte';

  /** stacked: label above each field, three across, for a narrow column. */
  let { stacked = false }: { stacked?: boolean } = $props();

  const { mission, actions } = useSession();

  interface Field {
    key: keyof PowerSetup;
    label: string;
    unit: string;
    max: number;
    step: number;
  }

  const fields: Field[] = [
    { key: 'arrayKw', label: 'Array', unit: 'kW', max: 10, step: 0.1 },
    { key: 'batteryKwh', label: 'Battery', unit: 'kWh', max: 100, step: 1 },
    { key: 'loadKw', label: 'Load', unit: 'kW', max: 5, step: 0.1 },
  ];

  // A refused value keeps its reason beside the field until the next valid edit.
  let reasons = $state<Record<keyof PowerSetup, string>>({ arrayKw: '', batteryKwh: '', loadKw: '' });

  function reasonFor(field: Field): string {
    return `${field.label} must be 0–${field.max} ${field.unit}`;
  }

  function live(field: Field, input: HTMLInputElement): void {
    const value = input.valueAsNumber;
    if (Number.isFinite(value) && value >= 0 && value <= field.max) {
      reasons[field.key] = '';
      actions.setPower({ [field.key]: value });
    }
  }

  function commit(field: Field, input: HTMLInputElement): void {
    const value = input.valueAsNumber;
    if (!Number.isFinite(value) || value < 0 || value > field.max) {
      reasons[field.key] = reasonFor(field);
      input.value = String(mission.power[field.key]);
      return;
    }
    reasons[field.key] = '';
    actions.setPower({ [field.key]: value });
  }
</script>

<div class={stacked ? 'grid grid-cols-3 gap-3' : 'flex items-center gap-3'} data-tour="power">
  {#each fields as field (field.key)}
    <label class="flex text-xs text-muted {stacked ? 'min-w-0 flex-col gap-1.5' : 'items-center gap-1.5'}">
      <span>{field.label}{stacked ? ` (${field.unit})` : ''}</span>
      <input
        type="number"
        min="0"
        max={field.max}
        step={field.step}
        value={mission.power[field.key]}
        oninput={(event) => live(field, event.currentTarget)}
        onchange={(event) => commit(field, event.currentTarget)}
        aria-invalid={reasons[field.key] !== ''}
        class="rounded-sm border bg-ground text-right text-ink {stacked ? 'h-9 w-full min-w-0 px-2 text-sm' : 'w-16 px-1.5 py-1 text-xs'} {reasons[field.key] ? 'border-sun' : 'border-rule'}"
      />
      {#if !stacked}<span>{field.unit}</span>{/if}
      {#if reasons[field.key]}<span class="text-sun" role="alert">{reasons[field.key]}</span>{/if}
    </label>
  {/each}
</div>

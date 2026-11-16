<script lang="ts">
  import { useSession } from '../../lib/mission/session';
  import type { PowerSetup } from '../../lib/mission/store.svelte';

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

<div class="flex items-center gap-3" data-tour="power">
  {#each fields as field (field.key)}
    <label class="flex items-center gap-1.5 text-xs text-muted">
      <span>{field.label}</span>
      <input
        type="number"
        min="0"
        max={field.max}
        step={field.step}
        value={mission.power[field.key]}
        oninput={(event) => live(field, event.currentTarget)}
        onchange={(event) => commit(field, event.currentTarget)}
        aria-invalid={reasons[field.key] !== ''}
        class="w-16 rounded-sm border bg-ground px-1.5 py-1 text-right text-xs text-ink {reasons[field.key] ? 'border-sun' : 'border-rule'}"
      />
      <span>{field.unit}</span>
      {#if reasons[field.key]}<span class="text-sun" role="alert">{reasons[field.key]}</span>{/if}
    </label>
  {/each}
</div>

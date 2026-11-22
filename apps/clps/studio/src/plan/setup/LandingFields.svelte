<script lang="ts">
  import { actions, END_MS, FIRST_START_MS, MAX_DAYS, MAX_MAST_M, MIN_DAYS, mission } from '../../lib/mission/store.svelte';

  const DAY_MS = 86_400_000;
  const HOUR_MS = 3_600_000;

  let errors = $state<{ landing: string; stay: string; mast: string }>({ landing: '', stay: '', mast: '' });

  // A refused value keeps its reason on screen until the next valid edit of that field.
  let latestError = $state<keyof typeof errors | null>(null);

  function showError(field: keyof typeof errors, message: string): void {
    errors[field] = message;
    latestError = field;
  }

  const errorText = $derived((latestError && errors[latestError]) || errors.landing || errors.stay || errors.mast);

  /** Forgets every refused value, for when the whole plan is cleared. */
  export function clearErrors(): void {
    errors = { landing: '', stay: '', mast: '' };
    latestError = null;
  }

  function validStay(input: HTMLInputElement): boolean {
    return Number.isInteger(input.valueAsNumber) && input.valueAsNumber >= MIN_DAYS && input.valueAsNumber <= MAX_DAYS;
  }

  function validMast(input: HTMLInputElement): boolean {
    return Number.isFinite(input.valueAsNumber) && input.valueAsNumber >= 0 && input.valueAsNumber <= MAX_MAST_M;
  }

  /** The date and time picker works in YYYY-MM-DDTHH:MM, which this app reads and writes as UTC. */
  function pickerValue(ms: number): string {
    return new Date(ms).toISOString().slice(0, 16);
  }

  /** The picked landing as UTC milliseconds rounded down to the hour, or the reason it is refused. */
  function parseLanding(value: string): number | string {
    const ms = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? Date.parse(`${value}:00Z`) : Number.NaN;
    if (!Number.isFinite(ms)) return 'Pick a landing date and hour';
    const hour = Math.floor(ms / HOUR_MS) * HOUR_MS;
    if (hour < FIRST_START_MS || hour > END_MS - mission.days * DAY_MS) return 'Landing must be 1969 to 2035';
    return hour;
  }

  function commitLanding(input: HTMLInputElement): void {
    const parsed = parseLanding(input.value);
    if (typeof parsed === 'string') {
      showError('landing', parsed);
      input.value = pickerValue(Date.parse(mission.startUtc));
      return;
    }
    errors.landing = '';
    actions.setWindow(new Date(parsed).toISOString(), mission.days);
  }

  function commitStay(input: HTMLInputElement): void {
    const value = input.valueAsNumber;
    if (!Number.isInteger(value) || value < MIN_DAYS || value > MAX_DAYS) {
      showError('stay', `Stay must be ${MIN_DAYS}–${MAX_DAYS} days`);
      input.value = String(mission.days);
      return;
    }
    errors.stay = '';
    actions.setWindow(mission.startUtc, value);
  }

  function commitMast(input: HTMLInputElement): void {
    const value = input.valueAsNumber;
    if (!Number.isFinite(value) || value < 0 || value > MAX_MAST_M) {
      showError('mast', `Mast must be 0–${MAX_MAST_M} m`);
      input.value = String(mission.mastHeightM);
      return;
    }
    errors.mast = '';
    actions.setMastHeight(value);
  }

  const label = 'flex min-w-0 flex-col gap-1.5 text-xs text-muted';
  const field = 'h-9 w-full min-w-0 rounded-sm border bg-ground px-2 text-sm text-ink [color-scheme:dark] focus-visible:outline-offset-0';
</script>

<div class="grid grid-cols-3 gap-3" data-tour="landing-controls">
  <label class="{label} col-span-3">
    <span>Landing (UTC)</span>
    <input
      type="datetime-local"
      step="3600"
      min={pickerValue(FIRST_START_MS)}
      max={pickerValue(END_MS - mission.days * DAY_MS)}
      value={pickerValue(Date.parse(mission.startUtc))}
      aria-invalid={errors.landing !== ''}
      aria-describedby={errorText ? 'plan-field-error' : undefined}
      onchange={(event) => commitLanding(event.currentTarget)}
      class="{field} {errors.landing ? 'border-sun' : 'border-rule'}"
    />
  </label>
  <label class={label}>
    <span>Stay (days)</span>
    <input
      type="number"
      min={MIN_DAYS}
      max={MAX_DAYS}
      step="1"
      value={mission.days}
      aria-invalid={errors.stay !== ''}
      aria-describedby={errorText ? 'plan-field-error' : undefined}
      oninput={(event) => {
        if (validStay(event.currentTarget)) errors.stay = '';
      }}
      onchange={(event) => commitStay(event.currentTarget)}
      class="{field} text-right {errors.stay ? 'border-sun' : 'border-rule'}"
    />
  </label>
  <label class={label}>
    <span>Crew</span>
    <input
      type="number"
      min="1"
      max="40"
      step="1"
      value={mission.crew}
      onchange={(event) => {
        const value = event.currentTarget.valueAsNumber;
        if (Number.isFinite(value) && value >= 1 && value <= 40) actions.setCrew(value);
        else event.currentTarget.value = String(mission.crew);
      }}
      class="{field} border-rule text-right"
    />
  </label>
  <label class={label}>
    <span>Mast (m)</span>
    <input
      type="number"
      min="0"
      max={MAX_MAST_M}
      step="0.5"
      value={mission.mastHeightM}
      aria-invalid={errors.mast !== ''}
      aria-describedby={errorText ? 'plan-field-error' : undefined}
      oninput={(event) => {
        if (validMast(event.currentTarget)) errors.mast = '';
      }}
      onchange={(event) => commitMast(event.currentTarget)}
      class="{field} text-right {errors.mast ? 'border-sun' : 'border-rule'}"
    />
  </label>
  {#if errorText}
    <p id="plan-field-error" role="alert" class="col-span-3 m-0 text-xs text-sun">{errorText}</p>
  {/if}
</div>

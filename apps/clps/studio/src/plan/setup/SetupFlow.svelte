<script lang="ts">
  import { siteLabel } from '../../lib/mission/labels';
  import { actions, MAX_SITES, mission, type PowerSetup } from '../../lib/mission/store.svelte';
  import YearPicker from '../calendar/YearPicker.svelte';
  import YearStrip from '../calendar/YearStrip.svelte';
  import SiteMap from '../map/Map.svelte';
  import Recommendation from '../table/Recommendation.svelte';
  import PowerInputs from '../timeline/PowerInputs.svelte';
  import { closeSetup, setup, SETUP_STEPS } from './flow.svelte';
  import LandingFields from './LandingFields.svelte';

  // The three things a plan needs, one per screen, before the workbench opens. Every edit goes straight into the plan,
  // so leaving early keeps what was set.

  interface Preset {
    name: string;
    power: PowerSetup;
  }

  const PRESETS: Preset[] = [
    { name: 'Small lander', power: { arrayKw: 0.5, batteryKwh: 4, loadKw: 0.15 } },
    { name: 'Rover', power: { arrayKw: 2, batteryKwh: 12, loadKw: 0.4 } },
    { name: 'Crewed outpost', power: { arrayKw: 10, batteryKwh: 100, loadKw: 3 } },
  ];

  const last = SETUP_STEPS.length - 1;
  const selected = $derived(mission.sites.find((site) => site.id === mission.selectedSiteId) ?? null);

  function matches(preset: Preset): boolean {
    const p = mission.power;
    return p.arrayKw === preset.power.arrayKw && p.batteryKwh === preset.power.batteryKwh && p.loadKw === preset.power.loadKw;
  }

  function next(): void {
    if (setup.step < last) setup.step += 1;
    else closeSetup();
  }

  const heading = 'm-0 text-2xl font-semibold text-ink';
  const lead = 'm-0 max-w-[60ch] text-base leading-6 text-muted';
  const button = 'h-10 rounded-sm border px-5 text-base';
</script>

<div class="plan-type flex h-full flex-col bg-ground">
  <nav aria-label="Setup steps" class="flex shrink-0 items-center gap-6 border-b border-rule bg-panel px-6 py-3">
    <ol class="m-0 flex list-none items-center gap-6 p-0">
      {#each SETUP_STEPS as name, index (name)}
        <li>
          <button
            type="button"
            onclick={() => (setup.step = index)}
            aria-current={setup.step === index ? 'step' : undefined}
            class="flex items-center gap-2 text-base {setup.step === index ? 'font-semibold text-ink' : 'text-muted hover:text-ink'}"
          >
            <span
              class="inline-flex size-7 items-center justify-center rounded-full border text-sm {setup.step === index
                ? 'border-sun bg-sun text-black'
                : index < setup.step
                  ? 'border-ink text-ink'
                  : 'border-rule'}"
            >{index + 1}</span>
            {name}
          </button>
        </li>
      {/each}
    </ol>
    <button type="button" onclick={closeSetup} class="ml-auto text-base text-muted underline hover:text-ink">Skip to the plan</button>
  </nav>

  <div class="plan-scroll min-h-0 flex-1 overflow-auto">
    {#if setup.step === 0}
      <section class="mx-auto grid h-full max-w-[1400px] gap-8 px-6 py-6" style="grid-template-columns: minmax(0, 1fr) 340px;">
        <div class="flex min-h-[420px] flex-col gap-3">
          <h2 class={heading}>Where could you land?</h2>
          <p class={lead}>Search by name, type coordinates, or click the map. Compare up to {MAX_SITES} sites near the south pole.</p>
          <SiteMap class="min-h-0 flex-1" />
        </div>
        <div class="flex min-h-0 flex-col gap-3 pt-1">
          <h3 class="m-0 text-lg font-semibold">Sites in this plan ({mission.sites.length})</h3>
          <ul class="m-0 flex list-none flex-col gap-2 p-0">
            {#each mission.sites as site (site.id)}
              <li class="flex items-center gap-3 rounded-sm border border-rule bg-panel px-3 py-2">
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-base">{siteLabel(site).short}</span>
                  <span class="block text-sm text-muted">{site.latitudeDeg.toFixed(2)}°, {site.longitudeDeg.toFixed(2)}°</span>
                </span>
                <button
                  type="button"
                  disabled={mission.sites.length <= 1}
                  onclick={() => actions.removeSite(site.id)}
                  class="h-8 rounded-sm border border-rule px-3 text-sm text-ink hover:border-muted disabled:cursor-not-allowed disabled:opacity-40"
                  title={mission.sites.length <= 1 ? 'Keep at least one site' : undefined}
                >Remove</button>
              </li>
            {/each}
          </ul>
        </div>
      </section>
    {:else if setup.step === 1}
      <section class="mx-auto flex max-w-[1400px] flex-col gap-6 px-6 py-6">
        <div class="flex flex-col gap-3">
          <h2 class={heading}>When do you land, and for how long?</h2>
          <p class={lead}>
            The year view shows when {selected ? siteLabel(selected).short : 'the selected site'} has the Sun and Earth in view.
            Click a day to land then, or use the suggested date.
          </p>
        </div>
        <div class="max-w-[520px]"><LandingFields /></div>
        <div class="overflow-hidden rounded-sm border border-rule bg-panel">
          <div class="flex justify-end border-b border-rule px-5 py-2"><YearPicker /></div>
          <YearStrip />
          <Recommendation part="date" />
        </div>
      </section>
    {:else}
      <section class="mx-auto flex max-w-[900px] flex-col gap-6 px-6 py-6">
        <div class="flex flex-col gap-3">
          <h2 class={heading}>How much power?</h2>
          <p class={lead}>Pick a starting point, then adjust the numbers. The plan shows when the battery would run out.</p>
        </div>
        <div class="grid grid-cols-3 gap-3">
          {#each PRESETS as preset (preset.name)}
            <button
              type="button"
              onclick={() => actions.setPower(preset.power)}
              aria-pressed={matches(preset)}
              class="flex flex-col items-start gap-1 rounded-sm border bg-panel px-4 py-3 text-left {matches(preset) ? 'border-sun' : 'border-rule hover:border-muted'}"
            >
              <span class="text-base font-semibold">{preset.name}</span>
              <span class="text-sm leading-6 text-muted">
                {preset.power.arrayKw} kW array<br />{preset.power.batteryKwh} kWh battery<br />{preset.power.loadKw} kW load
              </span>
            </button>
          {/each}
        </div>
        <div class="max-w-[520px]"><PowerInputs stacked /></div>
      </section>
    {/if}
  </div>

  <footer class="flex shrink-0 items-center gap-3 border-t border-rule bg-panel px-6 py-3">
    <span class="text-base text-muted">Step {setup.step + 1} of {SETUP_STEPS.length}</span>
    <button
      type="button"
      onclick={() => (setup.step -= 1)}
      disabled={setup.step === 0}
      class="{button} ml-auto border-rule text-ink hover:border-muted disabled:invisible"
    >Back</button>
    <button type="button" onclick={next} class="{button} border-sun bg-sun font-semibold text-black hover:opacity-90">
      {setup.step === last ? 'Open the plan' : 'Next'}
    </button>
  </footer>
</div>

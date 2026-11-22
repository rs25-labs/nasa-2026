<script lang="ts">
  import { formatUtc } from '../../lib/format';
  import { clearComparison } from '../../lib/mission/estimates.svelte';
  import { actions, mission } from '../../lib/mission/store.svelte';
  import { openSetup } from './flow.svelte';

  // The whole plan in one line, with a way back into each setup step and a way to start over.

  let confirming = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function startOver(): void {
    clearTimeout(timer);
    if (!confirming) {
      confirming = true;
      timer = setTimeout(() => (confirming = false), 4000);
      return;
    }
    confirming = false;
    actions.reset();
    clearComparison();
    openSetup(0);
  }

  const item = 'flex min-w-0 flex-col gap-0.5';
  const name = 'text-xs text-muted';
  const value = 'text-base text-ink';
  const edit = 'h-8 shrink-0 rounded-sm border border-rule bg-ground px-3 text-sm text-ink hover:border-muted';
</script>

<section aria-label="Your plan" class="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-sm border border-rule bg-panel px-5 py-3">
  <h2 class="m-0 text-lg font-semibold">Your plan</h2>
  <div class="flex items-center gap-3" data-tour="edit-sites">
    <div class={item}>
      <span class={name}>Sites</span>
      <span class={value}>{mission.sites.length} to compare</span>
    </div>
    <button type="button" class={edit} onclick={() => openSetup(0)}>Edit</button>
  </div>
  <div class="flex items-center gap-3" data-tour="landing-controls">
    <div class={item}>
      <span class={name}>Landing and stay</span>
      <span class={value}>{formatUtc(Date.parse(mission.startUtc))} · {mission.days} days · crew {mission.crew} · mast {mission.mastHeightM} m</span>
    </div>
    <button type="button" class={edit} onclick={() => openSetup(1)}>Edit</button>
  </div>
  <div class="flex items-center gap-3" data-tour="power">
    <div class={item}>
      <span class={name}>Power</span>
      <span class={value}>{mission.power.arrayKw} kW array · {mission.power.batteryKwh} kWh battery · {mission.power.loadKw} kW load</span>
    </div>
    <button type="button" class={edit} onclick={() => openSetup(2)}>Edit</button>
  </div>
  <button
    type="button"
    onclick={startOver}
    title="Reset to the starter plan and go through the setup again"
    class="ml-auto h-8 rounded-sm border px-3 text-sm {confirming ? 'border-sun text-sun' : 'border-rule text-muted hover:border-muted hover:text-ink'}"
  >{confirming ? 'Click again to start over' : 'Start over'}</button>
</section>

<script lang="ts">
  import { SPEED_OPTIONS } from '../../lib/mission/clock.svelte';
  import { useSession } from '../../lib/mission/session';

  const { mission, actions, clock } = useSession();

  const button =
    'rounded-sm border border-rule bg-ground px-2.5 py-1 text-xs hover:border-muted';

  function restart(): void {
    actions.setClock(0);
  }
</script>

<div class="flex items-center gap-2">
  <button type="button" class="{button} min-w-16" onclick={clock.toggle}>{mission.playing ? 'Pause' : 'Play'}</button>
  <button type="button" class={button} onclick={restart}>Start</button>
  <label class="flex items-center gap-1.5 text-xs text-muted">
    <span>Speed</span>
    <select
      class="rounded-sm border border-rule bg-ground px-1.5 py-1 text-xs text-ink"
      value={String(clock.speedHoursPerSecond)}
      onchange={(event) => clock.setSpeed(Number(event.currentTarget.value))}
    >
      {#each SPEED_OPTIONS as option (option.hoursPerSecond)}
        <option value={String(option.hoursPerSecond)}>{option.label}</option>
      {/each}
    </select>
  </label>
</div>

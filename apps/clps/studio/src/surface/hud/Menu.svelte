<script lang="ts">
  import { drive, type CameraKind, type HeadlightMode, type Quality } from '../../lib/mission/drive.svelte';
  import { ROVER_PRESETS, type RoverSettings } from '../../lib/mission/roverPower';

  interface Props {
    onBackToPlan: () => void;
  }
  let { onBackToPlan }: Props = $props();

  const cameras: { id: CameraKind; label: string }[] = [
    { id: 'chase', label: 'Chase' },
    { id: 'driver', label: 'Driver' },
    { id: 'mast', label: 'Mast' },
    { id: 'orbit', label: 'Orbit' },
  ];
  const lights: HeadlightMode[] = ['auto', 'on', 'off'];
  const qualities: Quality[] = ['high', 'medium', 'low'];

  const fields: { key: keyof RoverSettings; label: string; unit: string; step: number }[] = [
    { key: 'batteryKwh', label: 'Battery capacity', unit: 'kWh', step: 0.5 },
    { key: 'arrayPeakW', label: 'Array peak power', unit: 'W', step: 10 },
    { key: 'arrayNormalElevationDeg', label: 'Array normal elevation', unit: '°', step: 1 },
    { key: 'massKg', label: 'Mass', unit: 'kg', step: 10 },
    { key: 'rollingResistance', label: 'Rolling resistance', unit: '', step: 0.01 },
    { key: 'drivetrainEfficiency', label: 'Drivetrain efficiency', unit: '', step: 0.05 },
    { key: 'idleW', label: 'Idle load', unit: 'W', step: 10 },
    { key: 'shadowHeaterW', label: 'Shadow heaters', unit: 'W', step: 10 },
    { key: 'headlightW', label: 'Headlamps (both)', unit: 'W', step: 5 },
    { key: 'chargeEfficiency', label: 'Charge efficiency', unit: '', step: 0.05 },
    { key: 'dischargeEfficiency', label: 'Discharge efficiency', unit: '', step: 0.05 },
    { key: 'maxSpeedKmh', label: 'Top speed', unit: 'km/h', step: 0.5 },
    { key: 'accelerationMs2', label: 'Acceleration', unit: 'm/s²', step: 0.1 },
  ];

  function choose(settings: RoverSettings): void {
    drive.settings = { ...settings };
    drive.speedKmh = Math.min(drive.speedKmh, settings.maxSpeedKmh);
    drive.commands?.refreshPrediction();
  }

  function edit(key: keyof RoverSettings, value: number): void {
    if (!Number.isFinite(value)) return;
    drive.settings = { ...drive.settings, [key]: value };
    drive.commands?.refreshPrediction();
  }
</script>

<div class="absolute inset-0 flex items-start justify-start p-3" role="presentation">
  <div class="w-[300px] rounded-sm border border-rule bg-[rgb(10_10_11/0.94)] p-3 text-xs text-ink" role="dialog" aria-label="Surface menu" aria-modal="false">
    {#if !drive.settingsOpen}
      <button type="button" class="mb-3 w-full rounded-sm border border-rule px-2 py-1.5 text-left hover:bg-rule" onclick={() => (drive.menuOpen = false)}>Resume</button>

      <p class="mb-1 text-muted">Camera</p>
      <div class="mb-3 flex gap-1" role="group" aria-label="Camera">
        {#each cameras as camera (camera.id)}
          <button type="button" class="flex-1 rounded-sm border border-rule px-1 py-1 hover:bg-rule {drive.camera === camera.id ? 'bg-rule' : ''}" aria-pressed={drive.camera === camera.id} onclick={() => { drive.planning = false; drive.camera = camera.id; }}>{camera.label}</button>
        {/each}
      </div>

      <p class="mb-1 text-muted">Headlights</p>
      <div class="mb-3 flex gap-1" role="group" aria-label="Headlights">
        {#each lights as mode (mode)}
          <button type="button" class="flex-1 rounded-sm border border-rule px-1 py-1 capitalize hover:bg-rule {drive.headlights === mode ? 'bg-rule' : ''}" aria-pressed={drive.headlights === mode} onclick={() => (drive.headlights = mode)}>{mode}</button>
        {/each}
      </div>

      <p class="mb-1 text-muted">Route overlay</p>
      <div class="mb-3 flex flex-col gap-1">
        <label class="flex items-center gap-2"><input type="checkbox" bind:checked={drive.showRoute} /> Show route on the ground</label>
        <label class="flex items-center gap-2"><input type="checkbox" bind:checked={drive.routeInDriverView} /> Also in driver and mast views</label>
        <label class="flex items-center gap-2"><input type="checkbox" bind:checked={drive.hudVisible} /> Drive status box (H)</label>
      </div>

      <p class="mb-1 text-muted">Render quality</p>
      <div class="mb-3 flex gap-1" role="group" aria-label="Render quality">
        {#each qualities as quality (quality)}
          <button type="button" class="flex-1 rounded-sm border border-rule px-1 py-1 capitalize hover:bg-rule {drive.quality === quality ? 'bg-rule' : ''}" aria-pressed={drive.quality === quality} onclick={() => (drive.quality = quality)}>{quality}</button>
        {/each}
      </div>

      <div class="flex gap-2">
        <button type="button" class="flex-1 rounded-sm border border-rule px-2 py-1.5 text-left hover:bg-rule" onclick={() => (drive.settingsOpen = true)}>Rover settings</button>
        <button type="button" class="flex-1 rounded-sm border border-rule px-2 py-1.5 text-left hover:bg-rule" onclick={onBackToPlan}>Back to Plan</button>
      </div>
    {:else}
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-medium">Rover settings</h2>
        <button type="button" class="rounded-sm px-2 py-1 text-muted hover:bg-rule hover:text-ink" onclick={() => (drive.settingsOpen = false)}>Back</button>
      </div>
      <div class="mb-2 flex gap-1">
        {#each ROVER_PRESETS as preset (preset.id)}
          <button type="button" class="flex-1 rounded-sm border border-rule px-1 py-1 hover:bg-rule" onclick={() => choose(preset.settings)}>{preset.label}</button>
        {/each}
      </div>
      <div class="grid grid-cols-[1fr_84px] items-center gap-x-2 gap-y-1">
        {#each fields as field (field.key)}
          <label for="rs-{field.key}" class="text-muted">{field.label}{field.unit ? `, ${field.unit}` : ''}</label>
          <input id="rs-{field.key}" type="number" step={field.step} min="0" value={drive.settings[field.key]} class="rounded-sm border border-rule bg-panel px-1 py-1 text-ink" onchange={(event) => edit(field.key, Number(event.currentTarget.value))} />
        {/each}
      </div>
      <p class="mt-2 text-muted">Solar input is peak × visible Sun × cos(Sun elevation − array elevation). Drive power is m g v (Crr cos θ + sin θ) / efficiency in lunar gravity.</p>
    {/if}
  </div>
</div>

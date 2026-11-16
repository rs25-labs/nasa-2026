<script lang="ts">
  import { formatDegrees, formatDuration } from '../../lib/format';
  import { drive } from '../../lib/mission/drive.svelte';
  import ElevationChart from './ElevationChart.svelte';
  import Gauge, { type Tone } from './Gauge.svelte';
  import { arrivalText, clockText, earthField, kilometres, percentText, sunField, warningsFor } from './hudModel';

  const t = $derived(drive.telemetry);
  const capacity = $derived(drive.settings.batteryKwh);
  const fraction = $derived(capacity > 0 ? Math.max(0, Math.min(1, t.batteryKwh / capacity)) : 0);
  const sun = $derived(sunField(t.sun, t.clockMs));
  const earth = $derived(earthField(t.earth, t.clockMs));
  const warnings = $derived(warningsFor(t, capacity, drive.slopeLimitDeg));
  const word = (id: string): string => warnings.find((w) => w.id === id)?.word ?? '';
  const netKw = $derived(t.netW / 1000);
  const kmh = $derived(Math.abs(t.speedMs) * 3.6);
  const hasRoute = $derived(t.totalM > 0);
  const lapseText = $derived(drive.arrived ? 'arrived' : drive.paused || drive.menuOpen ? 'paused' : `${drive.mode === 'manual' ? 1 : drive.lapse}×`);
  const signed = (value: number): string => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`;

  const level = (value: number): Tone => (value > 0.5 ? 'good' : value > 0.2 ? 'warn' : 'bad');
  const batteryTone = $derived<Tone>(t.batteryFlat ? 'bad' : level(fraction));
  // Hours of battery left at the present drain; charging when the array covers the load.
  const endurance = $derived(netKw < -0.001 ? `${formatDuration((t.batteryKwh / -netKw) * 3_600_000)} left` : 'charging');
  const powerTone = $derived<Tone>(netKw >= 0 ? 'good' : fraction > 0.2 ? 'warn' : 'bad');
  const supply = $derived(t.loadW > 0 ? t.solarW / t.loadW : 1);
  const sunTone = $derived<Tone>(t.sun.fraction >= 0.995 ? (word('shadow') ? 'warn' : 'good') : t.sun.fraction > 0.005 ? 'warn' : 'bad');
  const earthTone = $derived<Tone>(t.earth.fraction > 0.005 ? (word('earth') ? 'warn' : 'good') : 'bad');
  const slopeShare = $derived(drive.slopeLimitDeg > 0 ? t.slopeDeg / drive.slopeLimitDeg : 0);
  const slopeTone = $derived<Tone>(slopeShare > 1 ? 'bad' : t.slopeDeg >= drive.slopeLimitDeg - 2 ? 'warn' : 'good');
  const remaining = $derived(Math.max(0, t.totalM - t.progressM));
</script>

<section
  class="pointer-events-none absolute right-4 top-4 w-[340px] border border-[rgb(255_255_255/0.28)] bg-[rgb(6_8_10/0.8)] px-4 pb-2 pt-3 text-ink"
  aria-label="Drive status"
>
  <header class="flex items-end justify-between border-b border-[rgb(255_255_255/0.2)] pb-2">
    <div>
      <div class="font-mono text-[40px] font-bold leading-[40px]">{kmh.toFixed(1)}</div>
      <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">km/h</div>
    </div>
    <div class="text-right">
      <div class="font-mono text-[14px] font-semibold">{t.clockMs > 0 ? clockText(t.clockMs) : '—'}</div>
      <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{lapseText}</div>
    </div>
  </header>

  {#if warnings.length > 0}
    <ul class="mt-2 space-y-[2px]" aria-live="polite">
      {#each warnings as warning (warning.id)}
        <li class="px-2 py-[3px] text-[12px] font-bold uppercase tracking-[0.06em] text-black" style="background: {warning.id === 'battery' || warning.word === 'over limit' ? '#ff3b30' : '#ff9f1a'}">{warning.sentence}</li>
      {/each}
    </ul>
  {/if}

  <Gauge label="Battery" value={percentText(fraction)} detail="{t.batteryKwh.toFixed(2)} of {capacity.toFixed(0)} kWh" {fraction} tone={batteryTone} flag={word('battery')} />
  <Gauge label="Power" value="{signed(netKw)} kW" detail="sun {(t.solarW / 1000).toFixed(2)} · load {(t.loadW / 1000).toFixed(2)} kW · {endurance}" fraction={supply} tone={powerTone} />
  <Gauge label="Sunlight" value={sun.text} detail={sun.detail} fraction={t.sun.fraction} tone={sunTone} flag={word('shadow')} />
  <Gauge label="Earth link" value={earth.text} detail={earth.detail} fraction={t.earth.fraction > 0.005 ? 1 : 0} tone={earthTone} flag={word('earth')} />
  <Gauge
    label="Slope"
    value={formatDegrees(t.slopeDeg, 0)}
    detail="limit {drive.slopeLimitDeg}° · pitch {formatDegrees(t.pitchDeg, 0, true)} · roll {formatDegrees(t.rollDeg, 0, true)}"
    fraction={slopeShare}
    tone={slopeTone}
    flag={word('steep')}
  />
  {#if hasRoute}
    <Gauge
      label="Route"
      value="{kilometres(remaining)} km"
      detail="{arrivalText(t, drive.arrived)}{t.offRouteM > 25 ? ` · ${Math.round(t.offRouteM)} m off route` : ''}"
      fraction={t.totalM > 0 ? t.progressM / t.totalM : 0}
      tone="info"
    />
  {/if}
  <ElevationChart />
</section>

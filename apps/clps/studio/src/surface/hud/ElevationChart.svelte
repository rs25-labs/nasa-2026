<script lang="ts">
  import { drive } from '../../lib/mission/drive.svelte';

  const WIDTH = 308;
  const HEIGHT = 84;

  const route = $derived(drive.route);
  const t = $derived(drive.telemetry);

  const profile = $derived.by(() => {
    const points = route?.points ?? [];
    if (points.length < 2) return null;
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (const p of points) {
      low = Math.min(low, p.elevation_m);
      high = Math.max(high, p.elevation_m);
    }
    const length = points[points.length - 1]!.distance_m || 1;
    const range = Math.max(1, high - low);
    const xy = points.map((p) => [(p.distance_m / length) * WIDTH, HEIGHT - 4 - ((p.elevation_m - low) / range) * (HEIGHT - 10)] as const);
    const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    return { low, high, length, line, area: `0,${HEIGHT} ${line} ${WIDTH},${HEIGHT}`, xy };
  });

  // Rover marker: its share of the route, on the profile line.
  const marker = $derived.by(() => {
    if (!profile || t.totalM <= 0) return null;
    const x = Math.max(0, Math.min(1, t.progressM / t.totalM)) * WIDTH;
    const xy = profile.xy;
    let k = 0;
    while (k + 2 < xy.length && xy[k + 1]![0] < x) k += 1;
    const [x0, y0] = xy[k]!;
    const [x1, y1] = xy[k + 1]!;
    const share = x1 > x0 ? (x - x0) / (x1 - x0) : 0;
    return { x, y: y0 + (y1 - y0) * Math.max(0, Math.min(1, share)) };
  });
</script>

{#if profile && route}
  <div class="border-t border-[rgb(255_255_255/0.2)] pb-1 pt-[7px]">
    <div class="flex items-baseline justify-between">
      <span class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Elevation</span>
      <span class="text-[11px] text-ink">up {Math.round(route.ascent_m)} m · down {Math.round(route.descent_m)} m · steepest {route.max_slope_deg.toFixed(0)}°</span>
    </div>
    <svg viewBox="0 0 {WIDTH} {HEIGHT}" width="100%" height={HEIGHT} class="mt-1 block" role="img" aria-label="Elevation along the route">
      <polygon points={profile.area} fill="rgb(110 168 224 / 0.25)" />
      <polyline points={profile.line} fill="none" stroke="#6ea8e0" stroke-width="2" />
      {#if marker}
        <line x1={marker.x} y1="0" x2={marker.x} y2={HEIGHT} stroke="rgb(255 255 255 / 0.5)" stroke-width="1" />
        <circle cx={marker.x} cy={marker.y} r="5" fill="#3ddc84" stroke="#06080a" stroke-width="2" />
      {/if}
    </svg>
    <div class="flex justify-between text-[11px] text-ink">
      <span>{Math.round(profile.low)} to {Math.round(profile.high)} m</span>
      <span>{(profile.length / 1000).toFixed(2)} km</span>
    </div>
  </div>
{/if}

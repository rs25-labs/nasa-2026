<script lang="ts">
  import { siteLabel } from '../../lib/mission/labels';
  import type { BodySeries } from '../../lib/api/types';
  import { formatDegrees, visibilityWord } from '../../lib/format';
  import { horizonAt, okResult, sampleAt, visibilityOf, type Visibility } from '../../lib/mission/derive';
  import { useSession } from '../../lib/mission/session';
  import { linePath, rangeFor, segmentsPath, ticksFor, trackSegments, unwrapNear } from './geometry';
  import Busy from '../Busy.svelte';

  type Centring = 'full' | 'sun' | 'earth';
  type Side = 'left' | 'right';

  let { class: className = '' }: { class?: string } = $props();

  const { mission, estimates } = useSession();

  const CENTRINGS: { id: Centring; label: string }[] = [
    { id: 'full', label: 'Full circle' },
    { id: 'sun', label: 'Follow Sun' },
    { id: 'earth', label: 'Follow Earth' },
  ];
  const FOLLOW_WIDTH_DEG = 120;
  const MIN_PANORAMA_SPAN_DEG = 12;
  const MIN_ELEVATION_SPAN_DEG = 6;
  const MIN_DISC_RADIUS_PX = 5;
  const COPIES = [-360, 0, 360];
  const CARDINALS: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W', 360: 'N' };
  const LEFT = 36;
  const RIGHT = 8;
  const TOP = 8;
  const BOTTOM = 18;

  let centring = $state<Centring>('full');
  let panoramaWidth = $state(0);
  let panoramaHeight = $state(0);
  let elevationWidth = $state(0);
  let elevationHeight = $state(0);
  let bodyHeight = $state(0);
  // Below this height the elevation chart is dropped so the panorama keeps room, instead of scrolling.
  const MIN_BODY_FOR_ELEVATION_PX = 150;
  const showElevation = $derived(bodyHeight === 0 || bodyHeight >= MIN_BODY_FOR_ELEVATION_PX);

  const selected = $derived(mission.selectedSiteId ? estimates.bySiteId[mission.selectedSiteId] : undefined);
  const result = $derived(okResult(selected));
  const site = $derived(mission.sites.find((candidate) => candidate.id === mission.selectedSiteId));
  const failure = $derived(selected && !selected.ok ? selected.error : null);

  const plotWidth = $derived(Math.max(0, panoramaWidth - LEFT - RIGHT));
  const plotHeight = $derived(Math.max(0, panoramaHeight - TOP - BOTTOM));

  // Static geometry: recomputed only when the result or the panel size changes.
  const panoramaRange = $derived.by(() => {
    if (!result) return null;
    const values = [...result.horizon_elevation_deg];
    for (const series of [result.series.sun, result.series.earth]) {
      series.elevation_deg.forEach((elevation, hour) => {
        const radius = series.angular_radius_deg[hour] ?? 0;
        values.push(elevation - radius, elevation + radius);
      });
    }
    return rangeFor(values, MIN_PANORAMA_SPAN_DEG, 5);
  });

  const yOfPanorama = $derived.by(() => {
    const range = panoramaRange;
    const height = plotHeight;
    return (elevationDeg: number): number =>
      range ? TOP + ((range.high - elevationDeg) / (range.high - range.low)) * height : TOP;
  });

  const pixelsPerDegreeY = $derived(panoramaRange ? plotHeight / (panoramaRange.high - panoramaRange.low) : 0);

  const skyline = $derived.by(() => {
    if (!result) return null;
    const bottom = TOP + plotHeight + 40;
    const count = result.horizon_elevation_deg.length;
    const step = 360 / count;
    const points: string[] = [];
    let firstX = 0;
    let lastX = 0;
    for (let index = 0; index <= count * 3; index += 1) {
      const azimuth = -360 + index * step;
      const elevation = result.horizon_elevation_deg[index % count] ?? 0;
      if (index === 0) firstX = azimuth;
      lastX = azimuth;
      points.push(`${index === 0 ? 'M' : 'L'}${azimuth.toFixed(2)} ${yOfPanorama(elevation).toFixed(1)}`);
    }
    const edge = points.join('');
    return { edge, fill: `${edge}L${lastX} ${bottom}L${firstX} ${bottom}Z` };
  });

  const fullTracks = $derived.by(() => {
    if (!result) return null;
    return {
      sun: segmentsPath(trackSegments(result.series.sun), yOfPanorama, COPIES),
      earth: segmentsPath(trackSegments(result.series.earth), yOfPanorama, COPIES),
    };
  });

  const yGrid = $derived(
    panoramaRange
      ? ticksFor(panoramaRange).map((value) => ({ value, y: yOfPanorama(value) }))
      : [],
  );

  // Clock-driven values.
  interface BodyView {
    azimuthDeg: number;
    elevationDeg: number;
    radiusDeg: number;
    state: Visibility;
    marginDeg: number;
  }

  function viewOf(series: BodySeries, horizon: number[]): BodyView {
    const sample = sampleAt(series, mission.clockIndex);
    const marginDeg = sample.elevationDeg - horizonAt(horizon, sample.azimuthDeg);
    return {
      azimuthDeg: sample.azimuthDeg,
      elevationDeg: sample.elevationDeg,
      radiusDeg: sample.angularRadiusDeg,
      state: visibilityOf(sample.fraction),
      marginDeg,
    };
  }

  const sun = $derived(result ? viewOf(result.series.sun, result.horizon_elevation_deg) : null);
  const earth = $derived(result ? viewOf(result.series.earth, result.horizon_elevation_deg) : null);

  const centreDeg = $derived(centring === 'sun' && sun ? sun.azimuthDeg : centring === 'earth' && earth ? earth.azimuthDeg : 180);
  const windowWidthDeg = $derived(centring === 'full' ? 360 : FOLLOW_WIDTH_DEG);
  const windowStartDeg = $derived(centring === 'full' ? 0 : centreDeg - FOLLOW_WIDTH_DEG / 2);
  const pixelsPerDegreeX = $derived(plotWidth / windowWidthDeg);
  const groupTransform = $derived(`translate(${LEFT - windowStartDeg * pixelsPerDegreeX} 0) scale(${pixelsPerDegreeX} 1)`);

  const elapsedTracks = $derived.by(() => {
    if (!result) return null;
    return {
      sun: segmentsPath(trackSegments(result.series.sun, mission.clockIndex), yOfPanorama, COPIES),
      earth: segmentsPath(trackSegments(result.series.earth, mission.clockIndex), yOfPanorama, COPIES),
    };
  });

  function xOf(azimuthDeg: number): number {
    return LEFT + (unwrapNear(azimuthDeg, centreDeg) - windowStartDeg) * pixelsPerDegreeX;
  }

  interface Disc {
    id: 'Sun' | 'Earth';
    view: BodyView;
    x: number;
    y: number;
    radius: number;
    trueRadius: number;
    side: Side;
  }

  const discs = $derived.by((): Disc[] => {
    if (!sun || !earth || plotWidth <= 0) return [];
    const make = (id: 'Sun' | 'Earth', view: BodyView): Omit<Disc, 'side'> => {
      const trueRadius = view.radiusDeg * pixelsPerDegreeY;
      return {
        id,
        view,
        x: xOf(view.azimuthDeg),
        y: yOfPanorama(view.elevationDeg),
        radius: Math.max(MIN_DISC_RADIUS_PX, trueRadius),
        trueRadius,
      };
    };
    const base = [make('Sun', sun), make('Earth', earth)];
    return base.map((disc, index) => {
      const other = base[1 - index]!;
      let side: Side = Math.abs(other.x - disc.x) < 90 ? (disc.x <= other.x ? 'left' : 'right') : 'right';
      if (side === 'right' && disc.x + disc.radius + 56 > LEFT + plotWidth) side = 'left';
      if (side === 'left' && disc.x - disc.radius - 56 < LEFT) side = 'right';
      return { ...disc, side };
    });
  });

  const xTicks = $derived.by(() => {
    if (plotWidth <= 0) return [];
    const step = centring === 'full' ? 30 : plotWidth < 420 ? 30 : 15;
    const first = Math.ceil(windowStartDeg / step) * step;
    const ticks: { x: number; label: string }[] = [];
    for (let azimuth = first; azimuth <= windowStartDeg + windowWidthDeg + 1e-9; azimuth += step) {
      const normalized = ((azimuth % 360) + 360) % 360;
      const label = centring === 'full' ? CARDINALS[azimuth] : CARDINALS[normalized];
      ticks.push({
        x: LEFT + (azimuth - windowStartDeg) * pixelsPerDegreeX,
        label: label ?? `${normalized}`,
      });
    }
    return ticks;
  });

  // Elevation over the stay.
  const stayHours = $derived(result ? Math.max(1, result.series.sun.fraction.length - 1) : 1);
  const E_LEFT = LEFT;
  const E_TOP = 6;
  const E_BOTTOM = 16;
  const elevationPlotWidth = $derived(Math.max(0, elevationWidth - E_LEFT - RIGHT));
  const elevationPlotHeight = $derived(Math.max(0, elevationHeight - E_TOP - E_BOTTOM));

  const stayLines = $derived.by(() => {
    if (!result) return null;
    const horizon = result.horizon_elevation_deg;
    const sunSeries = result.series.sun;
    const earthSeries = result.series.earth;
    const sunHorizon = sunSeries.azimuth_deg.map((azimuth) => horizonAt(horizon, azimuth));
    const earthHorizon = earthSeries.azimuth_deg.map((azimuth) => horizonAt(horizon, azimuth));
    const range = rangeFor(
      [...sunSeries.elevation_deg, ...earthSeries.elevation_deg, ...sunHorizon, ...earthHorizon],
      MIN_ELEVATION_SPAN_DEG,
      3,
    );
    const yOf = (elevationDeg: number): number =>
      E_TOP + ((range.high - elevationDeg) / (range.high - range.low)) * elevationPlotHeight;
    const xs = sunSeries.elevation_deg.map((_, hour) => E_LEFT + (hour / stayHours) * elevationPlotWidth);
    const line = (values: number[]): string =>
      linePath(
        xs,
        values.map((value) => yOf(value)),
      );
    const dayCount = Math.floor(stayHours / 24);
    const dayStep = dayCount > 10 ? Math.ceil(dayCount / 8) : 1;
    const days: { x: number; label: string }[] = [];
    for (let day = 0; day <= dayCount; day += dayStep) {
      const date = new Date(Date.parse(mission.startUtc) + day * 86_400_000);
      days.push({
        x: E_LEFT + ((day * 24) / stayHours) * elevationPlotWidth,
        label: date.toISOString().slice(5, 10),
      });
    }
    return {
      sun: line(sunSeries.elevation_deg),
      earth: line(earthSeries.elevation_deg),
      sunHorizon: line(sunHorizon),
      earthHorizon: line(earthHorizon),
      grid: ticksFor(range).map((value) => ({ value, y: yOf(value) })),
      zeroY: yOf(0),
      range,
      days,
    };
  });

  const cursorX = $derived(E_LEFT + (Math.min(mission.clockIndex, stayHours) / stayHours) * elevationPlotWidth);

  function rangeLabel(range: { low: number; high: number }): string {
    const digits = Number.isInteger(range.low) && Number.isInteger(range.high) ? 0 : 1;
    return `${formatDegrees(range.low, digits)} to ${formatDegrees(range.high, digits)}`;
  }

  function sentence(name: string, view: BodyView): string {
    const margin = view.marginDeg;
    const position = `${formatDegrees(Math.abs(margin))} ${margin >= 0 ? 'above' : 'below'} the skyline`;
    return `${name} elevation ${formatDegrees(view.elevationDeg)}, bearing ${formatDegrees(view.azimuthDeg, 0)}, ${position}${view.state === 'visible' ? '' : `, ${visibilityWord(view.state)}`}.`;
  }

  const description = $derived(
    sun && earth ? `${site ? siteLabel(site).short : 'Selected site'}. ${sentence('Sun', sun)} ${sentence('Earth', earth)}` : 'Sky view',
  );
</script>

<section aria-label="Sky" class="flex min-h-0 min-w-0 flex-col overflow-hidden bg-panel {className}">
  <header class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-rule px-3 py-1.5">
    <h2 class="truncate text-xs font-semibold">Sky{site ? `, ${siteLabel(site).short}` : ''}</h2>
    <div role="group" aria-label="View centring" class="flex border border-rule">
      {#each CENTRINGS as option (option.id)}
        <button
          type="button"
          aria-pressed={centring === option.id}
          class="px-2 py-0.5 text-xs {centring === option.id ? 'bg-rule text-ink' : 'text-muted hover:text-ink'}"
          onclick={() => (centring = option.id)}
        >
          {option.label}
        </button>
      {/each}
    </div>
  </header>

  {#if failure}
    <p class="p-3 text-xs text-muted">{failure}</p>
  {:else if !result}
    {#if estimates.status === 'loading'}
      <div class="flex flex-1 items-center justify-center p-3"><Busy text="Calculating the sky…" /></div>
    {:else}
      <p class="p-3 text-xs text-muted">…</p>
    {/if}
  {:else}
    <div class="flex min-h-0 flex-1 flex-col" bind:clientHeight={bodyHeight}>
    <div class="min-h-0 flex-[3_1_0]" bind:clientWidth={panoramaWidth} bind:clientHeight={panoramaHeight}>
      {#if plotWidth > 0 && plotHeight > 0 && skyline && fullTracks && elapsedTracks && panoramaRange}
        <svg width={panoramaWidth} height={panoramaHeight} role="img" aria-label={description} class="block">
          <defs>
            <clipPath id="sky-plot-clip">
              <rect x={LEFT} y={TOP} width={plotWidth} height={plotHeight} />
            </clipPath>
          </defs>

          {#each yGrid as line (line.value)}
            <line x1={LEFT} x2={LEFT + plotWidth} y1={line.y} y2={line.y} class="stroke-rule" stroke-width="1" />
            <text x={LEFT - 4} y={line.y + 3} text-anchor="end" class="fill-muted text-[10px]">{formatDegrees(line.value, 0)}</text>
          {/each}

          <g clip-path="url(#sky-plot-clip)">
            {#each discs as disc (disc.id)}
              {#each COPIES as copy (copy)}
                {#if disc.view.state !== 'hidden'}
                  <circle
                    cx={disc.x + copy * pixelsPerDegreeX}
                    cy={disc.y}
                    r={disc.radius}
                    class={disc.id === 'Sun' ? 'fill-sun' : 'fill-earth'}
                  />
                {/if}
              {/each}
            {/each}

            <g transform={groupTransform}>
              <path d={skyline.fill} class="fill-rule" />
              <path d={fullTracks.sun} fill="none" class="stroke-sun" stroke-opacity="0.35" stroke-width="1" vector-effect="non-scaling-stroke" />
              <path d={fullTracks.earth} fill="none" class="stroke-earth" stroke-opacity="0.35" stroke-width="1" vector-effect="non-scaling-stroke" />
              <path d={elapsedTracks.sun} fill="none" class="stroke-sun" stroke-opacity="0.75" stroke-width="1.5" vector-effect="non-scaling-stroke" />
              <path d={elapsedTracks.earth} fill="none" class="stroke-earth" stroke-opacity="0.75" stroke-width="1.5" vector-effect="non-scaling-stroke" />
              <path d={skyline.edge} fill="none" class="stroke-muted" stroke-width="1" vector-effect="non-scaling-stroke" />
            </g>

            <line
              x1={LEFT}
              x2={LEFT + plotWidth}
              y1={yOfPanorama(0)}
              y2={yOfPanorama(0)}
              class="stroke-ink"
              stroke-opacity="0.6"
              stroke-width="1"
              stroke-dasharray="4 3"
            />

            {#each discs as disc (disc.id)}
              {#each COPIES as copy (copy)}
                {#if disc.trueRadius < MIN_DISC_RADIUS_PX}
                  <circle
                    cx={disc.x + copy * pixelsPerDegreeX}
                    cy={disc.y}
                    r={disc.trueRadius}
                    fill="none"
                    class={disc.id === 'Sun' ? 'stroke-sun' : 'stroke-earth'}
                    stroke-width="0.75"
                  />
                {/if}
                {#if disc.view.state === 'hidden'}
                  <circle
                    cx={disc.x + copy * pixelsPerDegreeX}
                    cy={disc.y}
                    r={disc.radius}
                    fill="none"
                    class={disc.id === 'Sun' ? 'stroke-sun' : 'stroke-earth'}
                    stroke-width="1.5"
                  />
                {/if}
              {/each}
            {/each}
          </g>

          <text x={LEFT + plotWidth - 4} y={TOP + 10} text-anchor="end" class="fill-muted stroke-panel text-[10px] [paint-order:stroke]" stroke-width="3">
            <title>The vertical scale changes with the site</title>
            Vertical scale {rangeLabel(panoramaRange)}
          </text>
          <text x={LEFT + plotWidth - 4} y={yOfPanorama(0) - 4} text-anchor="end" class="fill-muted stroke-panel text-[10px] [paint-order:stroke]" stroke-width="3">0° horizon level</text>

          {#each discs as disc (disc.id)}
            <text
              x={disc.side === 'right' ? disc.x + disc.radius + 4 : disc.x - disc.radius - 4}
              y={Math.max(TOP + 10, disc.y - disc.radius - 3)}
              text-anchor={disc.side === 'right' ? 'start' : 'end'}
              stroke-width="3" class="stroke-panel text-[11px] [paint-order:stroke] {disc.id === 'Sun' ? 'fill-sun' : 'fill-earth'}"
            >
              {disc.id}{disc.view.state === 'visible' ? '' : `, ${visibilityWord(disc.view.state)}`}
            </text>
          {/each}

          {#each xTicks as tick (tick.x)}
            <line x1={tick.x} x2={tick.x} y1={TOP + plotHeight} y2={TOP + plotHeight + 3} class="stroke-muted" stroke-width="1" />
            <text
              x={tick.x}
              y={TOP + plotHeight + 13}
              text-anchor="middle"
              class="text-[10px] {tick.label.length === 1 ? 'fill-ink' : 'fill-muted'}"
            >
              {tick.label}
            </text>
          {/each}
        </svg>
      {/if}
    </div>

    {#if showElevation}
    <div class="min-h-0 flex-[2_1_0] border-t border-rule" bind:clientWidth={elevationWidth} bind:clientHeight={elevationHeight}>
      {#if elevationPlotWidth > 0 && elevationPlotHeight > 0 && stayLines}
        <svg width={elevationWidth} height={elevationHeight} role="img" aria-label="Elevation over the stay. {description}" class="block">
          {#each stayLines.grid as line (line.value)}
            <line x1={E_LEFT} x2={E_LEFT + elevationPlotWidth} y1={line.y} y2={line.y} class="stroke-rule" stroke-width="1" />
            <text x={E_LEFT - 4} y={line.y + 3} text-anchor="end" class="fill-muted text-[10px]">{formatDegrees(line.value, 0)}</text>
          {/each}
          <line
            x1={E_LEFT}
            x2={E_LEFT + elevationPlotWidth}
            y1={stayLines.zeroY}
            y2={stayLines.zeroY}
            class="stroke-ink"
            stroke-opacity="0.6"
            stroke-width="1"
            stroke-dasharray="4 3"
          />

          <path d={stayLines.sunHorizon} fill="none" class="stroke-sun" stroke-opacity="0.7" stroke-width="1" stroke-dasharray="3 3" />
          <path d={stayLines.earthHorizon} fill="none" class="stroke-earth" stroke-opacity="0.7" stroke-width="1" stroke-dasharray="3 3" />
          <path d={stayLines.sun} fill="none" class="stroke-sun" stroke-width="1.5" />
          <path d={stayLines.earth} fill="none" class="stroke-earth" stroke-width="1.5" />
          <line x1={cursorX} x2={cursorX} y1={E_TOP} y2={E_TOP + elevationPlotHeight} class="stroke-ink" stroke-width="1" />

          {#each stayLines.days as day (day.x)}
            <line x1={day.x} x2={day.x} y1={E_TOP + elevationPlotHeight} y2={E_TOP + elevationPlotHeight + 3} class="stroke-muted" stroke-width="1" />
            <text x={day.x} y={E_TOP + elevationPlotHeight + 13} text-anchor="middle" class="fill-muted text-[10px]">{day.label}</text>
          {/each}

          <text x={E_LEFT + elevationPlotWidth - 4} y={E_TOP + 10} text-anchor="end" class="fill-muted text-[10px]">
            <title>The vertical scale changes with the site</title>
            Vertical scale {rangeLabel(stayLines.range)}
          </text>
          <g class="text-[10px]">
            <line x1={E_LEFT + 6} x2={E_LEFT + 22} y1={E_TOP + 8} y2={E_TOP + 8} class="stroke-sun" stroke-width="1.5" />
            <text x={E_LEFT + 26} y={E_TOP + 11} class="fill-muted">Sun</text>
            <line x1={E_LEFT + 52} x2={E_LEFT + 68} y1={E_TOP + 8} y2={E_TOP + 8} class="stroke-earth" stroke-width="1.5" />
            <text x={E_LEFT + 72} y={E_TOP + 11} class="fill-muted">Earth</text>
            <line x1={E_LEFT + 104} x2={E_LEFT + 120} y1={E_TOP + 8} y2={E_TOP + 8} class="stroke-muted" stroke-width="1" stroke-dasharray="3 3" />
            <text x={E_LEFT + 124} y={E_TOP + 11} class="fill-muted">skyline in its direction</text>
          </g>
        </svg>
      {/if}
    </div>
    {/if}
    </div>
  {/if}
</section>

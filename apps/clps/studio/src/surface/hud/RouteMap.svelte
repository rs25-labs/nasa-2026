<script lang="ts">
  import { api } from '../../lib/api/client';
  import { polarXY } from '../../lib/geo/polar';
  import { drive } from '../../lib/mission/drive.svelte';

  interface Props {
    originLatitudeDeg: number;
    originLongitudeDeg: number;
  }
  const { originLatitudeDeg, originLongitudeDeg }: Props = $props();

  const SIZE = 280;
  const TILE = 257;
  /** Half-widths of the map, metres: the smallest that holds the rover, the target and the route. */
  const HALF_SPANS = [500, 1000, 2000, 4000, 9000] as const;

  let canvas: HTMLCanvasElement | undefined = $state();
  let relief: ImageBitmap | HTMLCanvasElement | null = $state.raw(null);
  let reliefHalf = $state(0);

  const origin = $derived(polarXY(originLatitudeDeg, originLongitudeDeg));
  const t = $derived(drive.telemetry);
  const points = $derived(drive.route ? drive.route.points.map((p) => ({ x: p.x_m - origin.x, z: -(p.y_m - origin.y) })) : []);

  const half = $derived.by(() => {
    let reach = Math.hypot(t.x, t.z);
    if (drive.target) reach = Math.max(reach, Math.hypot(drive.target.x, drive.target.z));
    for (const p of points) reach = Math.max(reach, Math.hypot(p.x, p.z));
    return HALF_SPANS.find((value) => reach <= value * 0.8) ?? HALF_SPANS[HALF_SPANS.length - 1]!;
  });

  // Shaded relief for the current span, lit from the upper left.
  $effect(() => {
    const wanted = half;
    const controller = new AbortController();
    api
      .terrainTile({ x: origin.x, y: origin.y, span: wanted * 2, size: TILE }, controller.signal)
      .then((tile) => {
        const image = new ImageData(TILE, TILE);
        const spacing = (wanted * 2) / (TILE - 1);
        const at = (column: number, row: number): number => tile.heights[Math.max(0, Math.min(TILE - 1, row)) * TILE + Math.max(0, Math.min(TILE - 1, column))] ?? Number.NaN;
        // Relief from the slope toward the upper left, with the area's overall tilt removed and the contrast set by its spread.
        const slope = new Float32Array(TILE * TILE);
        let sum = 0;
        let count = 0;
        for (let row = 0; row < TILE; row += 1) {
          for (let column = 0; column < TILE; column += 1) {
            const value = (at(column + 1, row) - at(column - 1, row) + at(column, row + 1) - at(column, row - 1)) / (2 * spacing);
            slope[row * TILE + column] = value;
            if (Number.isFinite(value)) {
              sum += value;
              count += 1;
            }
          }
        }
        const mean = count > 0 ? sum / count : 0;
        let squares = 0;
        for (const value of slope) if (Number.isFinite(value)) squares += (value - mean) ** 2;
        const spread = Math.max(1e-4, Math.sqrt(squares / Math.max(1, count)));
        for (let index = 0; index < slope.length; index += 1) {
          const value = slope[index]!;
          const shade = Number.isFinite(value) ? Math.max(0, Math.min(1, 0.45 - (0.22 * (value - mean)) / spread)) : 0;
          const grey = Math.round(18 + 190 * shade);
          image.data[index * 4] = grey;
          image.data[index * 4 + 1] = grey;
          image.data[index * 4 + 2] = Math.round(grey * 0.96);
          image.data[index * 4 + 3] = 255;
        }
        const buffer = document.createElement('canvas');
        buffer.width = TILE;
        buffer.height = TILE;
        buffer.getContext('2d')?.putImageData(image, 0, 0);
        relief = buffer;
        reliefHalf = wanted;
      })
      .catch(() => undefined);
    return () => controller.abort();
  });

  const toPixel = (value: number, span: number): number => (value / span / 2 + 0.5) * SIZE;

  $effect(() => {
    const context = canvas?.getContext('2d');
    if (!context) return;
    const span = half;
    context.fillStyle = '#0b0b0c';
    context.fillRect(0, 0, SIZE, SIZE);
    if (relief && reliefHalf === span) context.drawImage(relief, 0, 0, SIZE, SIZE);

    if (points.length > 1) {
      context.lineWidth = 2.5;
      context.lineJoin = 'round';
      context.strokeStyle = '#f2b24a';
      context.beginPath();
      context.moveTo(toPixel(0, span), toPixel(0, span));
      for (const p of points) context.lineTo(toPixel(p.x, span), toPixel(p.z, span));
      context.stroke();
    }
    // Landing site.
    context.fillStyle = '#ecebe6';
    context.fillRect(toPixel(0, span) - 3, toPixel(0, span) - 3, 6, 6);
    if (drive.target) {
      const x = toPixel(drive.target.x, span);
      const y = toPixel(drive.target.z, span);
      context.strokeStyle = '#ff3b30';
      context.lineWidth = 2.5;
      context.beginPath();
      context.arc(x, y, 7, 0, Math.PI * 2);
      context.moveTo(x - 11, y);
      context.lineTo(x + 11, y);
      context.moveTo(x, y - 11);
      context.lineTo(x, y + 11);
      context.stroke();
    }
    // Rover.
    const rx = toPixel(t.x, span);
    const ry = toPixel(t.z, span);
    context.fillStyle = '#3ddc84';
    context.strokeStyle = '#06080a';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(rx, ry, 6, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });

  function pick(event: MouseEvent): void {
    const box = canvas?.getBoundingClientRect();
    if (!box) return;
    const x = ((event.clientX - box.left) / box.width - 0.5) * 2 * half;
    const z = ((event.clientY - box.top) / box.height - 0.5) * 2 * half;
    drive.commands?.setTargetAt(x, z);
    drive.panelOpen = true;
  }

  const scaleM = $derived(half / 2);
</script>

<section class="absolute bottom-4 left-4 border border-[rgb(255_255_255/0.28)] bg-[rgb(6_8_10/0.8)] p-2 text-ink" aria-label="Route map">
  <div class="mb-1 flex items-baseline justify-between">
    <span class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Map</span>
    <span class="text-[11px] text-ink">
      <span style="color: #3ddc84">●</span> rover <span class="ml-2" style="color: #ff3b30">⊕</span> target
    </span>
  </div>
  <canvas bind:this={canvas} width={SIZE} height={SIZE} class="block cursor-crosshair" style="width: {SIZE}px; height: {SIZE}px" onclick={pick} aria-label="Click to set the drive target"></canvas>
  <div class="mt-1 flex items-center gap-2 text-[11px] text-ink">
    <span class="block h-[3px] bg-ink" style="width: {SIZE / 4}px"></span>
    <span>{scaleM >= 1000 ? `${scaleM / 1000} km` : `${scaleM} m`}</span>
    <span class="ml-auto text-muted">click to set target</span>
  </div>
</section>

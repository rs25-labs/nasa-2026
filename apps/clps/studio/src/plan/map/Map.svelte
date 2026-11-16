<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { api, ApiError, type CatalogSite } from '../../lib/api/client';
  import { isOnPolarMap, polarLatLon, polarXY } from '../../lib/geo/polar';
  import { clockTimeMs } from '../../lib/mission/derive';
  import { siteLabel } from '../../lib/mission/labels';
  import { mission, actions, MAX_SITES } from '../../lib/mission/store.svelte';
  import { addCatalogSite, addCustomSite, FULL_REASON, isFull } from './adding';
  import { renderRelief, type ReliefLayers } from './relief';
  import SiteAdder from './SiteAdder.svelte';

  let { class: className = '' }: { class?: string } = $props();

  const MIN_SPAN_M = 7_680;
  const MAX_SPAN_M = 320_000;
  const MAX_CENTRE_M = 200_000;
  const CLICK_SLOP_PX = 4;
  const SITE_HIT_PX = 14;
  const DOT_HIT_PX = 9;
  const SETTLE_MS = 250;

  const SHADOW_SIZE = 256;
  const SHADOW_MIN_INTERVAL_MS = 250;
  const SHADOW_TIME_STEP_MS = 300_000;
  const SHADOW_MAX_DARKNESS = 0.85;
  const SHADOW_LIT = 250;
  const SHADOW_NO_DATA = 255;

  interface ShadowLayer {
    centreX: number;
    centreY: number;
    span: number;
    canvas: HTMLCanvasElement;
    /** Direction of the Sun on the map, degrees clockwise from the top of the map. */
    mapBearingDeg: number;
    sunAzimuthDeg: number;
  }

  interface Fetched {
    centreX: number;
    centreY: number;
    span: number;
    layers: ReliefLayers;
  }

  let area: HTMLDivElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  let side = $state(0);
  let areaWidth = $state(0);
  let hoverId = $state<string | null>(null);
  let view = $state({ x: 0, y: 0, span: MAX_SPAN_M });
  let fetched = $state.raw<Fetched | null>(null);
  let loading = $state(true);
  let errorText = $state('');
  let notice = $state('');
  let catalog = $state.raw<CatalogSite[]>([]);
  let listError = $state('');
  let shadowOn = $state(true);
  let shadow = $state.raw<ShadowLayer | null>(null);
  let shadowError = $state('');

  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let drag: { startX: number; startY: number; viewX: number; viewY: number; moved: boolean } | null = null;
  let lastSelectedId: string | null = null;
  let shadowController: AbortController | undefined;
  let shadowTimer: ReturnType<typeof setTimeout> | undefined;
  let shadowLastStart = 0;
  let shadowWanted: { x: number; y: number; span: number; utc: string } | null = null;
  let shadowKey = '';

  const scale = $derived(side > 0 ? side / view.span : 1);

  const storeIds = $derived(new Set(mission.sites.map((site) => site.id)));
  const placed = $derived(
    mission.sites
      .filter((site) => isOnPolarMap(site.latitudeDeg))
      .map((site) => ({ site, ...polarXY(site.latitudeDeg, site.longitudeDeg) })),
  );
  const offMap = $derived(mission.sites.filter((site) => !isOnPolarMap(site.latitudeDeg)));
  const dots = $derived(
    catalog
      .filter((site) => !storeIds.has(site.site_id) && isOnPolarMap(site.latitude_deg))
      .map((site) => ({ site, ...polarXY(site.latitude_deg, site.longitude_deg) })),
  );
  const selectedPlaced = $derived(placed.find((entry) => entry.site.id === mission.selectedSiteId));

  const screenX = (x: number): number => side / 2 + (x - view.x) * scale;
  const screenY = (y: number): number => side / 2 - (y - view.y) * scale;

  const scaleBar = $derived.by(() => {
    const targetKm = (side * 0.25) / scale / 1000;
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(targetKm, 0.001)));
    const nice = [5, 2, 1].map((m) => m * magnitude).find((km) => km <= targetKm) ?? magnitude;
    return { km: nice, px: nice * 1000 * scale };
  });

  const widthKm = $derived(view.span / 1000);
  const statusText = $derived(notice || errorText || shadowError || (loading ? 'Loading terrain…' : ''));

  function formatKm(km: number): string {
    return km >= 100 ? String(Math.round(km)) : km >= 10 ? km.toFixed(0) : km >= 1 ? km.toFixed(1) : km.toFixed(2);
  }

  function clamp(value: number, low: number, high: number): number {
    return Math.min(high, Math.max(low, value));
  }

  function setView(x: number, y: number, span: number): void {
    view.span = clamp(span, MIN_SPAN_M, MAX_SPAN_M);
    view.x = clamp(x, -MAX_CENTRE_M, MAX_CENTRE_M);
    view.y = clamp(y, -MAX_CENTRE_M, MAX_CENTRE_M);
  }

  function say(message: string): void {
    notice = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ''), 3500);
  }

  function zoomAbout(factor: number, pixelX: number, pixelY: number): void {
    const span = clamp(view.span * factor, MIN_SPAN_M, MAX_SPAN_M);
    const worldX = view.x + (pixelX - side / 2) / scale;
    const worldY = view.y - (pixelY - side / 2) / scale;
    const nextScale = side / span;
    setView(worldX - (pixelX - side / 2) / nextScale, worldY + (pixelY - side / 2) / nextScale, span);
  }

  function zoomCentre(factor: number): void {
    setView(view.x, view.y, view.span * factor);
  }

  function centreOnSelected(): void {
    if (selectedPlaced) setView(selectedPlaced.x, selectedPlaced.y, view.span);
  }

  async function loadViewport(): Promise<void> {
    controller?.abort();
    const request = new AbortController();
    controller = request;
    loading = true;
    try {
      const data = await api.terrainViewport(
        { x: Math.round(view.x), y: Math.round(view.y), span: Math.round(view.span) },
        request.signal,
      );
      if (request.signal.aborted) return;
      fetched = {
        centreX: data.center_x_m,
        centreY: data.center_y_m,
        span: data.span_m,
        layers: renderRelief(data.elevations, data.display_spacing_m),
      };
      errorText = '';
      loading = false;
    } catch (cause) {
      if (request.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) return;
      errorText = cause instanceof ApiError ? cause.message : 'Terrain could not be loaded.';
      loading = false;
    }
  }

  /** Black layer whose opacity grows with the shadowed share of each cell. */
  function shadowCanvas(cells: Uint8Array): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = SHADOW_SIZE;
    canvas.height = SHADOW_SIZE;
    const context = canvas.getContext('2d');
    if (!context) return canvas;
    const image = context.createImageData(SHADOW_SIZE, SHADOW_SIZE);
    for (let index = 0; index < cells.length; index += 1) {
      const code = cells[index] ?? SHADOW_NO_DATA;
      const dark = code >= SHADOW_LIT ? 0 : (1 - code / SHADOW_LIT) * SHADOW_MAX_DARKNESS;
      image.data[index * 4 + 3] = Math.round(dark * 255);
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  async function loadShadow(request: NonNullable<typeof shadowWanted>): Promise<void> {
    shadowController?.abort();
    const controller = new AbortController();
    shadowController = controller;
    shadowLastStart = performance.now();
    try {
      const mask = await api.terrainShadow({ ...request, size: SHADOW_SIZE }, controller.signal);
      if (controller.signal.aborted) return;
      const centreLongitude = polarLatLon(request.x, request.y).longitudeDeg;
      shadow = {
        centreX: request.x,
        centreY: request.y,
        span: request.span,
        canvas: shadowCanvas(mask.cells),
        mapBearingDeg: centreLongitude + mask.sunAzimuthDeg,
        sunAzimuthDeg: mask.sunAzimuthDeg,
      };
      shadowError = '';
    } catch (cause) {
      if (controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) return;
      shadowError = 'Sunlight overlay could not be loaded.';
    }
  }

  // At most about four requests a second; the newest wanted view and time always wins.
  function scheduleShadow(request: NonNullable<typeof shadowWanted>): void {
    const key = `${request.x},${request.y},${request.span},${request.utc}`;
    if (key === shadowKey) return;
    shadowKey = key;
    shadowWanted = request;
    if (shadowTimer !== undefined) return;
    const wait = Math.max(0, SHADOW_MIN_INTERVAL_MS - (performance.now() - shadowLastStart));
    shadowTimer = setTimeout(() => {
      shadowTimer = undefined;
      const next = shadowWanted;
      shadowWanted = null;
      if (next) void loadShadow(next);
    }, wait);
  }

  // A "limit reached" notice no longer applies once a site is removed.
  $effect(() => {
    if (!isFull() && notice === FULL_REASON) {
      notice = '';
      clearTimeout(noticeTimer);
    }
  });

  const clockMs = $derived(
    Math.round(clockTimeMs(mission.startUtc, mission.clockIndex) / SHADOW_TIME_STEP_MS) * SHADOW_TIME_STEP_MS,
  );

  // The mask is fetched even with the overlay off: the Sun-direction tick needs its azimuth.
  $effect(() => {
    const request = {
      x: Math.round(view.x),
      y: Math.round(view.y),
      span: Math.round(view.span),
      utc: new Date(clockMs).toISOString(),
    };
    untrack(() => scheduleShadow(request));
  });

  function scheduleViewport(delayMs: number): void {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => void loadViewport(), delayMs);
  }

  // Re-fetch once the view settles; later changes cancel earlier requests.
  $effect(() => {
    void view.x;
    void view.y;
    void view.span;
    untrack(() => scheduleViewport(fetched === null ? 0 : SETTLE_MS));
  });

  // Recentre when the selection moves to a site outside the current view.
  $effect(() => {
    const id = mission.selectedSiteId;
    untrack(() => {
      if (id === lastSelectedId) return;
      lastSelectedId = id;
      const target = placed.find((entry) => entry.site.id === id);
      if (!target || side === 0) return;
      const px = screenX(target.x);
      const py = screenY(target.y);
      if (px < 0 || py < 0 || px > side || py > side) setView(target.x, target.y, view.span);
    });
  });

  function draw(): void {
    const element = canvas;
    if (!element || side === 0) return;
    const context = element.getContext('2d');
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, side, side);
    const data = fetched;
    if (!data) return;
    const left = screenX(data.centreX - data.span / 2);
    const top = screenY(data.centreY + data.span / 2);
    const size = data.span * scale;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(data.layers.relief, left, top, size, size);
    const layer = shadowOn ? shadow : null;
    if (layer) {
      context.drawImage(
        layer.canvas,
        screenX(layer.centreX - layer.span / 2),
        screenY(layer.centreY + layer.span / 2),
        layer.span * scale,
        layer.span * scale,
      );
    }
    context.imageSmoothingEnabled = false;
    context.drawImage(data.layers.hatch, left, top, size, size);
  }

  $effect(() => {
    void side;
    void view.x;
    void view.y;
    void view.span;
    void fetched;
    void shadow;
    void shadowOn;
    draw();
  });

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      areaWidth = entry.contentRect.width;
      side = Math.max(0, Math.floor(Math.min(entry.contentRect.width, entry.contentRect.height)));
    });
    if (area) observer.observe(area);

    const lists = new AbortController();
    void api.sites(lists.signal).then(
      (sites) => {
        if (lists.signal.aborted) return;
        catalog = sites.sites;
        listError = '';
      },
      () => {
        if (!lists.signal.aborted) listError = 'Site lists could not be loaded.';
      },
    );

    return () => {
      observer.disconnect();
      lists.abort();
      controller?.abort();
      shadowController?.abort();
      clearTimeout(shadowTimer);
      clearTimeout(settleTimer);
      clearTimeout(noticeTimer);
    };
  });

  function localPoint(event: { clientX: number; clientY: number; currentTarget: EventTarget | null }) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = { startX: event.clientX, startY: event.clientY, viewX: view.x, viewY: view.y, moved: false };
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag) {
      updateHover(event);
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < CLICK_SLOP_PX) return;
    drag.moved = true;
    setView(drag.viewX - dx / scale, drag.viewY + dy / scale, view.span);
  }

  function onPointerUp(event: PointerEvent): void {
    const finished = drag;
    drag = null;
    if (finished && !finished.moved) {
      const point = localPoint(event);
      handleClick(point.x, point.y);
    }
  }

  function handleClick(pixelX: number, pixelY: number): void {
    let nearest: { id: string; distance: number } | null = null;
    for (const entry of placed) {
      const distance = Math.hypot(screenX(entry.x) - pixelX, screenY(entry.y) - pixelY);
      if (distance <= SITE_HIT_PX && (!nearest || distance < nearest.distance)) {
        nearest = { id: entry.site.id, distance };
      }
    }
    if (nearest) {
      actions.selectSite(nearest.id);
      return;
    }

    let nearestDot: { site: CatalogSite; distance: number } | null = null;
    for (const entry of dots) {
      const distance = Math.hypot(screenX(entry.x) - pixelX, screenY(entry.y) - pixelY);
      if (distance <= DOT_HIT_PX && (!nearestDot || distance < nearestDot.distance)) {
        nearestDot = { site: entry.site, distance };
      }
    }
    if (nearestDot) {
      if (isFull()) say(FULL_REASON);
      else addCatalogSite(nearestDot.site);
      return;
    }

    const worldX = view.x + (pixelX - side / 2) / scale;
    const worldY = view.y - (pixelY - side / 2) / scale;
    const point = polarLatLon(worldX, worldY);
    if (!isOnPolarMap(point.latitudeDeg)) {
      say('Outside the polar terrain data.');
      return;
    }
    if (isFull()) {
      say(FULL_REASON);
      return;
    }
    addCustomSite(point.latitudeDeg, point.longitudeDeg);
  }

  interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
  }

  interface LabelPlan {
    id: string;
    name: string;
    x: number;
    y: number;
    anchor: 'start' | 'end' | 'middle';
    show: boolean;
    selected: boolean;
  }

  const LABEL_HEIGHT = 13;
  const EDGE_PAD = 4;
  const CONTROLS_WIDTH = 64;
  const CONTROLS_HEIGHT = 108;
  const STATUS_HEIGHT = 18;
  const FOOTER_HEIGHT = 30;

  let measureContext: CanvasRenderingContext2D | null | undefined;

  function textWidth(text: string, bold: boolean): number {
    if (measureContext === undefined) measureContext = document.createElement('canvas').getContext('2d');
    if (!measureContext) return text.length * 6.5;
    measureContext.font = `${bold ? 700 : 400} 11px system-ui, sans-serif`;
    return measureContext.measureText(text).width;
  }

  function overlaps(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }

  // Parts of the map where a label must not sit: the zoom buttons, the status line and the scale bar.
  const reserved = $derived.by((): Rect[] => {
    const controlsLeft = (areaWidth + side) / 2 - CONTROLS_WIDTH;
    return [
      { x: controlsLeft, y: 0, w: CONTROLS_WIDTH + 1, h: CONTROLS_HEIGHT },
      { x: 0, y: 0, w: side * 0.7, h: STATUS_HEIGHT },
      { x: 0, y: side - FOOTER_HEIGHT, w: side, h: FOOTER_HEIGHT },
    ];
  });

  /** Each label goes on the side of its marker with free room; labels that would still collide wait for hover. */
  const labelPlans = $derived.by((): LabelPlan[] => {
    const visible = placed
      .map((entry) => ({ entry, x: screenX(entry.x), y: screenY(entry.y) }))
      .filter((item) => item.x >= 0 && item.y >= 0 && item.x <= side && item.y <= side);
    const markers = visible.map((item) => ({ id: item.entry.site.id, rect: { x: item.x - 10, y: item.y - 10, w: 20, h: 20 } }));
    const ordered = [...visible].sort(
      (a, b) =>
        Number(b.entry.site.id === mission.selectedSiteId) - Number(a.entry.site.id === mission.selectedSiteId) ||
        Number(b.entry.site.id === hoverId) - Number(a.entry.site.id === hoverId),
    );
    const taken: Rect[] = [];
    const plans: LabelPlan[] = [];
    for (const item of ordered) {
      const site = item.entry.site;
      const selected = site.id === mission.selectedSiteId;
      const name = siteLabel(site).short;
      const width = textWidth(name, selected) + 4;
      const gap = selected ? 14 : 9;
      const candidates: { rect: Rect; anchor: LabelPlan['anchor']; x: number; y: number }[] = [
        { anchor: 'start', x: item.x + gap, y: item.y + 4, rect: { x: item.x + gap, y: item.y - 9, w: width, h: LABEL_HEIGHT } },
        { anchor: 'end', x: item.x - gap, y: item.y + 4, rect: { x: item.x - gap - width, y: item.y - 9, w: width, h: LABEL_HEIGHT } },
        { anchor: 'middle', x: item.x, y: item.y - gap - 2, rect: { x: item.x - width / 2, y: item.y - gap - 13, w: width, h: LABEL_HEIGHT } },
        { anchor: 'middle', x: item.x, y: item.y + gap + 11, rect: { x: item.x - width / 2, y: item.y + gap, w: width, h: LABEL_HEIGHT } },
      ];
      const inside = (rect: Rect): boolean =>
        rect.x >= EDGE_PAD && rect.y >= EDGE_PAD && rect.x + rect.w <= side - EDGE_PAD && rect.y + rect.h <= side - EDGE_PAD;
      const clear = (rect: Rect): boolean =>
        inside(rect) &&
        !reserved.some((area) => overlaps(rect, area)) &&
        !taken.some((area) => overlaps(rect, area)) &&
        !markers.some((marker) => marker.id !== site.id && overlaps(rect, marker.rect));
      const free = candidates.find((candidate) => clear(candidate.rect));
      if (free) {
        taken.push(free.rect);
        plans.push({ id: site.id, name, x: free.x, y: free.y, anchor: free.anchor, show: true, selected });
        continue;
      }
      // No free spot. The selected and hovered sites still show, at the first spot inside the map.
      const forced = site.id === hoverId || selected;
      const fallback = candidates.find((candidate) => inside(candidate.rect) && !reserved.some((area) => overlaps(candidate.rect, area))) ?? candidates[0]!;
      if (forced) taken.push(fallback.rect);
      plans.push({ id: site.id, name, x: fallback.x, y: fallback.y, anchor: fallback.anchor, show: forced, selected });
    }
    return plans;
  });

  const SUN_TICK_PX = 12;

  /** Where the Sun's direction meets the map edge, and where its label sits just inside. */
  const sunTick = $derived.by(() => {
    if (!shadow || side === 0) return null;
    const bearing = (shadow.mapBearingDeg * Math.PI) / 180;
    const dx = Math.sin(bearing);
    const dy = -Math.cos(bearing);
    const reach = side / 2 / Math.max(Math.abs(dx), Math.abs(dy));
    const point = (distance: number) => ({ x: side / 2 + dx * distance, y: side / 2 + dy * distance });
    const edge = point(reach);
    const inner = point(reach - SUN_TICK_PX);
    const label = point(reach - SUN_TICK_PX - 4);
    const anchor: 'start' | 'end' | 'middle' = dx > 0.35 ? 'end' : dx < -0.35 ? 'start' : 'middle';
    const baseline = dy > 0.35 ? label.y - 2 : label.y + 10;
    return { edge, inner, label: { x: label.x, y: baseline, anchor }, text: `Sun ${Math.round(((shadow.sunAzimuthDeg % 360) + 360) % 360)}°` };
  });

  const hoverName = $derived(hoverId ? placed.find((entry) => entry.site.id === hoverId)?.site.name : undefined);

  function updateHover(event: PointerEvent): void {
    if (drag) return;
    const point = localPoint(event);
    let nearest: { id: string; distance: number } | null = null;
    for (const entry of placed) {
      const distance = Math.hypot(screenX(entry.x) - point.x, screenY(entry.y) - point.y);
      if (distance <= SITE_HIT_PX && (!nearest || distance < nearest.distance)) nearest = { id: entry.site.id, distance };
    }
    hoverId = nearest?.id ?? null;
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    const point = localPoint(event);
    const lines = event.deltaMode === 1 ? 16 : 1;
    zoomAbout(Math.exp(event.deltaY * lines * 0.002), point.x, point.y);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const step = view.span * 0.1;
    switch (event.key) {
      case 'ArrowLeft':
        setView(view.x - step, view.y, view.span);
        break;
      case 'ArrowRight':
        setView(view.x + step, view.y, view.span);
        break;
      case 'ArrowUp':
        setView(view.x, view.y + step, view.span);
        break;
      case 'ArrowDown':
        setView(view.x, view.y - step, view.span);
        break;
      case '+':
      case '=':
        zoomCentre(1 / 1.5);
        break;
      case '-':
      case '_':
        zoomCentre(1.5);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const button =
    'h-8 min-w-8 rounded-sm border border-rule bg-panel px-2 text-sm text-ink hover:bg-rule disabled:opacity-50 disabled:hover:bg-panel';
</script>

<section aria-label="Map" class="flex min-h-0 min-w-0 flex-col gap-1.5 bg-panel p-2 {className}">
  <SiteAdder {catalog} loadError={listError} />

  <div bind:this={area} class="relative flex min-h-0 flex-1 items-center justify-center">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
    <div
      class="relative touch-none select-none bg-ground outline-offset-2 cursor-crosshair"
      style="width: {side}px; height: {side}px;"
      role="application"
      tabindex="0"
      title={hoverName}
      aria-label="South polar terrain map. Drag to pan, scroll or plus and minus to zoom, arrow keys to pan, click to add a point."
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={() => (drag = null)}
      onpointerleave={() => (hoverId = null)}
      onwheel={onWheel}
      onkeydown={onKeydown}
    >
      <canvas
        bind:this={canvas}
        class="absolute inset-0 h-full w-full"
        width={Math.round(side * (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1))}
        height={Math.round(side * (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1))}
        aria-hidden="true"
      ></canvas>

      <svg class="pointer-events-none absolute inset-0" width={side} height={side} aria-hidden="true">
        {#each dots as entry (entry.site.site_id)}
          <circle cx={screenX(entry.x)} cy={screenY(entry.y)} r="2.5" class="fill-ink" fill-opacity="0.6" />
        {/each}

        {#each placed as entry (entry.site.id)}
          {@const cx = screenX(entry.x)}
          {@const cy = screenY(entry.y)}
          {@const selected = entry.site.id === mission.selectedSiteId}
          {#if selected}
            <rect x={cx - 7} y={cy - 7} width="14" height="14" class="fill-sun stroke-ground" stroke-width="2" />
            <rect x={cx - 10} y={cy - 10} width="20" height="20" fill="none" class="stroke-sun" stroke-width="1.5" />
          {:else}
            <circle {cx} {cy} r="4.5" class="fill-ground stroke-ink" stroke-width="1.5" />
          {/if}
        {/each}

        {#each labelPlans as plan (plan.id)}
          {#if plan.show}
            <text
              x={plan.x}
              y={plan.y}
              text-anchor={plan.anchor}
              font-size="11"
              class="fill-ink"
              font-weight={plan.selected ? 700 : 400}
              style="paint-order: stroke; stroke: #0b0b0c; stroke-width: 3px; stroke-linejoin: round;"
            >
              {plan.name}
            </text>
          {/if}
        {/each}

        {#if sunTick}
          <g style="paint-order: stroke; stroke: #0b0b0c; stroke-width: 3px; stroke-linejoin: round;" font-size="11">
            <line x1={sunTick.inner.x} y1={sunTick.inner.y} x2={sunTick.edge.x} y2={sunTick.edge.y} class="stroke-sun" stroke-width="2" style="stroke-linecap: butt; paint-order: normal; stroke-opacity: 1;" />
            <text x={sunTick.label.x} y={sunTick.label.y} text-anchor={sunTick.label.anchor} class="fill-sun">{sunTick.text}</text>
          </g>
        {/if}

        <g style="paint-order: stroke; stroke: #0b0b0c; stroke-width: 3px; stroke-linejoin: round;" font-size="11">
          <line x1="8" y1={side - 14} x2={8 + scaleBar.px} y2={side - 14} class="stroke-ink" stroke-width="2" style="stroke-linecap: butt;" />
          <text x="8" y={side - 20} class="fill-ink">{formatKm(scaleBar.km)} km</text>
          <text x={side - 8} y={side - 8} text-anchor="end" class="fill-ink">Width {formatKm(widthKm)} km</text>
        </g>
      </svg>
    </div>

    <div class="absolute right-0 top-0 flex flex-col gap-1">
      <button type="button" class={button} aria-label="Zoom in" onclick={() => zoomCentre(1 / 1.5)}>+</button>
      <button type="button" class={button} aria-label="Zoom out" onclick={() => zoomCentre(1.5)}>−</button>
      <button
        type="button"
        class={button}
        aria-label="Centre on selected site"
        disabled={!selectedPlaced}
        onclick={centreOnSelected}
      >
        Centre
      </button>
    </div>

    {#if statusText}
      <p class="absolute left-0 top-0 max-w-[70%] bg-panel px-1 text-xs text-muted" role="status">{statusText}</p>
    {/if}
  </div>

  <div class="flex flex-wrap items-center justify-between gap-x-3 text-xs leading-4">
    <label class="flex items-center gap-1.5 text-ink">
      <input type="checkbox" bind:checked={shadowOn} class="size-3.5 accent-[#f2b24a]" />
      <span>Sunlight at clock</span>
    </label>
    {#if shadowOn}
      <span class="text-muted">Shaded: Sun hidden by terrain</span>
    {/if}
    {#if isFull()}
      <span class="text-muted" role="status">Site limit reached ({MAX_SITES}).</span>
    {/if}
    {#if offMap.length > 0}
      <span class="min-w-0 truncate text-muted" title={offMap.map((site) => site.name).join(', ')}>Not on this map: {offMap.map((site) => siteLabel(site).short).join(', ')}</span>
    {/if}
  </div>
</section>

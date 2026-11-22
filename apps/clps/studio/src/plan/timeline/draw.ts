import type { EstimateEvent } from '../../lib/api/types';
import { BATTERY_ROW, BLOCK_PAD, EARTH_ROW, ROW_GAP, SUN_ROW } from './layout';

export interface Palette {
  sun: string;
  earth: string;
  ink: string;
  ground: string;
  rule: string;
  muted: string;
}

export interface BlockData {
  sunFraction: number[];
  earthFraction: number[];
  events: EstimateEvent[];
  socKwh: number[];
  capacityKwh: number;
  startMs: number;
  dayMarkIndexes: number[];
}

/** Heights in CSS pixels of the three rows of a block and the gap between them. */
export interface BlockRows {
  sun: number;
  earth: number;
  battery: number;
  gap: number;
}

export const DEFAULT_ROWS: BlockRows = { sun: SUN_ROW, earth: EARTH_ROW, battery: BATTERY_ROW, gap: ROW_GAP };

export function blockHeight(rows: BlockRows): number {
  return BLOCK_PAD * 2 + rows.sun + rows.earth + rows.battery + rows.gap * 2;
}

const HOUR_MS = 3_600_000;
const MIN_PARTIAL_ALPHA = 0.18;
const EMPTY_KWH = 1e-6;

export function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
  return {
    sun: read('--color-sun', '#f2b24a'),
    earth: read('--color-earth', '#6ea8e0'),
    ink: read('--color-ink', '#ecebe6'),
    ground: read('--color-ground', '#0b0b0c'),
    rule: read('--color-rule', '#2c2c2e'),
    muted: read('--color-muted', '#9b9993'),
  };
}

/** Whole device pixels everywhere, so adjacent hours leave no seams. */
function xAt(index: number, lastIndex: number, width: number): number {
  return Math.round((index / lastIndex) * width);
}

function drawStrip(
  ctx: CanvasRenderingContext2D,
  fractions: number[],
  colour: string,
  top: number,
  height: number,
  width: number,
  dpr: number,
): void {
  const lastIndex = fractions.length - 1;
  ctx.fillStyle = colour;
  for (let hour = 0; hour < lastIndex; hour += 1) {
    const fraction = fractions[hour] ?? 0;
    if (fraction <= 0) continue;
    const left = xAt(hour, lastIndex, width);
    const right = xAt(hour + 1, lastIndex, width);
    ctx.globalAlpha = fraction >= 1 ? 1 : MIN_PARTIAL_ALPHA + (1 - MIN_PARTIAL_ALPHA) * fraction;
    ctx.fillRect(left, top * dpr, Math.max(1, right - left), height * dpr);
  }
  ctx.globalAlpha = 1;
}

function drawEvents(
  ctx: CanvasRenderingContext2D,
  events: EstimateEvent[],
  body: 'SUN' | 'EARTH',
  startMs: number,
  lastIndex: number,
  width: number,
  rowTop: number,
  rowHeight: number,
  dpr: number,
): void {
  const tickLength = 1;
  ctx.fillStyle = ctx.strokeStyle;
  for (const event of events) {
    if (event.body !== body) continue;
    const index = (Date.parse(event.utc) - startMs) / HOUR_MS;
    if (!(index >= 0 && index <= lastIndex)) continue;
    const x = Math.min(width - dpr, xAt(index, lastIndex, width));
    // Sets reach up out of the row, rises reach down out of it.
    const top = event.kind === 'set' ? rowTop - tickLength : rowTop;
    ctx.fillRect(x, top * dpr, dpr, (rowHeight + tickLength) * dpr);
  }
}

function drawBattery(
  ctx: CanvasRenderingContext2D,
  data: BlockData,
  palette: Palette,
  top: number,
  rowHeight: number,
  width: number,
  dpr: number,
): void {
  const soc = data.socKwh;
  const lastIndex = soc.length - 1;
  if (lastIndex < 1) return;
  const scale = data.capacityKwh > 0 ? data.capacityKwh : Math.max(1, ...soc);
  const markHeight = 2;
  const plotTop = top * dpr;
  const plotHeight = (rowHeight - markHeight - 1) * dpr;
  const baseline = plotTop + plotHeight;

  ctx.fillStyle = palette.rule;
  for (const index of data.dayMarkIndexes) {
    ctx.fillRect(Math.min(width - dpr, xAt(index, lastIndex, width)), plotTop, dpr, (rowHeight - markHeight) * dpr);
  }

  const yAt = (kwh: number): number => baseline - (Math.min(scale, Math.max(0, kwh)) / scale) * plotHeight;
  ctx.beginPath();
  ctx.moveTo(0, baseline);
  for (let index = 0; index <= lastIndex; index += 1) {
    ctx.lineTo(xAt(index, lastIndex, width), yAt(soc[index] ?? 0));
  }
  ctx.lineTo(width, baseline);
  ctx.closePath();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = palette.ink;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  for (let index = 0; index <= lastIndex; index += 1) {
    const x = xAt(index, lastIndex, width);
    const y = yAt(soc[index] ?? 0);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineWidth = dpr;
  ctx.strokeStyle = palette.ink;
  ctx.stroke();

  ctx.fillStyle = palette.ink;
  const markTop = top * dpr + (rowHeight - markHeight) * dpr;
  for (let index = 1; index <= lastIndex; index += 1) {
    if ((soc[index] ?? 0) > EMPTY_KWH) continue;
    const left = xAt(index - 1, lastIndex, width);
    const right = xAt(index, lastIndex, width);
    ctx.fillRect(left, markTop, Math.max(1, right - left), markHeight * dpr);
  }
}

export function drawBlock(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  palette: Palette,
  data: BlockData | null,
  rows: BlockRows = DEFAULT_ROWS,
): void {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.round(cssWidth * dpr);
  const height = Math.round(cssHeight * dpr);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);

  const sunTop = BLOCK_PAD;
  const earthTop = sunTop + rows.sun + rows.gap;
  const batteryTop = earthTop + rows.earth + rows.gap;

  ctx.fillStyle = palette.ground;
  ctx.fillRect(0, sunTop * dpr, width, rows.sun * dpr);
  ctx.fillRect(0, earthTop * dpr, width, rows.earth * dpr);
  if (!data) return;

  const lastIndex = data.sunFraction.length - 1;
  drawStrip(ctx, data.sunFraction, palette.sun, sunTop, rows.sun, width, dpr);
  drawStrip(ctx, data.earthFraction, palette.earth, earthTop, rows.earth, width, dpr);
  ctx.strokeStyle = palette.ink;
  drawEvents(ctx, data.events, 'SUN', data.startMs, lastIndex, width, sunTop, rows.sun, dpr);
  drawEvents(ctx, data.events, 'EARTH', data.startMs, lastIndex, width, earthTop, rows.earth, dpr);
  drawBattery(ctx, data, palette, batteryTop, rows.battery, width, dpr);
}

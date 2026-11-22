import type { Palette } from '../timeline/draw';

export const MONTH_ROW = 16;
export const STRIP_ROW = 28;
export const YEAR_HEIGHT = MONTH_ROW + STRIP_ROW * 2 + 1;
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DAY_MS = 86_400_000;
const MIN_ALPHA = 0.12;

/** Day-of-year index of each month's first day. */
export function monthStartDays(year: number): number[] {
  const first = Date.UTC(year, 0, 1);
  return MONTH_NAMES.map((_, month) => (Date.UTC(year, month, 1) - first) / DAY_MS);
}

export interface YearDrawData {
  year: number;
  /** Daily mean visible fraction per day; NaN or missing where not loaded. */
  sun: number[];
  earth: number[];
}

function drawRow(
  ctx: CanvasRenderingContext2D,
  values: number[],
  dayCount: number,
  colour: string,
  top: number,
  width: number,
  dpr: number,
): void {
  ctx.fillStyle = colour;
  for (let day = 0; day < dayCount; day += 1) {
    const value = values[day];
    if (value === undefined || Number.isNaN(value) || value <= 0) continue;
    const left = Math.round((day / dayCount) * width);
    const right = Math.round(((day + 1) / dayCount) * width);
    ctx.globalAlpha = MIN_ALPHA + (1 - MIN_ALPHA) * Math.min(1, value);
    ctx.fillRect(left, top * dpr, Math.max(1, right - left), STRIP_ROW * dpr);
  }
  ctx.globalAlpha = 1;
}

/** Two rows of daily means, Sun above Earth, with a hairline at each month start. */
export function drawYear(canvas: HTMLCanvasElement, cssWidth: number, palette: Palette, data: YearDrawData): void {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.round(cssWidth * dpr);
  const height = Math.round(YEAR_HEIGHT * dpr);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);

  const dayCount = (Date.UTC(data.year + 1, 0, 1) - Date.UTC(data.year, 0, 1)) / DAY_MS;
  const sunTop = MONTH_ROW;
  const earthTop = MONTH_ROW + STRIP_ROW + 1;

  ctx.fillStyle = palette.ground;
  ctx.fillRect(0, sunTop * dpr, width, STRIP_ROW * dpr);
  ctx.fillRect(0, earthTop * dpr, width, STRIP_ROW * dpr);
  drawRow(ctx, data.sun, dayCount, palette.sun, sunTop, width, dpr);
  drawRow(ctx, data.earth, dayCount, palette.earth, earthTop, width, dpr);

  ctx.fillStyle = palette.muted;
  for (const start of monthStartDays(data.year)) {
    const x = Math.round((start / dayCount) * width);
    ctx.fillRect(x, 0, dpr, MONTH_ROW * dpr - 3 * dpr);
    if (start === 0) continue;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = palette.rule;
    ctx.fillRect(x, sunTop * dpr, dpr, (STRIP_ROW * 2 + 1) * dpr);
    ctx.fillStyle = palette.muted;
    ctx.globalAlpha = 1;
  }
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LABEL_STEPS = [1, 2, 3, 5, 7, 10, 15];
const MIN_LABEL_SPACING_PX = 56;

export interface DayTick {
  /** Hourly index on the shared axis; whole numbers only at UTC midnight. */
  index: number;
  label: string;
}

/** UTC midnights that fall inside the stay. */
export function dayTicks(startUtc: string, days: number): DayTick[] {
  const startMs = Date.parse(startUtc);
  if (!Number.isFinite(startMs)) return [];
  const endMs = startMs + days * DAY_MS;
  const ticks: DayTick[] = [];
  for (let ms = Math.ceil(startMs / DAY_MS) * DAY_MS; ms <= endMs; ms += DAY_MS) {
    const date = new Date(ms);
    ticks.push({ index: (ms - startMs) / HOUR_MS, label: `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}` });
  }
  return ticks;
}

/** Label every nth midnight so labels never crowd, from 1 to 30 days. */
export function labelStep(axisWidthPx: number, days: number): number {
  const pxPerDay = axisWidthPx / Math.max(1, days);
  return LABEL_STEPS.find((step) => step * pxPerDay >= MIN_LABEL_SPACING_PX) ?? LABEL_STEPS[LABEL_STEPS.length - 1] ?? 1;
}

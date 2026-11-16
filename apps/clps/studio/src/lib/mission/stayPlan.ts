/**
 * Stay plan: what a crew needs to bring to stay at a site, and what to watch, from the hourly Sun and Earth visibility.
 * All inputs are hourly fractions of the disc visible above the terrain, one per hour of the stay.
 */

/** The Sun is treated as hidden below this visible fraction, and as usable for surface work above WORK_LIGHT. */
const DARK_FRACTION = 0.05;
const WORK_LIGHT = 0.5;
const EARTH_LINK = 0.5;
/** Battery round trip and the margins a planner adds on top of the bare need. */
const DISCHARGE_EFFICIENCY = 0.9;
const CHARGE_EFFICIENCY = 0.9;
const ARRAY_MARGIN = 1.25;
const BATTERY_MARGIN = 1.2;
/** Below this mean sunlight a solar array cannot carry the stay. */
const MIN_SOLAR_SHARE = 0.1;
/** Hardware scale: flexible array output per square metre in full Sun, and battery pack energy per kilogram. */
export const ARRAY_KW_PER_M2 = 0.3;
export const BATTERY_KWH_PER_KG = 0.2;

export interface Stretch {
  hours: number;
  /** First hour of the stretch, from the start of the stay. */
  startHour: number;
}

export interface StayPlan {
  loadKw: number;
  hours: number;
  sunShare: number;
  solarViable: boolean;
  arrayKw: number;
  arrayM2: number;
  batteryKwh: number;
  batteryTonnes: number;
  longestDark: Stretch;
  longestBlackout: Stretch;
  /** Hours with both working light and a direct line to Earth. */
  workHours: number;
  sunUp: boolean[];
  earthUp: boolean[];
  work: boolean[];
}

function longest(flags: boolean[]): Stretch {
  let best: Stretch = { hours: 0, startHour: 0 };
  let run = 0;
  for (let hour = 0; hour < flags.length; hour += 1) {
    run = flags[hour] ? run + 1 : 0;
    if (run > best.hours) best = { hours: run, startHour: hour - run + 1 };
  }
  return best;
}

/** Stored energy needed to carry `loadKw` through the stay with an array of `arrayKw`: the deepest the battery is drawn. */
function drawdownKwh(sun: number[], arrayKw: number, loadKw: number): number {
  let deficit = 0;
  let deepest = 0;
  for (const fraction of sun) {
    const net = arrayKw * fraction - loadKw;
    deficit = net < 0 ? deficit - net / DISCHARGE_EFFICIENCY : Math.max(0, deficit - net * CHARGE_EFFICIENCY);
    deepest = Math.max(deepest, deficit);
  }
  return deepest;
}

export function planStay(sun: number[], earth: number[], loadKw: number): StayPlan {
  const hours = Math.max(1, Math.min(sun.length, earth.length));
  const sunSeries = sun.slice(0, hours);
  const sunShare = sunSeries.reduce((total, value) => total + value, 0) / hours;
  const solarViable = sunShare >= MIN_SOLAR_SHARE;
  // Enough array to carry the load on the stay's average sunlight, with margin to recharge between dark spells.
  const arrayKw = solarViable ? (loadKw * ARRAY_MARGIN) / sunShare : 0;
  const batteryKwh = Math.max(loadKw, drawdownKwh(sunSeries, arrayKw, loadKw) * BATTERY_MARGIN);
  const sunUp = sunSeries.map((value) => value >= WORK_LIGHT);
  const earthUp = earth.slice(0, hours).map((value) => value >= EARTH_LINK);
  const work = sunUp.map((up, hour) => up && (earthUp[hour] ?? false));
  return {
    loadKw,
    hours,
    sunShare,
    solarViable,
    arrayKw,
    arrayM2: arrayKw / ARRAY_KW_PER_M2,
    batteryKwh,
    batteryTonnes: batteryKwh / BATTERY_KWH_PER_KG / 1000,
    longestDark: longest(sunSeries.map((value) => value < DARK_FRACTION)),
    longestBlackout: longest(earthUp.map((up) => !up)),
    workHours: work.filter(Boolean).length,
    sunUp,
    earthUp,
    work,
  };
}

export type Tone = 'good' | 'warn' | 'bad';

export const darkTone = (hours: number): Tone => (hours <= 6 ? 'good' : hours <= 48 ? 'warn' : 'bad');
export const blackoutTone = (hours: number): Tone => (hours <= 1 ? 'good' : hours <= 24 ? 'warn' : 'bad');
export const workTone = (share: number): Tone => (share >= 0.6 ? 'good' : share >= 0.3 ? 'warn' : 'bad');
/** How much more battery the worst landing slip needs than the planned date. */
export const slipTone = (ratio: number): Tone => (ratio <= 1.25 ? 'good' : ratio <= 2 ? 'warn' : 'bad');

export function energyText(kwh: number): string {
  return kwh >= 1000 ? `${(kwh / 1000).toFixed(kwh >= 10_000 ? 0 : 1)} MWh` : `${Math.round(kwh)} kWh`;
}

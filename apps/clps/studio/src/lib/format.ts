import type { Countdown, Visibility } from './mission/derive';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MINUS = '−';
const NBSP = '\u00a0';

export function formatDuration(ms: number): string {
  const total = Math.max(0, ms);
  if (total >= DAY_MS) {
    const days = Math.floor(total / DAY_MS);
    const hours = Math.round((total - days * DAY_MS) / HOUR_MS);
    return hours > 0 && hours < 24 ? `${days} d ${hours} h` : `${days + (hours === 24 ? 1 : 0)} d`;
  }
  if (total >= HOUR_MS) {
    const hours = Math.floor(total / HOUR_MS);
    const minutes = Math.round((total - hours * HOUR_MS) / MINUTE_MS);
    if (minutes === 60) return `${hours + 1} h`;
    return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  }
  const minutes = Math.round(total / MINUTE_MS);
  return minutes < 1 ? '<1 min' : `${minutes} min`;
}

/** Takes a fraction from 0 to 1. */
export function formatPercent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatHours(hours: number): string {
  return `${Math.round(hours)} h`;
}

export function formatUtc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function formatDegrees(degrees: number, digits = 1, signed = false): string {
  const rounded = degrees.toFixed(digits);
  const negative = rounded.startsWith('-');
  const sign = negative ? MINUS : signed && Number(rounded) !== 0 ? '+' : '';
  return `${sign}${negative ? rounded.slice(1) : rounded}°`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Day, month and UTC clock time, for example "24 Nov 20:04 UTC". */
export function formatEventUtc(ms: number): string {
  const date = new Date(ms);
  const clock = date.toISOString().slice(11, 16);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${clock} UTC`.replaceAll(' ', NBSP);
}

const VISIBILITY_WORDS: Record<Visibility, string> = {
  visible: 'visible',
  partial: 'partly hidden',
  hidden: 'hidden by terrain',
};

/** "hidden" alone is used where the full phrase does not fit, such as table cells. */
export function visibilityWord(state: Visibility, short = false): string {
  return short && state === 'hidden' ? 'hidden' : VISIBILITY_WORDS[state];
}

/** "sets in 23 h 5 min", or "no sunrise this stay" when the body never changes state in the stay. */
export function countdownText(value: Countdown, body: 'sun' | 'earth'): string {
  if (value.kind === 'none' || value.ms === null) {
    const hidden = value.state === 'hidden';
    if (body === 'sun') return hidden ? 'no sunrise this stay' : 'no sunset this stay';
    return hidden ? 'no Earthrise this stay' : 'no Earthset this stay';
  }
  return `${value.kind === 'set' ? 'sets' : 'rises'} in ${formatDuration(value.ms).replaceAll(' ', NBSP)}`;
}

/** Signed whole-number change with a true minus sign, for example "+30" or "−35". */
export function formatDelta(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return '0';
  return `${rounded > 0 ? '+' : MINUS}${Math.abs(rounded)}`;
}

/** Day, month and year, for example "23 Nov 2026". */
export function formatDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

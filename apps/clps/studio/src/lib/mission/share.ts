import type { MissionState } from './store.svelte';

const VERSION = '1';
const SITE_SOURCE_CODES = { catalog: 'c', landing: 'l', custom: 'x' } as const;
const SOURCE_FROM_CODE: Record<string, 'catalog' | 'landing' | 'custom'> = { c: 'catalog', l: 'landing', x: 'custom' };

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** 2026-11-23T21:00:00Z becomes 2026112321. */
function packStart(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}`;
}

function unpackStart(text: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(text);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]));
  return Number.isFinite(ms) ? new Date(ms).toISOString().replace('.000Z', 'Z') : null;
}

function optionalNumber(text: string | null | undefined): number | undefined {
  return text === null || text === '' ? undefined : Number(text);
}

function round(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

/**
 * Versioned query for the URL hash: `m=1`, one `s` per site (source,id,lat,lon,name, each URI-encoded),
 * `t` start (YYYYMMDDHH, UTC), `d` days, `h` mast metres, `p` array kW, battery kWh, load kW,
 * `sel` index of the selected site, `k` clock hour index. Coordinates and settings only.
 */
function field(text: string): string {
  return encodeURIComponent(text).replaceAll('~', '%7E');
}

export function encodeShare(state: MissionState): string {
  const parts = [`m=${VERSION}`];
  for (const site of state.sites) {
    const fields = [
      SITE_SOURCE_CODES[site.source],
      site.id,
      round(site.latitudeDeg, 5),
      round(site.longitudeDeg, 5),
      site.name,
    ];
    parts.push(`s=${fields.map(field).join('~')}`);
  }
  parts.push(`t=${packStart(state.startUtc)}`);
  parts.push(`d=${state.days}`);
  parts.push(`h=${round(state.mastHeightM, 2)}`);
  parts.push(`p=${[state.power.arrayKw, state.power.batteryKwh, state.power.loadKw].map((v) => round(v, 3)).join(',')}`);
  parts.push(`sel=${Math.max(0, state.sites.findIndex((site) => site.id === state.selectedSiteId))}`);
  parts.push(`k=${round(state.clockIndex, 2)}`);
  return parts.join('&');
}

function parseQuery(query: string): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (const pair of query.split('&')) {
    const cut = pair.indexOf('=');
    if (cut <= 0) continue;
    const key = pair.slice(0, cut);
    values.set(key, [...(values.get(key) ?? []), pair.slice(cut + 1)]);
  }
  return values;
}

/** Untrusted raw mission for `restoreState`, or null when the hash holds no version-1 share. */
export function decodeShare(hash: string): Record<string, unknown> | null {
  const queryStart = hash.indexOf('?');
  if (queryStart < 0) return null;
  const query = parseQuery(hash.slice(queryStart + 1));
  const first = (key: string): string | null => query.get(key)?.[0] ?? null;
  if (first('m') !== VERSION) return null;

  const sites: Record<string, unknown>[] = [];
  for (const text of query.get('s') ?? []) {
    const fields = text.split('~').map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return '';
      }
    });
    const [code, id, latitude, longitude, name] = fields;
    const source = SOURCE_FROM_CODE[code ?? ''];
    if (!source || !id || !name) continue;
    const latitudeDeg = Number(latitude);
    const longitudeDeg = Number(longitude);
    if (!Number.isFinite(latitudeDeg) || !Number.isFinite(longitudeDeg)) continue;
    if (Math.abs(latitudeDeg) > 90 || Math.abs(longitudeDeg) > 180) continue;
    sites.push({ id, name, latitudeDeg, longitudeDeg, source });
  }
  if (sites.length === 0) return null;

  const [arrayKw, batteryKwh, loadKw] = (first('p') ?? '').split(',').map(optionalNumber);
  const selectedIndex = Number(first('sel'));
  return {
    sites,
    selectedSiteId: (sites[Number.isInteger(selectedIndex) ? selectedIndex : 0] ?? sites[0])?.id,
    startUtc: unpackStart(first('t') ?? '') ?? undefined,
    days: optionalNumber(first('d')),
    mastHeightM: optionalNumber(first('h')),
    power: { arrayKw, batteryKwh, loadKw },
    clockIndex: optionalNumber(first('k')),
  };
}

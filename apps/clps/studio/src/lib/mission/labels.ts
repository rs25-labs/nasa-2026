import type { MissionSite } from './store.svelte';

export interface SiteLabel {
  /** Primary name: always short enough to tell sites apart when truncated. */
  short: string;
  /** Muted longer name shown after the short one where there is room, or null. */
  long: string | null;
}

const SEPARATOR = ' · ';
const EXPLORATORY_ID = /^exp-([a-z0-9]+)-(xp|xm|yp)$/;
const EXPLORATORY_LETTER: Record<string, string> = { xp: 'A', xm: 'B', yp: 'C' };

export function siteLabel(site: Pick<MissionSite, 'id' | 'name' | 'source'>): SiteLabel {
  const cut = site.name.indexOf(SEPARATOR);
  const before = cut >= 0 ? site.name.slice(0, cut) : site.name;
  const after = cut >= 0 ? site.name.slice(cut + SEPARATOR.length) : '';
  if (site.source === 'custom' || cut < 0) return { short: site.name, long: null };
  if (site.source === 'landing') return { short: before, long: after };
  const exploratory = EXPLORATORY_ID.exec(site.id);
  if (exploratory?.[1] && exploratory[2]) {
    return { short: `${exploratory[1].toUpperCase()}-${EXPLORATORY_LETTER[exploratory[2]]}`, long: `${before} ${after}` };
  }
  return { short: after, long: before };
}

/** A custom point is named by where it is, for example "88.00°S 45.0°E". */
export function coordinateName(latitudeDeg: number, longitudeDeg: number, latDigits = 2, lonDigits = 1): string {
  const latitude = `${Math.abs(latitudeDeg).toFixed(latDigits)}°${latitudeDeg < 0 ? 'S' : 'N'}`;
  const longitude = `${Math.abs(longitudeDeg).toFixed(lonDigits)}°${longitudeDeg < 0 ? 'W' : 'E'}`;
  return `${latitude} ${longitude}`;
}

/** Sessions saved before custom points were named by coordinates hold "Custom 1" and the like. */
export function isLegacyCustomName(name: string): boolean {
  return /^Custom \d+$/.test(name);
}

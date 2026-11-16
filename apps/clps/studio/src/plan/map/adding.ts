import type { CatalogSite } from '../../lib/api/client';
import { coordinateName, siteLabel } from '../../lib/mission/labels';
import { actions, MAX_SITES, mission, type MissionSite } from '../../lib/mission/store.svelte';

export const FULL_REASON = `Limit is ${MAX_SITES} sites. Remove one to add another.`;

export function isFull(): boolean {
  return mission.sites.length >= MAX_SITES;
}

const MOON_RADIUS_M = 1_737_400;
/** A point this close to an existing site is the same place. */
export const SAME_PLACE_M = 10;

function distanceM(a: MissionSite, b: Pick<MissionSite, 'latitudeDeg' | 'longitudeDeg'>): number {
  const toRad = Math.PI / 180;
  const dLat = (b.latitudeDeg - a.latitudeDeg) * toRad;
  const dLon = (b.longitudeDeg - a.longitudeDeg) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.latitudeDeg * toRad) * Math.cos(b.latitudeDeg * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * MOON_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Add a site, or select the one already at that place and say so. */
function addOrSelect(site: MissionSite): void {
  const existing =
    mission.sites.find((candidate) => candidate.id === site.id) ??
    mission.sites.find((candidate) => distanceM(candidate, site) < SAME_PLACE_M);
  if (existing) {
    actions.selectSite(existing.id);
    actions.notify(`Already in the table: ${siteLabel(existing).short}. Selected.`);
    return;
  }
  actions.addSite(site);
}

export function addCatalogSite(site: Pick<CatalogSite, 'site_id' | 'name' | 'latitude_deg' | 'longitude_deg'>): void {
  addOrSelect({
    id: site.site_id,
    name: site.name,
    latitudeDeg: site.latitude_deg,
    longitudeDeg: site.longitude_deg,
    source: 'catalog',
  });
}

function nextCustomNumber(): number {
  let highest = 0;
  for (const site of mission.sites) {
    const match = /^custom-(\d+)$/.exec(site.id);
    if (match?.[1]) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}

export function addCustomSite(latitudeDeg: number, longitudeDeg: number): void {
  const number = nextCustomNumber();
  const latitude = Math.round(latitudeDeg * 1e5) / 1e5;
  const longitude = Math.round(longitudeDeg * 1e5) / 1e5;
  let name = coordinateName(latitude, longitude);
  // Two nearby points can round to the same short name; add digits until names differ.
  if (mission.sites.some((site) => site.name === name)) name = coordinateName(latitude, longitude, 4, 3);
  addOrSelect({ id: `custom-${number}`, name, latitudeDeg: latitude, longitudeDeg: longitude, source: 'custom' });
}

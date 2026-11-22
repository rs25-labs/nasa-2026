import type { MissionSite } from '../lib/mission/store.svelte';

/** Why Expedition cannot open for this site, or '' when it can. Its terrain covers only the area south of 85°S. */
export function expeditionBlockReason(site: MissionSite | null | undefined): string {
  if (!site) return 'Select a site first.';
  return site.latitudeDeg > -85 ? 'Expedition needs a site south of 85°S.' : '';
}

export function openExpedition(): void {
  window.location.hash = '#/surface';
}

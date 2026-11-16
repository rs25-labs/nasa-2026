import type { CatalogSite } from '../../lib/api/client';

/**
 * Upcoming CLPS deliveries whose landing feature NASA has named. NASA has not
 * published landing points, so each site is the feature's centre from the USGS
 * Gazetteer of Planetary Nomenclature, a region marker rather than a target.
 *
 * Missions: https://science.nasa.gov/lunar-discovery/deliveries (checked 2026-11-15)
 * Feature centres: https://planetarynames.wr.usgs.gov/Feature/<id>
 */
export const PLANNED_CLPS: Pick<CatalogSite, 'site_id' | 'name' | 'latitude_deg' | 'longitude_deg'>[] = [
  // Astrobotic Griffin (TO20A) and Intuitive Machines Nova-C (CP-22). USGS feature 16070.
  { site_id: 'clps-mons-mouton', name: 'Mons Mouton · Griffin, CP-22', latitude_deg: -84.6, longitude_deg: 31.0 },
  // Intuitive Machines IM-3 (CP-11). USGS feature 4987.
  { site_id: 'clps-reiner-gamma', name: 'Reiner Gamma · IM-3', latitude_deg: 7.39, longitude_deg: -58.96 },
  // Firefly Blue Ghost Mission 3 (CP-21), "Gruithuisen Domes". USGS feature 3982, Mons Gruithuisen Gamma.
  { site_id: 'clps-gruithuisen', name: 'Gruithuisen Domes · Blue Ghost 3', latitude_deg: 36.56, longitude_deg: -40.72 },
  // CS-11, provider to be decided. USGS feature 5381.
  { site_id: 'clps-schrodinger', name: 'Schrödinger Basin · CS-11', latitude_deg: -74.73, longitude_deg: 132.93 },
];

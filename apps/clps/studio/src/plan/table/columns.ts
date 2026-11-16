import type { SiteMetrics } from '../../lib/mission/derive';
import { siteLabel } from '../../lib/mission/labels';
import type { MissionSite } from '../../lib/mission/store.svelte';

export type SortKey = 'site' | 'sunMean' | 'sunDark' | 'earthMean' | 'earthLoss' | 'sunNow' | 'earthNow' | 'battery';

type SortValue = number | string | null;

/** Value each column sorts by. Countdown columns sort by elevation at the clock. */
export const SORT_VALUES: Record<SortKey, (site: MissionSite, metrics: SiteMetrics | null, batteryKwh: number) => SortValue> = {
  site: (site) => siteLabel(site).short,
  sunMean: (_site, metrics) => metrics?.sunMeanFraction ?? null,
  sunDark: (_site, metrics) => metrics?.sunLongestDarkHours ?? null,
  earthMean: (_site, metrics) => metrics?.earthMeanFraction ?? null,
  earthLoss: (_site, metrics) => metrics?.earthLongestLossHours ?? null,
  sunNow: (_site, metrics) => metrics?.sunElevationDeg ?? null,
  earthNow: (_site, metrics) => metrics?.earthElevationDeg ?? null,
  battery: (_site, metrics, batteryKwh) =>
    metrics ? (batteryKwh > 0 ? metrics.batteryLowestKwh / batteryKwh : 0) : null,
};

/** The first click puts the better value on top: more is better, except for the two "longest" columns and names. */
export const FIRST_CLICK_DESCENDING: Record<SortKey, boolean> = {
  site: false,
  sunMean: true,
  sunDark: false,
  earthMean: true,
  earthLoss: false,
  sunNow: true,
  earthNow: true,
  battery: true,
};

export interface ColumnInfo {
  key: SortKey;
  label: string;
  unit: string;
  definition: string;
  tone: 'plain' | 'sun' | 'earth';
}

export const COLUMNS: ColumnInfo[] = [
  { key: 'site', label: 'Site', unit: 'name', definition: 'Site name. Hover a row for its latitude and longitude.', tone: 'plain' },
  {
    key: 'sunMean',
    label: 'Sunlight',
    unit: '% of stay',
    definition: "Sunlight, % of stay: the mean visible fraction of the Sun's disc over the stay. More is better.",
    tone: 'sun',
  },
  {
    key: 'sunDark',
    label: 'Longest dark',
    unit: 'h',
    definition: 'Longest dark, h: the longest continuous time with the Sun fully hidden. Less is better.',
    tone: 'sun',
  },
  {
    key: 'earthMean',
    label: 'Earth in view',
    unit: '% of stay',
    definition: "Earth in view, % of stay: the mean visible fraction of Earth's disc over the stay. More is better.",
    tone: 'earth',
  },
  {
    key: 'earthLoss',
    label: 'Longest Earth loss',
    unit: 'h',
    definition: 'Longest Earth loss, h: the longest continuous time with Earth fully hidden. Less is better.',
    tone: 'earth',
  },
  {
    key: 'sunNow',
    label: 'Sun now',
    unit: '° · state · next event',
    definition:
      'Sun now: elevation at the clock time, whether the Sun is visible, partly hidden or hidden by terrain, and the time to its next rise or set. Sorts by elevation.',
    tone: 'sun',
  },
  {
    key: 'earthNow',
    label: 'Earth now',
    unit: '° · state · next event',
    definition:
      'Earth now: elevation at the clock time, whether Earth is visible, partly hidden or hidden by terrain, and the time to its next rise or set. Sorts by elevation.',
    tone: 'earth',
  },
  {
    key: 'battery',
    label: 'Lowest battery',
    unit: '% charge · hours empty',
    definition:
      'Lowest battery: the lowest charge the battery reaches during the stay, as a percentage of its capacity, using the array, battery and load set in the time strip. "118 h empty" means the battery sat at 0% with the load unmet for 118 hours in total.',
    tone: 'plain',
  },
];

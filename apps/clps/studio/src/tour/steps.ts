// The demo walkthrough, in order. Each step says where to be, what to point at and, for some, what to do.

export interface TourContext {
  /** Resolves after `ms`, or early (false) when the step is left. */
  wait(ms: number): Promise<boolean>;
  /** Waits until `check` is true (true) or `timeoutMs` passes or the step is left (false). */
  until(check: () => boolean, timeoutMs: number): Promise<boolean>;
}

export interface TourStep {
  id: string;
  title: string;
  text: string;
  /** Hash route the step needs; the tour navigates there first. */
  hash: string;
  /** CSS selectors for the element to point at; the first one found is used. None: the card sits in the middle. */
  targets?: string[];
  /** Extra time on Play, for steps that animate. */
  extraMs?: number;
  enter?: (ctx: TourContext) => Promise<void> | void;
  leave?: () => void;
}

/** Drive target for the demo: a published exploratory point 0.5 km from Mons Mouton MMO01 (the demo's first site). */
export const DEMO_DRIVE_TARGET = { latitudeDeg: -85.4072912175244, longitudeDeg: 32.02563800502806 };

/** Step bodies live in tour.svelte.ts, which owns the mission and drive; this file holds the words and places. */
export const STEP_TEXT: Omit<TourStep, 'enter' | 'leave' | 'extraMs'>[] = [
  {
    id: 'welcome',
    title: 'Welcome',
    text: "This tool helps you choose where and when to land near the Moon's south pole. It shows when each site gets sunlight for power and when it can see Earth for radio contact.",
    hash: '#/plan',
  },
  {
    id: 'landing-date',
    title: 'Choose the landing date',
    text: 'Set the landing time in UTC, the length of the stay and the height of the mast. All numbers on the page are for this stay.',
    hash: '#/plan',
    targets: ['[data-tour="landing-controls"]'],
  },
  {
    id: 'year-strip',
    title: 'See the whole year',
    text: 'Each column is one day. Orange means the Sun is up at the selected site. Blue means Earth is in view. Drag the white box to move the landing date. The demo moves it three days later.',
    hash: '#/plan',
    targets: ['[data-tour="year-strip"]'],
  },
  {
    id: 'map',
    title: 'Add sites to compare',
    text: 'Choose sites from the list, type coordinates, or click the map. The demo adds two more sites.',
    hash: '#/plan',
    targets: ['[aria-label="Map"]'],
  },
  {
    id: 'table',
    title: 'Compare the sites',
    text: 'Each row is one site. It shows how much of the stay has sunlight, the longest dark period, how often Earth is in view, and the lowest battery level. Click a column name to sort.',
    hash: '#/plan',
    targets: ['[aria-label="Sites table"] table'],
  },
  {
    id: 'expand',
    title: 'Open the table on its own page',
    text: 'With many sites the table gets crowded. This button opens it on a full page.',
    hash: '#/plan',
    targets: ['[data-tour="expand"]'],
  },
  {
    id: 'compare-page',
    title: 'The comparison page',
    text: 'The full page has room for up to eight sites. Press Return to Planning to go back to the plan.',
    hash: '#/compare',
    targets: ['[aria-label="Sites table"] table'],
  },
  {
    id: 'recommendation',
    title: 'Recommended site and date',
    text: 'The app picks the best site for this stay. It looks at sunlight first, then Earth contact, then battery. It also suggests the best landing date this year for the selected site.',
    hash: '#/plan',
    targets: ['[aria-label="Recommendation"]'],
  },
  {
    id: 'small-change',
    title: 'Impact of Small Changes to Plan',
    text: 'Moving one kilometre, or landing a few days later, can cut the sunlight by half. This line shows the biggest change for the selected site.',
    hash: '#/plan',
    targets: ['[aria-label="Sites table"] > p[role="status"]', '[aria-label="Sites table"]'],
  },
  {
    id: 'sky',
    title: 'The sky from the site',
    text: 'This shows the Sun and Earth above the hills all around the site. When the Sun or Earth goes behind a hill, the site loses sunlight or radio contact.',
    hash: '#/plan',
    targets: ['[aria-label="Sky"]'],
  },
  {
    id: 'key-numbers',
    title: 'Countdowns',
    text: 'Time left until sunset and until Earth goes out of view, for the time shown on the clock.',
    hash: '#/plan',
    targets: ['[aria-label="Key numbers"]'],
  },
  {
    id: 'time-strip',
    title: 'Sun, Earth and battery over time',
    text: 'One clock controls all the sites. The demo presses Play. The Sun, Earth and battery rows move together.',
    hash: '#/plan',
    targets: ['[aria-label="Time strip"]'],
  },
  {
    id: 'power',
    title: 'Power settings',
    text: "Enter the size of the solar panels, the battery and the power use. Each site's battery line shows whether it lasts through the dark periods.",
    hash: '#/plan',
    targets: ['[data-tour="power"]'],
  },
  {
    id: 'expedition',
    title: 'Expedition',
    text: 'This is the site in 3D, built from NASA height data. The Sun lights it from its true position, so the shadows are long and dark.',
    hash: '#/surface',
  },
  {
    id: 'drive-plan',
    title: 'Plan a drive',
    text: 'Pick a place within 8 km and press Find route. The route avoids steep slopes. The panel shows the distance, the time and the lowest battery level.',
    hash: '#/surface',
    targets: ['[aria-label="Plan a drive"]'],
  },
  {
    id: 'drive',
    title: 'Drive',
    text: 'The rover follows the route. The display shows the battery, the power, the time until sunset and the time until Earth goes out of view.',
    hash: '#/surface',
    targets: ['[aria-label="Drive status"]'],
  },
  {
    id: 'cameras',
    title: 'Cameras 1 to 4',
    text: "Behind the rover, the driver's seat, the mast camera and an orbit view. The demo switches between them. You can press 1 to 4 at any time.",
    hash: '#/surface',
    targets: ['[aria-label="Camera"]'],
  },
  {
    id: 'outpost',
    title: 'Outpost plan',
    text: 'Set the number of crew and days. The plan works out the solar panels and battery to bring. It marks risks in green, orange or red: long darkness, gaps in Earth contact, time for outside work, and a late landing.',
    hash: '#/surface',
    targets: ['[aria-label="Outpost status"]'],
  },
  {
    id: 'export',
    title: 'Export Mission Plan',
    text: 'Download one PDF with both the landing plan and the outpost plan. You can also download each part on its own, or copy a link to this plan.',
    hash: '#/surface',
    targets: ['[data-tour="export"]'],
  },
  {
    id: 'real-landings',
    title: 'Real Landings',
    text: 'Past landings shown on their real dates. This is Apollo 11 in July 1969. It does not change your own plan.',
    hash: '#/landings/apollo-11',
    targets: ['[aria-label="Sky"]', '[aria-label="Real landings"]'],
  },
  {
    id: 'finish',
    title: 'End of the tour',
    text: 'Press End Tour to go back to the start page. Your own plan comes back. Then press Plan a Mission to start.',
    hash: '#/landings/apollo-11',
  },
];

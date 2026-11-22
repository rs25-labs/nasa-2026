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
    text: "This tool helps you choose where and when to land near the Moon's south pole. It shows when each site gets sunlight for power and when it can see Earth for radio contact. The Plan page reads from top to bottom, in five numbered steps.",
    hash: '#/plan',
  },
  {
    id: 'your-plan',
    title: 'Your plan',
    text: 'The whole plan in one line: the sites, the landing date and stay, and the power. Each Edit opens the guided setup at that step. Start over clears the plan.',
    hash: '#/plan',
    targets: ['[aria-label="Your plan"]'],
  },
  {
    id: 'add-sites',
    title: 'Add sites to compare',
    text: 'Edit next to Sites opens a map and a search, to add up to eight sites. The demo adds two more sites.',
    hash: '#/plan',
    targets: ['[data-tour="edit-sites"]'],
  },
  {
    id: 'landing-date',
    title: '1 · Pick a landing date',
    text: 'Each column is one day. Orange means the Sun is up at the selected site, blue means Earth is in view. Click a day or drag the white box to move the landing, and change the year at the top right. The demo moves the landing three days later.',
    hash: '#/plan',
    targets: ['[aria-label="Pick a landing date"]'],
  },
  {
    id: 'sites',
    title: '2 · Pick a site',
    text: 'One row per site, with its Sun, Earth and battery strips over the stay. The numbers show how much of the stay has sunlight, the longest dark spell, how often Earth is in view and the lowest battery. Click a row to choose a site.',
    hash: '#/plan',
    targets: ['[aria-label="Sites table"] table'],
  },
  {
    id: 'recommendation',
    title: 'Recommended site',
    text: 'The app picks the best of your sites for this stay: sunlight first, then Earth contact, then battery. Choose this site makes it your choice.',
    hash: '#/plan',
    targets: ['[aria-label="Recommendation"]'],
  },
  {
    id: 'small-change',
    title: 'If you change the plan a little',
    text: 'Landing a few days later, or moving a kilometre, can cut the sunlight by half. This line shows the biggest such change for your site.',
    hash: '#/plan',
    targets: ['[aria-label="Small changes"]', '[aria-label="Sites table"]'],
  },
  {
    id: 'stay-clock',
    title: 'The stay clock',
    text: 'One clock for the Plan page, always at the bottom of the window. The demo presses Play: the page brings the sites and your site into view, and everything moves together.',
    hash: '#/plan',
    targets: ['[aria-label="Stay clock"]'],
  },
  {
    id: 'check-site',
    title: '3 · Check your site',
    text: 'The Sun and Earth above the hills all around your site, and how long until each sets. When either goes behind a hill, the site loses sunlight or radio contact.',
    hash: '#/plan',
    targets: ['[aria-label^="Check your site"]'],
  },
  {
    id: 'outpost-size',
    title: '4 · Size the outpost',
    text: 'Set the crew and the stay. The app works out the solar array and battery to bring, and marks the risks in green, orange or red: long darkness, gaps in Earth contact, time for outside work, and a late landing.',
    hash: '#/plan',
    targets: ['[aria-label="Size the outpost"]'],
  },
  {
    id: 'your-choice',
    title: '5 · Your choice',
    text: 'The decision in plain words: where and when to land, what the outpost needs, and the best time to drive. From here, plan the expedition or download the plan.',
    hash: '#/plan',
    targets: ['[aria-label="Your choice"]'],
  },
  {
    id: 'expedition',
    title: 'Expedition',
    text: 'Your site in 3D, built from NASA height data. The Sun lights it from its true position, so the shadows are long and dark. Expedition keeps its own clock, so it never moves the plan.',
    hash: '#/surface',
  },
  {
    id: 'drive-plan',
    title: 'Plan a drive',
    text: 'Four steps: pick a target, when to leave, speed and slope limit, and find a route. The leaving time and slope limit start at recommended values, with a warning if the Sun sets or the slope is steep. The demo picks a target and finds the route.',
    hash: '#/surface',
    targets: ['[aria-label="Plan a drive"]'],
  },
  {
    id: 'drive',
    title: 'Drive selected route',
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
    title: 'The outpost on site',
    text: 'See the outpost shows the base on the ground over a time-lapse of the stay, with what to bring and whether the stay works. The crew and stay are set in Plan, step 4.',
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

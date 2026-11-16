import { actions, mission } from '../../lib/mission/store.svelte';

/** Deterministic view placement from the URL hash, for the screenshot review loop. */
export interface HashView {
  /** x, y, z in scene metres relative to the site, then yaw and pitch in degrees. */
  cam: [number, number, number, number, number] | null;
  /** Orbit camera: azimuth deg, elevation deg, distance m. */
  orbit: [number, number, number] | null;
  fov: number | null;
  clock: number | null;
  /** Drive staging: target latitude and longitude (the route is requested from the landing site). */
  drive: [number, number] | null;
  /** 0 to 1 along the route: the rover is placed there with tracks laid behind it. */
  progress: number | null;
  camera: 'chase' | 'driver' | 'mast' | 'orbit' | 'plan' | null;
  /** Time-lapse factor; 0 leaves the drive paused at the staged place. */
  lapse: number | null;
  /** Rover speed setting, km/h, and the rover class ("viper" or "lrv"). */
  speed: number | null;
  roverClass: 'viper' | 'lrv' | null;
  /** Seconds of real-time autopilot to run before freezing (throws dust, lays fresh tracks). */
  run: number | null;
  /** Chase camera: azimuth offset deg, elevation deg, distance m. */
  chase: [number, number, number] | null;
  headlights: 'on' | 'off' | 'auto' | null;
  /** Free orbit/plan: distance in metres. */
  planDistance: number | null;
  hud: boolean | null;
  /** Base at the landing site: shown with a drive by default, with a free camera only when `base=1`; `base=0` hides it. */
  base: boolean | null;
  /** Stay mode: camera on the base, the clock runs through the stay at `lapse` mission seconds per second (0 holds it). */
  stay: boolean | null;
  /** Review staging of the shared mission: a custom site (latitude, longitude), the window start (ISO UTC) and its length in days. */
  site: [number, number] | null;
  start: string | null;
  days: number | null;
}

/**
 * `site=lat,lon`, `start=ISO` and `days=n` set the shared mission before the Surface reads it, so review views can stage any
 * site and date. They change the same store the Plan screen edits, so they are only applied when they differ from it.
 */
export function applyReviewMission(hash: string): void {
  const query = new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '');
  const site = numbers(query.get('site'), 2);
  const start = query.get('start');
  const days = Number(query.get('days'));
  if (site) {
    const id = `review-${String(site[0]).replace('-', 'm').replace('.', 'p')}-${String(site[1]).replace('-', 'm').replace('.', 'p')}`;
    if (!mission.sites.some((candidate) => candidate.id === id)) {
      actions.addSite({ id, name: `Review ${site[0]}, ${site[1]}`, latitudeDeg: site[0] as number, longitudeDeg: site[1] as number, source: 'custom' });
    } else if (mission.selectedSiteId !== id) {
      actions.selectSite(id);
    }
  }
  if (start && /^\d{4}-\d{2}-\d{2}T/.test(start)) {
    const nextDays = Number.isFinite(days) && days >= 1 ? days : mission.days;
    if (mission.startUtc !== start || mission.days !== nextDays) actions.setWindow(start, nextDays);
  }
}

function numbers(text: string | null, count: number): number[] | null {
  if (!text) return null;
  const values = text.split(',').map(Number);
  return values.length === count && values.every(Number.isFinite) ? values : null;
}

export function parseHashView(hash: string): HashView {
  applyReviewMission(hash);
  const query = new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '');
  const fov = Number(query.get('fov'));
  const clockText = query.get('clock');
  const optional = (name: string): number | null => {
    const text = query.get(name);
    return text !== null && text !== '' && Number.isFinite(Number(text)) ? Number(text) : null;
  };
  const camera = query.get('camera');
  const lights = query.get('headlights');
  const roverClass = query.get('class');
  return {
    drive: numbers(query.get('drive'), 2) as HashView['drive'],
    progress: optional('progress'),
    camera: camera === 'chase' || camera === 'driver' || camera === 'mast' || camera === 'orbit' || camera === 'plan' ? camera : null,
    lapse: optional('lapse'),
    speed: optional('speed'),
    roverClass: roverClass === 'lrv' || roverClass === 'viper' ? roverClass : null,
    run: optional('run'),
    chase: numbers(query.get('chase'), 3) as HashView['chase'],
    headlights: lights === 'on' || lights === 'off' || lights === 'auto' ? lights : null,
    planDistance: optional('dist'),
    hud: query.has('hud') ? query.get('hud') !== '0' : null,
    base: query.has('base') ? query.get('base') !== '0' : null,
    stay: query.has('stay') ? query.get('stay') !== '0' : null,
    cam: numbers(query.get('cam'), 5) as HashView['cam'],
    orbit: numbers(query.get('orbit'), 3) as HashView['orbit'],
    fov: query.has('fov') && Number.isFinite(fov) && fov > 5 && fov < 120 ? fov : null,
    site: numbers(query.get('site'), 2) as HashView['site'],
    start: query.get('start'),
    days: optional('days'),
    clock: clockText !== null && Number.isFinite(Number(clockText)) ? Number(clockText) : null,
  };
}

// Stage the mission as early as possible: this module loads before the Surface screen reads the store.
if (typeof window !== 'undefined') applyReviewMission(window.location.hash);

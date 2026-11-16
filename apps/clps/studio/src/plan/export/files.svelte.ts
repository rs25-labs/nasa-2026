import { api } from '../../lib/api/client';
import { clockTimeMs, okResult, siteMetrics, type Countdown, type SiteMetrics } from '../../lib/mission/derive';
import { estimates } from '../../lib/mission/estimates.svelte';
import { siteLabel } from '../../lib/mission/labels';
import { encodeShare } from '../../lib/mission/share';
import { mission, type MissionState } from '../../lib/mission/store.svelte';

const FORMAT_VERSION = 1;

function snapshot(): MissionState {
  return $state.snapshot(mission) as MissionState;
}

export function shareUrl(): string {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}#/plan?${encodeShare(snapshot())}`;
}

function stamp(): string {
  return mission.startUtc.slice(0, 10).replaceAll('-', '');
}

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const text = typeof value === 'number' ? String(Number(value.toFixed(4))) : value;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function eventIso(value: Countdown): string {
  return value.eventMs === null ? '' : new Date(value.eventMs).toISOString().replace('.000Z', 'Z');
}

const CSV_COLUMNS = [
  'site_id',
  'site',
  'long_name',
  'source',
  'latitude_deg',
  'longitude_deg',
  'sunlight_pct_of_stay',
  'longest_dark_h',
  'earth_in_view_pct_of_stay',
  'longest_earth_loss_h',
  'sun_elevation_at_clock_deg',
  'sun_state_at_clock',
  'sun_next_event_utc',
  'earth_elevation_at_clock_deg',
  'earth_state_at_clock',
  'earth_next_event_utc',
  'battery_minimum_pct_of_capacity',
  'battery_hours_empty_h',
  'error',
];

function metricCells(metrics: SiteMetrics, batteryKwh: number): (string | number)[] {
  return [
    metrics.sunMeanFraction * 100,
    metrics.sunLongestDarkHours,
    metrics.earthMeanFraction * 100,
    metrics.earthLongestLossHours,
    metrics.sunElevationDeg,
    metrics.sunCountdown.state,
    eventIso(metrics.sunCountdown),
    metrics.earthElevationDeg,
    metrics.earthCountdown.state,
    eventIso(metrics.earthCountdown),
    batteryKwh > 0 ? (metrics.batteryLowestKwh / batteryKwh) * 100 : 0,
    metrics.batteryHoursEmpty,
  ];
}

export function buildCsv(): string {
  const power = mission.power;
  const lines = [
    '# Lunar Mission Lab sites table',
    `# Stay start (UTC): ${mission.startUtc}`,
    `# Stay length (days): ${mission.days}`,
    `# Mast height (m): ${mission.mastHeightM}`,
    `# Power: array ${power.arrayKw} kW, battery ${power.batteryKwh} kWh, load ${power.loadKw} kW`,
    `# Clock for the "at_clock" columns (UTC): ${new Date(clockTimeMs(mission.startUtc, mission.clockIndex)).toISOString()}`,
    CSV_COLUMNS.join(','),
  ];
  for (const site of mission.sites) {
    const label = siteLabel(site);
    const result = estimates.bySiteId[site.id];
    const ok = okResult(result);
    const identity = [site.id, label.short, label.long ?? '', site.source, site.latitudeDeg, site.longitudeDeg];
    const measured = ok ? metricCells(siteMetrics(ok, mission.clockIndex, mission.startUtc, power), power.batteryKwh) : null;
    const cells = measured
      ? [...identity, ...measured, '']
      : [...identity, ...new Array<string>(12).fill(''), result && !result.ok ? result.error : 'not calculated'];
    lines.push(cells.map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function buildJson(): string {
  const state = snapshot();
  const sites = state.sites.map((site) => {
    const result = estimates.bySiteId[site.id];
    const ok = okResult(result);
    if (ok) {
      return {
        site_id: site.id,
        name: site.name,
        source: site.source,
        latitude_deg: site.latitudeDeg,
        longitude_deg: site.longitudeDeg,
        model: ok.model,
        terrain: ok.terrain,
        summaries: ok.summaries,
        events: ok.events,
        horizon_elevation_deg: ok.horizon_elevation_deg,
        series: ok.series,
      };
    }
    return {
      site_id: site.id,
      name: site.name,
      source: site.source,
      latitude_deg: site.latitudeDeg,
      longitude_deg: site.longitudeDeg,
      error: result && !result.ok ? result.error : 'not calculated',
    };
  });
  const models = [...new Set(sites.flatMap((site) => ('model' in site ? [site.model] : [])))];
  const terrains = [...new Set(sites.flatMap((site) => ('terrain' in site ? [site.terrain] : [])))];
  return `${JSON.stringify(
    {
      format: 'lunar-mission-lab-export',
      version: FORMAT_VERSION,
      mission: {
        start_utc: state.startUtc,
        days: state.days,
        mast_height_m: state.mastHeightM,
        power: { array_kw: state.power.arrayKw, battery_kwh: state.power.batteryKwh, load_kw: state.power.loadKw },
        selected_site_id: state.selectedSiteId,
        clock_hours_from_start: state.clockIndex,
        samples_per_site: state.days * 24 + 1,
        step_hours: 1,
      },
      models,
      terrains,
      sites,
    },
    null,
    1,
  )}\n`;
}

function save(filename: string, content: string | Blob, type: string): void {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadCsv(): void {
  save(`lunar-mission-lab-${stamp()}.csv`, buildCsv(), 'text/csv;charset=utf-8');
}

export function downloadJson(): void {
  save(`lunar-mission-lab-${stamp()}.json`, buildJson(), 'application/json');
}

/** Mission planning report: sends the plan, receives a PDF built from server-side recalculation. */
export type ReportParts = 'all' | 'sites' | 'outpost';

export async function downloadPdfReport(include: ReportParts = 'all'): Promise<void> {
  const plan = snapshot();
  const pdf = await api.reportPdf({
    start: plan.startUtc,
    days: plan.days,
    observer_height_m: plan.mastHeightM,
    power: { array_kw: plan.power.arrayKw, battery_kwh: plan.power.batteryKwh, load_kw: plan.power.loadKw },
    crew: { people: plan.crew, kw_per_person: plan.crewKw },
    include,
    sites: plan.sites.map((site) => ({
      site_id: site.id,
      name: site.name.slice(0, 80) || site.id,
      latitude_deg: site.latitudeDeg,
      longitude_deg: site.longitudeDeg,
    })),
  });
  const name = include === 'sites' ? 'lunar-landing-site-plan' : include === 'outpost' ? 'lunar-outpost-stay-plan' : 'lunar-mission-report';
  save(`${name}-${stamp()}.pdf`, pdf, 'application/pdf');
}

export async function copyShareLink(): Promise<boolean> {
  const text = shareUrl();
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const done = document.execCommand('copy');
    area.remove();
    return done;
  }
}

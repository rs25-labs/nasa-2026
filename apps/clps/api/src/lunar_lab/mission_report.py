"""Mission planning report as a PDF.

The browser sends only the plan (sites, landing time, stay, mast, power). Every number in the report is recalculated
here with the same estimate service the sites table uses, so the PDF can be trusted on its own. Written summaries
come from fixed sentence templates filled with those numbers; no language model is involved.
"""
from datetime import datetime, timedelta, timezone
from io import BytesIO
import math
import threading

from .live_estimates import MAX_BATCH_SITES, validate_batch

_LOCK = threading.RLock()

# Battery rules, identical to the app's (apps/clps/studio/src/lib/mission/derive.ts).
MAX_CHARGE_KW = 2.0
MAX_DISCHARGE_KW = 2.0
CHARGE_EFFICIENCY = 0.9
DISCHARGE_EFFICIENCY = 0.9
EPSILON = 1e-9
# Ranking weights, identical to the app's recommendation (plan/table/Recommendation.svelte).
SUN_WEIGHT, EARTH_WEIGHT, BATTERY_WEIGHT = 0.5, 0.3, 0.2

SUN_COLOUR = '#c77d00'
EARTH_COLOUR = '#2f6fb3'
INK = '#1a1a1a'
MUTED = '#5b5b5b'
RULE = '#c9c9c9'
A4 = (8.27, 11.69)
MAX_NAME = 80
MAX_CREW = 40

# Outpost stay plan rules, identical to the app's (apps/clps/studio/src/lib/mission/stayPlan.ts).
STAY_DARK_FRACTION = 0.05
STAY_WORK_LIGHT = 0.5
STAY_EARTH_LINK = 0.5
STAY_ARRAY_MARGIN = 1.25
STAY_BATTERY_MARGIN = 1.2
STAY_MIN_SOLAR_SHARE = 0.1
ARRAY_KW_PER_M2 = 0.3
BATTERY_KWH_PER_KG = 0.2
GOOD, WARN, BAD = '#1e8e4e', '#c77d00', '#c0392b'


def _longest(flags):
    """Longest run of true values: (hours, first hour)."""
    best, run = (0, 0), 0
    for hour, flag in enumerate(flags):
        run = run + 1 if flag else 0
        if run > best[0]:
            best = (run, hour - run + 1)
    return best


def stay_plan(sun, earth, load_kw):
    """What a crew drawing load_kw must bring to stay, and what to watch, from hourly Sun and Earth visible fractions."""
    hours = max(1, min(len(sun), len(earth)))
    sun, earth = sun[:hours], earth[:hours]
    share = sum(sun) / hours
    viable = share >= STAY_MIN_SOLAR_SHARE
    array_kw = load_kw * STAY_ARRAY_MARGIN / share if viable else 0.0
    deficit = deepest = 0.0
    for fraction in sun:
        net = array_kw * fraction - load_kw
        deficit = deficit - net / DISCHARGE_EFFICIENCY if net < 0 else max(0.0, deficit - net * CHARGE_EFFICIENCY)
        deepest = max(deepest, deficit)
    battery_kwh = max(load_kw, deepest * STAY_BATTERY_MARGIN)
    sun_up = [value >= STAY_WORK_LIGHT for value in sun]
    earth_up = [value >= STAY_EARTH_LINK for value in earth]
    work = [a and b for a, b in zip(sun_up, earth_up)]
    dark, gap = _longest([value < STAY_DARK_FRACTION for value in sun]), _longest([not up for up in earth_up])
    work_share = sum(work) / hours
    tones = [
        GOOD if dark[0] <= 6 else WARN if dark[0] <= 48 else BAD,
        GOOD if gap[0] <= 1 else WARN if gap[0] <= 24 else BAD,
        GOOD if work_share >= 0.6 else WARN if work_share >= 0.3 else BAD,
    ]
    if not viable:
        verdict, tone = 'Solar cannot carry this stay', BAD
    elif BAD in tones:
        verdict, tone = 'At risk', BAD
    elif WARN in tones:
        verdict, tone = 'Workable', WARN
    else:
        verdict, tone = 'Good to go', GOOD
    return dict(hours=hours, viable=viable, array_kw=array_kw, array_m2=array_kw / ARRAY_KW_PER_M2, battery_kwh=battery_kwh,
                battery_t=battery_kwh / BATTERY_KWH_PER_KG / 1000, dark=dark, gap=gap, work_hours=sum(work), work_share=work_share,
                sun_up=sun_up, earth_up=earth_up, work=work, tones=tones, verdict=verdict, tone=tone)


def _energy(kwh):
    return f'{kwh / 1000:.1f} MWh' if kwh >= 1000 else f'{kwh:.0f} kWh'


def _stretch(stretch):
    hours, first = stretch
    if hours <= 0:
        return 'none'
    return f"{hours / 24:.1f} d, day {first // 24 + 1}" if hours >= 48 else f"{hours} h, day {first // 24 + 1}"


def validate_report(data):
    """Check the plan and split it into estimate requests, site names and power settings."""
    expected = {'start', 'days', 'observer_height_m', 'sites', 'power'}
    if not isinstance(data, dict) or set(data) - {'crew', 'include'} != expected:
        raise ValueError('Provide start, days, observer_height_m, sites, power and optionally crew and include only.')
    include = data.get('include', 'all')
    if include not in ('all', 'sites', 'outpost'):
        raise ValueError('include must be all, sites or outpost.')
    if include == 'outpost' and data.get('crew') is None:
        raise ValueError('The outpost stay plan needs crew.')
    crew = data.get('crew')
    if crew is not None:
        if not isinstance(crew, dict) or set(crew) != {'people', 'kw_per_person'}:
            raise ValueError('Crew needs people and kw_per_person only.')
        people, each = crew['people'], crew['kw_per_person']
        if isinstance(people, bool) or not isinstance(people, int) or not 1 <= people <= MAX_CREW:
            raise ValueError(f'people must be a whole number from 1 to {MAX_CREW}.')
        if isinstance(each, bool) or not isinstance(each, (int, float)) or not math.isfinite(each) or not 0.5 <= each <= 10:
            raise ValueError('kw_per_person must be a number from 0.5 to 10.')
        crew = dict(people=people, kw_per_person=float(each))
    sites = data['sites']
    if not isinstance(sites, list) or not 1 <= len(sites) <= MAX_BATCH_SITES:
        raise ValueError(f'Provide 1–{MAX_BATCH_SITES} sites.')
    names, batch_sites = {}, []
    for site in sites:
        if not isinstance(site, dict) or set(site) != {'site_id', 'name', 'latitude_deg', 'longitude_deg'}:
            raise ValueError('Each site needs site_id, name, latitude_deg and longitude_deg only.')
        if not isinstance(site['name'], str) or not site['name'].strip() or len(site['name']) > MAX_NAME:
            raise ValueError(f'Each site name must be 1–{MAX_NAME} characters.')
        names[site['site_id']] = site['name'].strip()
        batch_sites.append({key: site[key] for key in ('site_id', 'latitude_deg', 'longitude_deg')})
    power = data['power']
    if not isinstance(power, dict) or set(power) != {'array_kw', 'battery_kwh', 'load_kw'}:
        raise ValueError('Power needs array_kw, battery_kwh and load_kw only.')
    for key, value in power.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1000:
            raise ValueError(f'{key} must be a number from 0 to 1000.')
    requests = validate_batch(dict(start=data['start'], days=data['days'], observer_height_m=data['observer_height_m'], sites=batch_sites))
    return requests, names, {key: float(value) for key, value in power.items()}, (None if include == 'sites' else crew), include


def battery(fractions, power):
    """State of charge each hour, lowest charge and hours empty: the app's battery model, line for line."""
    capacity = max(0.0, power['battery_kwh'])
    soc, lowest, empty = capacity, capacity, 0
    series = [capacity]
    for hour in range(len(fractions) - 1):
        net = power['array_kw'] * fractions[hour] - power['load_kw']
        if net >= 0:
            soc = min(capacity, soc + min(net, MAX_CHARGE_KW) * CHARGE_EFFICIENCY)
        else:
            need = -net
            deliverable = min(need, MAX_DISCHARGE_KW, soc * DISCHARGE_EFFICIENCY)
            soc = max(0.0, soc - deliverable / DISCHARGE_EFFICIENCY)
            if deliverable < need - EPSILON:
                empty += 1
        series.append(soc)
        lowest = min(lowest, soc)
    return series, lowest, empty


def _summary(result, body):
    return next((item for item in result['summaries'] if item['body'] == body), None)


def _parse(stamp):
    return datetime.fromisoformat(stamp.replace('Z', '+00:00'))


def _utc(moment):
    return moment.strftime('%Y-%m-%d %H:%M UTC')


def _metrics(result, power, hours):
    sun, earth = _summary(result, 'SUN'), _summary(result, 'EARTH')
    soc, lowest, empty = battery(result['series']['sun']['fraction'], power)
    capacity = power['battery_kwh']
    powered = 1 - min(1, empty / hours) if hours else 1
    sun_mean = sun['mean_visible_fraction'] if sun else 0.0
    earth_mean = earth['mean_visible_fraction'] if earth else 0.0
    return dict(
        sun=sun_mean, dark=sun['longest_blocked_hours'] if sun else None,
        earth=earth_mean, earth_loss=earth['longest_blocked_hours'] if earth else None,
        soc=soc, lowest=lowest, lowest_pct=(lowest / capacity) if capacity > 0 else 0.0, empty=empty,
        score=SUN_WEIGHT * sun_mean + EARTH_WEIGHT * earth_mean + BATTERY_WEIGHT * powered,
    )


def _horizon_at(horizon, azimuth):
    """Terrain skyline elevation at a bearing, interpolated between the 2° samples."""
    step = 360 / len(horizon)
    position = (azimuth % 360) / step
    lower = int(math.floor(position)) % len(horizon)
    upper = (lower + 1) % len(horizon)
    weight = position - math.floor(position)
    return horizon[lower] + (horizon[upper] - horizon[lower]) * weight


def summary_sentences(rows, power, days):
    """The report's written summary: fixed templates filled with the calculated numbers."""
    ok = [row for row in rows if row['ok']]
    if not ok:
        return ['No site could be calculated for this stay.']
    lines = []
    best = max(ok, key=lambda row: row['m']['score'])
    if len(ok) > 1:
        lines.append(
            f"Recommended site: {best['name']}, with {best['m']['sun']:.0%} sunlight and Earth in view "
            f"{best['m']['earth']:.0%} of the stay. It ranks first on a score weighted toward sunlight, then Earth in view, then battery."
        )
    else:
        lines.append(f"{best['name']}: {best['m']['sun']:.0%} sunlight and Earth in view {best['m']['earth']:.0%} of the stay.")
    sunniest = max(ok, key=lambda row: row['m']['sun'])
    darkest = max(ok, key=lambda row: row['m']['dark'] or 0)
    lines.append(f"Most sunlight: {sunniest['name']} ({sunniest['m']['sun']:.0%}). Longest dark stretch: {darkest['name']}, {darkest['m']['dark']} h.")
    earthiest = max(ok, key=lambda row: row['m']['earth'])
    lines.append(f"Best Earth visibility: {earthiest['name']} ({earthiest['m']['earth']:.0%} of the stay).")
    flat = [row for row in ok if row['m']['empty'] > 0]
    setup = f"{power['array_kw']:g} kW array, {power['battery_kwh']:g} kWh battery, {power['load_kw']:g} kW load"
    if flat:
        worst = max(flat, key=lambda row: row['m']['empty'])
        lines.append(
            f"With a {setup}, {len(flat)} of {len(ok)} sites run the battery flat; {worst['name']} is empty for "
            f"{worst['m']['empty']} h of the {days * 24} h stay."
        )
    else:
        lowest = min(ok, key=lambda row: row['m']['lowest_pct'])
        lines.append(f"With a {setup}, every site keeps power; the lowest charge is {lowest['m']['lowest_pct']:.0%} at {lowest['name']}.")
    return lines


def report_pdf(batch, names, power, observer_height_m, crew=None, include='all'):
    """Builds the PDF from a batch estimate result (as returned by LiveEstimates.estimates)."""
    from matplotlib.backends.backend_pdf import PdfPages
    from matplotlib.figure import Figure

    start, end, days = _parse(batch['start_utc']), _parse(batch['end_utc']), batch['days']
    hours = days * 24
    rows = []
    for result in batch['results']:
        name = names.get(result['site_id'], result['site_id'])
        if result.get('ok'):
            rows.append(dict(ok=True, name=name, result=result, m=_metrics(result, power, hours)))
        else:
            rows.append(dict(ok=False, name=name, error=result.get('error', 'Estimate failed.')))
    created = datetime.now(timezone.utc)
    output = BytesIO()

    def page():
        fig = Figure(figsize=A4, facecolor='white')
        fig.text(0.08, 0.035, f'Lunar Mission Lab · mission planning report · generated {_utc(created)}', fontsize=7, color=MUTED)
        return fig

    def wrap(text, width):
        words, lines, line = text.split(), [], ''
        for word in words:
            if len(line) + len(word) + 1 > width:
                lines.append(line)
                line = word
            else:
                line = f'{line} {word}'.strip()
        return lines + ([line] if line else [])

    with _LOCK, PdfPages(output, metadata={'Title': 'Lunar Mission Lab mission planning report', 'Author': 'Lunar Mission Lab'}) as pdf:
        # Page 1: plan, summary and comparison.
        fig = page()
        fig.text(0.08, 0.94, 'Mission planning report', fontsize=20, fontweight='bold', color=INK)
        fig.text(0.08, 0.915, 'Lunar Mission Lab · NASA Space Apps Challenge 2026', fontsize=10, color=MUTED)
        plan = [
            ('Landing', _utc(start)),
            ('Stay', f'{days} days, to {_utc(end)}'),
            ('Mast height', f'{observer_height_m:g} m'),
            ('Power', f"array {power['array_kw']:g} kW · battery {power['battery_kwh']:g} kWh · load {power['load_kw']:g} kW"),
            ('Sites compared', str(len(rows))),
        ]
        y = 0.875
        for label, value in plan:
            fig.text(0.08, y, label, fontsize=9, color=MUTED)
            fig.text(0.27, y, value, fontsize=9, color=INK)
            y -= 0.02
        y -= 0.015
        fig.text(0.08, y, 'Summary', fontsize=12, fontweight='bold', color=INK)
        y -= 0.025
        for sentence in summary_sentences(rows, power, days):
            for line in wrap(sentence, 100):
                fig.text(0.08, y, line, fontsize=9, color=INK)
                y -= 0.017
            y -= 0.006
        y -= 0.015
        fig.text(0.08, y, 'Comparison', fontsize=12, fontweight='bold', color=INK)
        header = ['Site', 'Latitude,\nlongitude', 'Sunlight', 'Longest\ndark', 'Earth\nin view', 'Longest\nEarth loss', 'Lowest\nbattery', 'Hours\nempty']
        cells = []
        for row in sorted(rows, key=lambda item: -(item['m']['score'] if item['ok'] else -1)):
            name = '\n'.join(wrap(row['name'], 26)[:2])
            if not row['ok']:
                cells.append([name, '', 'not calculated', '', '', '', '', ''])
                continue
            request, m = row['result']['request'], row['m']
            cells.append([
                name, f"{request['latitude_deg']:.3f}°,\n{request['longitude_deg']:.3f}°",
                f"{m['sun']:.0%}", f"{m['dark']} h", f"{m['earth']:.0%}", f"{m['earth_loss']} h",
                f"{m['lowest_pct']:.0%}", f"{m['empty']} h",
            ])
        table_height = 0.036 * (len(cells) + 1)
        ax = fig.add_axes((0.08, y - 0.012 - table_height, 0.84, table_height))
        ax.axis('off')
        # bbox makes the table fill its axes exactly, so the rows use the space reserved for them.
        table = ax.table(cellText=cells, colLabels=header, bbox=(0, 0, 1, 1), cellLoc='left', colLoc='left',
                         colWidths=[0.27, 0.15, 0.09, 0.09, 0.09, 0.11, 0.1, 0.1])
        table.auto_set_font_size(False)
        table.set_fontsize(7.5)
        for (r, _), cell in table.get_celld().items():
            cell.set_edgecolor(RULE)
            cell.PAD = 0.04
            if r == 0:
                cell.set_text_props(fontweight='bold')
                cell.set_facecolor('#f1f1f1')
        note_y = y - 0.035 - table_height
        for line in wrap('Sites are ordered by the same score the app uses for its recommendation: half sunlight, three tenths Earth in view, '
                         'one fifth time with battery power. Hours empty: hours the battery sat at 0% with the load unmet.', 110):
            fig.text(0.08, note_y, line, fontsize=7.5, color=MUTED)
            note_y -= 0.015
        if include != 'outpost':
            pdf.savefig(fig)

        # Outpost stay plan: what the crew must bring at each site, and what to watch.
        if crew:
            load_kw = crew['people'] * crew['kw_per_person']
            plans = [(row, stay_plan(row['result']['series']['sun']['fraction'], row['result']['series']['earth']['fraction'], load_kw))
                     for row in rows if row['ok']]
            plans.sort(key=lambda item: item[1]['battery_kwh'])
            fig = page()
            fig.text(0.08, 0.94, 'Outpost stay plan', fontsize=20, fontweight='bold', color=INK)
            fig.text(0.08, 0.915, f"{crew['people']} crew for {days} days from {_utc(start)} · {crew['kw_per_person']:g} kW per person · "
                     f"{load_kw:g} kW continuous load", fontsize=10, color=MUTED)
            y = 0.88
            if plans:
                best_row, best = plans[0]
                lines = [f"Cheapest site to support: {best_row['name']}, with a {best['array_kw']:.0f} kW array "
                         f"({best['array_m2']:.0f} m² of panel) and {_energy(best['battery_kwh'])} of battery ({best['battery_t']:.2f} t of cells)."]
                if len(plans) > 1:
                    worst_row, worst = plans[-1]
                    ratio = worst['battery_kwh'] / max(1e-6, best['battery_kwh'])
                    lines.append(f"Most demanding: {worst_row['name']}, which needs {_energy(worst['battery_kwh'])} of battery, "
                                 f"{ratio:.0f} times as much." if ratio >= 1.5 else f"The other sites need about the same battery.")
                relay = [row['name'] for row, plan in plans if plan['gap'][0] > 24]
                if relay:
                    lines.append(f"Earth is out of view for more than a day at {', '.join(relay)}: plan a relay.")
                for sentence in lines:
                    for line in wrap(sentence, 100):
                        fig.text(0.08, y, line, fontsize=9, color=INK)
                        y -= 0.017
                    y -= 0.006
            header = ['Site', 'Verdict', 'Solar array', 'Battery', 'Longest\ndarkness', 'Longest\nEarth gap', 'Work\noutside']
            cells, colours = [], []
            for row, plan in plans:
                cells.append([
                    '\n'.join(wrap(row['name'], 24)[:2]), plan['verdict'],
                    f"{plan['array_kw']:.0f} kW\n{plan['array_m2']:.0f} m²" if plan['viable'] else 'too little\nsunlight',
                    f"{_energy(plan['battery_kwh'])}\n{plan['battery_t']:.2f} t",
                    _stretch(plan['dark']), _stretch(plan['gap']), f"{plan['work_share']:.0%}\n{plan['work_hours']} h",
                ])
                colours.append([plan['tone'], *plan['tones']])
            if cells:
                table_height = 0.04 * (len(cells) + 1)
                ax = fig.add_axes((0.08, y - 0.012 - table_height, 0.84, table_height))
                ax.axis('off')
                table = ax.table(cellText=cells, colLabels=header, bbox=(0, 0, 1, 1), cellLoc='left', colLoc='left',
                                 colWidths=[0.25, 0.15, 0.12, 0.13, 0.12, 0.12, 0.11])
                table.auto_set_font_size(False)
                table.set_fontsize(7.5)
                for (r, c), cell in table.get_celld().items():
                    cell.set_edgecolor(RULE)
                    cell.PAD = 0.04
                    if r == 0:
                        cell.set_text_props(fontweight='bold')
                        cell.set_facecolor('#f1f1f1')
                    elif c in (1, 4, 5, 6):
                        cell.set_text_props(color=colours[r - 1][{1: 0, 4: 1, 5: 2, 6: 3}[c]], fontweight='bold')
                y -= 0.04 + table_height
                # The stay hour by hour at each site: Sun, Earth link, and hours fit for work outside.
                fig.text(0.08, y, 'The stay, hour by hour', fontsize=12, fontweight='bold', color=INK)
                fig.text(0.42, y + 0.002, 'amber: Sun up · blue: Earth in view · green: both, fit for work outside', fontsize=7.5, color=MUTED)
                y -= 0.02
                strip = min(0.07, (y - 0.09) / len(plans))
                for row, plan in plans:
                    ax = fig.add_axes((0.3, y - strip * 0.8, 0.62, strip * 0.72))
                    t_days = [hour / 24 for hour in range(plan['hours'])]
                    for level, flags, colour in ((2, plan['sun_up'], SUN_COLOUR), (1, plan['earth_up'], EARTH_COLOUR), (0, plan['work'], GOOD)):
                        ax.fill_between(t_days, [level + 0.85 * flag for flag in flags], [level] * len(t_days), color=colour, linewidth=0, step='post')
                    ax.set_xlim(0, days)
                    ax.set_ylim(0, 3)
                    ax.set_yticks([])
                    ax.tick_params(labelsize=6)
                    for side in ('top', 'right', 'left'):
                        ax.spines[side].set_visible(False)
                    fig.text(0.08, y - strip * 0.45, '\n'.join(wrap(row['name'], 28)[:2]), fontsize=8, color=INK, va='center')
                    y -= strip
            pdf.savefig(fig)

        # One page per site.
        for row in (rows if include != 'outpost' else []):
            fig = page()
            fig.text(0.08, 0.95, row['name'], fontsize=15, fontweight='bold', color=INK)
            if not row['ok']:
                fig.text(0.08, 0.92, f"Not calculated: {row['error']}", fontsize=9, color=INK)
                pdf.savefig(fig)
                continue
            result, m = row['result'], row['m']
            request = result['request']
            fig.text(0.08, 0.928, f"{request['latitude_deg']:.4f}°, {request['longitude_deg']:.4f}° · terrain: {result['terrain']}", fontsize=8.5, color=MUTED)
            fig.text(0.08, 0.91,
                     f"Sunlight {m['sun']:.0%} · longest dark {m['dark']} h · Earth in view {m['earth']:.0%} · longest Earth loss {m['earth_loss']} h · "
                     f"lowest battery {m['lowest_pct']:.0%}, {m['empty']} h empty", fontsize=8.5, color=INK)
            horizon = result['horizon_elevation_deg']
            sun, earth = result['series']['sun'], result['series']['earth']
            t_days = [hour / 24 for hour in range(len(sun['fraction']))]

            # Sky: skyline all round, with the Sun and Earth tracks over the stay.
            ax = fig.add_axes((0.1, 0.69, 0.82, 0.18))
            azimuths = [index * 360 / len(horizon) for index in range(len(horizon))] + [360]
            ax.fill_between(azimuths, [-30] * len(azimuths), horizon + [horizon[0]], color='#d4d4d4', linewidth=0)
            ax.plot(azimuths, horizon + [horizon[0]], color='#7a7a7a', linewidth=0.8, label='Terrain skyline')
            ax.scatter([a % 360 for a in sun['azimuth_deg']], sun['elevation_deg'], s=2, color=SUN_COLOUR, label='Sun, hourly')
            ax.scatter([a % 360 for a in earth['azimuth_deg']], earth['elevation_deg'], s=2, color=EARTH_COLOUR, label='Earth, hourly')
            low = min(min(horizon), min(sun['elevation_deg']), min(earth['elevation_deg'])) - 1
            high = max(max(horizon), max(sun['elevation_deg']), max(earth['elevation_deg'])) + 1
            ax.set_xlim(0, 360)
            ax.set_ylim(max(-30, low), min(90, high))
            ax.set_xticks([0, 90, 180, 270, 360], ['N', 'E', 'S', 'W', 'N'])
            ax.set_ylabel('Elevation, °', fontsize=8)
            ax.set_title('Sky from the site: skyline and the Sun and Earth tracks', fontsize=9, loc='left')
            ax.tick_params(labelsize=7)
            ax.legend(fontsize=6.5, loc='upper right', markerscale=3)

            # Elevation over the stay, with the skyline in each body's direction.
            ax = fig.add_axes((0.1, 0.47, 0.82, 0.17))
            ax.plot(t_days, sun['elevation_deg'], color=SUN_COLOUR, linewidth=1, label='Sun')
            ax.plot(t_days, [_horizon_at(horizon, a) for a in sun['azimuth_deg']], color=SUN_COLOUR, linewidth=0.7, linestyle='--', label='Skyline toward Sun')
            ax.plot(t_days, earth['elevation_deg'], color=EARTH_COLOUR, linewidth=1, label='Earth')
            ax.plot(t_days, [_horizon_at(horizon, a) for a in earth['azimuth_deg']], color=EARTH_COLOUR, linewidth=0.7, linestyle='--', label='Skyline toward Earth')
            ax.set_xlim(0, days)
            ax.set_ylabel('Elevation, °', fontsize=8)
            ax.set_title('Height above the horizon over the stay', fontsize=9, loc='left')
            ax.tick_params(labelsize=7)
            ax.legend(fontsize=6.5, loc='upper right', ncol=2)

            # Visible share of each disc, and the battery.
            ax = fig.add_axes((0.1, 0.33, 0.82, 0.09))
            ax.fill_between(t_days, [1 + f for f in sun['fraction']], [1] * len(t_days), color=SUN_COLOUR, linewidth=0, step='post')
            ax.fill_between(t_days, earth['fraction'], [0] * len(t_days), color=EARTH_COLOUR, linewidth=0, step='post')
            ax.set_xlim(0, days)
            ax.set_ylim(0, 2)
            ax.set_yticks([0.5, 1.5], ['Earth', 'Sun'])
            ax.set_title('Visible share of the Sun and Earth discs, hour by hour', fontsize=9, loc='left')
            ax.tick_params(labelsize=7)

            ax = fig.add_axes((0.1, 0.19, 0.82, 0.09))
            capacity = power['battery_kwh']
            ax.plot(t_days, [(value / capacity * 100) if capacity > 0 else 0 for value in m['soc']], color=INK, linewidth=1)
            ax.set_xlim(0, days)
            ax.set_ylim(0, 105)
            ax.set_ylabel('Charge, %', fontsize=8)
            ax.set_xlabel(f'Days after landing ({_utc(start)})', fontsize=8)
            ax.set_title('Battery charge', fontsize=9, loc='left')
            ax.tick_params(labelsize=7)

            # Rise and set times.
            events = sorted(result['events'], key=lambda event: event['utc'])
            fig.text(0.08, 0.13, 'Rise and set times (upper limb meets the skyline; about ±1 min)', fontsize=9, fontweight='bold', color=INK)
            if not events:
                fig.text(0.08, 0.11, 'No sunrise, sunset, Earthrise or Earthset during this stay.', fontsize=8.5, color=INK)
            for index, event in enumerate(events[:10]):
                column, line = divmod(index, 5)
                label = {('SUN', 'rise'): 'Sunrise', ('SUN', 'set'): 'Sunset', ('EARTH', 'rise'): 'Earthrise', ('EARTH', 'set'): 'Earthset'}.get(
                    (event['body'], event['kind']), f"{event['body']} {event['kind']}")
                fig.text(0.08 + column * 0.42, 0.11 - line * 0.0135, f"{label:<10} {_utc(_parse(event['utc']))}", fontsize=8, color=INK)
            if len(events) > 10:
                fig.text(0.08, 0.11 - 5 * 0.0135, f'… and {len(events) - 10} more.', fontsize=8, color=MUTED)
            pdf.savefig(fig)

        # Data and methods.
        fig = page()
        fig.text(0.08, 0.94, 'Data and methods', fontsize=15, fontweight='bold', color=INK)
        models = sorted({row['result']['model'] for row in rows if row['ok']})
        terrains = sorted({row['result']['terrain'] for row in rows if row['ok']})
        paragraphs = [
            ('Estimates', 'Every number is an estimate, not a certified bound. For each site and each hour of the stay, the Sun and Earth '
             'discs are tested against a terrain horizon sampled every 2° of azimuth out to 150 km. The visible fraction is the '
             'share of the disc above that horizon. Rise and set times are found by bisection to about a minute.'),
            ('Horizon, Sun and Earth', 'The Moon has no atmosphere, so there is no refraction: the skyline is the terrain plus the curve of '
             'the Moon. Sun and Earth directions come from JPL’s DE421 ephemeris and the Moon’s orientation model through NAIF SPICE, '
             'corrected for light time and aberration, which includes libration and the changing shape of the Moon’s orbit.'),
            ('Terrain', 'Sites south of 85°S use LOLA polar terrain: 10 m near the site and 40 m beyond, out to 150 km. Other sites use the '
             'global LOLA map (about 1.9 km). At a 2 m mast, metre-scale relief can shift rise and set times by hours.'),
            ('Earth in view', 'Earth in view is line-of-sight geometry. It is not a radio link budget.'),
            ('Battery', f'Each hour, solar power is the array size times the Sun’s visible fraction, minus the load. The battery starts full, '
             f'charges at up to {MAX_CHARGE_KW:g} kW at {CHARGE_EFFICIENCY:.0%} efficiency and discharges at up to {MAX_DISCHARGE_KW:g} kW at '
             f'{DISCHARGE_EFFICIENCY:.0%}. An hour counts as empty when the battery is at 0% and the load goes unmet.'),
            ('Outpost stay plan', f'The load is the crew size times the power per person. The solar array is sized to carry that load on the '
             f'stay’s average sunlight with a {STAY_ARRAY_MARGIN - 1:.0%} margin, at {ARRAY_KW_PER_M2:g} kW per square metre of panel. The battery is the deepest '
             f'draw over the stay with that array, plus {STAY_BATTERY_MARGIN - 1:.0%}, at {BATTERY_KWH_PER_KG:g} kWh per kilogram. Darkness counts hours with under '
             f'{STAY_DARK_FRACTION:.0%} of the Sun visible; work outside counts hours with at least half of both discs visible. '
             'Colours: darkness up to 6 h green, up to 48 h amber; Earth gap up to 1 h green, up to 24 h amber; work outside from 60% green, from 30% amber.'),
            ('Recommendation', 'Sites are ranked by 0.5 × sunlight share + 0.3 × Earth-in-view share + 0.2 × share of hours with battery power. '
             'The written summary is filled in from these numbers by fixed templates; no language model is used.'),
            ('Data', 'LOLA LDEM_85S_10M, LDEM_85S_40M and LDEM_16 (NASA PDS Geosciences Node); NAIF SPICE kernels de421.bsp, '
             'moon_pa_de421_1900-2050.bpc, moon_080317.tf, pck00011.tpc, naif0012.tls (JPL NAIF).'),
            ('This report', f"Model: {', '.join(models) or 'none'}. Terrain: {'; '.join(terrains) or 'none'}. Generated {_utc(created)}."),
        ]
        y = 0.9
        for title, body in paragraphs:
            fig.text(0.08, y, title, fontsize=10, fontweight='bold', color=INK)
            y -= 0.02
            for line in wrap(body, 105):
                fig.text(0.08, y, line, fontsize=8.5, color=INK)
                y -= 0.016
            y -= 0.014
        pdf.savefig(fig)
    return output.getvalue()

"""Versioned mission summary from a validated saved snapshot; no asset loading."""
from io import BytesIO
import textwrap
import threading

_LOCK=threading.RLock()


def report_pdf(record):
    # Existing application dependency; import only for an explicit PDF request.
    from matplotlib.figure import Figure
    from matplotlib.backends.backend_pdf import PdfPages
    from matplotlib.font_manager import FontProperties
    from matplotlib.textpath import TextToPath
    run=record['session']['run'];source=run['source'];config=run['config'];request=source['request'];rules=run['rules']
    expanded=run['schema_version']==2;pages=3 if expanded else 2
    crew=config.get('crew',rules.get('crew',1))
    output=BytesIO()
    # PDF/font backend state is shared inside the process.
    with _LOCK, PdfPages(output,metadata={'Title':'Lunar Mission Lab - '+record['name'],'Author':'Lunar Mission Lab'}) as pdf:
        fig=Figure(figsize=(8.27,11.69),facecolor='white')
        def text(x,y,value,size=9):
            # Preserve arbitrary Unicode exactly in JSON; PDF escapes glyphs not
            # covered by its ASCII report contract instead of rendering squares.
            value=str(value).encode('ascii','backslashreplace').decode()
            fig.text(x,y,value,fontsize=size,fontfamily='DejaVu Sans',va='top',parse_math=False)
        def block(y,value,width=98,lines=6,size=9):
            wrapped=[]
            value=str(value).encode('ascii','backslashreplace').decode()
            font=FontProperties(family='DejaVu Sans',size=size);maximum=.84*8.27*72;metrics=TextToPath()
            measure=lambda value:metrics.get_text_width_height_descent(value,font,False)[0]
            for paragraph in value.splitlines():
                for line in textwrap.wrap(paragraph,width=width,break_long_words=True,break_on_hyphens=False) or ['']:
                    while line and measure(line)>maximum:
                        low,high=1,len(line)
                        while low<high:
                            middle=(low+high+1)//2
                            if measure(line[:middle])<=maximum:low=middle
                            else:high=middle-1
                        cut=line.rfind(' ',0,low+1)
                        if cut<low//2:cut=low
                        wrapped.append(line[:cut]);line=line[cut:].lstrip()
                    wrapped.append(line)
            if len(wrapped)>lines:wrapped=wrapped[:lines-1]+['[Continued in full saved JSON]']
            for line in wrapped:text(.08,y,line,size);y-=.016 if size<=9 else .027
            return y-.012
        text(.08,.965,'LUNAR MISSION LAB  /  OUTPOST REPORT',10)
        y=block(.925,record['name'],width=58,lines=2,size=16)
        y=block(y,f"Saved revision {record['revision']} | {run['status'].upper()} | {run['elapsed_h']:.2f} / {source['duration']:g} hours\nSaved UTC: {record['updated_utc']}\nMission ID: {record['id']}",lines=4)
        y=block(y,'SOURCE CALCULATION\n'+f"{request['site_id']} | {request['latitude_deg']} deg, {request['longitude_deg']} deg\n{request['start_utc']} to {request['end_utc']}\nObserver {request['observer_height_m']} m | source cadence {request['step_hours']} h\nCalculation: {source['cache_key']}\nSource run: {source['run_id']}\nScience versions: "+', '.join(str(v) for v in source.get('scientific_versions',[]))[:300],lines=9)
        y=block(y,'ALLOCATION AND PROGRESS\n'+f"{config['mass_kg']:.2f} / {rules['budget_kg']:g} kg | crew {crew:g}\nSolar {config['solar_kw']:g} kW | battery {config['battery_kwh']:g} kWh | initial reserve {config['support_units']:g} units\nBattery now {run['battery_kwh']:.2f} kWh | reserve now {run['support_units']:.2f} units\nScience {run['science_h']:.2f} / {config['objective_h']:g} science-hours\nGenerated {run['generated_kwh']:.2f} kWh | curtailed {run['curtailed_kwh']:.2f} kWh\nEssential shortfall {run['essential_shortfall_kwh']:.2f} kWh | UNKNOWN solar time {run['unknown_h']:.2f} h",lines=7)
        y=block(y,'OUTCOME\n'+(run['reason'] or 'In progress. Resume explicitly; no time advances while the page is closed.'),lines=4)
        assumptions='Solar uses held lower visible-disk estimates with ideal tracking; upper estimates and UNKNOWN remain in the saved source. Not a between-sample guarantee or spacecraft forecast. Battery starts full; 90% charge/discharge efficiency, 2 kW rates. '
        assumptions+=('Essential load and reserve use scale with crew; recycler fault doubles reserve use until repaired. Food/shielding and scripted events are on page 3. Exposure is a teaching proxy, not medical dose. Success permits unpowered time while reserve lasts.' if expanded else 'Essential load 0.4 kW before science 0.8 kW. Reserve depletes 0.05-1 units/h with power shortfall. Success permits unpowered periods while reserve lasts.')
        y=block(y,'TEACHING ASSUMPTIONS / '+rules['version']+'\n'+assumptions,lines=7 if expanded else 6)
        previous=record['session']['previous_attempt']
        if previous:
            prior=f"PREVIOUS ATTEMPT | {previous['status']} at {previous['elapsed_h']:.2f} h\nScience {previous['science_h']:.2f}/{previous['config']['objective_h']:g} h | reserve {previous['support_units']:.2f} | battery {previous['battery_kwh']:.2f} kWh\nAllocation {previous['config']['solar_kw']:g} kW / {previous['config']['battery_kwh']:g} kWh / {previous['config']['support_units']:g} units. Full prior ledger in JSON."
            if expanded:prior+=f"\nCrew {previous['config']['crew']} | initial food {previous['config']['food_days']:g} crew-days | shield {previous['config']['shield_tier']} | seed {previous['seed']} | final proxy {previous['exposure_points']:.2f}"
            block(y,prior,lines=6 if expanded else 4)
        text(.08,.035,f'Teaching-model evidence | Saved JSON preserves full precision, source, rules and ledger.          1 / {pages}',8)
        pdf.savefig(fig)
        fig=Figure(figsize=(8.27,11.69),facecolor='white')
        text(.08,.96,'RESOURCE HISTORY AND PLAYER DECISIONS',13)
        text(.08,.925,f"Saved revision {record['revision']} | elapsed hours since {request['start_utc']}",9)
        history=run['history'];x=[0]+[h['end_h'] for h in history]
        for bottom,key,title,initial,color in [(.735,'battery_kwh','Battery (kWh)',config['battery_kwh'],'#247355'),(.53,'support_units','Support reserve (teaching units)',config['support_units'],'#8a6422'),(.325,'science_h','Science (science-hours)',0,'#315c9b')]:
            values=[initial]+[h[key] for h in history]
            ax=fig.add_axes([.12,bottom,.8,.145]);ax.plot(x,values,color=color,linewidth=1.8)
            upper=max([1]+values+([config['objective_h']] if key=='science_h' else []))
            ax.set_title(title,fontsize=10,loc='left');ax.set_xlim(0,source['duration']);ax.set_ylim(0,upper*1.12);ax.grid(alpha=.2);ax.tick_params(labelsize=8)
            if key=='science_h':ax.axhline(config['objective_h'],linestyle='--',color='#555555',linewidth=.9,label='Objective');ax.legend(fontsize=7,loc='upper left')
        decisions=run['decisions'];y=.255
        text(.08,y,f"RECENT DECISIONS ({len(decisions)} total; complete list in JSON)",9);y-=.024
        for d in decisions[-5:]:text(.08,y,f"At +{d['start_h']:.2f} h: {d['action']}, requested {d['requested_hours']} h",9);y-=.017
        text(.08,.105,'Charts end at the saved state; remaining mission time is not simulated.',8)
        text(.08,.085,'Lower/upper source estimates, UNKNOWN states and substep ledger remain in saved JSON.',8)
        text(.08,.065,'Non-ASCII names are escaped in this PDF; the online save and JSON preserve the original text.',8)
        text(.08,.035,f'Lunar Mission Lab | Report from one saved revision; resume is separate from retry.                 2 / {pages}',8)
        pdf.savefig(fig)
        if expanded:
            fig=Figure(figsize=(8.27,11.69),facecolor='white')
            text(.08,.965,'EXPEDITION SUPPLIES, PROTECTION AND EVENTS',13)
            fault,protection=run['event_schedule']
            block(.925,f"Crew {config['crew']} | initial food {config['food_days']:g} crew-days | shield tier {config['shield_tier']}\nFood remaining {run['food_days']:.2f} crew-days | exposure {run['exposure_points']:.2f} / {rules['exposure_limit']:g} teaching points\nSeed {run['seed']} | fault at +{fault['start_h']:g} h | protection +{protection['start_h']:g} to +{protection['end_h']:g} h\nRepair {run['repair_h']:.2f} / {rules['repair_h']:g} powered hours | fault active {run['fault_active']} | protection active {run['protection_active']}\nFood uses crew/24 crew-days per hour. Shielding halves proxy rate per tier; shelter reduces it another 90%. Events are scripted, not predictions.",lines=7)
            for bottom,key,title,initial,color in [(.595,'food_days','Food (remaining crew-days)',config['food_days'],'#247355'),(.365,'exposure_points','Exposure proxy (teaching points, not dose)',0,'#96533a')]:
                values=[initial]+[h[key] for h in history];ax=fig.add_axes([.12,bottom,.8,.145])
                ax.plot(x,values,color=color,linewidth=1.8);ax.set_title(title,fontsize=10,loc='left');ax.set_xlim(0,source['duration'])
                ax.set_ylim(0,max([1]+values+([rules['exposure_limit']] if key=='exposure_points' else []))*1.12);ax.grid(alpha=.2);ax.tick_params(labelsize=8)
                if key=='exposure_points':ax.axhline(rules['exposure_limit'],linestyle='--',color='#555555',linewidth=.9,label='Failure limit');ax.legend(fontsize=7,loc='upper left')
            block(.29,'RECENT SCRIPTED EVENTS / RESPONSES (complete log in JSON)\n'+'\n'.join(f"+{e['hour']:.2f} h | {e['type']}: {e['message']}" for e in run['events'][-5:]),lines=11)
            text(.08,.075,'Food/support exhaustion or exposure reaching its limit fails, even if science was completed.',8)
            text(.08,.055,'Seeded events and all responses resume exactly; retry begins a fresh attempt on retained inputs.',8)
            text(.08,.035,'Lunar Mission Lab | Full rule constants, source bounds and event ledger remain in saved JSON.       3 / 3',8)
            pdf.savefig(fig)
    return output.getvalue()

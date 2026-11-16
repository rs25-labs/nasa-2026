"""Named, file-backed outpost snapshots. No scientific asset or result-store access."""
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import threading
from uuid import uuid4
from .assets import write_json

MAX_BYTES=4*1024*1024
RULE_VERSION='lml-outpost-slice-v1'
RULE_VALUES=dict(version=RULE_VERSION,crew=1,budget_kg=240,core_kg=40,science_kg=20,
    solar_kg_per_kw=10,battery_kg_per_kwh=5,support_kg_per_unit=2,essential_kw=0.4,
    science_kw=0.8,charge_kw=2,discharge_kw=2,charge_efficiency=0.9,
    discharge_efficiency=0.9,powered_support_per_h=0.05,unpowered_support_per_h=1)
EXPEDITION_VERSION='lml-outpost-expedition-v2'
EXPEDITION_VALUES=dict(RULE_VALUES,version=EXPEDITION_VERSION,default_crew=1,crew_min=1,crew_max=4,
    crew_seat_kg=10,food_kg_per_day=4,food_per_crew_h=1/24,shield_kg=15,
    protection_rate=2,exposure_limit=3,shelter_factor=0.1,repair_kw=0.2,repair_h=2,fault_depletion_factor=2)
del EXPEDITION_VALUES['crew']


def activities(run):
    return ('science','conserve','repair','shelter') if run.get('schema_version')==2 else ('science','conserve')


class SaveConflict(ValueError):
    pass


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()


def numeric(value,low,high,label):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not low<=value<=high or not math.isfinite(value):
        raise ValueError('Invalid '+label)
    return value


def validate_session(session):
    if not isinstance(session,dict) or set(session)!={'kind','schema_version','notice','run','previous_attempt'} or session['schema_version']!=1 or session['kind']!='lml-outpost-session-snapshot':
        raise ValueError('Unsupported outpost snapshot format')
    if not isinstance(session['notice'],str) or len(session['notice'])>1000:raise ValueError('Invalid snapshot notice')
    for index,run in enumerate((session['run'],session['previous_attempt'])):
        if run is None and index==1:continue
        if not isinstance(run,dict):raise ValueError('Invalid run')
        rules=run.get('rules',{})
        if not isinstance(rules,dict) or rules.get('version') not in (RULE_VERSION,EXPEDITION_VERSION):raise ValueError('Unsupported teaching rules; preserve the original JSON')
        expanded=rules['version']==EXPEDITION_VERSION;expected=EXPEDITION_VALUES if expanded else RULE_VALUES
        if run.get('schema_version')!=(2 if expanded else 1) or (not expanded and run.get('seed') is not None):raise ValueError('Invalid run schema/seed')
        for key in expected:
            if key!='version':numeric(rules.get(key),0,1000,'rule '+key)
        if rules!=expected:raise ValueError('Teaching rule constants differ from the supported version')
        source=run.get('source',{});config=run.get('config',{})
        if not isinstance(source,dict) or not re.fullmatch('[a-f0-9]{64}',str(source.get('cache_key',''))):raise ValueError('Invalid source identity')
        if not isinstance(source.get('run_id'),str) or len(source['run_id'])>100:raise ValueError('Invalid source run')
        duration=numeric(source.get('duration'),24,336,'duration')
        request=source.get('request',{})
        if not isinstance(request,dict):raise ValueError('Invalid source request')
        for key in ('site_id','start_utc','end_utc'):
            if not isinstance(request.get(key),str) or not 1<=len(request[key])<=100:raise ValueError('Invalid source '+key)
        for key,low,high in [('latitude_deg',-90,90),('longitude_deg',-180,180),('observer_height_m',0,20),('step_hours',1e-9,336)]:numeric(request.get(key),low,high,key)
        versions=source.get('scientific_versions')
        if not isinstance(versions,list) or len(versions)>128 or any(not isinstance(v,str) or len(v)>128 for v in versions):raise ValueError('Invalid scientific versions')
        try:
            dates=[datetime.fromisoformat(request[k].replace('Z','+00:00')) for k in ('start_utc','end_utc')]
            if any(d.tzinfo is None for d in dates) or (dates[1]-dates[0]).total_seconds()/3600!=duration:raise ValueError('Source duration differs')
        except (ValueError,TypeError):raise ValueError('Invalid source dates/duration') from None
        samples=source.get('samples')
        if not isinstance(samples,list) or not 2<=len(samples)<=2048:raise ValueError('Invalid source sample count')
        for s in samples:
            if not isinstance(s,dict):raise ValueError('Invalid source sample')
            numeric(s.get('h'),0,duration,'sample hour');lo=numeric(s.get('lower'),0,1,'lower estimate');numeric(s.get('upper'),lo,1,'upper estimate')
            if s.get('state') not in ('FULL','PARTIAL','BLOCKED','UNKNOWN') or not isinstance(s.get('source'),dict):raise ValueError('Invalid source sample state')
        if not isinstance(config,dict):raise ValueError('Invalid allocation')
        crew=1
        if expanded:
            for key,low,high in [('crew',1,4),('shield_tier',0,2),('seed',0,2147483647)]:
                numeric(config.get(key),low,high,key)
                if type(config[key]) is not int:raise ValueError('Invalid integer '+key)
            crew=config['crew'];numeric(config.get('food_days'),0.1,56,'food stock')
            if type(run.get('seed')) is not int or run['seed']!=config['seed']:raise ValueError('Saved event seed differs')
        for key,low,high in [('solar_kw',0,4),('battery_kwh',0,30),('support_units',1,120),('objective_h',1,duration*crew),('mass_kg',0,240)]:numeric(config.get(key),low,high,key)
        mass=60+config['solar_kw']*10+config['battery_kwh']*5+config['support_units']*2
        if expanded:mass=60+config['solar_kw']*10+config['battery_kwh']*5+config['support_units']*2+(crew-1)*10+config['food_days']*4+config['shield_tier']*15
        if mass>240 or abs(config['mass_kg']-mass)>1e-7:raise ValueError('Saved allocation mass differs')
        if run.get('status') not in (('running','succeeded','failed') if index==0 else ('running','succeeded','failed','stopped')):raise ValueError('Invalid run status')
        if not isinstance(run.get('reason'),str) or len(run['reason'])>1000:raise ValueError('Invalid outcome reason')
        for key,high in [('elapsed_h',duration),('battery_kwh',config['battery_kwh']),('support_units',config['support_units']),('science_h',duration*crew),('unknown_h',duration),('generated_kwh',duration*4),('curtailed_kwh',duration*4),('essential_shortfall_kwh',duration*crew)]:numeric(run.get(key),0,high+1e-7,key)
        decisions=run.get('decisions');history=run.get('history')
        if not isinstance(decisions,list) or len(decisions)>(512 if expanded else 336) or not isinstance(history,list) or len(history)>4096:raise ValueError('Invalid history/decision count')
        for d in decisions:
            if not isinstance(d,dict) or d.get('action') not in activities(run) or d.get('requested_hours') not in (1,6):raise ValueError('Invalid decision')
            numeric(d.get('start_h'),0,duration,'decision start')
        for h in history:
            if not isinstance(h,dict):raise ValueError('Invalid history row')
            for key in ('start_h','end_h'):numeric(h.get(key),0,duration+1e-7,'history time')
            for key in ('pv_kw','essential_kw','science_kw','charge_input_kw','discharge_output_kw'):numeric(h.get(key),0,4,'history power')
            for key in ('battery_kwh','support_units','science_h'):numeric(h.get(key),0,max(1000,duration*crew)+1e-7,'history resource')
            if expanded:
                for key,high in [('food_days',config['food_days']),('exposure_points',3),('repair_h',2),('repair_kw',0.2)]:numeric(h.get(key),0,high+1e-7,key)
        if expanded:
            for key,high in [('food_days',config['food_days']),('exposure_points',3),('repair_h',2)]:numeric(run.get(key),0,high+1e-7,key)
            for key in ('fault_active','protection_active'):
                if type(run.get(key)) is not bool:raise ValueError('Invalid event state')
            pending=run.get('pending_events');schedule=run.get('event_schedule');events=run.get('events')
            if not isinstance(pending,list) or len(pending)>4 or any(p not in ('recycler-fault:started','recycler-fault:repaired','protection-event:started','protection-event:ended') for p in pending):raise ValueError('Invalid pending events')
            if not isinstance(schedule,list) or len(schedule)!=2 or not isinstance(events,list) or len(events)>32:raise ValueError('Invalid event schedule/log')
            for event in schedule:
                if not isinstance(event,dict) or event.get('id') not in ('recycler-fault','protection-event'):raise ValueError('Invalid event identity')
                numeric(event.get('start_h'),0,duration,'event start')
                if event.get('end_h') is not None:numeric(event['end_h'],event['start_h'],duration,'event end')
            for event in events:
                if not isinstance(event,dict) or not isinstance(event.get('id'),str) or len(event['id'])>100 or not isinstance(event.get('type'),str) or len(event['type'])>40 or not isinstance(event.get('message'),str) or len(event['message'])>1000:raise ValueError('Invalid event log')
                numeric(event.get('hour'),0,duration,'event time')
    previous=session['previous_attempt']
    if previous is not None and (previous['rules']['version']!=session['run']['rules']['version'] or previous['source']['cache_key']!=session['run']['source']['cache_key']):raise ValueError('Prior attempt must keep the same rules and source calculation')
    encoded=json.dumps(session,allow_nan=False).encode()
    if len(encoded)>MAX_BYTES:raise ValueError('Outpost snapshot is too large')
    return json.loads(encoded)


class OutpostStore:
    def __init__(self,root):
        self.folder=Path(root)/'outpost-saves';self.lock=threading.RLock()

    def path(self,save_id):
        if not isinstance(save_id,str) or not re.fullmatch('[a-f0-9]{32}',save_id):raise ValueError('Invalid mission ID')
        path=self.folder/(save_id+'.json')
        if self.folder.is_symlink() or path.is_symlink() or path.resolve().parent!=self.folder.resolve():raise ValueError('Invalid mission storage path')
        return path

    def get(self,save_id):
        with self.lock:
            path=self.path(save_id)
            if path.stat().st_size>MAX_BYTES+8192:raise ValueError('Saved mission is too large')
            record=json.loads(path.read_text())
            if not isinstance(record,dict):raise ValueError('Invalid saved mission')
            expected=record.pop('sha256',None)
            if digest(record)!=expected:raise ValueError('Saved mission checksum differs; preserve and report')
            if record.get('schema_version')!=1 or record.get('id')!=save_id:raise ValueError('Saved mission identity differs')
            if not isinstance(record.get('revision'),int) or record['revision']<1:raise ValueError('Invalid saved revision')
            self.name(record.get('name'));validate_session(record.get('session'))
            if record.get('next_activity') not in activities(record['session']['run']):raise ValueError('Invalid saved activity')
            for key in ('created_utc','updated_utc'):
                if not isinstance(record.get(key),str) or len(record[key])>100:raise ValueError('Invalid save timestamp')
            return dict(record,sha256=expected)

    @staticmethod
    def name(value):
        if not isinstance(value,str) or not 1<=len(value.strip())<=80 or not value.isprintable():raise ValueError('Mission name must contain 1–80 printable characters')
        return value.strip()

    def list(self):
        with self.lock:
            items=[];unavailable=0
            if self.folder.is_symlink():raise ValueError('Invalid mission storage path')
            for path in self.folder.glob('*.json'):
                try:
                    r=self.get(path.stem);run=r['session']['run']
                    items.append({k:r[k] for k in ('id','name','revision','updated_utc')}|dict(status=run['status'],elapsed_h=run['elapsed_h'],site_id=run['source']['request']['site_id'],rules_version=run['rules']['version']))
                except (OSError,ValueError,KeyError,TypeError):unavailable+=1
            return dict(items=sorted(items,key=lambda r:r['updated_utc'],reverse=True),unavailable=unavailable)

    def save(self,data):
        if not isinstance(data,dict) or set(data)!={'name','session','next_activity','id','revision'}:raise ValueError('Provide name, snapshot, activity, ID and revision')
        name=self.name(data['name']);session=validate_session(data['session'])
        if data['next_activity'] not in activities(session['run']):raise ValueError('Choose a valid activity')
        with self.lock:
            now=datetime.now(timezone.utc).isoformat();save_id=data['id']
            if save_id is None:
                if data['revision'] is not None:raise ValueError('New missions have no prior revision')
                save_id=uuid4().hex;revision=1;created=now
            else:
                old=self.get(save_id)
                if isinstance(data['revision'],bool) or data['revision']!=old['revision']:raise SaveConflict('A newer revision exists. Reopen it or Save a copy; nothing was overwritten.')
                revision=old['revision']+1;created=old['created_utc']
            record=dict(schema_version=1,id=save_id,revision=revision,name=name,created_utc=created,updated_utc=now,session=session,next_activity=data['next_activity'])
            record['sha256']=digest(record)
            if len(json.dumps(record,indent=2,allow_nan=False).encode())>MAX_BYTES:raise ValueError('Saved mission exceeds the storage size limit')
            write_json(self.path(save_id),record)
            return record

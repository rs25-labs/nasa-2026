"""Local Lunar Mission Lab planner. Run: python -m lunar_lab.planner_server."""
import argparse
import csv
from datetime import datetime,timedelta,timezone
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
import math
from pathlib import Path
import re
from urllib.parse import urlsplit
from .planner_jobs import Jobs
from .result_store import load_result

REPO=Path(__file__).resolve().parents[5]
EXPORTS={'environment-timeseries.csv','environment-intervals.csv','environment-summaries.csv','environment-report.json'}


def validate_request(data):
    keys={'site_id','latitude_deg','longitude_deg','observer_height_m','start','days'}
    if not isinstance(data,dict) or set(data)!=keys:raise ValueError('Provide site, latitude, longitude, observer height, UTC start and days only.')
    if not isinstance(data['site_id'],str) or not re.fullmatch('[A-Za-z0-9_-]{1,48}',data['site_id']):
        raise ValueError('Site name must have 1–48 letters, numbers, underscores or hyphens.')
    result=dict(data)
    for key,low,high in [('latitude_deg',-90,-85),('longitude_deg',-180,180),('observer_height_m',0,20),('days',1,30)]:
        if isinstance(data[key],bool):raise ValueError(f'{key} must be a number.')
        try:value=float(data[key])
        except (ValueError,TypeError):raise ValueError(f'{key} must be a number.') from None
        if not math.isfinite(value) or not low<=value<=high:raise ValueError(f'{key} must be between {low} and {high}.')
        result[key]=value
    if not result['days'].is_integer():raise ValueError('Duration must be a whole number of days.')
    result['days']=int(result['days'])
    if not isinstance(data['start'],str):raise ValueError('Start must be a UTC timestamp.')
    try:start=datetime.fromisoformat(data['start'].replace('Z','+00:00'))
    except ValueError:raise ValueError('Start must be a valid UTC timestamp.') from None
    if start.tzinfo is None:raise ValueError('Start must include a timezone.')
    start=start.astimezone(timezone.utc)
    dates=json.loads((REPO/'data/manifests/clps/foundation-sources.json').read_text())['dates']
    lower=datetime.fromisoformat(dates['start_inclusive'].replace('Z','+00:00'))
    upper=datetime.fromisoformat(dates['end_exclusive'].replace('Z','+00:00'))
    if not lower<=start<upper or start+timedelta(days=result['days'])>upper:raise ValueError('The full interval must fit within 2026–2028.')
    result['start']=start.isoformat()
    return result


class Handler(BaseHTTPRequestHandler):
    def send(self,status,data,kind='application/json; charset=utf-8',filename=None):
        payload=json.dumps(data,allow_nan=False).encode() if kind.startswith('application/json') and not isinstance(data,bytes) else data
        self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(payload)))
        self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
        if filename:self.send_header('Content-Disposition',f'attachment; filename="{filename}"')
        self.end_headers();self.wfile.write(payload)

    def do_GET(self):
        try:
            parts=urlsplit(self.path).path.strip('/').split('/')
            if parts==['api','jobs']:return self.send(200,self.server.jobs.list())
            if len(parts)==3 and parts[:2]==['api','jobs']:return self.send(200,self.server.jobs.get(parts[2]))
            if parts==['api','saved']:
                path=self.server.root/'results-index.json'
                try:index=json.loads(path.read_text())['results']
                except (OSError,ValueError,KeyError,TypeError):index={}
                if not isinstance(index,dict):index={}
                saved=[]
                for key,run in index.items():
                    if not re.fullmatch('[a-f0-9]{64}',key) or not isinstance(run,str) or not re.fullmatch('[A-Za-z0-9_-]+',run):continue
                    folder=self.server.root/'env-runs'/run
                    if folder.resolve().parent!=(self.server.root/'env-runs').resolve() or (folder/'SUPERSEDED.txt').exists():continue
                    report_path=folder/'environment-report.json'
                    if report_path.resolve().parent!=folder.resolve():continue
                    try:
                        report=json.loads(report_path.read_text())
                        if report.get('status')!='complete':continue
                        saved.append(dict(cache_key=key,run_id=run,request=report.get('request',{})))
                    except (OSError,ValueError,AttributeError):continue
                return self.send(200,sorted(saved,key=lambda r:r['run_id'],reverse=True)[:20])
            if len(parts) in (3,4) and parts[:2]==['api','results']:
                saved=load_result(self.server.root,parts[2])
                if saved is None:return self.send(404,dict(error='Saved result is missing, incomplete or changed. Calculate again.'))
                run=Path(saved['artifacts_directory'])
                if len(parts)==4:
                    if parts[3] not in EXPORTS:return self.send(404,dict(error='Unknown export.'))
                    kind='application/json' if parts[3].endswith('.json') else 'text/csv; charset=utf-8'
                    return self.send(200,(run/parts[3]).read_bytes(),kind,parts[3])
                report=json.loads((run/'environment-report.json').read_text())
                def table(name):
                    with (run/name).open(newline='') as stream:return list(csv.DictReader(stream))
                return self.send(200,dict(cache_key=parts[2],run_id=saved['run_id'],request=report['request'],
                    summaries=saved['summaries'],samples=table('environment-timeseries.csv'),
                    intervals=table('environment-intervals.csv'),created_utc=report['created_utc'],
                    calculation_seconds=report.get('elapsed_wall_seconds')))
            static={'':'index.html','index.html':'index.html','app.js':'app.js','style.css':'style.css'}
            name=static.get('/'.join(parts))
            if name:
                kind={'html':'text/html; charset=utf-8','js':'text/javascript; charset=utf-8','css':'text/css; charset=utf-8'}[name.rsplit('.',1)[1]]
                return self.send(200,(REPO/'apps/clps/web'/name).read_bytes(),kind)
            self.send(404,dict(error='Not found.'))
        except KeyError:self.send(404,dict(error='Job or result not found.'))
        except (OSError,ValueError,TypeError) as exc:self.send(500,dict(error=str(exc)))

    def do_POST(self):
        try:
            origin=self.headers.get('Origin')
            allowed={f'http://127.0.0.1:{self.server.server_port}',f'http://localhost:{self.server.server_port}'}
            if origin and origin not in allowed:return self.send(403,dict(error='Use the local planner page.'))
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=8192 or self.headers.get('Content-Type','').split(';')[0]!='application/json':
                return self.send(400,dict(error='Send a small JSON request.'))
            data=json.loads(self.rfile.read(length));parts=urlsplit(self.path).path.strip('/').split('/')
            if parts==['api','jobs']:
                request=validate_request(data)
                try:return self.send(202,self.server.jobs.submit(request))
                except ValueError as exc:return self.send(409,dict(error=str(exc)))
            if len(parts)==4 and parts[:2]==['api','jobs'] and parts[3]=='cancel':
                return self.send(200,self.server.jobs.cancel(parts[2]))
            self.send(404,dict(error='Not found.'))
        except KeyError:self.send(404,dict(error='Job not found.'))
        except (ValueError,TypeError) as exc:self.send(422,dict(error=str(exc)))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--work-dir',type=Path,default=REPO/'data/local/lml')
    args=parser.parse_args()
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    server.root=args.work_dir.resolve();server.jobs=Jobs(server.root,REPO)
    print(f'Lunar Mission Lab: http://127.0.0.1:{server.server_port}',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.jobs.close();server.server_close()


if __name__=='__main__':main()

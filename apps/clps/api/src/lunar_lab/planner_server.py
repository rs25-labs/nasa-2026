"""Local Lunar Mission Lab planner. Run: python -m lunar_lab.planner_server."""
import argparse
import csv
from datetime import datetime,timedelta,timezone
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import re
from urllib.parse import urlsplit,parse_qs,unquote
from .planner_jobs import Jobs
from .result_store import load_result
from .terrain_view import TerrainView
from .shadow_mask import shadow_mask,Unavailable as ShadowUnavailable
from .site_atlas import sites_response
from .planning_views import planning_response
from .outpost_store import OutpostStore,SaveConflict,MAX_BYTES
from .hourly_publication import HourlyArchive,enabled as hourly_enabled,utc as hourly_utc,export_result
from .live_estimates import LiveEstimates,validate as validate_estimate,validate_batch as validate_estimates
from .expedition import plan_route,validate as validate_route,NoRoute,SearchLimit,ROUTE_LOCK
from .expedition_environment import waypoint_environment,drive_environment,validate as validate_waypoint,validate_drive,WAYPOINT_LOCK

LOCAL_DEV_ORIGIN=re.compile(r'http://(127\.0\.0\.1|localhost|\[::1\]):\d{1,5}')
REPO=Path(__file__).resolve().parents[5]
DIST=REPO/'apps/clps/studio/dist'
LEGACY=REPO/'apps/clps/web'
LEGACY_NAMES={'index.html','app.js','style.css','shell.js','shell.css','elevation-chart.js','slip.js','terrain3d.js','ground-view.js','expedition.js','expedition-environment.js',
    'vendor/three.module.min.js','vendor/OrbitControls.js','terrain-map.js','sky-timeline.js','moon-entry.js','moon-entry.css','site-explorer.js','site-explorer.css',
    'seasonal-planner.js','seasonal-planner.css','scenario-comparison.js','scenario-comparison.css','outpost-engine.js','outpost.js','outpost.css','outpost-library.js',
    'outpost-expedition.js','expedition-playback.js','local-coordinates.js','notable-sites.js','sharing.js','browser-library.js','advanced-tools.js','expedition-power.js',
    'ground-devices.js','terrain-overlays.js'}
# The old pages name their files with root-relative paths ("/app.js"); under /legacy/ those are rewritten to "/legacy/app.js".
LEGACY_REFERENCE=re.compile(r'(["\'])/('+'|'.join(re.escape(name) for name in sorted(LEGACY_NAMES,key=len,reverse=True))+r')\1')
CONTENT_TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.jpeg':'image/jpeg',
    '.png':'image/png','.webp':'image/webp','.json':'application/json; charset=utf-8','.md':'text/markdown; charset=utf-8','.txt':'text/plain; charset=utf-8','.ico':'image/x-icon',
    '.woff2':'font/woff2','.glb':'model/gltf-binary','.map':'application/json; charset=utf-8'}
CORS_EXPOSED='X-Terrain-Product, X-Terrain-Pixel-Size-M, X-Sun-Azimuth-Deg, X-Sun-Elevation-Deg'
ORIGIN_SHAPE=re.compile(r'https?://[a-z0-9*.-]+(:\d{1,5})?')
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
    def send(self,status,data,kind='application/json; charset=utf-8',filename=None,headers=None):
        payload=json.dumps(data,allow_nan=False).encode() if kind.startswith('application/json') and not isinstance(data,bytes) else data
        self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(payload)))
        extra=self.cors_headers();extra.update(headers or {})
        if 'Cache-Control' not in extra:self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        if filename:self.send_header('Content-Disposition',f'attachment; filename="{filename}"')
        for name,value in extra.items():self.send_header(name,value)
        self.end_headers();self.wfile.write(payload)

    def origin_permitted(self,origin,parts,method):
        """The page's own origin and configured origins always; local dev servers only off public mode, for reads and the batch estimate."""
        server=self.server
        if origin in (f'http://127.0.0.1:{server.server_port}',f'http://localhost:{server.server_port}') or origin in server.allowed_origins:return True
        if any(pattern.fullmatch(origin) for pattern in server.origin_patterns):return True
        # A page served by this server is always allowed, whatever host name or alias it was reached by.
        host=(self.headers.get('X-Forwarded-Host') or self.headers.get('Host') or '').split(',')[0].strip().lower()
        if host and urlsplit(origin).netloc.lower()==host:return True
        return not server.public and LOCAL_DEV_ORIGIN.fullmatch(origin) is not None and (method in ('GET','HEAD') or parts in (['api','estimates'],['api','report.pdf']))

    def cors_headers(self):
        path=urlsplit(self.path).path
        if not path.startswith(('/api/','/media/')):return {}
        headers={'Vary':'Origin'};origin=self.headers.get('Origin')
        method=self.headers.get('Access-Control-Request-Method','GET') if self.command=='OPTIONS' else self.command
        if origin and self.origin_permitted(origin,path.strip('/').split('/'),method):
            headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Expose-Headers']=CORS_EXPOSED
        return headers

    def do_OPTIONS(self):
        parts=urlsplit(self.path).path.strip('/').split('/')
        origin=self.headers.get('Origin');method=self.headers.get('Access-Control-Request-Method')
        if parts[0]!='api':return self.send(404,dict(error='Not found.'))
        headers={'Allow':'GET, POST, OPTIONS','Cache-Control':'no-store'}
        if origin:
            if method not in ('GET','POST') or not self.origin_permitted(origin,parts,method):return self.send(403,dict(error='Origin not allowed.'))
            headers.update(self.cors_headers())
            headers.update({'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400'})
            if self.headers.get('Access-Control-Request-Private-Network')=='true':headers['Access-Control-Allow-Private-Network']='true'
        self.send_response(204);self.send_header('Content-Length','0')
        for name,value in headers.items():self.send_header(name,value)
        self.end_headers()

    def send_file(self,file,cache,legacy_prefix=False):
        data=file.read_bytes();suffix=file.suffix.lower()
        if legacy_prefix and suffix in ('.html','.js'):data=LEGACY_REFERENCE.sub(r'\1/legacy/\2\1',data.decode()).encode()
        self.send(200,data,CONTENT_TYPES.get(suffix,'application/octet-stream'),headers={'Cache-Control':cache})

    def dist_file(self,path):
        """A file inside the built app, or None. Anything resolving outside dist (including through links) is refused."""
        root=DIST.resolve()
        try:candidate=(root/(unquote(path).lstrip('/') or 'index.html')).resolve()
        except (OSError,ValueError):return None
        return candidate if candidate.is_relative_to(root) and candidate.is_file() else None

    def serve_static(self):
        path=urlsplit(self.path).path
        if path=='/legacy':return self.send(301,b'',headers={'Location':'/legacy/'})
        if path.startswith('/legacy/'):
            name=path[8:] or 'index.html'
            if name in LEGACY_NAMES and (LEGACY/name).is_file():return self.send_file(LEGACY/name,'no-store',True)
        elif (DIST/'index.html').is_file():
            file=self.dist_file(path)
            if file:return self.send_file(file,'no-store' if file.name=='index.html' else 'public, max-age=31536000, immutable' if file.parent.name=='assets' else 'public, max-age=3600')
        else:
            name='index.html' if path in ('/','/index.html') else path[1:]
            if name in LEGACY_NAMES and (LEGACY/name).is_file():return self.send_file(LEGACY/name,'no-store')
        self.send(404,dict(error='Not found.'))

    def do_GET(self):
        try:
            parts=urlsplit(self.path).path.strip('/').split('/')
            origin=self.headers.get('Origin')
            if origin and parts[0] in ('api','media') and not self.origin_permitted(origin,parts,'GET'):return self.send(403,dict(error='Origin not allowed.'))
            if parts==['api','notable-sites']:return self.send(200,json.loads((REPO/'data/manifests/clps/notable-sites.json').read_text()))
            if parts==['api','capabilities']:return self.send(200,dict(public=self.server.public,storage='browser',dates=dict(first='1969-01-01',end_exclusive='2036-01-01'),terrain=dict(polar='40 m',global_resolution='16 pixels/degree')))
            if parts==['api','terrain','global-grid']:
                query=parse_qs(urlsplit(self.path).query,keep_blank_values=True)
                try:
                    if set(query)!={'latitude','longitude','span','size'} or any(len(v)!=1 for v in query.values()):raise ValueError('Provide latitude, longitude, span and size once.')
                    grid=self.server.live.global_view.grid(float(query['latitude'][0]),float(query['longitude'][0]),float(query['span'][0]),int(query['size'][0]))
                    return self.send(200,grid,'application/octet-stream')
                except (ValueError,TypeError) as exc:return self.send(422,dict(error=str(exc)))
                except (OSError,KeyError) as exc:return self.send(503,dict(error=f'Global terrain unavailable: {exc}'))
            if self.server.public and parts[:2] in (['api','outposts'],['api','jobs']):return self.send(403,dict(error='Server-side private libraries and legacy jobs are disabled on this public instance.'))
            if parts[:2]==['api','outposts']:
                try:
                    if len(parts)==2:return self.send(200,self.server.outposts.list())
                    if len(parts) not in (3,4):return self.send(404,dict(error='Unknown mission route'))
                    record=self.server.outposts.get(parts[2])
                    if len(parts)==3:return self.send(200,record)
                    query=parse_qs(urlsplit(self.path).query,keep_blank_values=True)
                    if query and (set(query)!={'revision'} or len(query['revision'])!=1 or query['revision'][0]!=str(record['revision'])):
                        return self.send(409,dict(error='Saved revision changed. Refresh the library before downloading.'))
                    if parts[3]=='snapshot.json':return self.send(200,record,'application/json; charset=utf-8',f'outpost-{record["id"]}.json')
                    if parts[3]=='report.pdf':
                        from .outpost_pdf import report_pdf
                        return self.send(200,report_pdf(record),'application/pdf',f'outpost-{record["id"]}-r{record["revision"]}.pdf')
                    return self.send(404,dict(error='Unknown mission export'))
                except FileNotFoundError:return self.send(404,dict(error='Saved mission not found. Current session is unchanged.'))
                except (ValueError,KeyError,TypeError):return self.send(409,dict(error='Saved mission is invalid or uses unsupported rules. Preserve the file for review.'))
                except (OSError,ImportError,RuntimeError):return self.send(503,dict(error='Mission storage or PDF output is unavailable. Current session is unchanged.'))
            if parts==['api','site-planning']:
                query=parse_qs(urlsplit(self.path).query,keep_blank_values=True)
                if 'site' not in query or set(query)-{'site','year'} or any(len(v)!=1 for v in query.values()):return self.send(422,dict(error='Provide one catalog site and year'))
                year=query.get('year',['2026'])[0]
                if year not in ('2026','2027','2028'):return self.send(422,dict(error='Choose 2026, 2027 or 2028'))
                try:return self.send(200,planning_response(self.server.root,REPO,query['site'][0],int(year)))
                except ValueError as exc:return self.send(422,dict(error=str(exc)))
            if parts==['api','hourly-mission']:
                query=parse_qs(urlsplit(self.path).query,keep_blank_values=True)
                if set(query)!={'site','start','days'} or any(len(v)!=1 for v in query.values()):return self.send(422,dict(error='Choose site, start and duration'))
                try:
                    days=int(query['days'][0]);archive=HourlyArchive(self.server.root,REPO)
                    key=archive.mission_key(query['site'][0],hourly_utc(query['start'][0]),days)
                    return self.send(200,archive.result(key))
                except (ValueError,KeyError,TypeError) as exc:return self.send(422,dict(error=str(exc)))
                except OSError:return self.send(503,dict(error='Hourly coverage is unavailable. Your current mission is unchanged.'))
            if parts==['api','slip']:
                query=parse_qs(urlsplit(self.path).query,keep_blank_values=True)
                if set(query)!={'start','days','span'} or any(len(v)!=1 for v in query.values()):return self.send(422,dict(error='Provide start, days and span.'))
                try:return self.send(200,HourlyArchive(self.server.root,REPO).slip(hourly_utc(query['start'][0]),int(query['days'][0]),int(query['span'][0])))
                except (ValueError,KeyError,TypeError) as exc:return self.send(422,dict(error=str(exc)))
                except OSError:return self.send(503,dict(error='Hourly coverage is unavailable.'))
            if parts==['api','estimate']:
                query=parse_qs(urlsplit(self.path).query,keep_blank_values=True)
                if set(query)-{'site','latitude','longitude','height','start','days'} or any(len(v)!=1 for v in query.values()):
                    return self.send(422,dict(error='Provide site, latitude, longitude, height, start and days.'))
                try:return self.send(200,self.server.live.open(validate_estimate({key:values[0] for key,values in query.items()})))
                except (ValueError,KeyError,TypeError) as exc:return self.send(422,dict(error=str(exc)))
                except OSError as exc:return self.send(503,dict(error=f'Terrain or ephemeris files are unavailable: {exc}'))
                # SPICE raises its own error types; report them as a failed estimate.
                except Exception as exc:return self.send(500,dict(error=f'Estimate failed: {exc}'))
            if parts==['api','expedition','waypoint']:
                query=parse_qs(urlsplit(self.path).query,keep_blank_values=True)
                try:
                    if any(len(v)!=1 for v in query.values()):raise ValueError('Provide each waypoint parameter once.')
                    request=validate_waypoint({key:values[0] for key,values in query.items()})
                    if not WAYPOINT_LOCK.acquire(blocking=False):return self.send(409,dict(error='Another waypoint is being calculated. Retry shortly.'))
                    try:result=waypoint_environment(self.server.live,request)
                    finally:WAYPOINT_LOCK.release()
                    return self.send(200,result)
                except (ValueError,TypeError) as exc:return self.send(422,dict(error=str(exc)))
                except (OSError,KeyError) as exc:return self.send(503,dict(error=f'Terrain or ephemeris data unavailable: {exc}'))
                except Exception as exc:return self.send(500,dict(error=f'Waypoint estimate failed: {exc}'))
            if parts==['api','expedition','route']:
                query=parse_qs(urlsplit(self.path).query,keep_blank_values=True)
                try:
                    if any(len(v)!=1 for v in query.values()):raise ValueError('Provide each route parameter once.')
                    request=validate_route({key:values[0] for key,values in query.items()})
                    if not ROUTE_LOCK.acquire(blocking=False):return self.send(409,dict(error='Another route is being calculated. Retry shortly.'))
                    try:route=plan_route(self.server.terrain,request,self.server.live)
                    finally:ROUTE_LOCK.release()
                    return self.send(200,route)
                except SearchLimit as exc:return self.send(422,dict(error=str(exc),code='search_limit'))
                except NoRoute as exc:return self.send(422,dict(error=str(exc),code='no_route_in_window'))
                except (ValueError,TypeError) as exc:return self.send(422,dict(error=str(exc)))
                except (OSError,KeyError) as exc:return self.send(503,dict(error=f'Cached terrain unavailable: {exc}'))
            if parts==['api','expedition','drive']:
                query=parse_qs(urlsplit(self.path).query,keep_blank_values=True)
                try:
                    if any(len(v)!=1 for v in query.values()):raise ValueError('Provide each route parameter once.')
                    request,samples=validate_drive({key:values[0] for key,values in query.items()})
                    if not ROUTE_LOCK.acquire(blocking=False):return self.send(409,dict(error='Another route is being calculated. Retry shortly.'))
                    try:
                        if not WAYPOINT_LOCK.acquire(blocking=False):return self.send(409,dict(error='Another waypoint is being calculated. Retry shortly.'))
                        try:
                            route=plan_route(self.server.terrain,request,self.server.live)
                            route.update(drive_environment(self.server.live,route,samples))
                        finally:WAYPOINT_LOCK.release()
                    finally:ROUTE_LOCK.release()
                    return self.send(200,route)
                except SearchLimit as exc:return self.send(422,dict(error=str(exc),code='search_limit'))
                except NoRoute as exc:return self.send(422,dict(error=str(exc),code='no_route_in_window'))
                except (ValueError,TypeError) as exc:return self.send(422,dict(error=str(exc)))
                except (OSError,KeyError) as exc:return self.send(503,dict(error=f'Terrain or ephemeris data unavailable: {exc}'))
                except Exception as exc:return self.send(500,dict(error=f'Drive estimate failed: {exc}'))
            if parts==['api','sites']:return self.send(200,sites_response(self.server.root,REPO))
            if parts==['media','moon-color.jpg']:
                image=self.server.root/'ui-assets/moon-color.jpg'
                if not image.is_file():return self.send(404,dict(error='Moon illustration is not cached. Terrain planning remains available.'))
                return self.send(200,image.read_bytes(),'image/jpeg')
            if parts==['api','terrain','tile']:
                query=parse_qs(urlsplit(self.path).query,keep_blank_values=True)
                try:
                    if set(query)!={'x','y','span','size'} or any(len(v)!=1 for v in query.values()):raise ValueError('Provide x, y, span and size once.')
                    heights,product,pixel=self.server.terrain.tile(float(query['x'][0]),float(query['y'][0]),float(query['span'][0]),int(query['size'][0]))
                    return self.send(200,heights,'application/octet-stream',headers={'X-Terrain-Product':product,'X-Terrain-Pixel-Size-M':f'{pixel:g}'})
                except (ValueError,TypeError) as exc:return self.send(422,dict(error=str(exc)))
                except (OSError,KeyError) as exc:return self.send(503,dict(error=f'Cached terrain unavailable: {exc}'))
            if parts==['api','terrain','shadow']:
                query=parse_qs(urlsplit(self.path).query,keep_blank_values=True)
                try:
                    if set(query)!={'x','y','span','size','utc'} or any(len(v)!=1 for v in query.values()):raise ValueError('Provide x, y, span, size and utc once each.')
                    mask,sun=shadow_mask(self.server.terrain,self.server.live,{key:values[0] for key,values in query.items()})
                    return self.send(200,mask,'application/octet-stream',headers={'X-Sun-Azimuth-Deg':f'{sun["azimuth"]:.3f}','X-Sun-Elevation-Deg':f'{sun["elevation"]:.3f}','X-Terrain-Product':sun['product']})
                except (ValueError,TypeError) as exc:return self.send(422,dict(error=str(exc)))
                except (ShadowUnavailable,OSError,KeyError) as exc:return self.send(503,dict(error=f'Terrain or ephemeris data unavailable: {exc}'))
            if parts==['api','terrain','products']:
                try:return self.send(200,self.server.terrain.product_list())
                except (ValueError,TypeError) as exc:return self.send(422,dict(error=str(exc)))
                except (OSError,KeyError) as exc:return self.send(503,dict(error=f'Cached terrain unavailable: {exc}'))
            if parts==['api','terrain','grid']:
                query=parse_qs(urlsplit(self.path).query,keep_blank_values=True)
                try:
                    if set(query)!={'x','y','span','size'} or any(len(v)!=1 for v in query.values()):raise ValueError('Invalid terrain grid query.')
                    heights=self.server.terrain.grid(float(query['x'][0]),float(query['y'][0]),float(query['span'][0]),int(query['size'][0]))
                    return self.send(200,heights,'application/octet-stream')
                except (ValueError,TypeError) as exc:return self.send(422,dict(error=str(exc)))
                except (OSError,KeyError) as exc:return self.send(503,dict(error=f'Cached terrain unavailable: {exc}'))
            if parts in (['api','terrain'],['api','terrain','site']):
                query=parse_qs(urlsplit(self.path).query,keep_blank_values=True)
                expected={'latitude','longitude'} if len(parts)==3 else {'x','y','span'}
                try:
                    if set(query)!=expected or any(len(v)!=1 for v in query.values()):raise ValueError('Invalid terrain query.')
                    numbers={key:float(values[0]) for key,values in query.items()}
                    data=self.server.terrain.site(numbers['latitude'],numbers['longitude']) if len(parts)==3 else self.server.terrain.viewport(numbers['x'],numbers['y'],numbers['span'])
                    return self.send(200,data)
                except (ValueError,TypeError) as exc:return self.send(422,dict(error=str(exc)))
                except (OSError,KeyError) as exc:return self.send(503,dict(error=f'Cached terrain unavailable: {exc}'))
            if parts==['api','jobs']:return self.send(200,self.server.jobs.list())
            if len(parts)==3 and parts[:2]==['api','jobs']:return self.send(200,self.server.jobs.get(parts[2]))
            if parts==['api','saved']:
                if self.server.public:return self.send(200,[])
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
                hourly=None
                if hourly_enabled(REPO):
                    try:
                        config=json.loads((REPO/'data/manifests/clps/hourly-ui.json').read_text())
                        prefix=config['identity'][:54]
                    except (OSError,ValueError,KeyError,TypeError):prefix=None
                    if parts[2][:54]==prefix:
                        try:hourly=HourlyArchive(self.server.root,REPO).result(parts[2])
                        except (OSError,ValueError,KeyError,TypeError):return self.send(503,dict(error='Hourly mission could not be loaded. Refresh to retry.'))
                if hourly is None:
                    try:live_request=self.server.live.request_for(parts[2])
                    except (OSError,ValueError,KeyError,TypeError):live_request=None
                    if live_request is not None:
                        # Rebuilt from the stored request; any failure is reported, not raised.
                        try:hourly=self.server.live.result(live_request,parts[2])
                        except Exception:return self.send(503,dict(error='On-demand estimate could not be rebuilt. Open the mission again.'))
                if hourly is not None:
                    if len(parts)==3:return self.send(200,hourly)
                    if parts[3] not in EXPORTS:return self.send(404,dict(error='Unknown export.'))
                    payload,kind=export_result(hourly,parts[3]);return self.send(200,payload,kind,parts[3])
                if self.server.public:return self.send(404,dict(error='Private legacy results are not exposed by this public instance. Share mission inputs instead.'))
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
                    horizon=table('horizon-profile.csv'),
                    calculation_seconds=report.get('elapsed_wall_seconds')))
            return self.serve_static()
        except KeyError:self.send(404,dict(error='Job or result not found.'))
        except (OSError,ValueError,TypeError) as exc:self.send(500,dict(error=str(exc)))

    def do_POST(self):
        try:
            origin=self.headers.get('Origin')
            parts=urlsplit(self.path).path.strip('/').split('/')
            # The read-only batch estimate may come from a dev server (e.g. Vite) on any local port.
            if origin and not self.origin_permitted(origin,parts,'POST'):return self.send(403,dict(error='Use the local planner page.'))
            length=int(self.headers.get('Content-Length','0'));limit=MAX_BYTES if parts in (['api','outposts'],['api','outposts','report.pdf']) else 8192
            if not 0<length<=limit or self.headers.get('Content-Type','').split(';')[0]!='application/json':
                return self.send(400,dict(error='Send a bounded JSON request.'))
            data=json.loads(self.rfile.read(length))
            if parts==['api','outposts','report.pdf']:
                from .outpost_store import validate_session
                from .outpost_pdf import report_pdf
                validate_session(data.get('session'))
                if not isinstance(data.get('name'),str) or not 1<=len(data['name'])<=80:raise ValueError('Provide a mission name.')
                record=dict(data,id='browser-export',revision=1,created_utc=data.get('updated_utc',datetime.now(timezone.utc).isoformat()),updated_utc=data.get('updated_utc',datetime.now(timezone.utc).isoformat()))
                return self.send(200,report_pdf(record),'application/pdf','lunar-outpost.pdf')
            if parts==['api','report.pdf']:
                # Mission planning report: the plan in, every number recalculated here, a PDF out.
                from .mission_report import report_pdf as mission_pdf,validate_report
                requests,names,power,crew,include=validate_report(data)
                try:
                    batch=self.server.live.estimates(requests)
                    return self.send(200,mission_pdf(batch,names,power,requests[0]['observer_height_m'],crew,include),'application/pdf','lunar-mission-report.pdf')
                except OSError as exc:return self.send(503,dict(error=f'Terrain or ephemeris files are unavailable: {exc}'))
                except ImportError:return self.send(503,dict(error='PDF output is unavailable on this server.'))
            if parts==['api','estimates']:
                requests=validate_estimates(data)
                try:return self.send(200,self.server.live.estimates(requests))
                except OSError as exc:return self.send(503,dict(error=f'Terrain or ephemeris files are unavailable: {exc}'))
                except Exception as exc:return self.send(500,dict(error=f'Estimate failed: {exc}'))
            if self.server.public:return self.send(403,dict(error='Writes to shared server libraries and legacy jobs are disabled. Use browser-local saves.'))
            if parts==['api','outposts']:
                try:return self.send(200,self.server.outposts.save(data))
                except SaveConflict as exc:return self.send(409,dict(error=str(exc)))
                except FileNotFoundError:return self.send(404,dict(error='Saved mission no longer exists. Save a copy to preserve this session.'))
                except OSError:return self.send(503,dict(error='Could not save mission. Your current session remains in the browser; retry or export JSON.'))
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
    parser.add_argument('--port',type=int,default=int(os.environ.get('PORT','8765')))
    parser.add_argument('--host',default='127.0.0.1')
    parser.add_argument('--public',action='store_true',help='Disable shared private libraries and legacy job writes.')
    parser.add_argument('--allowed-origin',action='append',default=[os.environ.get('LML_PUBLIC_ORIGIN','')],help='Page origin allowed to call the API, e.g. https://lml.example.org. Repeat or comma-separate; one "*" inside the host matches a single label part (https://lml-*-team.vercel.app). LML_PUBLIC_ORIGIN is read the same way.')
    parser.add_argument('--work-dir',type=Path,default=REPO/'data/local/lml')
    args=parser.parse_args()
    server=ThreadingHTTPServer((args.host,args.port),Handler)
    server.public=args.public;server.allowed_origins=[];server.origin_patterns=[]
    for entry in (item.strip().rstrip('/').lower() for value in args.allowed_origin for item in value.split(',')):
        if not entry:continue
        if not ORIGIN_SHAPE.fullmatch(entry) or entry.count('*')>1 or re.match(r'https?://\*[.:]|https?://\*$',entry):
            parser.error(f'Allowed origin {entry!r} must look like https://host[:port]; one "*" may stand for part of a host label, never the whole host.')
        if '*' in entry:server.origin_patterns.append(re.compile(re.escape(entry).replace(r'\*','[a-z0-9-]+')))
        else:server.allowed_origins.append(entry)
    server.root=args.work_dir.resolve();server.jobs=Jobs(server.root,REPO)
    server.outposts=OutpostStore(server.root)
    server.terrain=TerrainView(server.root,REPO/'data/manifests/clps/foundation-sources.json')
    server.live=LiveEstimates(server.root,REPO,server.terrain)
    print(f'Lunar Mission Lab: http://127.0.0.1:{server.server_port}',flush=True)
    if not (DIST/'index.html').is_file():print('The app is not built (apps/clps/studio/dist missing). Run pnpm install and pnpm build in apps/clps/studio.',flush=True)
    if server.allowed_origins or server.origin_patterns:print('Allowed page origins: '+', '.join(server.allowed_origins+[p.pattern for p in server.origin_patterns]),flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.jobs.close();server.server_close()


if __name__=='__main__':main()

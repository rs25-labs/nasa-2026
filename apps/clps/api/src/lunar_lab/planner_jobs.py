"""One local background calculation, with small durable job receipts."""
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time
from uuid import uuid4
from .assets import write_json

ACTIVE={'queued','running','cancelling'}


class Jobs:
    def __init__(self,root,repo):
        self.root=Path(root).resolve();self.repo=Path(repo).resolve()
        self.folder=self.root/'planner-jobs';self.folder.mkdir(parents=True,exist_ok=True)
        self.lock=threading.RLock();self.records={};self.process=None;self.active=None
        for path in sorted(self.folder.glob('*.json'),key=lambda p:p.stat().st_mtime,reverse=True)[:20]:
            try:
                record=json.loads(path.read_text());job_id=record['id']
                if not re.fullmatch('[a-f0-9]{32}',job_id):continue
                if record['state'] in ACTIVE:
                    record.update(state='interrupted',finished_at=time.time(),error='Previous app session ended. Retry after any old calculation has stopped.')
                    write_json(path,record)
                self.records[job_id]=record
            except (OSError,ValueError,KeyError,TypeError):continue

    def _save(self,record):write_json(self.folder/(record['id']+'.json'),record)

    def list(self):
        with self.lock:
            return [self.get(r['id']) for r in sorted(self.records.values(),key=lambda r:r['created_at'],reverse=True)[:20]]

    def get(self,job_id):
        with self.lock:
            record=dict(self.records[job_id])
            start=record.get('started_at',record['created_at'])
            record['elapsed_seconds']=max(0,record.get('finished_at',time.time())-start)
            return record

    def submit(self,request):
        with self.lock:
            if self.active is not None:raise ValueError('A calculation is already running. Wait or cancel it first.')
            job_id=uuid4().hex
            record=dict(id=job_id,state='queued',request=request,created_at=time.time())
            self.records[job_id]=record;self.active=job_id;self._save(record)
            threading.Thread(target=self._run,args=(job_id,),daemon=True).start()
            return self.get(job_id)

    def cancel(self,job_id):
        with self.lock:
            record=self.records[job_id]
            if record['state'] in ACTIVE and record['state']!='cancelling':
                if self.process is not None and self.process.poll() is not None:
                    # The child already finished; let _run publish its outcome
                    # rather than acknowledge a cancellation we cannot perform.
                    return self.get(job_id)
                record['state']='cancelling';self._save(record)
                if self.process is not None and self.process.poll() is None:
                    # planner_worker explicitly turns SIGTERM into an unwind.
                    # Do not force-kill or remove a live calculation's locks.
                    try:self.process.send_signal(signal.SIGTERM)
                    except ProcessLookupError:
                        record['state']='running';self._save(record)
                elif self.process is not None:
                    record['state']='running';self._save(record)
            return self.get(job_id)

    def _run(self,job_id):
        with self.lock:
            record=self.records[job_id]
            if record['state']=='cancelling':
                record.update(state='cancelled',finished_at=time.time());self.active=None;self._save(record);return
            request=record['request'];record.update(state='running',started_at=time.time());self._save(record)
        command=[sys.executable,'-m','lunar_lab.planner_worker','--work-dir',str(self.root),
                 '--sources',str(self.repo/'data/manifests/clps/foundation-sources.json'),
                 '--global-sources',str(self.repo/'data/manifests/clps/composite-global-sources.json'),'--offline']
        for key,value in request.items():command.extend(['--'+key.replace('_','-'),str(value)])
        env=dict(os.environ);env['PYTHONPATH']=str(self.repo/'apps/clps/api/src')+os.pathsep+env.get('PYTHONPATH','')
        log_path=self.folder/(job_id+'.log')
        try:
            with log_path.open('w') as log:
                with self.lock:
                    if record['state']=='cancelling':
                        record.update(state='cancelled',finished_at=time.time());self._save(record);return
                    self.process=subprocess.Popen(command,cwd=self.repo,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
                code=self.process.wait()
            with log_path.open('rb') as log:
                log.seek(0,2);size=log.tell();log.seek(max(0,size-65536));output=log.read().decode('utf-8',errors='replace')
            response=None
            for match in re.finditer(r'(?m)^\{',output):
                try:
                    value,_=json.JSONDecoder().raw_decode(output[match.start():])
                    if value.get('status')=='complete' and value.get('cache_key'):response=value
                except (ValueError,AttributeError):continue
            with self.lock:
                if code==0 and response:
                    if record['state']=='cancelling':
                        record['notice']='Calculation completed before cancellation took effect.'
                    record.update(state='complete',cache_key=response['cache_key'],cache_hit=response.get('cache_hit',False))
                elif record['state']=='cancelling':record['state']='cancelled'
                else:record.update(state='failed',error=output[-6000:] or f'Calculation exited {code}; no saved result returned.')
        except Exception as exc:
            with self.lock:record.update(state='failed',error=str(exc))
        finally:
            with self.lock:
                record['finished_at']=time.time();self._save(record);self.process=None;self.active=None

    def close(self):
        with self.lock:
            if self.active is not None:self.cancel(self.active)

"""Pi regression: launch from a thread after map use, then cancel cleanly."""
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import signal
import sys
from tempfile import TemporaryDirectory
import time
from unittest.mock import patch
from lunar_lab.planner_jobs import spawn_worker
from lunar_lab.terrain_view import TerrainView

CHILD='''
from lunar_lab.planner_worker import initialize_worker
from pathlib import Path
import os,sys,time
initialize_worker()
assert Path.cwd()==Path(sys.argv[1])
assert os.getsid(0)==os.getpid()
folder=Path(sys.argv[2])
try:
    (folder/'lock').write_text('held')
    (folder/'ready').write_text('ready')
    while True:time.sleep(.02)
except KeyboardInterrupt:
    raise SystemExit(130)
finally:
    (folder/'lock').unlink(missing_ok=True)
'''


def check():
    repo=Path(__file__).resolve().parents[3]
    view=TerrainView(repo/'data/local/lml',repo/'data/manifests/clps/foundation-sources.json')
    with ThreadPoolExecutor(max_workers=1) as pool:
        pool.submit(view.site,-89.55,.1).result(timeout=60)
        with TemporaryDirectory() as temp:
            folder=Path(temp)
            env=dict(os.environ)
            env['PYTHONPATH']=str(repo/'apps/clps/api/src')
            with (folder/'worker.log').open('w') as log:
                with patch('os.posix_spawn',wraps=os.posix_spawn) as native_spawn:
                    child=pool.submit(spawn_worker,[sys.executable,'-u','-c',CHILD,str(repo),temp],repo,env,log).result(timeout=10)
                try:
                    if sys.platform=='darwin':assert native_spawn.call_count==1,'macOS must use posix_spawn, without fork hooks'
                    deadline=time.monotonic()+10
                    while not (folder/'ready').exists():
                        assert child.poll() is None,(folder/'worker.log').read_text()
                        assert time.monotonic()<deadline,'worker startup timed out'
                        time.sleep(.02)
                    child.send_signal(signal.SIGTERM)
                    assert child.wait(timeout=10)==130
                    assert not (folder/'lock').exists(),'cancellation must release held lock'
                finally:
                    if child.poll() is None:child.kill();child.wait()
    print('PASS: worker launches after map use from background thread; session/cwd and cancellation cleanup preserved')


if __name__=='__main__':check()

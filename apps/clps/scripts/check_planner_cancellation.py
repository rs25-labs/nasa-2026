"""Pi check: inherited ignored SIGINT must not prevent graceful lock cleanup."""
from pathlib import Path
import os
import signal
import subprocess
import sys
from tempfile import TemporaryDirectory
import time

CHILD='''
from lunar_lab.planner_worker import install_cancellation_handlers
from pathlib import Path
import sys,time
install_cancellation_handlers()
folder=Path(sys.argv[1])
lock=folder/'lock'
try:
    lock.write_text('held')
    (folder/'ready').write_text('ready')
    while True:time.sleep(.05)
except KeyboardInterrupt:
    raise SystemExit(130)
finally:
    lock.unlink(missing_ok=True)
'''


def check():
    if os.name!='posix':raise SystemExit('This local planner signal check requires POSIX.')
    for cancel_signal in (signal.SIGINT,signal.SIGTERM):
        with TemporaryDirectory() as temp:
            folder=Path(temp);previous=signal.signal(signal.SIGINT,signal.SIG_IGN)
            try:child=subprocess.Popen([sys.executable,'-c',CHILD,temp],start_new_session=True)
            finally:signal.signal(signal.SIGINT,previous)
            try:
                deadline=time.monotonic()+5
                while not (folder/'ready').exists():
                    if child.poll() is not None:raise AssertionError('worker exited before signal test')
                    if time.monotonic()>deadline:raise AssertionError('worker did not become ready')
                    time.sleep(.02)
                child.send_signal(cancel_signal)
                assert child.wait(timeout=5)==130
                assert not (folder/'lock').exists(), 'cancellation must unwind finally cleanup'
            finally:
                if child.poll() is None:child.kill();child.wait()
    print('PASS: ignored inherited SIGINT reset; SIGINT/SIGTERM cancel and release held lock')


if __name__=='__main__':check()

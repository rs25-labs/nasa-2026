"""Calculation entry point with explicit graceful cancellation signals."""
import os
import signal


def install_cancellation_handlers():
    # Background shells may pass SIGINT=SIG_IGN through exec. A new process
    # session does not reset that disposition. Install before heavy imports.
    signal.signal(signal.SIGINT,signal.default_int_handler)
    signal.signal(signal.SIGTERM,signal.default_int_handler)


def initialize_worker():
    install_cancellation_handlers()
    repo=os.environ.pop('LML_WORKER_REPO',None)
    if repo is not None:
        # macOS launch uses posix_spawn without pre-exec Python/native hooks.
        os.setsid()
        os.chdir(repo)


def main():
    try:
        initialize_worker()
        from .batch_environment import main as calculate
        return calculate()
    except KeyboardInterrupt:
        # Unwinding calculate() runs its lock context managers' finally blocks.
        print('Calculation cancelled.',flush=True)
        return 130


if __name__=='__main__':raise SystemExit(main())

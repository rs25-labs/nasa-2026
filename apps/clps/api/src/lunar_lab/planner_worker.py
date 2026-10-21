"""Calculation entry point with explicit graceful cancellation signals."""
import signal


def install_cancellation_handlers():
    # Background shells may pass SIGINT=SIG_IGN through exec. A new process
    # session does not reset that disposition. Install before heavy imports.
    signal.signal(signal.SIGINT,signal.default_int_handler)
    signal.signal(signal.SIGTERM,signal.default_int_handler)


def main():
    install_cancellation_handlers()
    try:
        from .batch_environment import main as calculate
        return calculate()
    except KeyboardInterrupt:
        # Unwinding calculate() runs its lock context managers' finally blocks.
        print('Calculation cancelled.',flush=True)
        return 130


if __name__=='__main__':raise SystemExit(main())

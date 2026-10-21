"""Pi entry point: see docs/LML-SITE-ATLAS-PI-HANDOFF.md."""
from lunar_lab.site_archive import main

if __name__=='__main__':
    try:raise SystemExit(main())
    except KeyboardInterrupt:raise SystemExit(130)

"""Pi only: prepare compact views from published completed summaries, no solver."""
import argparse
from pathlib import Path
from lunar_lab.planning_views import build_views

if __name__=='__main__':
    repo=Path(__file__).resolve().parents[3]
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir',type=Path,required=True)
    args=parser.parse_args();print(build_views(args.work_dir,repo))

"""Pi entry point for the bounded first data/geometry handoff."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import csv
from datetime import datetime, timedelta, timezone
import hashlib
from importlib.metadata import version
import json
import math
import os
from pathlib import Path
import platform
import sys
import time
from uuid import uuid4

from . import __version__
from .assets import acquire_assets, write_json
from .ephemeris import coverage_report, kernel_session, positions
from .terrain import PolarTerrain


def parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("UTC input must include Z or an explicit timezone offset")
    return parsed.astimezone(timezone.utc)


def iso_utc(value: datetime) -> str:
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        raise ValueError("Cannot write an empty review table")
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


@contextmanager
def exclusive_workdir(root: Path):
    lock = root / ".foundation.lock"
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as exc:
        raise ValueError(f"Work directory locked: {lock}. Confirm no preparation process remains before removing a stale lock.") from exc
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(str(os.getpid()) + "\n")
        yield
    finally:
        lock.unlink(missing_ok=True)


def peak_memory_mib():
    try:
        import resource
        usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return usage / (1024 * 1024 if sys.platform == "darwin" else 1024)
    except (ImportError, AttributeError):
        return None


def write_angle_plot(path: Path, rows: list[dict]) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(2, 1, figsize=(11, 7), sharex=True, constrained_layout=True)
    for ax, body in zip(axes, ("SUN", "EARTH")):
        for site_id in sorted({row["site_id"] for row in rows}):
            selected = [r for r in rows if r["body"] == body and r["site_id"] == site_id]
            ax.plot([parse_utc(r["utc"]) for r in selected],
                    [r["center_elevation_deg"] for r in selected], label=site_id)
        ax.axhline(0, color="black", linewidth=0.6)
        ax.set(ylabel=f"{body} center elevation (deg)")
        ax.legend()
    axes[0].set_title("Geometric topocentric angles — terrain obstruction is NOT calculated")
    axes[1].set_xlabel("UTC")
    fig.savefig(path, dpi=140)
    plt.close(fig)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", type=Path, default=Path("data/manifests/clps/foundation-sources.json"))
    parser.add_argument("--work-dir", type=Path, default=Path("data/local/lml"))
    parser.add_argument("--start", default="2026-11-14T09:00:00Z")
    parser.add_argument("--days", type=float, default=7)
    parser.add_argument("--step-hours", type=float, default=6)
    parser.add_argument("--max-download-mib", type=float, default=160)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args(argv)
    root = args.work_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:8]
    run = root / "runs" / run_id
    run.mkdir(parents=True)
    report_path = run / "foundation-report.json"
    report = {
        "schema_version": 1, "run_id": run_id, "stage": "data-and-geometric-angles",
        "status": "running", "software_version": __version__,
        "execution_origin": "Produced by the process running this CLI; not evidence of Codex execution",
        "created_utc": datetime.now(timezone.utc).isoformat(),
    }
    write_json(report_path, report)
    began = time.perf_counter()
    try:
        with exclusive_workdir(root):
            for name, value, low, high in (
                ("days", args.days, 1, 30), ("step-hours", args.step_hours, 0.25, 24),
                ("max-download-mib", args.max_download_mib, 1, 2048),
            ):
                if not math.isfinite(value) or not low <= value <= high:
                    raise ValueError(f"{name} must be finite and in [{low}, {high}]")
            start = parse_utc(args.start)
            end = start + timedelta(days=args.days)
            content = args.sources.resolve().read_bytes()
            spec = json.loads(content)
            if spec["schema_version"] != 1 or spec["reference_frame"] != "MOON_ME_DE421":
                raise ValueError("Unsupported source manifest schema/frame")
            if spec["terrain_reference_radius_m"] != 1737400:
                raise ValueError("Unsupported terrain reference radius")
            allowed_start = parse_utc(spec["dates"]["start_inclusive"])
            allowed_end = parse_utc(spec["dates"]["end_exclusive"])
            if not allowed_start <= start < end <= allowed_end:
                raise ValueError("Requested interval must be inside source manifest's supported date range")
            examples = spec["example_sites"]
            ids = [site["id"] for site in examples]
            if not 1 <= len(examples) <= 16 or len(set(ids)) != len(ids):
                raise ValueError("Expected 1–16 example sites with unique IDs")
            timestamps = []
            current = start
            while current < end:
                timestamps.append(iso_utc(current))
                current += timedelta(hours=args.step_hours)
            timestamps.append(iso_utc(end))  # Explicit final boundary sample.
            if len(timestamps) > 2881:
                raise ValueError("Requested sample grid exceeds foundation limit")
            acquired_at = time.perf_counter()
            paths, receipts = acquire_assets(spec, root, args.offline, args.max_download_mib)
            report["asset_acquisition_wall_seconds"] = time.perf_counter() - acquired_at
            report["sources"] = receipts
            write_json(run / "source-receipts.json", receipts)
            terrain = PolarTerrain(paths["terrain_label"], paths["terrain_image"])
            sites = [{"id": s["id"], **terrain.sample(s["latitude_deg"], s["longitude_deg"], s["observer_height_m"])}
                     for s in examples]
            write_csv(run / "site-samples.csv", sites)
            metadata = terrain.metadata()
            preview = terrain.write_preview(run / "terrain-coverage.png", sites)
            rows = []
            with kernel_session(paths):
                coverage = coverage_report(paths)
                for site in sites:
                    rows.extend(positions(site, timestamps))
            write_csv(run / "sun-earth-geometry.csv", rows)
            write_angle_plot(run / "sun-earth-angles.png", rows)
            report.update({
                "status": "complete",
                "source_manifest": {
                    "path": str(args.sources.resolve()), "sha256": hashlib.sha256(content).hexdigest(),
                    "model_id": spec["model_id"],
                },
                "request": {"start_utc": iso_utc(start), "end_utc": iso_utc(end),
                            "days": args.days, "step_hours": args.step_hours,
                            "sample_count_per_site_per_body": len(timestamps)},
                "terrain": metadata, "preview": preview, "kernel_coverage": coverage,
                "site_samples": sites,
                "geometry_conventions": {
                    "frame": "MOON_ME_DE421", "units": "angles degrees; distance kilometers",
                    "up": "local radial direction; not a terrain-derived surface normal",
                    "azimuth": "north=0, east=90; at exact pole longitude selects tangent-axis convention",
                    "aberration": "NONE; geometric simultaneous positions",
                    "body_disks": "angular radius uses equatorial radius from pck00011.tpc",
                },
                "software": {
                    "python": platform.python_version(), "platform": platform.platform(),
                    **{name: version(name) for name in ("numpy", "pyproj", "spiceypy", "matplotlib")},
                },
                "limitations": [
                    "Foundation only: no terrain horizon, terrain occultation, or finite-disk obstruction.",
                    "Positive center elevation does not establish visibility above nearby terrain.",
                    "No training simulation, power model, app server, or frontend in this batch.",
                    "No broad/distant-terrain raster is included yet.",
                    "Observed checksums are provenance, not independent validation of scientific accuracy.",
                    "Review future UTC/leap-second assumptions before relying on 2026–2028 event timing.",
                ],
                "artifacts": ["foundation-report.json", "source-receipts.json", "site-samples.csv",
                              "terrain-coverage.png", "sun-earth-geometry.csv", "sun-earth-angles.png"],
            })
            report["elapsed_wall_seconds"] = time.perf_counter() - began
            report["peak_process_memory_mib"] = peak_memory_mib()
            write_json(report_path, report)
            print(json.dumps({"status": "complete", "report": str(report_path),
                              "artifacts_directory": str(run)}, indent=2))
            return 0
    except Exception as exc:
        report.update({"status": "failed", "error_type": type(exc).__name__, "error": str(exc),
                       "elapsed_wall_seconds": time.perf_counter() - began,
                       "peak_process_memory_mib": peak_memory_mib()})
        write_json(report_path, report)
        print(f"Foundation failed: {exc}\nReturn this report to the owner: {report_path}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

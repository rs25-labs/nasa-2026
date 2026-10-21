"""Pi entry point for Batch 02: horizon + obstructed Sun/Earth environment.

Bounded scope: one site, one interval, reuse of Batch 01 seven-asset
manifest and cache, with an optional explicit global supplement. No API,
no frontend, no training engine. Missing
terrain stays INDETERMINATE/UNKNOWN; a coarser comparison grid reports
diagnostic sensitivity without establishing an error bound.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import csv
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import sys
import time
from importlib.metadata import version
from uuid import uuid4

from . import __version__
from .assets import acquire_assets, write_json
from .environment import build_timeseries, compress_intervals, summarize
from .ephemeris import coverage_report, kernel_session, positions
from .horizon import compare_refinement, horizon_profile
from .terrain import PolarTerrain
from .terrain_bounds import build_sector_bounds
from .composite_bounds import CompositeClearance, MODEL_ID as COMPOSITE_MODEL_ID
from .global_terrain import GlobalTerrain
from .result_store import engine_identity,make_identity,source_snapshot,lookup,publish,rebuild_index


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
def exclusive_workdir(root: Path, name: str = ".environment.lock"):
    lock = root / name
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as exc:
        raise ValueError(
            f"Work directory locked: {lock}. Confirm no preparation process remains before removing a stale lock."
        ) from exc
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


def write_horizon_plot(path: Path, fine: list[dict], coarse: list[dict], site_id: str) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(11, 4.5), constrained_layout=True)
    ax.plot([p["azimuth_deg"] for p in fine], [p["diagnostic_max_elevation_deg"] for p in fine], label="fine (diagnostic)", linewidth=1.0)
    ax.plot(
        [p["azimuth_deg"] for p in coarse],
        [p["diagnostic_max_elevation_deg"] for p in coarse],
        label="coarse (diagnostic)",
        linewidth=0.8,
        linestyle="--",
    )
    unresolved = [p["azimuth_deg"] for p in fine if p["status"] == "INDETERMINATE"]
    if unresolved:
        ax.scatter(unresolved, [0.0] * len(unresolved), s=8, color="red", label="indeterminate az (diagnostic max)", zorder=3)
    ax.axhline(0, color="black", linewidth=0.6)
    ax.set(xlabel="Azimuth (deg, north=0 east=90)", ylabel="Diagnostic max elevation (deg)")
    ax.set_title(f"Terrain diagnostic maxima — {site_id} (INDETERMINATE; not a complete horizon)")
    ax.legend()
    ax.set_xlim(0, 360)
    fig.savefig(path, dpi=140)
    plt.close(fig)


def write_visibility_plot(path: Path, timeseries: list[dict], site_id: str) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(2, 1, figsize=(11, 6), sharex=True, constrained_layout=True)
    for ax, body in zip(axes, ("SUN", "EARTH")):
        selected = sorted(
            [r for r in timeseries if r["body"] == body and r["site_id"] == site_id],
            key=lambda r: parse_utc(r["utc"]),
        )
        times = [parse_utc(r["utc"]) for r in selected]
        fracs = [r["visible_fraction"] if r["visible_fraction"] != "" else float("nan") for r in selected]
        ax.plot(times, fracs, marker="o", markersize=3, linewidth=1.0)
        lower = [float(r.get('visible_fraction_lower',0)) for r in selected]
        upper = [float(r.get('visible_fraction_upper',1)) for r in selected]
        ax.fill_between(times,lower,upper,step='post',alpha=.22,label='visible fraction bounds')
        ax.legend(loc='lower right')
        ax.set_ylim(-0.05, 1.05)
        ax.set(ylabel=f"{body} visible fraction")
        ax.text(0.02, 0.9, f"UNKNOWN samples: {sum(r['state'] == 'UNKNOWN' for r in selected)}", transform=ax.transAxes)
        ax.grid(True, alpha=0.3)
    axes[0].set_title(f"Model-conditional whole-disk visibility; UNKNOWN where unproven — {site_id}")
    axes[1].set_xlabel("UTC")
    fig.savefig(path, dpi=140)
    plt.close(fig)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", type=Path, default=Path("data/manifests/clps/foundation-sources.json"))
    parser.add_argument("--work-dir", type=Path, default=Path("data/local/lml"))
    parser.add_argument("--site-id", default="sample-a")
    parser.add_argument("--latitude-deg", type=float, default=-89.54)
    parser.add_argument("--longitude-deg", type=float, default=0.0)
    parser.add_argument("--observer-height-m", type=float, default=2.0)
    parser.add_argument("--start", default="2026-11-14T09:00:00Z")
    parser.add_argument("--days", type=float, default=7.0)
    parser.add_argument("--step-hours", type=float, default=6.0)
    parser.add_argument("--az-step-deg", type=float, default=2.0)
    parser.add_argument("--max-distance-m", type=float, default=150000.0)
    parser.add_argument("--distance-steps", type=int, default=256)
    parser.add_argument("--max-download-mib", type=float, default=160.0)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument('--global-sources', type=Path, help='Optional explicit composite-global supplement manifest')
    parser.add_argument('--max-global-download-mib', type=float, default=40.0)
    parser.add_argument('--refresh',action='store_true',help='Recalculate and save a new result instead of reusing a match')
    parser.add_argument('--rebuild-index',action='store_true',help='Rebuild the saved-result index and exit without calculating')
    args = parser.parse_args(argv)

    root = args.work_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    if args.rebuild_index:
        with exclusive_workdir(root):
            count=rebuild_index(root)
        print(json.dumps(dict(status='complete',indexed_results=count,index=str(root/'results-index.json')),indent=2))
        return 0
    lookup_began=time.perf_counter()
    request={key:getattr(args,key) for key in ('site_id','latitude_deg','longitude_deg','observer_height_m','days','step_hours','az_step_deg','max_distance_m','distance_steps')}
    request['start_utc']=args.start
    engine_at_start=engine_identity()
    if not args.refresh:
        try:
            manifest_paths={'foundation':args.sources}
            if args.global_sources:manifest_paths['global']=args.global_sources
            manifest_bytes={name:path.read_bytes() for name,path in manifest_paths.items()}
            manifests={name:hashlib.sha256(content).hexdigest() for name,content in manifest_bytes.items()}
            specs=[json.loads(content) for content in manifest_bytes.values()]
            identity=make_identity(request,manifests,source_snapshot(root,specs),engine_at_start)
            cached=lookup(root,identity)
            if cached is not None:
                response={key:cached[key] for key in ('status','cache_hit','cache_key','report','artifacts_directory')}
                response['lookup_wall_seconds']=time.perf_counter()-lookup_began
                print(json.dumps(response,indent=2))
                return 0
        except (OSError,ValueError,KeyError,TypeError,OverflowError):
            pass  # A miss follows the existing validated preparation path.
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:8]
    run = root / "env-runs" / run_id
    run.mkdir(parents=True)
    report_path = run / "environment-report.json"
    report = {
        "schema_version": 1,
        "run_id": run_id,
        "stage": "horizon-and-operating-environment",
        "status": "running",
        "software_version": __version__,
        "execution_origin": "Local Batch 02 diagnostic; completion is not scientific validation",
        "created_utc": datetime.now(timezone.utc).isoformat(),
    }
    write_json(report_path, report)
    began = time.perf_counter()
    try:
        # Consistent order: environment lock is held for the whole run;
        # the shared foundation lock is additionally held around the
        # asset/receipt mutation so Batch 01 and Batch 02 cannot
        # concurrently modify assets/asset-receipts.json.
        with exclusive_workdir(root, ".environment.lock"):
            for name, value, low, high in (
                ("days", args.days, 1, 30),
                ("step-hours", args.step_hours, 0.25, 24),
                ("max-download-mib", args.max_download_mib, 1, 2048),
                ('max-global-download-mib', args.max_global_download_mib, 1, 64),
                ("observer-height-m", args.observer_height_m, 0, 20),
                ("az-step-deg", args.az_step_deg, 0.25, 10),
                ("max-distance-m", args.max_distance_m, 5000, 400000),
            ):
                if not math.isfinite(value) or not low <= value <= high:
                    raise ValueError(f"{name} must be finite and in [{low}, {high}]")
            if not 16 <= args.distance_steps <= 1024:
                raise ValueError("distance-steps must be in [16, 1024]")
            # Explicitly bounded workload for the densified radial grid.
            # A 0.25-degree azimuth grid may be proposed for a later
            # diagnostic run; it is not validated accuracy. Keep the
            # base-grid product bounded here.
            if (360.0 / float(args.az_step_deg)) * float(args.distance_steps) > 500000:
                raise ValueError("azimuth/distance grid exceeds the bounded workload; reduce az density or distance steps")
            if not math.isfinite(args.latitude_deg) or not -90 <= args.latitude_deg <= -85:
                raise ValueError("Batch 02 supports latitudes in [-90, -85] (south polar cap)")
            if not math.isfinite(args.longitude_deg):
                raise ValueError("longitude must be finite")

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

            timestamps = []
            current = start
            while current < end:
                timestamps.append(iso_utc(current))
                current += timedelta(hours=args.step_hours)
            timestamps.append(iso_utc(end))
            if len(timestamps) > 2881:
                raise ValueError("Requested sample grid exceeds foundation limit")

            acquired_at = time.perf_counter()
            global_spec = None
            if args.global_sources:
                global_content = args.global_sources.resolve().read_bytes()
                global_spec = json.loads(global_content)
                if (global_spec.get('schema_version') != 1 or global_spec.get('model_id') != COMPOSITE_MODEL_ID
                        or global_spec.get('reference_frame') != 'MOON_ME_DE421'
                        or global_spec.get('terrain_reference_radius_m') != 1737400):
                    raise ValueError('Unsupported composite global manifest contract')
            with exclusive_workdir(root, ".foundation.lock"):
                paths, receipts = acquire_assets(spec, root, args.offline, args.max_download_mib)
                if global_spec is not None:
                    global_paths, global_receipts = acquire_assets(
                        global_spec, root, args.offline, args.max_global_download_mib, profile='composite-global')
                    paths.update(global_paths)
                    receipts.update(global_receipts)
                # Snapshot receipts while still holding the foundation lock.
                write_json(run / "source-receipts.json", receipts)
            report["asset_acquisition_wall_seconds"] = time.perf_counter() - acquired_at
            report["sources"] = receipts

            terrain = PolarTerrain(paths["terrain_label"], paths["terrain_image"])
            sampled = terrain.sample(args.latitude_deg, args.longitude_deg, args.observer_height_m)
            site = {"id": args.site_id, **sampled}
            clearance = None
            if global_spec is not None:
                global_terrain = GlobalTerrain(paths['global_terrain_label'], paths['global_terrain_image'])
                clearance = CompositeClearance(terrain, global_terrain, site)
                report['composite_source_manifest'] = {
                    'path': str(args.global_sources.resolve()),
                    'sha256': hashlib.sha256(global_content).hexdigest(), 'model_id': COMPOSITE_MODEL_ID,
                }
            write_csv(run / "site-sample.csv", [site])

            horizon_began = time.perf_counter()
            fine = horizon_profile(
                terrain,
                args.latitude_deg,
                args.longitude_deg,
                site["observer_radius_m"],
                az_step_deg=args.az_step_deg,
                max_distance_m=args.max_distance_m,
                distance_steps=args.distance_steps,
                far_field=None,
            )
            coarse = horizon_profile(
                terrain,
                args.latitude_deg,
                args.longitude_deg,
                site["observer_radius_m"],
                az_step_deg=min(10.0, args.az_step_deg * 2.0),
                max_distance_m=args.max_distance_m,
                distance_steps=max(16, args.distance_steps // 2),
                far_field=None,
            )
            horizon_seconds = time.perf_counter() - horizon_began
            write_csv(run / "horizon-profile.csv", fine)
            write_csv(run / "horizon-profile-coarse.csv", coarse)
            cell_evidence, sector_bounds, bounds_report = build_sector_bounds(terrain, site, fine)
            if cell_evidence:
                write_csv(run / "terrain-cell-enclosures.csv", cell_evidence)
            write_csv(run / "horizon-sector-bounds.csv", sector_bounds)

            # Split refinement reporting: radial vs angular diagnostic
            # sensitivities; never a guaranteed error bound.
            split = compare_refinement(fine, coarse)
            refinement = {
                "fine_az_step_deg": args.az_step_deg,
                "fine_distance_steps": args.distance_steps,
                "coarse_az_step_deg": min(10.0, args.az_step_deg * 2.0),
                "coarse_distance_steps": max(16, args.distance_steps // 2),
                **split,
            }
            complete = sum(1 for p in fine if p.get("horizon_is_complete"))
            indeterminate = len(fine) - complete
            terminations = {}
            for p in fine:
                key = p.get("termination", "unknown")
                terminations[key] = terminations.get(key, 0) + 1

            rows = []
            with kernel_session(paths):
                coverage = coverage_report(paths)
                rows.extend(positions(site, timestamps))
            timeseries = build_timeseries(rows, fine, sector_bounds, clearance, cell_evidence)
            if clearance is not None:
                write_json(run / 'composite-clearance-proofs.json', clearance.proofs)
                write_json(run / 'projected-disk-area-proofs.json', clearance.area_proofs)
                nodes = clearance.node_evidence()
                if nodes:
                    write_csv(run / 'composite-terrain-nodes.csv', nodes)
                report['composite_clearance'] = clearance.metadata()
                report['composite_clearance']['proof_artifact'] = 'composite-clearance-proofs.json'
                report['composite_clearance']['nodes_artifact'] = 'composite-terrain-nodes.csv' if nodes else None
                report['composite_clearance']['termination_counts'] = {
                    reason: sum(p['termination'] == reason for p in clearance.proofs)
                    for reason in sorted({p['termination'] for p in clearance.proofs})
                }
                report['disk_area_integration'] = {
                    'integrator_id': 'lml-projected-disk-bounds-v4',
                    'proof_artifact': 'projected-disk-area-proofs.json',
                    'normalization': 'uniform projected area of unit image disk; circle-edge squares left uncertain',
                    'samples_subdivided':len(clearance.area_proofs),
                    'requested_fraction_width':.01,'tile_budget_per_sample':16384,
                    'region_classification_budget_per_sample':4096,
                    'terrain_node_budget_per_sample':32768,'maximum_tile_depth':10,
                    'termination_counts':{reason:sum(p['termination']==reason for p in clearance.area_proofs)
                                          for reason in sorted({p['termination'] for p in clearance.area_proofs})},
                    'actual_widths':[p['fraction_width_upper'] for p in clearance.area_proofs],
                }
            write_csv(run / "environment-timeseries.csv", timeseries)
            intervals: list[dict] = []
            summaries: list[dict] = []
            for body in ("SUN", "EARTH"):
                body_intervals = compress_intervals(timeseries, site["id"], body)
                intervals.extend(body_intervals)
                summaries.append(summarize(timeseries, body_intervals, site["id"], body))
            if intervals:
                write_csv(run / "environment-intervals.csv", intervals)
            write_csv(run / "environment-summaries.csv", summaries)
            write_horizon_plot(run / "horizon.png", fine, coarse, site["id"])
            write_visibility_plot(run / "environment-visibility.png", timeseries, site["id"])

            report.update(
                {
                    "status": "complete",
                    "source_manifest": {
                        "path": str(args.sources.resolve()),
                        "sha256": hashlib.sha256(content).hexdigest(),
                        "model_id": spec.get("model_id"),
                    },
                    "request": {
                        "site_id": args.site_id,
                        "latitude_deg": args.latitude_deg,
                        "longitude_deg": args.longitude_deg,
                        "observer_height_m": args.observer_height_m,
                        "start_utc": iso_utc(start),
                        "end_utc": iso_utc(end),
                        "days": args.days,
                        "step_hours": args.step_hours,
                        "sample_count_per_body": len(timestamps),
                        "az_step_deg": args.az_step_deg,
                        "max_distance_m": args.max_distance_m,
                        "distance_steps": args.distance_steps,
                    },
                    "terrain": terrain.metadata(),
                    "site_sample": site,
                    "kernel_coverage": coverage,
                    "horizon": {
                        "method": "3D-vector diagnostic maxima along vector-rotated great-circle profiles; cell-densified radial grid",
                        "frame": "MOON_ME_DE421",
                        "far_field": "none; no completeness bound, so every azimuth is INDETERMINATE",
                        "complete_azimuths": complete,
                        "indeterminate_azimuths": indeterminate,
                        "termination_counts": terminations,
                        "horizon_wall_seconds": horizon_seconds,
                    },
                    "refinement": refinement,
                    "terrain_bounds_checkpoint": bounds_report,
                    "disk_classification": {
                        "method": "witnessed sector obstruction; optional complete composite-terrain whole-disk clearance",
                        "states_enabled": ["BLOCKED", "UNKNOWN"] + (["FULL",'PARTIAL'] if clearance else []),
                        "counts": {state: sum(r['state'] == state for r in timeseries) for state in ("BLOCKED", "UNKNOWN", "FULL",'PARTIAL')},
                        'model_id': COMPOSITE_MODEL_ID if clearance else bounds_report['model_id'],
                        "uncertainty": "conditional on constant-radius pixel solids and reported geometric directions; no physical height-error envelope",
                    },
                    "environment_conventions": {
                        "horizon_edge": "witnessed lower bounds over every possibly intersected closed sector; no constant-edge disk approximation used for classification",
                        "visible_fraction": "BLOCKED [0,0]/0; FULL [1,1]/1; PARTIAL and UNKNOWN retain proved area bounds with empty scalar",
                        "states": "whole-disk proofs or bounded projected disk area; PARTIAL requires positive visible and blocked area; unresolved area stays uncertain",
                        "intervals": "left-held sample state over [t_i, t_{i+1}); terminal boundary sample carries zero elapsed time",
                        "summaries": "duration-weighted hours; scalar means over known hours only; fraction mean bounds cover all left-held hours, preserving unknowns; cadence is the requested step_hours",
                        "aberration": "NONE; geometric simultaneous positions",
                    },
                    "summaries": summaries,
                    "software": {
                        "python": platform.python_version(),
                        "platform": platform.platform(),
                        **{name: version(name) for name in ("numpy", "pyproj", "spiceypy", "matplotlib")},
                    },
                    "limitations": [
                        "One south-polar-cap site per run; no global search in this batch.",
                        "No completeness bound: every horizon is INDETERMINATE (missing-raster vs search-cutoff); diagnostic maxima must not be read as clear.",
                        "Sparse point sampling with densified radial grid; unresolved gaps remain and are reported, not claimed as maxima.",
                        "Visibility fractions are conditional on the explicitly reported raster model; physical height error is unbounded. Actual fraction widths and work-limit termination are reported.",
                        "Duration-weighted coarse sampled estimates; longest blocked is a lower bound when unknown time remains.",
                        "Shared assets guarded by nested .environment.lock + .foundation.lock around acquisition; stale-lock checks preserved.",
                        "No power, thermal, comm-link, or training simulation in this batch; Earth-disk visibility is distinct from Earth-center communications visibility.",
                        "Observed checksums are provenance, not validation of scientific accuracy.",
                    ],
                    "artifacts": [
                        "environment-report.json",
                        "source-receipts.json",
                        "site-sample.csv",
                        "horizon-profile.csv",
                        "horizon-profile-coarse.csv",
                        *(["terrain-cell-enclosures.csv"] if cell_evidence else []),
                        "horizon-sector-bounds.csv",
                        "environment-timeseries.csv",
                        "environment-intervals.csv",
                        "environment-summaries.csv",
                        "horizon.png",
                        "environment-visibility.png",
                        *(['composite-clearance-proofs.json'] if clearance else []),
                        *(['projected-disk-area-proofs.json'] if clearance else []),
                        *(['composite-terrain-nodes.csv'] if clearance and clearance.cache else []),
                    ],
                }
            )
            report["elapsed_wall_seconds"] = time.perf_counter() - began
            report["peak_process_memory_mib"] = peak_memory_mib()
            write_json(report_path, report)
            cache_key=None
            cache_warning=None
            try:
                if engine_identity()!=engine_at_start:
                    raise ValueError('Calculation code changed during the run; result not indexed')
                manifests={'foundation':report['source_manifest']['sha256']}
                if global_spec is not None:manifests['global']=report['composite_source_manifest']['sha256']
                identity=make_identity(request,manifests,{name:value['sha256'] for name,value in receipts.items()},engine_at_start)
                cache_key=publish(root,run,identity)
            except (OSError,ValueError,KeyError,TypeError) as exc:
                cache_warning=str(exc)
                print(f'Result completed, but saved-result indexing failed: {exc}',file=sys.stderr)
            print(
                json.dumps(
                    {"status": "complete", "report": str(report_path), "artifacts_directory": str(run),
                     "cache_hit":False,"cache_key":cache_key,"cache_saved":cache_key is not None,
                     **({"cache_warning":cache_warning} if cache_warning else {})},
                    indent=2,
                )
            )
            return 0
    except Exception as exc:
        report.update(
            {
                "status": "failed",
                "error_type": type(exc).__name__,
                "error": str(exc),
                "elapsed_wall_seconds": time.perf_counter() - began,
                "peak_process_memory_mib": peak_memory_mib(),
            }
        )
        write_json(report_path, report)
        print(f"Environment failed: {exc}\nReturn this report to the owner: {report_path}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

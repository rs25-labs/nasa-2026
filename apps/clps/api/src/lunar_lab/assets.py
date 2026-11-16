"""Bounded asset acquisition with persistent provenance receipts."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ALLOWED_HOSTS = {"pds-geosciences.wustl.edu", "naif.jpl.nasa.gov"}


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    try:
        # Stream large proof artifacts rather than duplicating a complete
        # JSON string in memory before the atomic replacement.
        with temporary.open('w',encoding='utf-8') as stream:
            json.dump(value,stream,indent=2,allow_nan=False)
            stream.write('\n')
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def digests(path: Path) -> dict[str, str]:
    sha = hashlib.sha256()
    md5 = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
            md5.update(block)
    return {"sha256": sha.hexdigest(), "md5": md5.hexdigest()}


def validate_bytes(path: Path, asset: dict) -> dict[str, str]:
    size = path.stat().st_size
    if not 0 < size <= asset["max_bytes"]:
        raise ValueError(f"{asset['id']}: invalid file size {size}")
    if "expected_bytes" in asset and size != asset["expected_bytes"]:
        raise ValueError(f"{asset['id']}: expected {asset['expected_bytes']} bytes, received {size}")
    hashes = digests(path)
    if asset.get("expected_md5") and hashes["md5"] != asset["expected_md5"]:
        raise ValueError(f"{asset['id']}: published MD5 integrity check failed")
    return hashes


def acquire_assets(spec: dict, root: Path, offline: bool, budget_mib: float, *, profile: str = 'foundation') -> tuple[dict, dict]:
    folder = root / "assets"
    folder.mkdir(parents=True, exist_ok=True)
    ledger_path = root / "asset-receipts.json"
    ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {}
    paths, receipts = {}, {}
    profiles = {
        'foundation': {"terrain_label", "terrain_image", "lsk", "constants", "spk", "orientation", "frames"},
        'composite-global': {'global_terrain_label', 'global_terrain_image'},
    }
    if profile not in profiles:
        raise ValueError('Unsupported asset manifest profile')
    required_ids = profiles[profile]
    if {item["id"] for item in spec["assets"]} != required_ids:
        raise ValueError(f"Source manifest must define the {profile} asset IDs exactly once")
    if len(spec["assets"]) != len(required_ids):
        raise ValueError("Duplicate asset IDs in source manifest")
    filenames = [item["filename"] for item in spec["assets"]]
    if len(set(filenames)) != len(filenames):
        raise ValueError("Duplicate local asset filenames")
    planned = sum(a["max_bytes"] for a in spec["assets"] if not (folder / a["filename"]).exists())
    if planned > budget_mib * 1024 * 1024:
        raise ValueError(f"Planned download upper bound {planned} bytes exceeds --max-download-mib")

    for asset in spec["assets"]:
        name, url = asset["filename"], asset["url"]
        if Path(name).name != name or name in {"", ".", ".."} or "\\" in name:
            raise ValueError("Asset filename must be a basename")
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
            raise ValueError(f"Unapproved asset source: {url}")
        path = folder / name
        old = ledger.get(asset["id"])
        if path.exists():
            if not old or old.get("source_url") != url:
                raise ValueError(f"Untracked or changed-source cache file: {path}; review it before removing/replacing")
            hashes = validate_bytes(path, asset)
            if hashes["sha256"] != old.get("sha256"):
                raise ValueError(f"Cached asset changed: {path}")
            receipt = old
            print(f"Reusing {name}", flush=True)
        else:
            if offline:
                raise FileNotFoundError(f"Offline mode requires {path}")
            print(f"Downloading {name} (upper bound {asset['max_bytes']} bytes)", flush=True)
            partial = path.with_name(name + ".partial")
            try:
                request = Request(url, headers={"User-Agent": "LunarMissionLab/0.1 (bounded data preparation)"})
                with urlopen(request, timeout=120) as response:
                    final_url = response.geturl()
                    final = urlparse(final_url)
                    if final.scheme != "https" or final.hostname not in ALLOWED_HOSTS:
                        raise ValueError(f"Unexpected download redirect: {final_url}")
                    length = response.headers.get("Content-Length")
                    if length and int(length) > asset["max_bytes"]:
                        raise ValueError(f"{name}: server file exceeds configured download cap")
                    count = 0
                    with partial.open("wb") as target:
                        while True:
                            block = response.read(1024 * 1024)
                            if not block:
                                break
                            count += len(block)
                            if count > asset["max_bytes"]:
                                raise ValueError(f"{name}: streamed file exceeds download cap")
                            target.write(block)
                    headers = {k: response.headers.get(k) for k in ("ETag", "Last-Modified")}
                hashes = validate_bytes(partial, asset)
                receipt = {
                    "source_url": url, "resolved_url": final_url, "filename": name,
                    "downloaded_utc": datetime.now(timezone.utc).isoformat(),
                    "bytes": partial.stat().st_size, **hashes, "http_metadata": headers,
                    "integrity_basis": "published MD5 + observed SHA-256" if asset.get("expected_md5")
                    else "official HTTPS + byte checks + observed SHA-256 (not a pre-pinned source hash)",
                }
                partial.replace(path)
                ledger[asset["id"]] = receipt
                write_json(ledger_path, ledger)
            finally:
                partial.unlink(missing_ok=True)
        paths[asset["id"]] = path
        receipts[asset["id"]] = receipt
    return paths, receipts

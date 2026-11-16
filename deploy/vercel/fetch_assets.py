"""Download the API's terrain and SPICE files from their official sources and check every byte.

Usage: python fetch_assets.py DEST_DIR SPEC_JSON [SPEC_JSON ...]
Each spec maps an id to source_url, filename, bytes and sha256 (asset-receipts.json has this shape). A file whose
spec has "split" is written as row-block pieces <filename>.part000, .part001, … so that each piece fits in one
container image layer; lunar_lab.terrain reads the pieces as one raster.
"""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

ALLOWED_SOURCES = ("https://pds-geosciences.wustl.edu/", "https://naif.jpl.nasa.gov/")


def fetch(spec: dict, destination: Path) -> None:
    url = spec["source_url"]
    if not url.startswith(ALLOWED_SOURCES):
        raise ValueError(f"Unapproved source: {url}")
    split = spec.get("split")
    if split:
        rows = spec["bytes"] // split["row_bytes"]
        piece_bytes = -(-rows // split["parts"]) * split["row_bytes"]
        names = [f"{spec['filename']}.part{n:03d}" for n in range(split["parts"])]
    else:
        piece_bytes, names = spec["bytes"], [spec["filename"]]
    digest, size, written = hashlib.sha256(), 0, []
    with urllib.request.urlopen(url, timeout=300) as response:
        for name in names:
            path = destination / (name + ".tmp")
            remaining = piece_bytes
            with path.open("wb") as out:
                while remaining and (chunk := response.read(min(1 << 20, remaining))):
                    digest.update(chunk)
                    out.write(chunk)
                    size += len(chunk)
                    remaining -= len(chunk)
            written.append(path)
        if response.read(1):
            size += 1
    if size != spec["bytes"] or digest.hexdigest() != spec["sha256"]:
        for path in written:
            path.unlink()
        raise ValueError(f"{spec['filename']}: got {size} bytes, sha256 {digest.hexdigest()}; spec disagrees")
    for path in written:
        path.rename(path.with_suffix(""))
    print(f"ok {spec['filename']} {size} bytes in {len(names)} file(s)", flush=True)


def main() -> None:
    destination = Path(sys.argv[1])
    destination.mkdir(parents=True, exist_ok=True)
    for spec_path in sys.argv[2:]:
        for spec in json.loads(Path(spec_path).read_text()).values():
            fetch(spec, destination)


if __name__ == "__main__":
    main()

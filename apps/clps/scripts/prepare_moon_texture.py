"""Pi only: cache one bounded NASA illustration, outside scientific assets."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

SOURCE='https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg'


def main():
    repo=Path(__file__).resolve().parents[3]
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir',type=Path,default=repo/'data/local/lml')
    args=parser.parse_args()
    folder=args.work_dir/'ui-assets';folder.mkdir(parents=True,exist_ok=True)
    path=folder/'moon-color.jpg'
    if path.exists():
        content=path.read_bytes()
        if not (folder/'moon-color-source.json').exists():
            raise SystemExit('Existing image has no receipt; preserve it and return to Codex.')
        receipt=json.loads((folder/'moon-color-source.json').read_text())
        if receipt.get('source_url')!=SOURCE or receipt.get('sha256')!=hashlib.sha256(content).hexdigest():
            raise SystemExit('Existing image/receipt differs; preserve both and return to Codex.')
        print(f'Cached: {path}');return
    with urlopen(SOURCE,timeout=30) as response:
        if response.headers.get_content_type()!='image/jpeg':raise SystemExit('NASA response was not JPEG; nothing saved.')
        content=response.read(2*1024*1024+1)
    if not content.startswith(b'\xff\xd8') or len(content)>2*1024*1024:
        raise SystemExit('Invalid or oversized illustration; nothing saved.')
    receipt=dict(source_url=SOURCE,source_page='https://svs.gsfc.nasa.gov/4720/',
                 credit="NASA's Scientific Visualization Studio",sha256=hashlib.sha256(content).hexdigest(),
                 bytes=len(content),purpose='Illustrative globe only; not scientific terrain or calculated lighting')
    temporary=folder/'moon-color.jpg.partial';temporary.write_bytes(content);temporary.replace(path)
    (folder/'moon-color-source.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(f'Cached: {path} ({len(content)} bytes); SHA-256 {receipt["sha256"]}')


if __name__=='__main__':main()

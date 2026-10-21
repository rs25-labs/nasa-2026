"""Bounded read-only view of the existing LOLA south-polar raster."""
import json
import math
from pathlib import Path
import threading
from .result_store import source_snapshot

RADIUS=1737400
SIZE=192


def polar_xy(latitude,longitude):
    if not all(math.isfinite(v) for v in (latitude,longitude)) or not -90<=latitude<=-85:
        raise ValueError('Choose a finite site between 90°S and 85°S.')
    radius=2*RADIUS*math.tan(math.radians(90+latitude)/2)
    angle=math.radians(longitude)
    return radius*math.sin(angle),radius*math.cos(angle)


def polar_lonlat(x,y):
    if not all(math.isfinite(v) for v in (x,y)):raise ValueError('Invalid projected coordinate.')
    return -90+math.degrees(2*math.atan(math.hypot(x,y)/(2*RADIUS))),math.degrees(math.atan2(x,y))


class TerrainView:
    def __init__(self,root,manifest):
        self.root=Path(root);self.manifest=Path(manifest)
        self.lock=threading.RLock();self.reader=None;self.signature=None

    def terrain(self):
        from .terrain import PolarTerrain
        paths=[self.manifest,self.root/'asset-receipts.json',self.root/'assets/ldem_85s_40m.lbl',self.root/'assets/ldem_85s_40m.img']
        with self.lock:
            signature=tuple((p.stat().st_mtime_ns,p.stat().st_size) for p in paths)
            if self.reader is None or signature!=self.signature:
                spec=json.loads(self.manifest.read_text())
                selected=dict(assets=[a for a in spec['assets'] if a['id'] in ('terrain_label','terrain_image')])
                expected={'terrain_label':'ldem_85s_40m.lbl','terrain_image':'ldem_85s_40m.img'}
                if len(selected['assets'])!=2 or {a['id']:a['filename'] for a in selected['assets']}!=expected:
                    raise ValueError('Terrain source manifest does not match the supported polar raster.')
                self.hashes=source_snapshot(self.root,[selected])
                self.reader=PolarTerrain(paths[2],paths[3]);self.signature=signature
            return self.reader

    def site(self,latitude,longitude):
        polar_xy(latitude,longitude)
        return self.terrain().sample(latitude,longitude)

    def viewport(self,x,y,span):
        if (not all(math.isfinite(v) for v in (x,y,span)) or abs(x)>200000 or abs(y)>200000
                or not 7680<=span<=320000):
            raise ValueError('Viewport must be within ±200 km with a 7.68–320 km span.')
        import numpy as np
        with self.lock:
            terrain=self.terrain()
            step=span/SIZE
            xx=x+(np.arange(SIZE)+.5-SIZE/2)*step
            yy=y+(SIZE/2-np.arange(SIZE)-.5)*step
            cols=np.floor(terrain.col_offset+xx/terrain.scale+.5).astype(int)
            rows=np.floor(terrain.row_offset-yy/terrain.scale+.5).astype(int)
            values=np.asarray(terrain.raw[np.clip(rows,0,terrain.rows-1)[:,None],np.clip(cols,0,terrain.cols-1)[None,:]])
            cap=2*terrain.radius*math.tan(math.radians(90+terrain.max_lat)/2)
            valid=(terrain.valid_dn(values)&(xx[None,:]**2+yy[:,None]**2<=cap**2)
                   &(rows[:,None]>=0)&(rows[:,None]<terrain.rows)&(cols[None,:]>=0)&(cols[None,:]<terrain.cols))
            heights=values.astype(float)*terrain.factor
            data=[[float(heights[r,c]) if valid[r,c] else None for c in range(SIZE)] for r in range(SIZE)]
            return dict(elevations=data,center_x_m=x,center_y_m=y,span_m=span,size=SIZE,
                display_spacing_m=step,source_pixel_size_m=terrain.scale,
                elevation_range_m=[float(heights[valid].min()),float(heights[valid].max())] if np.any(valid) else None,
                product='LOLA LDEM_85S_40M',frame='MOON_ME_DE421',source_sha256=self.hashes['terrain_image'],
                missing_policy='null means invalid, out of raster or outside nominal south-polar cap')

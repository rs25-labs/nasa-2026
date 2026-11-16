"""Bounded read-only view of the existing LOLA south-polar raster."""
import json
import math
from pathlib import Path
import re
import threading
from .result_store import source_snapshot

RADIUS=1737400
SIZE=192
TILE_SIZES=(65,129,257,513)
BASE_PRODUCT='ldem_85s_40m'


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
        self.lock=threading.RLock();self.reader=None;self.signature=None;self.extra_readers={}

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

    def grid(self,x,y,span,size):
        """Square height grid as little-endian float32 metres, north row first. NaN marks missing terrain."""
        if size not in (128,256,512):raise ValueError('Grid size must be 128, 256 or 512.')
        if (not all(math.isfinite(v) for v in (x,y,span)) or abs(x)>200000 or abs(y)>200000
                or not 7680<=span<=320000):
            raise ValueError('Grid must be within ±200 km with a 7.68–320 km span.')
        import numpy as np
        with self.lock:
            terrain=self.terrain()
            step=span/size
            xx=x+(np.arange(size)+.5-size/2)*step
            yy=y+(size/2-np.arange(size)-.5)*step
            cols=np.floor(terrain.col_offset+xx/terrain.scale+.5).astype(int)
            rows=np.floor(terrain.row_offset-yy/terrain.scale+.5).astype(int)
            values=np.asarray(terrain.raw[np.clip(rows,0,terrain.rows-1)[:,None],np.clip(cols,0,terrain.cols-1)[None,:]])
            cap=2*terrain.radius*math.tan(math.radians(90+terrain.max_lat)/2)
            valid=(terrain.valid_dn(values)&(xx[None,:]**2+yy[:,None]**2<=cap**2)
                   &(rows[:,None]>=0)&(rows[:,None]<terrain.rows)&(cols[None,:]>=0)&(cols[None,:]<terrain.cols))
            return np.where(valid,values.astype(float)*terrain.factor,np.nan).astype('<f4').tobytes()

    def products(self):
        """Readable polar rasters, finest first, as (id, reader). Extra products are label-checked but have no receipts."""
        from .terrain import PolarTerrain,image_parts
        with self.lock:
            found=[(BASE_PRODUCT,self.terrain())]
            for label in sorted((self.root/'assets').glob('ldem_*.lbl')):
                match=re.fullmatch(r'ldem_\d+s_(\d+)m',label.stem);image=label.with_suffix('.img')
                if label.stem==BASE_PRODUCT or not match or not image_parts(image):continue
                signature=tuple((p.stat().st_mtime_ns,p.stat().st_size) for p in (label,*image_parts(image)))
                cached=self.extra_readers.get(label.stem)
                if cached is None or cached[0]!=signature:
                    try:reader=PolarTerrain(label,image,float(match.group(1)))
                    except (ValueError,OSError):reader=None
                    cached=self.extra_readers[label.stem]=(signature,reader)
                if cached[1] is not None:found.append((label.stem,cached[1]))
            return sorted(found,key=lambda item:item[1].scale)

    def product_list(self):
        return [dict(id=name,pixel_size_m=reader.scale,min_latitude_deg=reader.min_lat,max_latitude_deg=reader.max_lat,
                     rows=reader.rows,columns=reader.cols) for name,reader in self.products()]

    def tile(self,x,y,span,size):
        """Vertex-registered bilinear height tile: little-endian float32 metres, north row first, NaN where missing.

        Returns the bytes with the id and pixel size of the source raster used.
        """
        if size not in TILE_SIZES:raise ValueError('Tile size must be 65, 129, 257 or 513.')
        if (not all(math.isfinite(v) for v in (x,y,span)) or abs(x)>200000 or abs(y)>200000
                or not 250<=span<=320000):
            raise ValueError('Tile must be within ±200 km with a 250 m–320 km span.')
        import numpy as np
        spacing=span/(size-1)
        name,terrain=self.tile_source(self.products(),x,y,span,spacing)
        xs=x-span/2+np.arange(size)*spacing
        ys=y+span/2-np.arange(size)*spacing
        fc=terrain.col_offset+xs/terrain.scale
        fr=terrain.row_offset-ys/terrain.scale
        c0=np.clip(np.floor(fc).astype(int),0,terrain.cols-2);r0=np.clip(np.floor(fr).astype(int),0,terrain.rows-2)
        tc=(fc-c0)[None,:];tr=(fr-r0)[:,None]
        corners=[np.asarray(terrain.raw[(r0+dr)[:,None],(c0+dc)[None,:]]) for dr in (0,1) for dc in (0,1)]
        cap=2*terrain.radius*math.tan(math.radians(90+terrain.max_lat)/2)
        valid=((xs[None,:]**2+ys[:,None]**2<=cap**2)&((fc>=0)&(fc<=terrain.cols-1))[None,:]&((fr>=0)&(fr<=terrain.rows-1))[:,None])
        for corner in corners:valid&=terrain.valid_dn(corner)
        top=(1-tc)*corners[0]+tc*corners[1];bottom=(1-tc)*corners[2]+tc*corners[3]
        heights=((1-tr)*top+tr*bottom)*terrain.factor
        return np.where(valid,heights,np.nan).astype('<f4').tobytes(),name,terrain.scale

    @staticmethod
    def tile_source(products,x,y,span,spacing):
        """Coarsest product no coarser than the tile spacing, else the finest; it must hold the whole tile when any does."""
        half=span/2
        def holds(terrain):
            cap=2*terrain.radius*math.tan(math.radians(90+terrain.max_lat)/2)
            fc=[terrain.col_offset+(x+sign*half)/terrain.scale for sign in (-1,1)]
            fr=[terrain.row_offset-(y+sign*half)/terrain.scale for sign in (-1,1)]
            return (min(fc)>=0 and max(fc)<=terrain.cols-1 and min(fr)>=0 and max(fr)<=terrain.rows-1
                    and math.hypot(abs(x)+half,abs(y)+half)<=cap)
        covering=[item for item in products if holds(item[1])]
        if not covering:return max(products,key=lambda item:item[1].scale)
        sufficient=[item for item in covering if item[1].scale<=spacing]
        return max(sufficient,key=lambda item:item[1].scale) if sufficient else min(covering,key=lambda item:item[1].scale)

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

"""Whole-disk clearance against explicit composite raster solids.

Every polar quadtree terminal is either outside the nominal cap, outside a
verified superset of the disk's azimuth footprint, or below its minimum
elevation. The global exterior is checked separately. No point-ray maxima
or physical terrain-height guarantees enter this proof.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import time

import numpy as np

from .bounded_math import Interval, basis, sin_cos_degrees
from .terrain_bounds import circle_cap, cap_cosine_range

MODEL_ID = 'lml-composite-cell-solid-v1'
NODE_BUDGET = 4096
CACHE_BUDGET = 16384
MINIMUM_SPAN = 1/256


@dataclass
class Node:
    box: tuple[int, int, int, int]
    outside: bool
    valid: bool = False
    radius: float | None = None
    v: tuple | None = None
    k: Interval | None = None
    cosine: Interval | None = None
    z: Interval | None = None
    horizontal: Interval | None = None

    @property
    def id(self):
        return ':'.join(map(str, self.box))

    def children(self,minimum_span=1):
        r0, r1, c0, c1 = self.box
        rm=(r0+r1)//2 if r1-r0>1 else (r0+r1)/2
        cm=(c0+c1)//2 if c1-c0>1 else (c0+c1)/2
        rs = (r0,rm,r1) if r1-r0>minimum_span else (r0,r1)
        cs = (c0,cm,c1) if c1-c0>minimum_span else (c0,c1)
        return [(a,b,c,d) for a,b in zip(rs,rs[1:]) for c,d in zip(cs,cs[1:])]


class CompositeClearance:
    def __init__(self, terrain, global_terrain, site, *, cache_budget=CACHE_BUDGET):
        self.terrain, self.global_terrain, self.site = terrain, global_terrain, site
        if not isinstance(cache_budget, int) or cache_budget < 0:
            raise ValueError('Invalid clearance cache budget')
        if not (site['latitude_deg'] <= terrain.max_lat and site['observer_radius_m'] > 0):
            raise ValueError('Observer outside polar model or invalid radius')
        self.east, self.north, self.up = basis(site['latitude_deg'], site['longitude_deg'])
        self.observer = Interval(site['observer_radius_m'])
        sine, cosine = sin_cos_degrees((Interval(90)+terrain.max_lat)/2)
        self.cap_radius = 2*Interval(terrain.radius)*sine/cosine
        self.cache_budget, self.cache = cache_budget, {}
        self.proofs = []
        self.area_proofs = []
        self.band_envelope = None
        self.band_sine_upper = None
        from .clearance_cache import SkyCertificateCache
        self.sky_cache=SkyCertificateCache()
        self.began = time.perf_counter()
        # Include any slivers of the nominal cap outside the raster rectangle
        # as unknown cells. Verify the padded rectangle covers the cap.
        self.root = (-16, terrain.rows+16, -16, terrain.cols+16)
        xmin, xmax, ymin, ymax = self._rectangle(self.root)
        if not (xmin.hi < -self.cap_radius.hi and xmax.lo > self.cap_radius.hi
                and ymin.hi < -self.cap_radius.hi and ymax.lo > self.cap_radius.hi):
            raise ValueError('Polar model rectangle does not enclose its nominal cap')

    def _rectangle(self, box):
        r0,r1,c0,c1 = box
        t = self.terrain
        xmin = (Interval(c0)-t.col_offset-Interval('0.5'))*t.scale
        xmax = (Interval(c1)-t.col_offset-Interval('0.5'))*t.scale
        ymin = (Interval(t.row_offset)-r1+Interval('0.5'))*t.scale
        ymax = (Interval(t.row_offset)-r0+Interval('0.5'))*t.scale
        return xmin,xmax,ymin,ymax

    def _node(self, box):
        if box in self.cache:
            return self.cache[box]
        if len(self.cache) >= self.cache_budget:
            return None
        xmin,xmax,ymin,ymax = self._rectangle(box)
        xspan, yspan = Interval(xmin.lo,xmax.hi), Interval(ymin.lo,ymax.hi)
        outside = (xspan.square()+yspan.square()).lo > self.cap_radius.square().hi
        node = Node(box, outside)
        self.cache[box] = node
        if outside:
            return node
        # Circumscribed circle encloses every point of the projected tile.
        x, y = (xmin+xmax)/2, (ymin+ymax)/2
        a = (((xmax-xmin)/2).square()+((ymax-ymin)/2).square()).sqrt()
        node.v, node.k = circle_cap(x,y,Interval(a.hi),self.terrain.radius)
        node.cosine = cap_cosine_range(node.v,node.k,self.up)
        r0,r1,c0,c1 = box
        t = self.terrain
        node.valid = 0 <= r0 < r1 <= t.rows and 0 <= c0 < c1 <= t.cols
        if node.valid:
            import math
            r0,r1,c0,c1=math.floor(r0),math.ceil(r1),math.floor(c0),math.ceil(c1)
            maximum = -32768
            # Row chunks bound temporary validity arrays, even at the root.
            for start in range(r0,r1,128):
                block = t.raw[start:min(start+128,r1),c0:c1]
                if not np.all(t.valid_dn(block)):
                    node.valid = False
                    break
                maximum = max(maximum,int(block.max()))
            if node.valid:
                node.radius = t.radius + maximum*t.factor
                radius = Interval(node.radius)
                node.z = radius*node.cosine-self.observer
                node.horizontal = radius*(1-node.cosine.square()).nonnegative().sqrt()
        return node

    def _wedge(self, row):
        """Only use an azimuth wedge proved to contain the entire disk."""
        az = float(row['azimuth_deg']) % 360
        elev, rho = float(row['center_elevation_deg']), float(row['angular_radius_deg'])
        sa,ca = sin_cos_degrees(az)
        _,ce = sin_cos_degrees(elev)
        chord = 2*sin_cos_degrees(Interval(rho)/2)[0]
        east,north = ce*sa,ce*ca
        for half in (1,2,4,8,16,32,64,89):
            ss,sc = sin_cos_degrees((az-half)%360)
            es,ec = sin_cos_degrees((az+half)%360)
            normals = ((sc,-ss),( -ec,es),(sa,ca))
            if all((a*east+b*north-chord).lo > 0 for a,b in normals):
                world = [tuple(a*e+b*n for e,n in zip(self.east,self.north)) for a,b in normals]
                return world,half
        return [],180

    def _exterior(self, threshold):
        g = self.global_terrain
        if not g.complete or g.max_radius_m is None:
            return False,'invalid-global-raster',None
        # Omitted polar exterior begins at least this central separation.
        delta = (Interval(self.terrain.max_lat)-self.site['latitude_deg']).lo
        delta = max(Interval(0).lo,delta)
        # For delta in [delta0,180], compare the elevation threshold theta:
        # r*cos(delta+theta) - ro*cos(theta) < 0. Maxima of cosine occur
        # at an endpoint or at zero within this argument range [-90,270].
        angle = Interval(delta)+threshold
        cos0 = sin_cos_degrees(angle)[1]
        cos1 = sin_cos_degrees(Interval(180)+threshold)[1]
        maximum = max(cos0.hi,cos1.hi)
        if angle.lo <= 0:
            maximum = Interval(1).hi
        cosine = sin_cos_degrees(threshold)[1]
        margin = Interval(g.max_radius_m)*Interval(maximum)-self.observer*cosine
        if margin.hi < 0:
            return True,'exterior-radius-envelope',str(margin.hi)
        self._prepare_bands()
        if self.band_sine_upper is not None and sin_cos_degrees(threshold)[0].lo > self.band_sine_upper:
            return True,'latitude-band-envelope',str(margin.hi)
        return False,'exterior-radius-envelope',str(margin.hi)

    def _prepare_bands(self):
        """Float proposals are accepted only after a strict interval proof."""
        if self.band_envelope is not None:
            return
        self.band_envelope = []
        if not hasattr(self.global_terrain,'exterior_bands'):
            return
        import math
        bands = self.global_terrain.exterior_bands(self.terrain.max_lat)
        if not bands:
            return
        maxima = []
        for band in bands:
            delta = max(Interval(0).lo,(Interval(band['latitude_south'])-self.site['latitude_deg']).lo)
            radius,ro = band['max_radius_m'],self.site['observer_radius_m']
            # Candidate extrema of apparent elevation for delta in [delta0,pi].
            ds = [math.radians(float(delta)),math.pi]
            if radius < ro:
                stationary = math.acos(radius/ro)
                if ds[0] <= stationary:
                    ds.append(stationary)
            proposal = max(math.degrees(math.atan2(radius*math.cos(d)-ro,radius*math.sin(d))) for d in ds)
            tick = min(9000,max(-8999,math.ceil(proposal*100)+1))
            theta = Interval(str(tick/100))
            if tick == 9000:
                return
            c0 = sin_cos_degrees(Interval(delta)+theta)[1]
            c1 = sin_cos_degrees(Interval(180)+theta)[1]
            maximum = max(c0.hi,c1.hi)
            if (Interval(delta)+theta).lo <= 0:
                maximum = Interval(1).hi
            margin = Interval(radius)*Interval(maximum)-self.observer*sin_cos_degrees(theta)[1]
            if margin.hi >= 0:
                return
            evidence = dict(band,minimum_separation_lo_deg=str(delta),
                            elevation_upper_deg=str(theta.lo),margin_upper_m=str(margin.hi))
            self.band_envelope.append(evidence)
            maxima.append(sin_cos_degrees(theta)[0].hi)
        self.band_sine_upper = max(maxima)

    def prove_wedge(self,start,end,sine,*,node_budget=512):
        """Prove every composite solid below a fixed meridian threshold."""
        from .bearing_horizon import wedge_normals
        local=wedge_normals(start,end)
        if not isinstance(node_budget,int) or node_budget<0:
            raise ValueError('Invalid wedge node budget')
        sine=Interval(sine.lo)
        if not -1<sine.lo<1:raise ValueError('Invalid wedge elevation sine')
        result=dict(clear=False,model_id=MODEL_ID,node_budget=node_budget,visited_nodes=0,
                    cache_budget=self.cache_budget,termination='',terminal_nodes=[],unresolved_node='',
                    minimum_disk_up_lo=str(sine.lo),minimum_polar_span=MINIMUM_SPAN,
                    wedge_start_deg=start,wedge_end_deg=end,
                    sky_wedge=[[str(a.lo),str(a.hi),str(b.lo),str(b.hi)] for a,b,_ in local])
        self._prepare_bands()
        if self.band_sine_upper is None or sine.lo<=self.band_sine_upper:
            result['termination']='exterior-band-envelope-unresolved'
            return result
        normals=[tuple(a*e+b*n for e,n in zip(self.east,self.north)) for a,b,_ in local]
        return self._walk(result,normals,sine,(1-sine.square()).nonnegative().sqrt(),node_budget)

    def prove_region(self, direction, *, node_budget=512,minimum_span=MINIMUM_SPAN,use_cache=True,legacy_wedge=False):
        """Enclose clearance of unit directions in a local E/N/up box."""
        from .bounded_math import dot
        if not isinstance(node_budget,int) or node_budget<0:
            raise ValueError('Invalid region node budget')
        if minimum_span not in tuple(2**-p for p in range(9)):
            raise ValueError('Unsupported polar subpixel span')
        east,north,up = direction
        sine = Interval(max(Interval(-1).lo,up.lo))
        result = dict(clear=False,model_id=MODEL_ID,node_budget=node_budget,visited_nodes=0,
                      cache_budget=self.cache_budget,termination='',terminal_nodes=[],unresolved_node='',
                      minimum_disk_up_lo=str(sine.lo),region_direction=[[str(d.lo),str(d.hi)] for d in direction])
        result['minimum_polar_span']=minimum_span
        result['region_wedge_policy']='legacy-v1' if legacy_wedge else 'dyadic-v2'
        if use_cache:
            result['cache_policy']='sky-certificate-v1'
            cached=self.sky_cache.lookup(direction)
            if cached is not None:
                result.update(clear=True,termination='cached-clearance-certificate',reuse_of=cached['proof_id'],
                              certificate_minimum_up_lo=str(cached['minimum']),minimum_disk_up_lo=str(cached['minimum']),sky_wedge=cached['sky_wedge'])
                return result
            from decimal import Decimal,ROUND_FLOOR
            sine=Interval(sine.lo.quantize(Decimal('0.00001'),rounding=ROUND_FLOOR))
            result['minimum_disk_up_lo']=str(sine.lo)
        if sine.lo <= -1:
            result['termination'] = 'region-includes-nadir'
            return result
        self._prepare_bands()
        if self.band_sine_upper is None or sine.lo <= self.band_sine_upper:
            result['termination'] = 'exterior-band-envelope-unresolved'
            return result
        cosine = (1-sine.square()).nonnegative().sqrt()
        import math
        az = math.degrees(math.atan2(east.midpoint_float(),north.midpoint_float())) % 360
        normals = []
        result['sky_wedge']=[]
        widths=(1/1024,1/512,1/256,1/128,1/64,1/32,1/16,1/8,1/4,1/2,1,2,4,8,16,32,64,89)
        # Corner bearings propose a wedge; interval inclusion decides.
        spread=max(abs((math.degrees(math.atan2(float(e),float(n)))-az+180)%360-180)
                   for e in (east.lo,east.hi) for n in (north.lo,north.hi))
        candidates=(1,2,4,8,16,32,64,89) if legacy_wedge else (w for w in widths if w>spread)
        for half in candidates:
            ss,sc = sin_cos_degrees((az-half)%360)
            es,ec = sin_cos_degrees((az+half)%360)
            sa,ca = sin_cos_degrees(az)
            local = ((sc,-ss,Interval(0)),(-ec,es,Interval(0)),(sa,ca,Interval(0)))
            if all(dot(n,direction).lo > 0 for n in local):
                normals = [tuple(a*e+b*n for e,n in zip(self.east,self.north)) for a,b,_ in local]
                # Store exact input angles rather than rounded interval
                # coefficient midpoints for the published certificate.
                result['sky_wedge_angles']=[(az-half)%360,(az+half)%360,az]
                result['sky_wedge']=[[str(a.lo),str(a.hi),str(b.lo),str(b.hi)] for a,b,_ in local]
                break
        return self._walk(result,normals,sine,cosine,node_budget)

    def prove(self, row, *, node_budget=NODE_BUDGET,minimum_span=MINIMUM_SPAN):
        from math import isfinite
        if minimum_span not in tuple(2**-p for p in range(9)):
            raise ValueError('Unsupported polar subpixel span')
        az,elev,rho = (float(row[k]) for k in ('azimuth_deg','center_elevation_deg','angular_radius_deg'))
        if not all(isfinite(v) for v in (az,elev,rho)) or not -90 <= elev <= 90 or not 0 < rho < 90:
            raise ValueError('Invalid composite disk geometry')
        if not isinstance(node_budget,int) or node_budget < 0:
            raise ValueError('Invalid clearance node budget')
        threshold = Interval(elev)-Interval(rho)
        result = {
            'clear': False, 'model_id': MODEL_ID,
            'minimum_disk_elevation_lo': str(threshold.lo),
            'node_budget': node_budget, 'visited_nodes': 0,
            'cache_budget': self.cache_budget, 'termination': '',
            'terminal_nodes': [], 'unresolved_node': '',
            'minimum_polar_span':minimum_span,
        }
        if threshold.lo <= -90:
            result['termination'] = 'disk-includes-nadir'
            return result
        # Use the lower endpoint itself as a conservative exact threshold.
        threshold = Interval(threshold.lo)
        exterior_ok,reason,margin = self._exterior(threshold)
        result['exterior_margin_upper_m'] = margin
        result['exterior_method'] = reason
        result['exterior_margin_basis'] = 'scalar envelope; latitude-band evidence recorded separately when used'
        result['exterior_proved_below'] = exterior_ok
        if not exterior_ok:
            result['termination'] = reason+'-unresolved'
            return result
        normals,half_width = self._wedge(row)
        result['verified_wedge_half_width_deg'] = half_width
        sine,cosine = sin_cos_degrees(threshold)
        return self._walk(result,normals,sine,cosine,node_budget)

    def _walk(self,result,normals,sine,cosine,node_budget):
        stack = [self.root]
        while stack:
            if result['visited_nodes'] >= node_budget:
                result['termination'] = 'node-budget'
                break
            box = stack.pop()
            node = self._node(box)
            if node is None:
                result['termination'] = 'cache-budget'
                break
            result['visited_nodes'] += 1
            criterion = ''
            if node.outside:
                criterion = 'outside-cap'
            elif any(cap_cosine_range(node.v,node.k,normal).hi < 0 for normal in normals):
                criterion = 'outside-disk-wedge'
            elif node.valid and (node.z*cosine-node.horizontal*sine).hi < 0:
                criterion = 'below-disk-minimum'
            if criterion:
                result['terminal_nodes'].append({'node_id':node.id,'criterion':criterion})
            elif max(box[1]-box[0],box[3]-box[2])<=result.get('minimum_polar_span',1):
                result['termination'] = 'unresolved-polar-cell' if node.valid else 'unknown-polar-cell'
                result['unresolved_node'] = node.id
                break
            else:
                stack.extend(reversed(node.children(result.get('minimum_polar_span',1))))
        else:
            result['clear'] = True
            result['termination'] = 'all-composite-terrain-below-disk'
        result['terminal_sha256'] = hashlib.sha256(json.dumps(result['terminal_nodes'],sort_keys=True).encode()).hexdigest()
        return result

    def node_evidence(self):
        rows = []
        for n in self.cache.values():
            row = dict(node_id=n.id, outside_cap=n.outside, all_samples_valid=n.valid,
                       max_radius_m=n.radius if n.radius is not None else '')
            for label,value in (('cap_k',n.k),('cosine',n.cosine),('z',n.z),('horizontal',n.horizontal)):
                row[label+'_lo'] = str(value.lo) if value else ''
                row[label+'_hi'] = str(value.hi) if value else ''
            for i in range(3):
                value = n.v[i] if n.v else None
                row[f'cap_v{i}_lo'] = str(value.lo) if value else ''
                row[f'cap_v{i}_hi'] = str(value.hi) if value else ''
            rows.append(row)
        return rows

    def metadata(self):
        return dict(model_id=MODEL_ID, scope='polar solids within cap, LDEM_16 solids outside; union at shared edge',
                    physical_height_error='unbounded', node_budget_per_sample=NODE_BUDGET,
                    cache_budget=self.cache_budget, cached_nodes=len(self.cache),
                    root_node=':'.join(map(str,self.root)), wall_seconds=time.perf_counter()-self.began,
                    arithmetic='50-digit outward Decimal intervals; strict trigonometric comparisons',
                    exterior_latitude_bands=self.band_envelope,
                    exterior_upper_sine=str(self.band_sine_upper) if self.band_sine_upper is not None else None,
                    minimum_polar_span=MINIMUM_SPAN,sky_certificate_cache=dict(capacity=self.sky_cache.capacity,
                        entries=len(self.sky_cache.entries),lookups=self.sky_cache.lookups,hits=self.sky_cache.hits),
                    global_terrain=self.global_terrain.metadata())

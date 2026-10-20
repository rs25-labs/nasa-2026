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

    def children(self):
        r0, r1, c0, c1 = self.box
        rs = (r0, (r0+r1)//2, r1) if r1-r0 > 1 else (r0, r1)
        cs = (c0, (c0+c1)//2, c1) if c1-c0 > 1 else (c0, c1)
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
        return margin.hi < 0,'exterior-radius-envelope',str(margin.hi)

    def prove(self, row, *, node_budget=NODE_BUDGET):
        from math import isfinite
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
        }
        if threshold.lo <= -90:
            result['termination'] = 'disk-includes-nadir'
            return result
        # Use the lower endpoint itself as a conservative exact threshold.
        threshold = Interval(threshold.lo)
        exterior_ok,reason,margin = self._exterior(threshold)
        result['exterior_margin_upper_m'] = margin
        result['exterior_proved_below'] = exterior_ok
        if not exterior_ok:
            result['termination'] = reason+'-unresolved'
            return result
        normals,half_width = self._wedge(row)
        result['verified_wedge_half_width_deg'] = half_width
        sine,cosine = sin_cos_degrees(threshold)
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
            elif box[1]-box[0]==box[3]-box[2]==1:
                result['termination'] = 'unresolved-polar-cell' if node.valid else 'unknown-polar-cell'
                result['unresolved_node'] = node.id
                break
            else:
                stack.extend(reversed(node.children()))
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
                    global_terrain=self.global_terrain.metadata())

"""Reuse only published proofs covering the new sky direction box."""
from .bounded_math import Interval


class SkyCertificateCache:
    def __init__(self,capacity=128):
        self.capacity=capacity
        self.entries=[]
        self.lookups=self.hits=0

    def remember(self,proof):
        if not proof['clear'] or (proof.get('reuse_of') or proof.get('reuse_of_all')) or 'sky_wedge' not in proof:
            return
        entry=dict(proof_id=proof['proof_id'],minimum=Interval(proof['minimum_disk_up_lo']).lo,
                   normals=[(Interval(a0,a1),Interval(b0,b1)) for a0,a1,b0,b1 in proof['sky_wedge']],
                   sky_wedge=proof['sky_wedge'])
        if 'wedge_start_deg' in proof:
            entry['angles']=(proof['wedge_start_deg'],proof['wedge_end_deg'])
        entry['approx']=[(a.midpoint_float(),b.midpoint_float()) for a,b in entry['normals']]
        self.entries.append(entry)
        self.entries.sort(key=lambda e:e['minimum'])
        del self.entries[self.capacity:]

    def lookup(self,direction):
        self.lookups+=1
        east,north,up=direction
        em,nm=east.midpoint_float(),north.midpoint_float()
        attempts=0
        for entry in self.entries:
            if up.lo<entry['minimum']:
                continue
            # A midpoint filter proposes candidates only; interval inclusion
            # below decides every accepted reuse. Misses merely lose speed.
            if any(a*em+b*nm<0 for a,b in entry['approx']):
                continue
            attempts+=1
            if all((a*east+b*north).lo>0 for a,b in entry['normals']):
                self.hits+=1
                return entry
            if attempts>=16:
                break
        return None

    def lookup_union(self,direction):
        """Join only exact dyadic closed bearing intervals, with no reuse chains."""
        import math
        from .bearing_horizon import wedge_normals
        from .bounded_math import dot
        az=math.degrees(math.atan2(direction[0].midpoint_float(),direction[1].midpoint_float()))
        candidates=[]
        for entry in self.entries:
            if entry['minimum']>direction[2].lo or 'angles' not in entry:continue
            start,end=entry['angles']
            if not (float(start*128).is_integer() and float(end*128).is_integer()):continue
            shift=360*round((az-(start+end)/2)/360)
            candidates.append((start+shift,end+shift,entry))
        candidates.sort(key=lambda item:(item[0],-item[1]))
        chain=[];left=right=None
        for start,end,entry in candidates:
            if right is None or start>right:
                left,right,chain=start,end,[entry]
            elif end>right:
                right=end;chain.append(entry)
            if len(chain)<2 or not 0<right-left<180:continue
            local=wedge_normals(left,right)
            if all(dot(n,direction).lo>0 for n in local):
                return dict(reuse_of_all=[p['proof_id'] for p in chain],
                            minimum=max(p['minimum'] for p in chain),
                            sky_wedge=[[str(a.lo),str(a.hi),str(b.lo),str(b.hi)] for a,b,_ in local])
        return None

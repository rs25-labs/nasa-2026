"""Reuse only published proofs covering the new sky direction box."""
from .bounded_math import Interval


class SkyCertificateCache:
    def __init__(self,capacity=128):
        self.capacity=capacity
        self.entries=[]
        self.lookups=self.hits=0

    def remember(self,proof):
        if not proof['clear'] or proof.get('reuse_of') or 'sky_wedge' not in proof:
            return
        entry=dict(proof_id=proof['proof_id'],minimum=Interval(proof['minimum_disk_up_lo']).lo,
                   normals=[(Interval(a0,a1),Interval(b0,b1)) for a0,a1,b0,b1 in proof['sky_wedge']],
                   sky_wedge=proof['sky_wedge'])
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

"""Lower area of a rectangle intersecting the unit disk, using concavity.

This accounts only for geometry of already proved sky regions. For each
vertical strip, the unclamped intersection height is concave: min(y1,r(x))
minus max(y0,-r(x)), with r(x)=sqrt(1-x*x). When both endpoint height lower
bounds are nonnegative, their trapezoid lies below that height everywhere.
Otherwise count zero for that strip. Endpoint square roots and sums round
outward. No sampled value is assumed to bound the interior of a strip.
"""
import math
from .bounded_math import Interval

STRIPS_PER_TILE=256
STRIP_BUDGET=65536


def clipped_area_lower(box,*,strips=STRIPS_PER_TILE):
    x0,x1,y0,y1=box
    if (not all(isinstance(v,(int,float)) and math.isfinite(v) for v in box) or not -1<=x0<x1<=1
            or not -1<=y0<y1<=1 or type(strips) is not int
            or strips<1 or strips>STRIPS_PER_TILE or strips&(strips-1)):
        raise ValueError('Invalid clipped-area geometry/work limit')
    # Pipeline endpoints and strip widths are bounded binary dyadics. Require
    # the same property for external callers rather than rounding a new grid.
    if any(not float(v*65536).is_integer() for v in box):
        raise ValueError('Clipped-area endpoints must be depth-16 dyadics')
    step=(x1-x0)/strips
    def height(x):
        radius=(1-Interval(x).square()).nonnegative().sqrt().lo
        return (Interval(min(Interval(y1).lo,radius))-
                Interval(max(Interval(y0).lo,radius.copy_negate()))).lo
    total=Interval(0);left=height(x0)
    for index in range(strips):
        right=height(x0+(index+1)*step)
        if left>=0 and right>=0:
            total=total+Interval(step)*(Interval(left)+Interval(right))/2
        left=right
    return max(Interval(0).lo,total.lo)

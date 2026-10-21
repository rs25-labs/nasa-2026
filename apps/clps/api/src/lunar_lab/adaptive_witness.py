"""Small, certified circle subsets of a constant-radius terrain pixel."""
import math

from .bounded_math import Interval,dot
from .terrain_bounds import circle_cap,cap_cosine_range


def circle_geometry(clearance,row,col,x,y,radius):
    t=clearance.terrain
    if not (0<=row<t.rows and 0<=col<t.cols) or Interval(radius).lo<=0:
        return None
    dn=int(t.raw[row,col])
    if not t.valid_dn(dn):return None
    x,y,a=Interval(x),Interval(y),Interval(radius)
    xmin,xmax,ymin,ymax=clearance._rectangle((row,row+1,col,col+1))
    if not ((x-a).lo>=xmin.hi and (x+a).hi<=xmax.lo and (y-a).lo>=ymin.hi and (y+a).hi<=ymax.lo):
        return None
    if ((x.square()+y.square()).sqrt()+a).hi>=clearance.cap_radius.lo:
        return None
    v,k=circle_cap(x,y,a,t.radius)
    C=cap_cosine_range(v,k,clearance.up)
    r=Interval(t.radius)+Interval(dn)*t.factor
    z=r*C-clearance.observer
    h=r*(1-C.square()).nonnegative().sqrt()
    norm=(z.square()+h.square()).sqrt()
    if norm.lo<=0:return None
    lower=(z/norm).lo
    A,E,N=(dot(v,b) for b in (clearance.up,clearance.east,clearance.north))
    return dict(row=row,col=col,dn=dn,x=x,y=y,a=a,k=k,A=A,E=E,N=N,lower=lower)


def certify_geometry(geometry,direction):
    if geometry is None:return None
    row,col,dn=(geometry[k] for k in ('row','col','dn'))
    x,y,a=(geometry[k] for k in ('x','y','a'))
    k,A,E,N,lower=(geometry[k] for k in ('k','A','E','N','lower'))
    east,north,up=direction
    horizontal=(east.square()+north.square()).sqrt()
    if lower<=up.hi or horizontal.lo<=0:return None
    B=(E*east+N*north)/horizontal
    sector=None
    if not (A.lo>0 and B.lo>0 and (A.square()+B.square()).lo>k.square().hi):
        from .bearing_horizon import bearing_wedge
        from .terrain_bounds import trig as sin_cos_degrees
        sector=bearing_wedge(direction)
        if sector is None:return None
        endpoints=[E*sin_cos_degrees(a%360)[0]+N*sin_cos_degrees(a%360)[1] for a in sector]
        minimum=min(b.lo for b in endpoints)
        # A positive sinusoid on a sector shorter than pi is concave;
        # its minimum is at an endpoint, avoiding component dependency loss.
        if not (A.lo>0 and minimum>0 and (A.square()+Interval(minimum).square()).lo>k.square().hi):return None
    receipt=dict(state='BLOCKED',witness_kind='adaptive-cell-circle',
                evidence_id=f'cell-circle:{row}:{col}',witness_cell_id=f'{row}:{col}',
                row=row,col=col,raw_dn=dn,circle_x_m=str(x.lo),circle_y_m=str(y.lo),
                circle_radius_m=str(a.lo),elevation_sine_lower_lo=str(lower),
                direction=[[str(d.lo),str(d.hi)] for d in direction])
    if sector is not None:receipt['bearing_sector_deg']=list(sector)
    return receipt


def certify_circle(clearance,direction,row,col,x,y,radius):
    return certify_geometry(circle_geometry(clearance,row,col,x,y,radius),direction)


def propose_witness(clearance,direction,node_id,cache=None):
    """Newton projection proposes a point on the bearing's ground circle.

    Only certify_circle decides containment, height and bearing coverage.
    A failed/rounded proposal loses a witness; it cannot block a tile.
    """
    if not node_id:return None
    r0,r1,c0,c1=map(float,node_id.split(':'))
    row,col=math.floor((r0+r1)/2),math.floor((c0+c1)/2)
    t=clearance.terrain
    if not (0<=row<t.rows and 0<=col<t.cols):return None
    angle=math.degrees(math.atan2(direction[0].midpoint_float(),direction[1].midpoint_float()))
    tick=round(angle*10000)
    spread=max(abs((math.degrees(math.atan2(float(e),float(n)))-angle+180)%360-180)
               for e in (direction[0].lo,direction[0].hi) for n in (direction[1].lo,direction[1].hi))
    up=[a.midpoint_float() for a in clearance.up]
    ox=2*t.radius*up[1]/(1-up[2]);oy=2*t.radius*up[0]/(1-up[2])
    distance=math.hypot((col-t.col_offset)*t.scale-ox,(t.row_offset-row)*t.scale-oy)
    requested=2**math.ceil(math.log2(max(.25,2*distance*math.radians(spread))))
    key=(row,col,tick,requested)
    if cache is not None and key in cache:
        geometry=cache.pop(key);cache[key]=geometry
        return certify_geometry(geometry,direction)
    az=math.radians(tick/10000)
    m=[e.midpoint_float()*math.cos(az)-n.midpoint_float()*math.sin(az)
       for e,n in zip(clearance.east,clearance.north)]
    x=(col-t.col_offset)*t.scale;y=(t.row_offset-row)*t.scale;R=t.radius
    for _ in range(3):
        F=m[2]*(x*x+y*y-4*R*R)+4*R*(m[0]*y+m[1]*x)
        gx=2*m[2]*x+4*R*m[1];gy=2*m[2]*y+4*R*m[0]
        denominator=gx*gx+gy*gy
        if denominator<=0:return None
        x-=F*gx/denominator;y-=F*gy/denominator
    xmin,xmax,ymin,ymax=clearance._rectangle((row,row+1,col,col+1))
    margin=min(x-float(xmin.hi),float(xmax.lo)-x,y-float(ymin.hi),float(ymax.lo)-y)
    radius=min(requested,margin/2)
    if radius<=1e-6:return None
    # Retain the former center proposal. Edge intersections may give a
    # stronger height along the same bearing without changing source heights.
    proposals=[(x,y,radius)]
    inset=requested+max(1e-5,requested*1e-6)
    bounds=(float(xmin.hi)+inset,float(xmax.lo)-inset,
            float(ymin.hi)+inset,float(ymax.lo)-inset)
    if bounds[0]<bounds[1] and bounds[2]<bounds[3]:
        edges=[]
        for axis in (0,1):
            for fixed in bounds[axis*2:axis*2+2]:
                point=[x,y];point[axis]=fixed
                for _ in range(3):
                    px,py=point
                    F=m[2]*(px*px+py*py-4*R*R)+4*R*(m[0]*py+m[1]*px)
                    derivative=2*m[2]*point[1-axis]+4*R*m[axis]
                    if derivative==0:break
                    point[1-axis]-=F/derivative
                px,py=point
                if bounds[0]<=px<=bounds[1] and bounds[2]<=py<=bounds[3]:
                    q=px*px+py*py
                    normal=(4*R*py/(4*R*R+q),4*R*px/(4*R*R+q),(q-4*R*R)/(q+4*R*R))
                    C=max(-1.,min(1.,sum(a*b for a,b in zip(normal,up))))
                    r=t.radius+int(t.raw[row,col])*t.factor
                    score=math.atan2(r*C-clearance.observer.midpoint_float(),r*math.sqrt(max(0.,1-C*C)))
                    edges.append((score,px,py,requested))
        proposals.extend((px,py,rad) for _,px,py,rad in sorted(edges,reverse=True)[:2])
    geometry=None
    probe=(direction[0],direction[1],Interval(-1))
    for px,py,rad in proposals:
        candidate=circle_geometry(clearance,row,col,px,py,rad)
        if candidate is not None and certify_geometry(candidate,probe) is not None:
            if geometry is None or candidate['lower']>geometry['lower']:geometry=candidate
    if cache is not None:
        if len(cache)>=4096:cache.pop(next(iter(cache)))
        cache[key]=geometry
    return certify_geometry(geometry,direction)

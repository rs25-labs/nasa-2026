"""Focused analytic checks; run with PYTHONPATH=apps/clps/api/src."""
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import math

import numpy as np


def check():
    # A flat spherical surface has an analytic horizon everywhere. Check
    # against that oracle, rather than a second sampled terrain profile.
    from lunar_lab.composite_bounds import CompositeClearance
    from lunar_lab.global_terrain import GlobalTerrain
    assert GlobalTerrain.cell(90, 360) == (0, 0)
    assert GlobalTerrain.cell(-90, -1e-16) == (2879, 5759)
    R = 1737400
    polar = SimpleNamespace(
        rows=4, cols=4, row_offset=1.5, col_offset=1.5, scale=40,
        radius=R, factor=0.5, max_lat=-89.998,
        raw=np.zeros((4, 4), dtype=np.int16),
        valid_dn=lambda a: (a > -32768) & (a < 32767),
    )
    global_dem = SimpleNamespace(max_radius_m=R, complete=True)
    site = dict(latitude_deg=-90, longitude_deg=0, observer_radius_m=R+2)
    disk = dict(azimuth_deg=359.9, center_elevation_deg=10, angular_radius_deg=1)
    proof = CompositeClearance(polar, global_dem, site)
    assert proof.prove(disk)['clear']
    assert proof.prove(dict(disk, azimuth_deg=0.1))['clear']
    assert proof.prove(dict(disk, center_elevation_deg=90))['clear']
    assert not proof.prove(dict(disk, center_elevation_deg=-10))['clear']
    assert not proof.prove(disk, node_budget=0)['clear']
    assert not CompositeClearance(polar, global_dem, site, cache_budget=0).prove(disk)['clear']
    contact = dict(site, observer_radius_m=R)
    assert not CompositeClearance(polar, global_dem, contact).prove(
        dict(disk, center_elevation_deg=1))['clear']
    # A missing pixel under the disk prevents clearance. A missing pixel
    # outside the verified disk footprint need not prevent clearance.
    polar.raw[1, 1] = -32768
    assert not CompositeClearance(polar, global_dem, site).prove(disk)['clear']
    polar.raw[1, 1] = 0
    polar.raw[0, 0] = -32768
    assert CompositeClearance(polar, global_dem, site).prove(disk)['clear']
    polar.raw[0, 0] = 0
    missing = SimpleNamespace(max_radius_m=None, complete=False)
    assert not CompositeClearance(polar, missing, site).prove(disk)['clear']
    # Radius above the observer must prevent a near-field clear-sky claim.
    polar.raw[1, 1] = 100
    assert not CompositeClearance(polar, global_dem, site).prove(disk)['clear']
    polar.raw[1, 1] = 0
    assert math.degrees(-math.acos(R/(R+2))) < 0
    with TemporaryDirectory() as tmp:
        label = Path(tmp)/'ldem_16.lbl'
        image = Path(tmp)/'ldem_16.img'
        # Strict production labels cannot be replaced by a different frame.
        label.write_text('PDS_VERSION_ID = "PDS3"\nPRODUCT_ID = "LDEM_16_PA"\n')
        image.write_bytes(b'\0\0')
        try:
            GlobalTerrain(label, image)
        except ValueError:
            pass
        else:
            raise AssertionError('Mismatched global conventions accepted')
    print('PASS: analytic sphere, wrap, zenith, missing coverage, strict contact, node budget, ridge and convention rejection')


if __name__ == '__main__':
    check()

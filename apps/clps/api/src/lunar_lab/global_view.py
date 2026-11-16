"""Coarse global LOLA terrain for mission replay, never native rover routing."""
import json
import math
from pathlib import Path
import threading

import numpy as np

from .global_terrain import GlobalTerrain
from .horizon import local_basis, radial_vector
from .result_store import source_snapshot

RADIUS = 1737400


def local_lonlat(latitude, longitude, x, y):
    """Azimuthal equidistant offsets in metres, east x and north y."""
    lat, lon = np.radians(latitude), np.radians(longitude)
    distance = np.hypot(x, y) / RADIUS
    bearing = np.arctan2(x, y)
    out_lat = np.arcsin(np.clip(np.sin(lat)*np.cos(distance) + np.cos(lat)*np.sin(distance)*np.cos(bearing), -1, 1))
    out_lon = lon + np.arctan2(np.sin(bearing)*np.sin(distance)*np.cos(lat), np.cos(distance)-np.sin(lat)*np.sin(out_lat))
    return np.degrees(out_lat), (np.degrees(out_lon)+180) % 360-180


class GlobalView:
    def __init__(self, root, repo):
        self.root, self.repo = Path(root), Path(repo)
        self.lock = threading.RLock(); self.reader = None; self.signature = None

    def terrain(self):
        manifest = self.repo/'data/manifests/clps/composite-global-sources.json'
        paths = [manifest, self.root/'asset-receipts.json', self.root/'assets/ldem_16.lbl', self.root/'assets/ldem_16.img']
        with self.lock:
            signature = tuple((p.stat().st_mtime_ns, p.stat().st_size) for p in paths)
            if self.reader is None or signature != self.signature:
                self.hashes = source_snapshot(self.root, [json.loads(manifest.read_text())])
                self.reader = GlobalTerrain(paths[2], paths[3]); self.signature = signature
            return self.reader

    def elevations(self, latitude, longitude):
        terrain = self.terrain()
        rows = np.clip(np.floor((90-np.asarray(latitude))*16).astype(int), 0, 2879)
        cols = np.floor((np.asarray(longitude) % 360)*16).astype(int) % 5760
        raw = np.asarray(terrain.raw[rows, cols])
        valid = (raw > -32768) & (raw < 32767) & (raw >= terrain.dn_min) & (raw <= terrain.dn_max)
        return np.where(valid, raw.astype(float)*.5, np.nan)

    def sample(self, latitude, longitude, height):
        if not all(math.isfinite(v) for v in (latitude, longitude, height)) or not -90 <= latitude <= 90 or not 0 <= height <= 20:
            raise ValueError('Choose finite global coordinates and a 0–20 m observer height.')
        elevation = float(self.elevations(latitude, longitude))
        if not math.isfinite(elevation): raise ValueError('No global terrain at this point.')
        return dict(latitude_deg=latitude, longitude_deg=longitude % 360, observer_height_m=height,
                    elevation_above_reference_sphere_m=elevation, surface_radius_m=RADIUS+elevation,
                    observer_radius_m=RADIUS+elevation+height, terrain_sampling='Coarse global LOLA 16 pixels/degree; nearest pixel, approximately 1.9 km north–south.')

    def horizon(self, site):
        az = np.radians(np.arange(0., 360., 2.))[:, None]
        distances = np.geomspace(RADIUS*math.pi/2880, 150000, 256)[None, :]
        delta = distances/RADIUS
        east, north, up = local_basis(site['latitude_deg'], site['longitude_deg'])
        directions = (up[None, None, :]*np.cos(delta)[:, :, None] +
                      (north[None, None, :]*np.cos(az)[:, :, None] + east[None, None, :]*np.sin(az)[:, :, None])*np.sin(delta)[:, :, None])
        lat = np.degrees(np.arctan2(directions[:, :, 2], np.hypot(directions[:, :, 0], directions[:, :, 1])))
        lon = np.degrees(np.arctan2(directions[:, :, 1], directions[:, :, 0]))
        heights = self.elevations(lat, lon)
        valid = np.isfinite(heights); counts = valid.sum(axis=1)
        if np.any(counts == 0): raise ValueError('A global horizon ray has no usable terrain.')
        vectors = directions*(RADIUS+heights)[:, :, None] - radial_vector(site['latitude_deg'], site['longitude_deg'], site['observer_radius_m'])
        elevations = np.degrees(np.arctan2(vectors@up, np.hypot(vectors@east, vectors@north)))
        ring = np.max(np.where(valid, elevations, -np.inf), axis=1)
        return dict(elevation_deg=ring.tolist(), valid_radial_samples=counts.tolist(), azimuth_step_deg=2,
                    radial_samples=256, max_distance_m=150000,
                    coverage='Coarse LDEM_16 terrain, 16 pixels/degree (~1.9 km north–south); 2° bearings, 256 ranges to 150 km. Subpixel relief, gaps and farther terrain omitted.')

    def grid(self, latitude, longitude, span, size):
        if (not all(math.isfinite(v) for v in (latitude, longitude, span)) or not -90 <= latitude <= 90
                or not -180 <= longitude <= 180 or not 7680 <= span <= 320000 or size not in (128, 256, 512)):
            raise ValueError('Choose a global point, 7.68–320 km span and a 128/256/512 grid.')
        x = (np.arange(size)+.5-size/2)*span/size
        y = (size/2-np.arange(size)-.5)*span/size
        lat, lon = local_lonlat(latitude, longitude, x[None, :], y[:, None])
        with self.lock:
            return self.elevations(lat, lon).astype('<f4').tobytes()

"""Strict LDEM_16 reader and observed raster-model envelope, not physical relief."""
from __future__ import annotations

from pathlib import Path
import math
import numpy as np

from .terrain import label_number, label_value


class GlobalTerrain:
    def __init__(self, label_path: Path, image_path: Path):
        text = label_path.read_text(encoding='ascii')
        for key, expected in {
            'PDS_VERSION_ID': 'PDS3', 'PRODUCT_ID': 'LDEM_16',
            'DATA_SET_ID': 'LRO-L-LOLA-4-GDR-V1.0', 'TARGET_NAME': 'MOON',
            'PRODUCT_VERSION_ID': 'V3.1', 'SAMPLE_TYPE': 'LSB_INTEGER',
            'UNIT': 'METER',
            'MAP_PROJECTION_TYPE': 'SIMPLE CYLINDRICAL',
            'POSITIVE_LONGITUDE_DIRECTION': 'EAST',
            'COORDINATE_SYSTEM_NAME': 'MEAN EARTH/POLAR AXIS OF DE421',
            '^IMAGE': 'LDEM_16.IMG',
        }.items():
            if label_value(text, key) != expected:
                raise ValueError(f'Unsupported global PDS convention: {key}')
        for key, expected in {
            'LINES': 2880, 'LINE_SAMPLES': 5760, 'SAMPLE_BITS': 16,
            'SCALING_FACTOR': 0.5, 'OFFSET': 1737400,
            'MAP_RESOLUTION': 16, 'MAXIMUM_LATITUDE': 90,
            'MINIMUM_LATITUDE': -90, 'WESTERNMOST_LONGITUDE': 0,
            'EASTERNMOST_LONGITUDE': 360, 'CENTER_LATITUDE': 0,
            'CENTER_LONGITUDE': 180, 'MAP_PROJECTION_ROTATION': 0,
            'LINE_PROJECTION_OFFSET': 1439.5, 'SAMPLE_PROJECTION_OFFSET': 2879.5,
            'A_AXIS_RADIUS': 1737.4, 'B_AXIS_RADIUS': 1737.4, 'C_AXIS_RADIUS': 1737.4,
        }.items():
            if label_number(text, key) != expected:
                raise ValueError(f'Unsupported global PDS value: {key}')
        if image_path.name.lower() != 'ldem_16.img' or image_path.stat().st_size != 33177600:
            raise ValueError('Global terrain image pointer/size mismatch')
        self.raw = np.memmap(image_path, dtype='<i2', mode='r', shape=(2880, 5760))
        low, high = label_number(text, 'MINIMUM'), label_number(text, 'MAXIMUM')
        if not -32768 < low <= high < 32767:
            raise ValueError('Unsupported global label DN range')
        self.invalid_samples = 0
        minimum, maximum = 32767, -32768
        for start in range(0, 2880, 128):
            block = self.raw[start:start+128]
            valid = (block > -32768) & (block < 32767) & (block >= low) & (block <= high)
            self.invalid_samples += int(block.size - np.count_nonzero(valid))
            if np.any(valid):
                minimum = min(minimum, int(block[valid].min()))
                maximum = max(maximum, int(block[valid].max()))
        self.complete = self.invalid_samples == 0
        self.observed_min_dn, self.observed_max_dn = minimum, maximum
        self.max_radius_m = 1737400 + maximum*0.5 if self.complete else None

    @staticmethod
    def cell(latitude_deg: float, longitude_deg: float) -> tuple[int, int]:
        if not all(math.isfinite(v) for v in (latitude_deg, longitude_deg)) or not -90 <= latitude_deg <= 90:
            raise ValueError('Invalid global coordinates')
        longitude = longitude_deg % 360
        # A tiny negative binary float can round its modulo to exactly 360.
        # It belongs on the west side of the seam, inside the last column.
        if longitude == 360:
            longitude = math.nextafter(360, 0)
        return min(2879, math.floor((90-latitude_deg)*16)), math.floor(longitude*16)

    def metadata(self):
        return {
            'product': 'LDEM_16', 'product_version': 'V3.1',
            'frame': 'MOON_ME_DE421', 'latitude_type': 'planetocentric',
            'longitude_direction': 'east-positive', 'rows': 2880, 'columns': 5760,
            'pixel_area': 'Closed latitude/longitude rectangles, 1/16 degree; seam and pole closures included',
            'registration': 'lat=90-(row+0.5)/16; lon=(col+0.5)/16; zero-based',
            'observed_min_dn': self.observed_min_dn, 'observed_max_dn': self.observed_max_dn,
            'invalid_samples': self.invalid_samples, 'complete': self.complete,
            'model_max_radius_m': self.max_radius_m,
            'envelope_scope': 'Global raster pixel solids only; used outside polar cap; not physical lunar relief',
            'physical_height_error': 'unbounded; no supplied deterministic error envelope',
        }

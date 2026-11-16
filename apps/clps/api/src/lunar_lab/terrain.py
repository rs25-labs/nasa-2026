"""Reader for the selected LOLA PDS3 signed-int16 polar shape raster."""
from __future__ import annotations

import math
import re
from pathlib import Path

import numpy as np
from pyproj import CRS, Transformer


def label_value(text: str, key: str) -> str:
    match = re.search(r"^\s*" + re.escape(key) + r"\s*=\s*([^\r\n]+)", text, re.MULTILINE)
    if not match:
        raise ValueError(f"PDS label missing {key}")
    return match.group(1).strip().strip('"')


def label_number(text: str, key: str) -> float:
    value = label_value(text, key)
    match = re.match(r"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?", value)
    if not match:
        raise ValueError(f"PDS label {key} is not numeric")
    number = float(match.group())
    if not math.isfinite(number):
        raise ValueError(f"Non-finite PDS label value: {key}")
    return number


def image_parts(image_path: Path) -> list[Path]:
    """The raster's files: the image itself, or its row-block pieces `<name>.part000`, `.part001`, … when it is split."""
    if image_path.is_file():
        return [image_path]
    return sorted(image_path.parent.glob(image_path.name + ".part[0-9][0-9][0-9]"))


class RowBlocks:
    """A read-only int16 raster stored as consecutive row blocks in several files, indexed like the whole array.

    Hosts with a per-file or per-layer size limit get the large polar rasters this way. Supported indexing is what
    the readers use: integers and slices on both axes, or integer arrays on both axes that broadcast together.
    """

    def __init__(self, paths: list[Path], rows: int, cols: int):
        self.blocks, start = [], 0
        for path in paths:
            size = path.stat().st_size
            if size % (cols * 2):
                raise ValueError(f"{path.name} does not hold whole rows")
            block = np.memmap(path, dtype="<i2", mode="r", shape=(size // (cols * 2), cols))
            self.blocks.append((start, block))
            start += block.shape[0]
        if start != rows:
            raise ValueError("Raster pieces do not add up to the labelled rows")
        self.starts = np.array([first for first, _ in self.blocks])
        self.shape, self.dtype, self.ndim = (rows, cols), np.dtype("<i2"), 2

    def __getitem__(self, key):
        rows, cols = key if isinstance(key, tuple) else (key, slice(None))
        plain = (int, np.integer, slice)
        if isinstance(rows, plain) and isinstance(cols, plain):
            single = not isinstance(rows, slice)
            wanted = np.array([int(rows) % self.shape[0]]) if single else np.arange(*rows.indices(self.shape[0]))
            if wanted.size > 1 and wanted[0] > wanted[-1]:
                raise ValueError("Descending row slices are not supported")
            pieces = []
            for first, block in self.blocks:
                local = wanted[(wanted >= first) & (wanted < first + block.shape[0])] - first
                if local.size:
                    pieces.append(np.asarray(block[local, cols]))
            if not pieces:
                return np.empty((0,) + np.empty(self.shape[1])[cols].shape, dtype=self.dtype)
            result = np.concatenate(pieces) if len(pieces) > 1 else pieces[0]
            return result[0] if single else result
        if isinstance(rows, slice) or isinstance(cols, slice):
            raise TypeError("Mixing a slice with an index array is not supported")
        row_index, col_index = np.broadcast_arrays(np.asarray(rows), np.asarray(cols))
        result = np.empty(row_index.shape, dtype=self.dtype)
        which = np.searchsorted(self.starts, row_index, side="right") - 1
        for number, (first, block) in enumerate(self.blocks):
            mask = which == number
            if mask.any():
                result[mask] = block[row_index[mask] - first, col_index[mask]]
        return result


class PolarTerrain:
    """Restricted, explicit format support; never guess a CRS or scale."""

    def __init__(self, label_path: Path, image_path: Path, expected_scale: float = 40):
        text = label_path.read_text(encoding="ascii")
        checks = {
            "PDS_VERSION_ID": "PDS3",
            "SAMPLE_TYPE": "LSB_INTEGER",
            "MAP_PROJECTION_TYPE": "POLAR STEREOGRAPHIC",
            "KEYWORD_LATITUDE_TYPE": "PLANETOCENTRIC",
            "POSITIVE_LONGITUDE_DIRECTION": "EAST",
            "COORDINATE_SYSTEM_NAME": "MEAN EARTH/POLAR AXIS OF DE421",
        }
        for key, expected in checks.items():
            if label_value(text, key) != expected:
                raise ValueError(f"Unsupported PDS convention {key}; expected {expected}")
        if label_number(text, "SAMPLE_BITS") != 16:
            raise ValueError("Only 16-bit signed integer terrain is supported")
        if label_value(text, "^IMAGE").lower() != image_path.name.lower():
            raise ValueError("Detached PDS image pointer does not match downloaded filename")
        self.rows = int(label_number(text, "LINES"))
        self.cols = int(label_number(text, "LINE_SAMPLES"))
        if self.rows <= 0 or self.cols <= 0:
            raise ValueError("Invalid terrain dimensions")
        parts = image_parts(image_path)
        if not parts or sum(part.stat().st_size for part in parts) != self.rows * self.cols * 2:
            raise ValueError("Terrain size does not match the PDS label")
        self.scale = label_number(text, "MAP_SCALE")
        self.factor = label_number(text, "SCALING_FACTOR")
        self.radius = label_number(text, "OFFSET")
        self.row_offset = label_number(text, "LINE_PROJECTION_OFFSET")
        self.col_offset = label_number(text, "SAMPLE_PROJECTION_OFFSET")
        self.min_lat = label_number(text, "MINIMUM_LATITUDE")
        self.max_lat = label_number(text, "MAXIMUM_LATITUDE")
        self.dn_min = label_number(text, "DERIVED_MINIMUM")
        self.dn_max = label_number(text, "DERIVED_MAXIMUM")
        if label_number(text, "CENTER_LATITUDE") != -90 or label_number(text, "CENTER_LONGITUDE") != 0:
            raise ValueError("Expected a south-pole projection centered on longitude zero")
        if label_number(text, "MAP_PROJECTION_ROTATION") != 0:
            raise ValueError("Rotated PDS maps are not supported")
        axes = [label_number(text, key) * 1000 for key in ("A_AXIS_RADIUS", "B_AXIS_RADIUS", "C_AXIS_RADIUS")]
        if any(abs(axis - self.radius) > 1e-6 for axis in axes):
            raise ValueError("Expected spherical projection axes matching OFFSET")
        if self.radius != 1737400 or self.factor != 0.5 or self.scale != expected_scale:
            raise ValueError("Label no longer matches selected foundation product; review source configuration")
        if parts == [image_path]:
            self.raw = np.memmap(image_path, dtype="<i2", mode="r", shape=(self.rows, self.cols))
        else:
            self.raw = RowBlocks(parts, self.rows, self.cols)
        geographic = CRS.from_proj4(f"+proj=longlat +R={self.radius} +no_defs")
        projected = CRS.from_proj4(
            f"+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R={self.radius} +units=m +no_defs"
        )
        self.projected_crs = projected
        self.forward = Transformer.from_crs(geographic, projected, always_xy=True)
        self.inverse = Transformer.from_crs(projected, geographic, always_xy=True)
        self.product_version = label_value(text, "PRODUCT_VERSION_ID")
        self.label_path, self.image_path = label_path, image_path

    def valid_dn(self, values):
        return (values != -32768) & (values != 32767) & (values >= self.dn_min) & (values <= self.dn_max)

    def sample(self, latitude_deg: float, longitude_deg: float, observer_height_m: float = 0) -> dict:
        if not all(math.isfinite(v) for v in (latitude_deg, longitude_deg, observer_height_m)):
            raise ValueError("Site coordinates and observer height must be finite")
        if not self.min_lat <= latitude_deg <= self.max_lat:
            raise ValueError(f"Latitude outside product domain [{self.min_lat}, {self.max_lat}]")
        if not 0 <= observer_height_m <= 20:
            raise ValueError("Observer height must be between 0 and 20 meters")
        longitude_deg = longitude_deg % 360
        x, y = self.forward.transform(longitude_deg, latitude_deg)
        row = math.floor(self.row_offset - y / self.scale + 0.5)
        col = math.floor(self.col_offset + x / self.scale + 0.5)
        if not (0 <= row < self.rows and 0 <= col < self.cols):
            raise ValueError("Site outside raster rectangle")
        dn = int(self.raw[row, col])
        if not self.valid_dn(dn):
            raise ValueError("Selected terrain pixel is invalid; no flat-ground fallback")
        pixel_x = (col - self.col_offset) * self.scale
        pixel_y = (self.row_offset - row) * self.scale
        pixel_lon, pixel_lat = self.inverse.transform(pixel_x, pixel_y)
        elevation = dn * self.factor
        return {
            "latitude_deg": latitude_deg, "longitude_deg": longitude_deg,
            "observer_height_m": observer_height_m,
            "sample_row_zero_based": row, "sample_col_zero_based": col,
            "sample_center_latitude_deg": float(pixel_lat),
            "sample_center_longitude_deg": float(pixel_lon % 360),
            "sampling_offset_projected_m": math.hypot(pixel_x - x, pixel_y - y),
            "raw_dn": dn, "elevation_above_reference_sphere_m": elevation,
            "surface_radius_m": self.radius + elevation,
            "observer_radius_m": self.radius + elevation + observer_height_m,
            "terrain_sampling": "nearest pixel; requested direction retained; no subpixel accuracy claim",
        }

    def metadata(self) -> dict:
        return {
            "product": self.image_path.stem, "product_version": self.product_version,
            "rows": self.rows, "columns": self.cols, "pixel_size_m_at_pole": self.scale,
            "frame": "MOON_ME_DE421", "latitude_type": "planetocentric",
            "longitude_direction": "east-positive",
            "nominal_latitude_range_deg": [self.min_lat, self.max_lat],
            "raw_dtype": "little-endian signed int16",
            "elevation_equation": "DN * 0.5 meters above reference sphere",
            "radius_equation": "1737400 + DN * 0.5 meters",
            "reference_radius_m": self.radius,
            "projection_wkt": self.projected_crs.to_wkt(),
            "registration": "PDS pixel centers: col=offset+x/scale, row=offset-y/scale (zero-based)",
            "mask_policy": "nominal latitude cap; exclude integer endpoints and values outside label-derived range",
            "limitations": [
                "Interpolated gridded altimetry, not a measurement at every grid cell.",
                "No per-cell shot-count/uncertainty raster is included.",
                "The data mask establishes usable raster values, not certified landing safety.",
                "No terrain-horizon or occlusion calculation in this batch.",
            ],
        }

    def write_preview(self, destination: Path, sites: list[dict]) -> dict:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from matplotlib.patches import Circle

        stride = max(1, math.ceil(max(self.rows, self.cols) / 900))
        values = np.asarray(self.raw[::stride, ::stride], dtype=float)
        yy, xx = np.meshgrid(
            (self.row_offset - np.arange(0, self.rows, stride)) * self.scale,
            (np.arange(0, self.cols, stride) - self.col_offset) * self.scale,
            indexing="ij",
        )
        cap_radius = 2 * self.radius * math.tan(math.radians(90 + self.max_lat) / 2)
        valid = self.valid_dn(values) & (xx * xx + yy * yy <= cap_radius * cap_radius)
        heights = np.ma.array(values * self.factor, mask=~valid)
        if heights.count() == 0:
            raise ValueError("Terrain preview contains no valid samples")
        extent = [
            -(self.col_offset + 0.5) * self.scale / 1000,
            (self.cols - self.col_offset - 0.5) * self.scale / 1000,
            (self.row_offset - self.rows + 0.5) * self.scale / 1000,
            (self.row_offset + 0.5) * self.scale / 1000,
        ]
        fig, ax = plt.subplots(figsize=(8, 8), constrained_layout=True)
        # Preview is decimated for context; quantitative samples use the full grid.
        im = ax.imshow(heights, extent=extent, origin="upper", cmap="terrain", interpolation="nearest")
        ax.add_patch(Circle((0, 0), cap_radius / 1000, fill=False, color="black", linewidth=0.7))
        for site in sites:
            x, y = self.forward.transform(site["longitude_deg"], site["latitude_deg"])
            ax.scatter(x / 1000, y / 1000, marker="x", color="red")
            ax.annotate(site["id"], (x / 1000, y / 1000), xytext=(4, 4), textcoords="offset points")
        ax.set(xlabel="Polar stereographic easting (km)", ylabel="Northing (km)",
               title="LOLA south-polar terrain: decimated context preview")
        fig.colorbar(im, ax=ax, label="Elevation above 1737.4 km reference sphere (m)", shrink=0.75)
        fig.savefig(destination, dpi=140)
        plt.close(fig)
        return {
            "decimation_stride": stride,
            "preview_valid_samples": int(heights.count()),
            "preview_elevation_range_m": [float(heights.min()), float(heights.max())],
            "preview_note": "Not full-resolution coverage statistics or an uncertainty assessment.",
        }

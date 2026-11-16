"""Builds public/sky/earth_albedo.jpg. Usage: python make_earth_albedo.py "Earth (A).jpg" earth_albedo.jpg (needs numpy, Pillow)."""
import sys
import numpy as np
from PIL import Image, ImageFilter

src, out = sys.argv[1], sys.argv[2]
W, H = 1024, 512
img = Image.open(src).convert('RGB').resize((W, H), Image.LANCZOS)
a = np.asarray(img).astype(np.float32) / 255.0
r, g, b = a[..., 0], a[..., 1], a[..., 2]
lat = (0.5 - (np.arange(H) + 0.5) / H) * 180.0
lat = np.broadcast_to(lat[:, None], (H, W))
lon = (((np.arange(W) + 0.5) / W) * 360.0 - 180.0)
lon = np.broadcast_to(lon[None, :], (H, W))

# Land where the hypsometric map is green or orange/brown; sea where it is blue or grey-blue.
land = ((g > b + 0.04) | (r > b + 0.10)).astype(np.float32)
green = (g >= r).astype(np.float32) * land
desert = (1 - green) * land
ice_land = np.clip((lat + 62) / -4, 0, 1) * land            # Antarctica
greenland = ((lat > 59) & (lat < 84) & (lon > -75) & (lon < -10)).astype(np.float32) * land
ice_land = np.maximum(ice_land, greenland)
sea_ice = (np.clip((np.abs(lat) - 70) / 6, 0, 1)) * (1 - land) * (lat > 0).astype(np.float32) * 0.8

def blur(x, px):
    f = np.fft.fftfreq(W)[None, :] ** 2 + np.fft.fftfreq(H)[:, None] ** 2
    return np.fft.ifft2(np.fft.fft2(x) * np.exp(-2 * (np.pi * px) ** 2 * f)).real

land, green, desert, ice_land, sea_ice = [np.clip(blur(x, 1.2), 0, 1) for x in (land, green, desert, ice_land, sea_ice)]

ocean = np.array([0.030, 0.062, 0.120], np.float32)
forest = np.array([0.045, 0.085, 0.035], np.float32)
sand = np.array([0.30, 0.22, 0.13], np.float32)
snow = np.array([0.80, 0.82, 0.85], np.float32)
surface = np.zeros((H, W, 3), np.float32)
surface += ocean * (1 - land)[..., None]
surface += forest * (land * np.clip(green, 0, 1))[..., None]
surface += sand * (land * np.clip(desert, 0, 1))[..., None]
ice = np.clip(np.maximum(ice_land, sea_ice), 0, 1)[..., None]
surface = surface * (1 - ice) + snow * ice

# Synthetic cloud layer: periodic fractal noise stretched along longitude, latitude-banded cover.
rng = np.random.default_rng(20261115)
fx = np.fft.fftfreq(W)[None, :]
fy = np.fft.fftfreq(H)[:, None]
k = np.sqrt((fx * 1.0) ** 2 + (fy * 1.7) ** 2)
k[0, 0] = 1
spec = k ** -1.4
spec[0, 0] = 0
noise = np.fft.ifft2(spec * np.exp(2j * np.pi * rng.random((H, W)))).real
noise = (noise - noise.mean()) / noise.std()
latr = np.abs(lat)
band = 0.50 * np.exp(-((latr - 55) / 16) ** 2) + 0.30 * np.exp(-(latr / 10) ** 2) - 0.22 * np.exp(-((latr - 24) / 9) ** 2) + 0.36
cover = np.clip(band, 0.1, 0.9)
thr = np.array([np.quantile(noise[i], 1 - cover[i, 0]) for i in range(H)])[:, None]
density = np.clip((noise - thr) / 1.5 + 0.35, 0, 1)
density = density * density * (3 - 2 * density)
cloud = (np.clip(density, 0, 1))[..., None]
cloud_albedo = 0.80
combined = surface * (1 - cloud * 0.92) + cloud_albedo * cloud * 0.92

# Rescale so the area-weighted mean luminance equals Earth's Bond albedo.
lum = combined @ np.array([0.2126, 0.7152, 0.0722], np.float32)
w = np.cos(np.deg2rad(lat[:, 0]))
mean = float((lum.mean(axis=1) * w).sum() / w.sum())
combined *= 0.30 / mean
print('mean before', mean, 'max', combined.max())
combined = np.clip(combined, 0, 1)
srgb = np.where(combined <= 0.0031308, combined * 12.92, 1.055 * np.power(combined, 1 / 2.4) - 0.055)
Image.fromarray((np.clip(srgb, 0, 1) * 255 + 0.5).astype(np.uint8)).save(out, quality=88, optimize=True)

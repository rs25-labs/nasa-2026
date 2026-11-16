/** South-polar stereographic plane used by the terrain API (metres, Moon radius 1 737 400 m). */
export const MOON_RADIUS_M = 1_737_400;

/** Southern edge of the LOLA polar raster: the map shows 85°S to the pole. */
export const POLAR_CAP_LATITUDE_DEG = -85;

export interface PolarPoint {
  x: number;
  y: number;
}

export interface LatLon {
  latitudeDeg: number;
  longitudeDeg: number;
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Same formula as `polar_xy` in terrain_view.py: x = r sin(lon), y = r cos(lon). */
export function polarXY(latitudeDeg: number, longitudeDeg: number): PolarPoint {
  const radius = 2 * MOON_RADIUS_M * Math.tan(toRad(90 + latitudeDeg) / 2);
  const angle = toRad(longitudeDeg);
  return { x: radius * Math.sin(angle), y: radius * Math.cos(angle) };
}

/** Same formula as `polar_lonlat` in terrain_view.py. */
export function polarLatLon(x: number, y: number): LatLon {
  return {
    latitudeDeg: -90 + toDeg(2 * Math.atan(Math.hypot(x, y) / (2 * MOON_RADIUS_M))),
    longitudeDeg: toDeg(Math.atan2(x, y)),
  };
}

/** True when a point can be drawn on the polar map. */
export function isOnPolarMap(latitudeDeg: number): boolean {
  return latitudeDeg <= POLAR_CAP_LATITUDE_DEG;
}

/** Great-circle distance in metres on the reference sphere (haversine). */
export function greatCircleDistanceM(a: LatLon, b: LatLon): number {
  const lat1 = toRad(a.latitudeDeg);
  const lat2 = toRad(b.latitudeDeg);
  const dLat = lat2 - lat1;
  const dLon = toRad(b.longitudeDeg - a.longitudeDeg);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * MOON_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

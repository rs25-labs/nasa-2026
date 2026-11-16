import * as THREE from 'three';
import { SceneFrame } from '../core/frame';

const RAD = Math.PI / 180;
const J2000_MS = Date.UTC(2000, 0, 1, 12);
const DAY_MS = 86_400_000;

export function daysSinceJ2000(timeMs: number): number {
  return (timeMs - J2000_MS) / DAY_MS;
}

/** Low-precision (about 0.01 degree) ecliptic longitude of the Sun, radians. */
export function solarLongitude(days: number): number {
  const mean = 280.46 + 0.9856474 * days;
  const anomaly = (357.528 + 0.9856003 * days) * RAD;
  return (mean + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * RAD;
}

/** Greenwich mean sidereal angle, radians. */
export function greenwichSiderealAngle(days: number): number {
  return (280.46061837 + 360.98564736629 * days) * RAD;
}

export function obliquity(days: number): number {
  return (23.4393 - 3.56e-7 * days) * RAD;
}

/** Equatorial (J2000-like) axes and the Earth-fixed axes, expressed in scene coordinates. */
export interface SkyOrientation {
  /** Lunar spin axis (north), and the ecliptic axes built around it. */
  moonNorth: THREE.Vector3;
  /** Celestial equatorial axes: x toward the vernal equinox, z toward the celestial north pole. */
  equatorX: THREE.Vector3;
  equatorY: THREE.Vector3;
  equatorZ: THREE.Vector3;
  /** Rows: Earth longitude 0, longitude 90 east, Earth's north pole. Maps a scene direction into Earth-fixed axes. */
  earthFixedFromScene: THREE.Matrix3;
  /** Celestial equatorial axes as columns: maps equatorial coordinates to scene directions. */
  sceneFromEquatorial: THREE.Matrix3;
}

export function createSkyOrientation(): SkyOrientation {
  return {
    moonNorth: new THREE.Vector3(),
    equatorX: new THREE.Vector3(),
    equatorY: new THREE.Vector3(),
    equatorZ: new THREE.Vector3(),
    earthFixedFromScene: new THREE.Matrix3(),
    sceneFromEquatorial: new THREE.Matrix3(),
  };
}

const scratch = {
  sunInPlane: new THREE.Vector3(),
  eclipticX: new THREE.Vector3(),
  eclipticY: new THREE.Vector3(),
  cross: new THREE.Vector3(),
  prime: new THREE.Vector3(),
  east: new THREE.Vector3(),
};

/**
 * Orientation of the celestial sphere and of Earth in the scene, from the calculated Sun direction.
 *
 * The lunar spin axis is taken as the ecliptic pole (the true tilt is 1.5 degrees). Around that axis the Sun's
 * calculated direction, together with the Sun's known ecliptic longitude at that date, fixes the ecliptic x axis;
 * the equatorial axes follow by the obliquity. Because the Sun direction already carries the Moon's rotation,
 * the stars turn at the sidereal rate (about 0.549 degrees per hour) without a separate rotation model.
 * Earth's rotation phase follows from Greenwich sidereal time.
 */
export function updateSkyOrientation(
  out: SkyOrientation,
  siteFrame: SceneFrame,
  latitudeDeg: number,
  sunDirection: THREE.Vector3,
  timeMs: number,
): void {
  const days = daysSinceJ2000(timeMs);
  const north = out.moonNorth;
  siteFrame.skyDirection(180, Math.abs(latitudeDeg), north).negate();

  const { sunInPlane, eclipticX, eclipticY, cross, prime, east } = scratch;
  sunInPlane.copy(sunDirection).addScaledVector(north, -sunDirection.dot(north)).normalize();
  const longitude = solarLongitude(days);
  cross.crossVectors(north, sunInPlane);
  eclipticX.copy(sunInPlane).multiplyScalar(Math.cos(longitude)).addScaledVector(cross, -Math.sin(longitude));
  eclipticY.crossVectors(north, eclipticX);

  const tilt = obliquity(days);
  out.equatorX.copy(eclipticX);
  out.equatorY.copy(eclipticY).multiplyScalar(Math.cos(tilt)).addScaledVector(north, -Math.sin(tilt));
  out.equatorZ.copy(eclipticY).multiplyScalar(Math.sin(tilt)).addScaledVector(north, Math.cos(tilt));

  const angle = greenwichSiderealAngle(days);
  prime.copy(out.equatorX).multiplyScalar(Math.cos(angle)).addScaledVector(out.equatorY, Math.sin(angle));
  east.copy(out.equatorY).multiplyScalar(Math.cos(angle)).addScaledVector(out.equatorX, -Math.sin(angle));
  out.earthFixedFromScene.set(
    prime.x, prime.y, prime.z,
    east.x, east.y, east.z,
    out.equatorZ.x, out.equatorZ.y, out.equatorZ.z,
  );
  const { equatorX: x, equatorY: y, equatorZ: z } = out;
  out.sceneFromEquatorial.set(x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z);
}

/** Sub-Earth point: latitude and longitude on Earth that face the Moon, degrees. For diagnostics. */
export function subLunarPoint(orientation: SkyOrientation, earthDirection: THREE.Vector3): { latitudeDeg: number; longitudeDeg: number } {
  const fixed = earthDirection.clone().negate().applyMatrix3(orientation.earthFixedFromScene);
  return { latitudeDeg: Math.asin(fixed.z) / RAD, longitudeDeg: Math.atan2(fixed.y, fixed.x) / RAD };
}

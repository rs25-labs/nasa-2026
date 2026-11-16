import * as THREE from 'three';
import { MOON_RADIUS_M, polarXY } from '../../lib/geo/polar';

const RAD = Math.PI / 180;

/**
 * Scene frame: metres, origin on the ground at the selected site.
 * X = polar map x, Z = -(polar map y), Y = up. Distant ground drops by d^2 / (2R).
 */
export class SceneFrame {
  readonly mapX: number;
  readonly mapY: number;
  readonly longitudeDeg: number;
  /** Terrain height at the site in metres above the reference sphere; scene Y = height - this. */
  originHeightM = 0;

  constructor(latitudeDeg: number, longitudeDeg: number) {
    const origin = polarXY(latitudeDeg, longitudeDeg);
    this.mapX = origin.x;
    this.mapY = origin.y;
    this.longitudeDeg = longitudeDeg;
  }

  /** Polar map metres for a scene position. */
  toMapX(sceneX: number): number {
    return this.mapX + sceneX;
  }

  toMapY(sceneZ: number): number {
    return this.mapY - sceneZ;
  }

  /** Scene height of a ground sample at scene (x, z): curvature drop applied. */
  groundY(heightM: number, sceneX: number, sceneZ: number): number {
    return heightM - this.originHeightM - curvatureDrop(sceneX, sceneZ);
  }

  /**
   * Unit direction to a body. Azimuth is the bearing from local north toward east. Near the south pole,
   * local north on the map points away from the pole along the site's longitude.
   */
  skyDirection(azimuthDeg: number, elevationDeg: number, out: THREE.Vector3): THREE.Vector3 {
    const bearing = (this.longitudeDeg + azimuthDeg) * RAD;
    const level = Math.cos(elevationDeg * RAD);
    return out.set(Math.sin(bearing) * level, Math.sin(elevationDeg * RAD), -Math.cos(bearing) * level);
  }
}

export function curvatureDrop(sceneX: number, sceneZ: number): number {
  return (sceneX * sceneX + sceneZ * sceneZ) / (2 * MOON_RADIUS_M);
}

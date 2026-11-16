import * as THREE from 'three';
import { mission } from '../../lib/mission/store.svelte';
import { SceneFrame } from '../core/frame';
import type { LightingFrame, SurfaceContext, SurfaceExtension } from '../core/types';
import { createSkyOrientation, subLunarPoint, updateSkyOrientation } from './astronomy';
import { EARTH, SKY_LAYER } from './constants';
import { createSkyDome } from './dome';
import { createStarField } from './stars';

const HOUR_MS = 3_600_000;
const RAD = Math.PI / 180;

declare global {
  interface Window {
    /** Read-only diagnostics for the render review loop. */
    __skyState?: () => {
      subEarthLatitudeDeg: number;
      subEarthLongitudeDeg: number;
      sunDirection: number[];
      earthDirection: number[];
    };
  }
}

/**
 * Sun disc, Earth and stars, drawn first and behind everything (no depth test), so the terrain silhouette
 * cuts them. All sky pixels are written with alpha 0, which the exposure meter treats as "not ground".
 */
export function createSkyExtension(): SurfaceExtension {
  const dome = createSkyDome();
  const stars = createStarField();
  const orientation = createSkyOrientation();
  const drawingBuffer = new THREE.Vector2();
  let context: SurfaceContext | null = null;
  let siteKey = '';
  let siteFrame: SceneFrame | null = null;
  let latitudeDeg = 0;
  const lastSunDirection = new THREE.Vector3();
  const lastEarthDirection = new THREE.Vector3();
  let oriented = false;

  const loader = new THREE.TextureLoader();
  let loading = true;
  const texture = loader.load(
    `${import.meta.env.BASE_URL}${EARTH.texturePath}`,
    (loaded) => {
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.wrapS = THREE.RepeatWrapping;
      loaded.wrapT = THREE.ClampToEdgeWrapping;
      loaded.minFilter = THREE.LinearMipmapLinearFilter;
      loaded.magFilter = THREE.LinearFilter;
      loaded.generateMipmaps = true;
      loaded.needsUpdate = true;
      dome.setTexture(loaded);
      loading = false;
    },
    undefined,
    () => {
      loading = false;
    },
  );

  function trackSite(): void {
    const site = mission.sites.find((candidate) => candidate.id === mission.selectedSiteId);
    if (!site) return;
    const key = `${site.latitudeDeg}|${site.longitudeDeg}`;
    if (key === siteKey) return;
    siteKey = key;
    siteFrame = new SceneFrame(site.latitudeDeg, site.longitudeDeg);
    latitudeDeg = site.latitudeDeg;
  }

  return {
    attach(target: SurfaceContext): void {
      context = target;
      target.camera.layers.enable(SKY_LAYER);
      target.scene.add(stars.points);
      target.scene.add(dome.mesh);
      window.__skyState = () => {
        const point = subLunarPoint(orientation, lastEarthDirection);
        return {
          subEarthLatitudeDeg: point.latitudeDeg,
          subEarthLongitudeDeg: point.longitudeDeg,
          sunDirection: lastSunDirection.toArray(),
          earthDirection: lastEarthDirection.toArray(),
        };
      };
    },

    update(frame: LightingFrame): void {
      if (!context) return;
      trackSite();
      const timeMs = Date.parse(mission.startUtc) + frame.clockIndex * HOUR_MS;
      if (siteFrame && Number.isFinite(timeMs)) {
        updateSkyOrientation(orientation, siteFrame, latitudeDeg, frame.sunDirection, timeMs);
        oriented = true;
      }
      lastSunDirection.copy(frame.sunDirection);
      lastEarthDirection.copy(frame.earthDirection);
      context.renderer.getDrawingBufferSize(drawingBuffer);
      const pixelAngle = (2 * Math.tan((context.camera.fov * RAD) / 2)) / Math.max(drawingBuffer.y, 1);
      dome.setSun(frame.sunDirection, frame.sunAngularRadiusRad);
      dome.setEarth(frame.earthDirection, frame.earthAngularRadiusRad, orientation.earthFixedFromScene, pixelAngle);
      stars.sceneFromEquatorial.copy(orientation.sceneFromEquatorial);
      stars.points.visible = oriented;
    },

    isReady(): boolean {
      return !loading;
    },

    dispose(): void {
      if (context) {
        context.scene.remove(stars.points);
        context.scene.remove(dome.mesh);
      }
      delete window.__skyState;
      stars.dispose();
      dome.dispose();
      texture.dispose();
    },
  };
}

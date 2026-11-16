import type * as THREE from 'three';
import type { TerrainField } from './terrainField';

/** What the lighting code needs each frame. Directions are unit vectors in scene axes. */
export interface LightingFrame {
  sunDirection: THREE.Vector3;
  sunAngularRadiusRad: number;
  earthDirection: THREE.Vector3;
  earthAngularRadiusRad: number;
  /** Mission time as a fractional hour index into the stay. */
  clockIndex: number;
}

/** Ground queries, valid for the finest loaded level. Heights are scene metres (site ground = 0). */
export interface GroundQuery {
  /** NaN where no terrain is loaded or the data has a gap. */
  heightAt(x: number, z: number): number;
  /** Writes the unit surface normal into `out` and returns it. */
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
}

/** Terrain surface response. R2 replaces the implementation behind this interface. */
export interface TerrainMaterial {
  material: THREE.Material;
  update(frame: LightingFrame): void;
  dispose(): void;
}

export type TerrainMaterialFactory = () => TerrainMaterial;

export interface SurfaceContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  ground: GroundQuery;
  /** The terrain levels, for code that needs their height grids (lighting). */
  terrain: TerrainField;
}

/**
 * Extension point for light/, ground/, sky/ and rover/. Extensions add objects to
 * `context.scene` in `attach` and update them per frame.
 */
export interface SurfaceExtension {
  attach(context: SurfaceContext): void;
  update(frame: LightingFrame, deltaSeconds: number): void;
  /** False while the extension still loads something that changes the picture; holds `__surfaceReady` back. */
  isReady?(): boolean;
  dispose(): void;
}

export interface SurfaceStats {
  /** Frames per second over the last 120 frames (1000 / mean frame interval). */
  fps: number;
  /** Mean and worst frame interval over the last 120 frames, ms. */
  frameMs: number;
  frameMaxMs: number;
  /** Mean main-thread time inside one frame's update and draw calls, ms. */
  cpuMs: number;
  /** Mean GPU time of the scene and post passes, ms; -1 when the timer query is unavailable. */
  gpuMs: number;
  drawCalls: number;
  triangles: number;
  tilesLoaded: number;
  exposure: number;
}

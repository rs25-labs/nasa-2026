import * as THREE from 'three';
import { api } from '../../lib/api/client';
import { DetailPool } from '../ground/detailPool';
import type { BuiltLevel, LevelJob, TileSource } from '../ground/levelBuild';
import { setCraterMap } from './detailAtlas';
import { SceneFrame } from './frame';
import { TerrainLevel, type LevelSpec } from './terrainLevel';
import { TileCache } from './tileCache';
import type { GroundQuery } from './types';

/**
 * Nested levels centred under the camera. Spacing is 0.125 m in the 32 m level around the viewer, then 0.5 m,
 * 2 m, 8 m, growing by 4 (2 at the top) to the horizon. Levels 2 and up come from server tiles; the two finest
 * are resampled from the 2 m tile and carry synthetic relief the data cannot (see `ground/`). Each level's
 * centre is snapped to the next coarser level's grid so a hole in the coarser level ends exactly on its grid
 * lines.
 */
export const LEVEL_SPECS: readonly LevelSpec[] = [
  { span: 32, size: 257 },
  { span: 128, size: 257 },
  { span: 512, size: 257 },
  { span: 2_048, size: 257 },
  { span: 8_192, size: 257 },
  { span: 32_768, size: 257 },
  { span: 131_072, size: 257 },
  { span: 262_144, size: 257 },
];

/** The finest level that is fetched from the server; finer levels are resampled from it. */
const FIRST_TILE_LEVEL = 2;

/** From this level up, tiles are extended over the edge of the data so the horizon is a smooth ridge, not a staircase of missing cells. */
const FIRST_FILLED_LEVEL = 4;

/** A level re-centres when the camera is further than this fraction of its span from its centre. */
const RECENTRE_FRACTION = 1 / 8;
const MAP_LIMIT_M = 199_000;

interface Inflight {
  cx: number;
  cz: number;
  controller: AbortController;
}

interface Staged {
  inflight: Inflight;
  own: Float32Array | null;
}

interface Built {
  inflight: Inflight;
  result: BuiltLevel;
}

export class TerrainField implements GroundQuery {
  readonly group = new THREE.Group();
  readonly levels: TerrainLevel[];
  error: string | null = null;
  /** Workers shared with the rock field. */
  readonly pool = new DetailPool(3);
  /** Counts level installs, so code that read heights from the levels knows when to read again. */
  version = 0;
  /** Pixel size of the terrain product at the site in metres: synthetic relief fills in below this. */
  pixelSizeM = 10;

  private readonly cache = new TileCache(72);
  private readonly inflight: (Inflight | null)[];
  private readonly staged: (Staged | null)[];
  private readonly built: (Built | null)[];
  private readonly raw: (TileSource | null)[];
  private readonly snaps: number[];
  private frame: SceneFrame | null = null;
  private originReady = false;
  private originController: AbortController | null = null;
  private generation = 0;

  constructor(material: THREE.Material) {
    this.levels = LEVEL_SPECS.map((spec, index) => {
      const coarser = LEVEL_SPECS[index + 1];
      const outerSpacing = coarser ? coarser.span / (coarser.size - 1) : null;
      const level = new TerrainLevel(index, spec, outerSpacing, material);
      this.group.add(level.mesh);
      return level;
    });
    this.inflight = this.levels.map(() => null);
    this.staged = this.levels.map(() => null);
    this.built = this.levels.map(() => null);
    this.raw = this.levels.map(() => null);
    this.snaps = this.levels.map((level, index) => this.levels[index + 1]?.spacing ?? level.spacing);
    this.group.name = 'terrain';
  }

  get tilesLoaded(): number {
    return this.levels.filter((level) => level.loaded).length;
  }

  /** The site's map origin, for code that places things by map position. */
  get site(): SceneFrame | null {
    return this.frame;
  }

  /** True when every level is installed near the camera and nothing is waiting. */
  isSettled(cameraX: number, cameraZ: number): boolean {
    if (!this.originReady) return false;
    return this.levels.every((level, index) => {
      if (this.inflight[index] || this.staged[index] || this.built[index] || !level.loaded) return false;
      return this.offCentre(level, cameraX, cameraZ) <= level.spec.span * RECENTRE_FRACTION;
    });
  }

  /** Start over for a new site. The scene origin height is read from a small tile at the site. */
  setSite(frame: SceneFrame): void {
    this.generation += 1;
    this.originController?.abort();
    for (const entry of this.inflight) entry?.controller.abort();
    this.inflight.fill(null);
    this.staged.fill(null);
    this.built.fill(null);
    this.raw.fill(null);
    this.cache.clear();
    for (const level of this.levels) {
      level.loaded = false;
      level.mesh.visible = false;
    }
    this.frame = frame;
    this.originReady = false;
    this.error = null;
    const controller = new AbortController();
    this.originController = controller;
    const generation = this.generation;
    const size = 65;
    void api
      .terrainTile({ x: frame.mapX, y: frame.mapY, span: 250, size }, controller.signal)
      .then((tile) => {
        if (generation !== this.generation) return;
        const centre = tile.heights[(size >> 1) * size + (size >> 1)];
        frame.originHeightM = centre !== undefined && Number.isFinite(centre) ? centre : 0;
        if (Number.isFinite(tile.pixelSizeM) && tile.pixelSizeM > 0) this.pixelSizeM = tile.pixelSizeM;
        setCraterMap(frame.mapX, frame.mapY, this.pixelSizeM);
        this.originReady = true;
      })
      .catch((cause: unknown) => {
        if (generation !== this.generation) return;
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        this.error = cause instanceof Error ? cause.message : 'Terrain request failed.';
      });
  }

  /** Request tiles for levels that are missing or off-centre, and install at most one built level. */
  update(cameraX: number, cameraZ: number): void {
    const frame = this.frame;
    if (!frame || !this.originReady) return;
    for (let index = 0; index < this.levels.length; index += 1) {
      const level = this.levels[index] as TerrainLevel;
      const snap = this.snaps[index] as number;
      const centreX = this.clampCentre(Math.round(cameraX / snap) * snap, snap, frame.mapX, 1);
      const centreZ = this.clampCentre(Math.round(cameraZ / snap) * snap, snap, frame.mapY, -1);
      const current = this.inflight[index];
      const needed = !level.loaded || this.offCentre(level, cameraX, cameraZ) > level.spec.span * RECENTRE_FRACTION;
      if (!needed) {
        if (current) {
          current.controller.abort();
          this.inflight[index] = null;
          this.staged[index] = null;
        }
        continue;
      }
      if (level.loaded && level.centreX === centreX && level.centreZ === centreZ) continue;
      if (current && current.cx === centreX && current.cz === centreZ) continue;
      current?.controller.abort();
      this.staged[index] = null;
      this.inflight[index] = null;
      this.request(index, centreX, centreZ);
    }
    this.dispatchStaged();
    this.installOne();
  }

  heightAt(x: number, z: number): number {
    for (const level of this.levels) {
      if (!level.covers(x, z)) continue;
      const y = level.sample(x, z);
      if (Number.isFinite(y)) return y;
    }
    return Number.NaN;
  }

  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    let step = 1;
    for (const level of this.levels) {
      if (level.covers(x, z)) {
        step = level.spacing;
        break;
      }
    }
    const west = this.heightAt(x - step, z);
    const east = this.heightAt(x + step, z);
    const north = this.heightAt(x, z - step);
    const south = this.heightAt(x, z + step);
    const here = this.heightAt(x, z);
    const centre = Number.isFinite(here) ? here : 0;
    const dx = ((Number.isFinite(east) ? east : centre) - (Number.isFinite(west) ? west : centre)) / (2 * step);
    const dz = ((Number.isFinite(south) ? south : centre) - (Number.isFinite(north) ? north : centre)) / (2 * step);
    return out.set(-dx, 1, -dz).normalize();
  }

  dispose(): void {
    this.generation += 1;
    this.originController?.abort();
    for (const entry of this.inflight) entry?.controller.abort();
    this.pool.dispose();
    for (const level of this.levels) level.dispose();
  }

  private offCentre(level: TerrainLevel, x: number, z: number): number {
    return Math.max(Math.abs(x - level.centreX), Math.abs(z - level.centreZ));
  }

  /** Keep the tile centre inside the API's +-200 km window, staying on the snap grid. */
  private clampCentre(value: number, snap: number, siteMap: number, sign: 1 | -1): number {
    // Map coordinate = siteMap + sign * scene coordinate.
    const low = (-MAP_LIMIT_M - siteMap) * sign;
    const high = (MAP_LIMIT_M - siteMap) * sign;
    const min = Math.ceil(Math.min(low, high) / snap) * snap;
    const max = Math.floor(Math.max(low, high) / snap) * snap;
    return Math.min(max, Math.max(min, value));
  }

  private tileSource(index: number): TileSource | null {
    return this.raw[index] ?? null;
  }

  private request(index: number, cx: number, cz: number): void {
    const frame = this.frame as SceneFrame;
    const level = this.levels[index] as TerrainLevel;
    const controller = new AbortController();
    const entry: Inflight = { cx, cz, controller };
    if (index < FIRST_TILE_LEVEL) {
      // Resampled from the first server tile: wait until that tile covers this level.
      const parent = this.tileSource(FIRST_TILE_LEVEL);
      const reach = level.half;
      if (!parent) return;
      const parentHalf = (parent.spacing * (parent.size - 1)) / 2;
      if (Math.abs(cx - parent.centreX) + reach > parentHalf - 3 * parent.spacing) return;
      if (Math.abs(cz - parent.centreZ) + reach > parentHalf - 3 * parent.spacing) return;
      this.inflight[index] = entry;
      this.staged[index] = { inflight: entry, own: null };
      return;
    }
    this.inflight[index] = entry;
    const generation = this.generation;
    const key = `${generation}|${index}|${cx}|${cz}`;
    this.cache
      .fetch(
        key,
        { x: frame.toMapX(cx), y: frame.toMapY(cz), span: level.spec.span, size: level.spec.size },
        controller.signal,
        index >= FIRST_FILLED_LEVEL,
      )
      .then((tile) => {
        if (generation !== this.generation || this.inflight[index] !== entry) return;
        this.raw[index] = { heights: tile.heights, centreX: cx, centreZ: cz, spacing: level.spacing, size: level.spec.size };
        this.staged[index] = { inflight: entry, own: tile.heights };
      })
      .catch((cause: unknown) => {
        if (generation !== this.generation || this.inflight[index] !== entry) return;
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        this.inflight[index] = null;
        this.error = cause instanceof Error ? cause.message : 'Terrain request failed.';
      });
  }

  /**
   * Send staged levels to the workers. A level waits for the next coarser tile (it is blended into it across
   * its outer ring) unless that tile is not on its way.
   */
  private dispatchStaged(): void {
    const frame = this.frame as SceneFrame;
    for (let index = 0; index < this.levels.length; index += 1) {
      const staged = this.staged[index];
      if (!staged) continue;
      const coarserIndex = index + 1;
      const hasCoarser = coarserIndex < this.levels.length && index >= FIRST_TILE_LEVEL - 1;
      if (hasCoarser && coarserIndex >= FIRST_TILE_LEVEL && !this.raw[coarserIndex] && this.inflight[coarserIndex]) continue;
      this.staged[index] = null;
      const level = this.levels[index] as TerrainLevel;
      const entry = staged.inflight;
      const coarse = hasCoarser && coarserIndex >= FIRST_TILE_LEVEL ? this.tileSource(coarserIndex) : null;
      const coarseLevel = this.levels[coarserIndex];
      const job: LevelJob = {
        level: index,
        size: level.spec.size,
        spacing: level.spacing,
        centreX: entry.cx,
        centreZ: entry.cz,
        siteMapX: frame.mapX,
        siteMapY: frame.mapY,
        originHeightM: frame.originHeightM,
        pixelSizeM: this.pixelSizeM,
        coarseSpacing: coarseLevel ? coarseLevel.spacing : 0,
        own: staged.own,
        parent: staged.own ? null : this.tileSource(FIRST_TILE_LEVEL),
        coarse: staged.own ? coarse : null,
      };
      const generation = this.generation;
      this.pool
        .level(job)
        .then((result) => {
          if (generation !== this.generation || this.inflight[index] !== entry) return;
          this.built[index] = { inflight: entry, result };
        })
        .catch((cause: unknown) => {
          if (generation !== this.generation || this.inflight[index] !== entry) return;
          this.inflight[index] = null;
          this.error = cause instanceof Error ? cause.message : 'Terrain build failed.';
        });
    }
  }

  /** Install the finest built level; coarser neighbours get their cut-out updated in the same step. */
  private installOne(): void {
    for (let index = 0; index < this.levels.length; index += 1) {
      const built = this.built[index];
      if (!built) continue;
      this.built[index] = null;
      if (this.inflight[index] === built.inflight) this.inflight[index] = null;
      const level = this.levels[index] as TerrainLevel;
      level.install(built.result, built.inflight.cx, built.inflight.cz);
      this.version += 1;
      level.setHole(this.levels[index - 1] ?? null);
      this.levels[index + 1]?.setHole(level);
      return;
    }
  }
}

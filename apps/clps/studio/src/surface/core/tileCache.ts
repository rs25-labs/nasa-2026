import { api } from '../../lib/api/client';
import { fillGaps } from '../ground/gapFill';

export interface CachedTile {
  heights: Float32Array;
  /** Pixel size of the source product in metres (NaN when the server did not say). */
  pixelSizeM: number;
}

/** Least-recently-used cache of height tiles with in-flight request sharing. */
export class TileCache {
  private readonly tiles = new Map<string, CachedTile>();
  private readonly capacity: number;

  constructor(capacity = 64) {
    this.capacity = capacity;
  }

  get size(): number {
    return this.tiles.size;
  }

  clear(): void {
    this.tiles.clear();
  }

  peek(key: string): CachedTile | undefined {
    const tiles = this.tiles.get(key);
    if (tiles) {
      this.tiles.delete(key);
      this.tiles.set(key, tiles);
    }
    return tiles;
  }

  async fetch(
    key: string,
    query: { x: number; y: number; span: number; size: 65 | 129 | 257 | 513 },
    signal: AbortSignal,
    extendOverGaps = false,
  ): Promise<CachedTile> {
    const cached = this.peek(key);
    if (cached) return cached;
    const tile = await api.terrainTile(query, signal);
    if (extendOverGaps) fillGaps(tile.heights, query.size);
    const entry = { heights: tile.heights, pixelSizeM: tile.pixelSizeM };
    this.tiles.set(key, entry);
    while (this.tiles.size > this.capacity) {
      const oldest = this.tiles.keys().next().value;
      if (oldest === undefined) break;
      this.tiles.delete(oldest);
    }
    return entry;
  }
}

import { ApiError, getFloat32, getJson, postForBlob, postJson } from './base';
import type {
  BatchEstimatesRequest,
  BatchEstimatesResponse,
  Capabilities,
  DriveQuery,
  DriveResponse,
  EstimateQuery,
  EstimateResponse,
  GlobalGridQuery,
  GridQuery,
  NotableSitesResponse,
  RouteQuery,
  RouteResponse,
  SitesResponse,
  SlipResponse,
  ShadowMask,
  ShadowQuery,
  TerrainProduct,
  TerrainTile,
  TerrainTileQuery,
  TerrainViewport,
  WaypointQuery,
  WaypointResponse,
} from './types';

const TILE_API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');

async function fetchTerrainTile(query: TerrainTileQuery, signal?: AbortSignal): Promise<TerrainTile> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) params.set(key, String(value));
  let response: Response;
  try {
    response = await fetch(`${TILE_API_BASE}/api/terrain/tile?${params.toString()}`, { signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError('Cannot reach the calculation server. Check that it is running.', 0);
  }
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string') message = body.error;
    } catch {
      // Non-JSON error body: keep the generic message.
    }
    throw new ApiError(message, response.status);
  }
  const heights = new Float32Array(await response.arrayBuffer());
  if (heights.length !== query.size * query.size) throw new ApiError('The terrain tile has an unexpected size.', 502);
  return {
    heights,
    product: response.headers.get('X-Terrain-Product') ?? '',
    pixelSizeM: Number(response.headers.get('X-Terrain-Pixel-Size-M') ?? 'NaN'),
  };
}

async function fetchShadowMask(query: ShadowQuery, signal?: AbortSignal): Promise<ShadowMask> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) params.set(key, String(value));
  let response: Response;
  try {
    response = await fetch(`${TILE_API_BASE}/api/terrain/shadow?${params.toString()}`, { signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError('Cannot reach the calculation server. Check that it is running.', 0);
  }
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string') message = body.error;
    } catch {
      // Non-JSON error body: keep the generic message.
    }
    throw new ApiError(message, response.status);
  }
  const cells = new Uint8Array(await response.arrayBuffer());
  if (cells.length !== query.size * query.size) throw new ApiError('The sunlight mask has an unexpected size.', 502);
  return {
    cells,
    sunAzimuthDeg: Number(response.headers.get('X-Sun-Azimuth-Deg') ?? 'NaN'),
    sunElevationDeg: Number(response.headers.get('X-Sun-Elevation-Deg') ?? 'NaN'),
  };
}

export const api = {
  sites: (signal?: AbortSignal) => getJson<SitesResponse>('/api/sites', undefined, signal),

  notableSites: (signal?: AbortSignal) => getJson<NotableSitesResponse>('/api/notable-sites', undefined, signal),

  capabilities: (signal?: AbortSignal) => getJson<Capabilities>('/api/capabilities', undefined, signal),

  estimate: (query: EstimateQuery, signal?: AbortSignal) =>
    getJson<EstimateResponse>('/api/estimate', { ...query }, signal),

  estimates: (request: BatchEstimatesRequest, signal?: AbortSignal) =>
    postJson<BatchEstimatesResponse>('/api/estimates', request, signal),
  /** Mission planning report: the server recalculates every number from the plan and returns a PDF. */
  reportPdf: (
    request: {
      start: string;
      days: number;
      observer_height_m: number;
      power: { array_kw: number; battery_kwh: number; load_kw: number };
      crew: { people: number; kw_per_person: number };
      include: 'all' | 'sites' | 'outpost';
      sites: { site_id: string; name: string; latitude_deg: number; longitude_deg: number }[];
    },
    signal?: AbortSignal,
  ) => postForBlob('/api/report.pdf', request, signal),

  slip: (query: { start: string; days: number; span: number }, signal?: AbortSignal) =>
    getJson<SlipResponse>('/api/slip', { ...query }, signal),

  /** Polar viewport: x and y are metres in the south-polar stereographic frame. */
  terrainViewport: (query: { x: number; y: number; span: number }, signal?: AbortSignal) =>
    getJson<TerrainViewport>('/api/terrain', { ...query }, signal),

  /** Little-endian float32 metres, north row first, size*size values; NaN marks missing terrain. */
  terrainGrid: (query: GridQuery, signal?: AbortSignal) => getFloat32('/api/terrain/grid', { ...query }, signal),

  /** Same layout as terrainGrid, centred on a latitude/longitude and valid anywhere on the Moon. */
  terrainGlobalGrid: (query: GlobalGridQuery, signal?: AbortSignal) =>
    getFloat32('/api/terrain/global-grid', { ...query }, signal),

  /** Vertex-registered height tile centred on x, y: adjacent tiles share their edge samples. */
  terrainTile: (query: TerrainTileQuery, signal?: AbortSignal) => fetchTerrainTile(query, signal),

  /** Sun mask over a square map area at one time: see ShadowMask for the byte codes. */
  terrainShadow: (query: ShadowQuery, signal?: AbortSignal) => fetchShadowMask(query, signal),

  terrainProducts: (signal?: AbortSignal) => getJson<TerrainProduct[]>('/api/terrain/products', undefined, signal),

  /** Route with the Sun and Earth state at evenly spaced samples. 409 when the server is busy. */
  expeditionDrive: (query: DriveQuery, signal?: AbortSignal) =>
    getJson<DriveResponse>('/api/expedition/drive', { ...query }, signal),

  expeditionRoute: (query: RouteQuery, signal?: AbortSignal) =>
    getJson<RouteResponse>('/api/expedition/route', { ...query }, signal),

  expeditionWaypoint: (query: WaypointQuery, signal?: AbortSignal) =>
    getJson<WaypointResponse>('/api/expedition/waypoint', { ...query }, signal),
};

export { ApiError } from './base';
export type * from './types';

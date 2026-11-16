export type Body = 'SUN' | 'EARTH';

export interface SiteTerrainMeta {
  elevation_m: number | null;
  diagnostic_slope_deg: number | null;
  local_relief_m: number | null;
  terrain_pixel_m: number | null;
  context: string;
  frame: string;
}

export interface BodySummary {
  body: Body;
  start_utc?: string;
  end_utc?: string;
  mean_visible_fraction: number;
  full_hours: number;
  partial_hours: number;
  blocked_hours: number;
  longest_blocked_hours: number;
  total_hours: number;
  simultaneous_positive_visibility_hours_lower: number;
  simultaneous_positive_visibility_hours_upper?: number;
  explanation?: string;
  longest_obstruction_basis?: string;
}

/** GET /api/sites */
export interface CatalogSite {
  site_id: string;
  region_id: string;
  region: string;
  name: string;
  latitude_deg: number;
  longitude_deg: number;
  source_site_id: string;
  kind: 'published-candidate' | 'exploratory-point';
  parent_site_id: string;
  source_url: string;
  source_locator: string;
  why_included: string;
  assessment: string;
  data_status: string;
  terrain: SiteTerrainMeta | null;
  preview: {
    label: string;
    start_utc: string;
    end_utc: string;
    step_hours: number;
    observer_height_m: number;
    conditions: BodySummary[];
  } | null;
}

export interface SitesResponse {
  sites: CatalogSite[];
  ready_count: number;
  preview_available: boolean;
  published_collection: string | null;
  notice: string;
  kind?: string;
}

/** GET /api/notable-sites */
export interface NotableSite {
  id: string;
  name: string;
  category: string;
  latitude_deg: number;
  longitude_deg: number;
  landing_utc: string;
  time_precision: string;
  days: number;
  sources: { title: string; url: string }[];
  note: string;
}

export interface NotableSitesResponse {
  schema_version: number;
  coordinate_notice: string;
  sites: NotableSite[];
}

export interface EstimateQuery {
  site: string;
  latitude: number;
  longitude: number;
  height: number;
  start: string;
  days: number;
}

export interface EstimateEvent {
  body: Body;
  kind: 'rise' | 'set';
  utc: string;
  tolerance_seconds?: number;
}

/** One row of the legacy per-sample table inside GET /api/estimate. */
export interface EstimateSample {
  body: Body;
  utc: string;
  azimuth_deg: number;
  center_elevation_deg: number;
  angular_radius_deg: number;
  state: 'FULL' | 'PARTIAL' | 'BLOCKED';
  visible_fraction: number;
  horizon_elevation_deg: number;
}

/** GET /api/estimate */
export interface EstimateResponse {
  kind: 'hourly';
  source: string;
  cache_key: string;
  run_id: string;
  request: {
    site_id: string;
    latitude_deg: number;
    longitude_deg: number;
    observer_height_m: number;
    start_utc: string;
    end_utc: string;
    days: number;
    step_hours: number;
    sample_count_per_body: number;
  };
  summaries: BodySummary[];
  samples: EstimateSample[];
  events: EstimateEvent[];
  horizon: { azimuth_deg: number; horizon_elevation_deg: number; status: string }[];
  created_utc: string;
  calculation_seconds: number;
  model: string;
  terrain_resolution: string;
  methods: string;
}

/** GET /api/slip: per-site cells for each delay day; null when the stay runs past the data. */
export interface SlipCell {
  sun: number;
  earth: number;
  joint_hours: number;
  darkness_hours: number;
}

export interface SlipResponse {
  start_utc: string;
  days: number;
  span_days: number;
  stay_hours: number;
  sites: { site_id: string; cells: (SlipCell | null)[] }[];
}

/** GET /api/terrain (viewport). Null elevations are invalid or outside the polar cap. */
export interface TerrainViewport {
  elevations: (number | null)[][];
  center_x_m: number;
  center_y_m: number;
  span_m: number;
  size: number;
  display_spacing_m: number;
  source_pixel_size_m: number;
  elevation_range_m: [number, number] | null;
  product: string;
  frame: string;
  source_sha256: string;
  missing_policy: string;
}

export interface GridQuery {
  x: number;
  y: number;
  span: number;
  size: 128 | 256 | 512;
}

export interface GlobalGridQuery {
  latitude: number;
  longitude: number;
  span: number;
  size: 128 | 256 | 512;
}

export interface RouteQuery {
  latitude: number;
  longitude: number;
  target_latitude: number;
  target_longitude: number;
  slope: number;
  speed: number;
  sunlight?: 0 | 1;
  departure?: string;
  height?: number;
}

export interface RoutePoint {
  x_m: number;
  y_m: number;
  latitude_deg: number;
  longitude_deg: number;
  distance_m: number;
  elapsed_seconds: number;
  elevation_m: number;
  slope_deg: number;
  segment_grade_deg: number;
  departure_light_proxy?: string;
}

/** GET /api/expedition/route. Fields not read by the server code (search_window and others) are omitted. */
export interface RouteResponse {
  model: string;
  request: Record<string, number | string | boolean>;
  points: RoutePoint[];
  endpoints: {
    requested_latitude_deg: number;
    requested_longitude_deg: number;
    latitude_deg: number;
    longitude_deg: number;
    offset_m: number;
  }[];
  sunlight_preference: string;
  distance_m: number;
  travel_seconds: number;
  max_slope_deg: number;
  ascent_m: number;
  descent_m: number;
}

export interface WaypointQuery {
  latitude: number;
  longitude: number;
  height: number;
  arrival: string;
  forecast?: 0 | 1;
}

export interface WaypointNextEvent extends EstimateEvent {
  seconds_after_arrival: number;
}

export interface WaypointBody {
  body: Body;
  utc?: string;
  azimuth_deg: number;
  center_elevation_deg: number;
  angular_radius_deg: number;
  state: 'FULL' | 'PARTIAL' | 'BLOCKED';
  visible_fraction: number;
  horizon_elevation_deg: number;
  next_events: { rise: WaypointNextEvent | null; set: WaypointNextEvent | null };
}

/** GET /api/expedition/waypoint */
export interface WaypointResponse {
  model: string;
  aberration_correction: string;
  request: {
    site_id: string;
    latitude_deg: number;
    longitude_deg: number;
    observer_height_m: number;
    arrival_utc: string;
    forecast: boolean;
  };
  arrival_utc: string;
  lookahead_end_utc: string;
  bodies: Record<Body, WaypointBody>;
  source_sha256: string;
  source_pixel_size_m: number;
  frame: string;
  calculation_seconds: number;
  countdown_basis: string;
  methods: string;
  horizon_coverage: string;
  limitations: string;
}

/** GET /api/capabilities */
export interface Capabilities {
  public: boolean;
  storage: string;
  dates: { first: string; end_exclusive: string };
  terrain: { polar: string; global_resolution: string };
}

export interface BatchSiteRequest {
  site_id: string;
  latitude_deg: number;
  longitude_deg: number;
}

/** POST /api/estimates request. */
export interface BatchEstimatesRequest {
  start: string;
  days: number;
  observer_height_m: number;
  sites: BatchSiteRequest[];
}

export interface BodySeries {
  fraction: number[];
  azimuth_deg: number[];
  elevation_deg: number[];
  angular_radius_deg: number[];
}

export interface BatchEstimateOk {
  site_id: string;
  ok: true;
  request: { site_id: string; latitude_deg: number; longitude_deg: number; observer_height_m: number };
  model: string;
  terrain: string;
  summaries: BodySummary[];
  events: EstimateEvent[];
  /** 180 values, azimuth 0, 2, ..., 358. */
  horizon_elevation_deg: number[];
  series: { sun: BodySeries; earth: BodySeries };
}

export interface BatchEstimateFailure {
  site_id: string;
  ok: false;
  error: string;
}

export type BatchEstimateResult = BatchEstimateOk | BatchEstimateFailure;

/** POST /api/estimates response. Each series array has `samples` hourly entries, both ends inclusive. */
export interface BatchEstimatesResponse {
  start_utc: string;
  end_utc: string;
  days: number;
  step_hours: number;
  samples: number;
  results: BatchEstimateResult[];
}

/** GET /api/terrain/tile. x and y are the tile centre in the south-polar stereographic plane, in metres. */
export interface TerrainTileQuery {
  x: number;
  y: number;
  /** 250 to 320 000 m. */
  span: number;
  size: 65 | 129 | 257 | 513;
}

/** Heights are metres above the reference sphere, north row first, NaN where missing. Edges lie on the tile bounds. */
export interface TerrainTile {
  heights: Float32Array;
  product: string;
  pixelSizeM: number;
}

/** GET /api/terrain/products */
export interface TerrainProduct {
  id: string;
  pixel_size_m: number;
  min_latitude_deg: number;
  max_latitude_deg: number;
  rows: number;
  columns: number;
}

/** GET /api/expedition/drive. `departure` is required (UTC). */
export interface DriveQuery {
  latitude: number;
  longitude: number;
  target_latitude: number;
  target_longitude: number;
  /** 1 to 35 degrees. */
  slope: number;
  /** 0.1 to 10 km/h. */
  speed: number;
  departure: string;
  /** 2 to 48, server default 24. */
  samples?: number;
  sunlight?: 0 | 1;
  /** 0 to 20 m. */
  height?: number;
}

export interface DriveBodyState {
  fraction: number;
  azimuth_deg: number;
  elevation_deg: number;
  next_event: { kind: 'rise' | 'set'; utc: string } | null;
}

export interface DriveEnvironmentPoint {
  index: number;
  distance_m: number;
  elapsed_seconds: number;
  utc: string;
  latitude_deg: number;
  longitude_deg: number;
  elevation_m: number;
  slope_deg: number;
  sun: DriveBodyState | null;
  earth: DriveBodyState | null;
  error?: string;
}

/** Route fields plus the Sun and Earth state at evenly spaced samples along the route. */
export interface DriveResponse extends RouteResponse {
  environment: DriveEnvironmentPoint[];
  environment_model: string;
  environment_horizon_hours: number;
}

/** GET /api/terrain/shadow. x and y are the area centre in the south-polar stereographic plane, in metres. */
export interface ShadowQuery {
  x: number;
  y: number;
  /** 7 680 to 320 000 m. */
  span: number;
  size: 64 | 128 | 192 | 256;
  /** ISO time with a time zone. */
  utc: string;
}

/**
 * One byte per cell, north row first, west column first. 0 is fully shadowed, 1 to 249 partly lit,
 * 250 fully lit, 255 no terrain data. The Sun angles are at the area centre.
 */
export interface ShadowMask {
  cells: Uint8Array;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
}

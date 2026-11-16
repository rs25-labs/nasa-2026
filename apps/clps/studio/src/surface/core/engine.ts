import * as THREE from 'three';
import { OrbitCamera, WalkCamera, type CameraController } from './cameras';
import { SceneFrame } from './frame';
import { CameraPipeline } from './passes';
import { overlayUniforms } from './overlay';
import type { HashView } from './reviewHooks';
import { TerrainField } from './terrainField';
import { createTerrainMaterial } from './terrainMaterial';
import { SurfaceLighting } from '../light/surfaceLighting';
import { createGroundExtension } from '../ground';
import { createSkyExtension } from '../sky';
import type {
  LightingFrame,
  SurfaceContext,
  SurfaceExtension,
  SurfaceStats,
  TerrainMaterial,
  TerrainMaterialFactory,
} from './types';

export type CameraMode = 'walk' | 'orbit' | 'drive';

export interface SurfaceState {
  ready: boolean;
  error: string | null;
}

export interface SkyInput {
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  sunAngularRadiusDeg: number;
  earthAzimuthDeg: number;
  earthElevationDeg: number;
  earthAngularRadiusDeg: number;
  clockIndex: number;
}

declare global {
  interface Window {
    __surfaceReady?: boolean;
    __surfaceStats?: () => SurfaceStats;
    __surfaceScale?: (scale: number) => void;
    /** Review hook: the scene graph, for profiling by hiding parts. */
    __surfaceScene?: THREE.Scene;
    /** Review hook: place the walk camera and read ground height, for scripted walks. */
    __surfaceCamera?: {
      place(x: number, y: number, z: number, yawDeg: number, pitchDeg: number): void;
      heightAt(x: number, z: number): number;
      position(): [number, number, number];
    };
  }
}

const FRAME_WINDOW = 120;

/** GPU time of a frame from EXT_disjoint_timer_query_webgl2, read back a few frames late. */
class GpuTimer {
  private readonly gl: WebGL2RenderingContext;
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pending: WebGLQuery[] = [];
  private readonly samples: number[] = [];
  private active: WebGLQuery | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }

  get available(): boolean {
    return this.ext !== null;
  }

  begin(): void {
    if (!this.ext || this.active || this.pending.length > 6) return;
    const query = this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = query;
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  poll(): void {
    if (!this.ext) return;
    const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length > 0) {
      const query = this.pending[0] as WebGLQuery;
      if (!this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) {
        this.samples.push((this.gl.getQueryParameter(query, this.gl.QUERY_RESULT) as number) / 1e6);
        if (this.samples.length > 20) this.samples.shift();
      }
      this.gl.deleteQuery(query);
    }
  }

  get meanMs(): number {
    if (this.samples.length === 0) return -1;
    return this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length;
  }
}

const RAD = Math.PI / 180;
const NEAR_M = 0.1;
const FAR_M = 600_000;
const MAX_PIXELS = 1920 * 1200;
/** Frame pacing: when more than this share of recent frames run late, the render resolution steps down. */
const SLOW_FRAME_MS = 24;
const PACING_WINDOW = 90;
const PACING_SLOW_SHARE = 0.3;
const PACING_STEP = 0.85;
const PACING_FLOOR = 0.45;
const SETTLE_FRAMES = 12;
const SETTLE_EV = 0.02;

export class SurfaceEngine {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, NEAR_M, FAR_M);
  private readonly pipeline: CameraPipeline;
  private readonly terrain: TerrainField;
  private readonly terrainMaterial: TerrainMaterial;
  private readonly walk = new WalkCamera();
  private readonly orbit = new OrbitCamera();
  private controller: CameraController = this.walk;
  private custom: CameraController | null = null;
  private mode: CameraMode = 'walk';
  private readonly keys = new Set<string>();
  private readonly extensions: SurfaceExtension[] = [];
  private readonly surfaceLighting = new SurfaceLighting();
  private readonly lighting: LightingFrame = {
    sunDirection: new THREE.Vector3(0, -1, 0),
    sunAngularRadiusRad: 0.0047,
    earthDirection: new THREE.Vector3(0, -1, 0),
    earthAngularRadiusRad: 0.0166,
    clockIndex: 0,
  };
  private frame: SceneFrame | null = null;
  private lightingKnown = false;
  private eyeHeight = 2;
  /** Fraction of the canvas resolution the scene is drawn at (the last resort for frame time). */
  private renderScale = 1;
  /** Lowered automatically while frames run late, so motion stays smooth on slower displays and GPUs. */
  private autoScale = 1;
  private pacingFrames = 0;
  private pacingSlow = 0;
  private needsInitialView = true;
  private sunBearingDeg = 0;
  private readyFrames = 0;
  private ready = false;
  private error: string | null = null;
  private rafId = 0;
  private running = false;
  private lastTime = 0;
  private readonly frameIntervals: number[] = [];
  private readonly cpuTimes: number[] = [];
  private readonly gpuTimer: GpuTimer;
  private drawCalls = 0;
  private triangles = 0;
  private width = 0;
  private height = 0;
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private readonly resizeObserver: ResizeObserver;
  private readonly groundScratch = new THREE.Vector3();

  constructor(
    canvas: HTMLCanvasElement,
    private readonly onState: (state: SurfaceState) => void,
    materialFactory: TerrainMaterialFactory = createTerrainMaterial,
  ) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
    });
    this.renderer.autoClear = true;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.info.autoReset = false;
    this.gpuTimer = new GpuTimer(this.renderer);
    this.pipeline = new CameraPipeline(2, 2);
    this.terrainMaterial = materialFactory();
    this.terrain = new TerrainField(this.terrainMaterial.material);
    this.scene.add(this.terrain.group);
    this.addExtension(this.surfaceLighting);
    this.addExtension(createGroundExtension());
    this.addExtension(createSkyExtension());
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.__surfaceStats = () => this.stats();
    window.__surfaceScale = (scale: number) => this.setRenderScale(scale);
    window.__surfaceCamera = {
      place: (x, y, z, yaw, pitch) => this.walk.place(x, y, z, yaw, pitch),
      heightAt: (x, z) => this.terrain.heightAt(x, z),
      position: () => [this.walk.position.x, this.walk.position.y, this.walk.position.z],
    };
    window.__surfaceScene = this.scene;
    window.__surfaceReady = false;
    canvas.dataset.surfaceReady = 'false';
    this.resize();
    this.start();
  }

  get cameraMode(): CameraMode {
    return this.mode;
  }

  /** Register lighting, ground, sky or rover code. Call before the first frame of use. */
  addExtension(extension: SurfaceExtension): void {
    const context: SurfaceContext = { renderer: this.renderer, scene: this.scene, camera: this.camera, ground: this.terrain, terrain: this.terrain };
    extension.attach(context);
    this.extensions.push(extension);
  }

  /** Detach an extension added with `addExtension` (a drive controller that is replaced removes its parts). */
  removeExtension(extension: SurfaceExtension): void {
    const index = this.extensions.indexOf(extension);
    if (index < 0) return;
    this.extensions.splice(index, 1);
    extension.dispose();
  }

  setSite(latitudeDeg: number, longitudeDeg: number): void {
    this.frame = new SceneFrame(latitudeDeg, longitudeDeg);
    this.terrain.setSite(this.frame);
    this.needsInitialView = true;
    this.invalidate();
  }

  setRenderScale(scale: number): void {
    this.renderScale = Math.max(0.5, Math.min(1, scale));
    this.width = 0;
    this.resize();
  }

  setEyeHeight(metres: number): void {
    this.eyeHeight = metres;
  }

  setSky(input: SkyInput | null): void {
    const frame = this.frame;
    if (!frame) return;
    const previous = this.groundScratch.copy(this.lighting.sunDirection);
    if (input) {
      frame.skyDirection(input.sunAzimuthDeg, input.sunElevationDeg, this.lighting.sunDirection);
      frame.skyDirection(input.earthAzimuthDeg, input.earthElevationDeg, this.lighting.earthDirection);
      this.lighting.sunAngularRadiusRad = input.sunAngularRadiusDeg * RAD;
      this.lighting.earthAngularRadiusRad = input.earthAngularRadiusDeg * RAD;
      this.lighting.clockIndex = input.clockIndex;
      this.sunBearingDeg = input.sunAzimuthDeg + frame.longitudeDeg;
    } else {
      this.lighting.sunDirection.set(0, -1, 0);
    }
    const jumped = !this.lightingKnown || previous.angleTo(this.lighting.sunDirection) > 1 * RAD;
    this.lightingKnown = input !== null;
    if (jumped) this.invalidate();
  }

  applyView(view: HashView): void {
    if (view.fov !== null) {
      this.camera.fov = view.fov;
      this.camera.updateProjectionMatrix();
    }
    if (view.cam) {
      this.walk.place(...view.cam);
      this.setMode('walk');
      this.needsInitialView = false;
    } else if (view.orbit) {
      this.orbit.place(...view.orbit);
      this.setMode('orbit');
      this.needsInitialView = false;
    }
    this.invalidate();
  }

  setMode(mode: CameraMode): void {
    if (mode === 'drive' && !this.custom) return;
    this.mode = mode;
    this.controller = mode === 'walk' ? this.walk : mode === 'orbit' ? this.orbit : (this.custom as CameraController);
  }

  /** Hand the camera to code outside the engine (the drive cameras). The controller also runs that code's per-frame update. */
  useController(controller: CameraController | null): void {
    this.custom = controller;
    if (controller) {
      this.needsInitialView = false;
      this.setMode('drive');
    } else {
      this.setMode('walk');
    }
    this.invalidate();
  }

  /** The scene point under a screen position, or null when the ray misses the loaded ground. */
  pickGround(clientX: number, clientY: number): { x: number; y: number; z: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const { origin, direction } = ray.ray;
    const heightAbove = (t: number): number => {
      const x = origin.x + direction.x * t;
      const z = origin.z + direction.z * t;
      const ground = this.terrain.heightAt(x, z);
      return Number.isFinite(ground) ? origin.y + direction.y * t - ground : Number.NaN;
    };
    let previous = 0;
    let step = 2;
    for (let t = 2; t < 60_000; t += step) {
      const above = heightAbove(t);
      if (Number.isFinite(above) && above <= 0) {
        let low = previous;
        let high = t;
        for (let k = 0; k < 24; k += 1) {
          const mid = 0.5 * (low + high);
          const value = heightAbove(mid);
          if (Number.isFinite(value) && value > 0) low = mid;
          else high = mid;
        }
        const x = origin.x + direction.x * high;
        const z = origin.z + direction.z * high;
        return { x, y: this.terrain.heightAt(x, z), z };
      }
      previous = t;
      step = Math.max(2, t * 0.01);
    }
    return null;
  }

  get exposure(): number {
    return this.pipeline.exposure;
  }

  get cameraPosition(): THREE.Vector3 {
    return this.camera.position;
  }

  get fov(): number {
    return this.camera.fov;
  }

  setFov(degrees: number): void {
    if (Math.abs(this.camera.fov - degrees) < 1e-3) return;
    this.camera.fov = degrees;
    this.camera.updateProjectionMatrix();
  }

  get sceneRoot(): THREE.Scene {
    return this.scene;
  }

  /** Bilinear-on-triangles height at a scene position; NaN where nothing is loaded. */
  heightAt(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    return this.terrain.normalAt(x, z, out);
  }

  stats(): SurfaceStats {
    const intervals = this.frameIntervals;
    const mean = (values: number[]): number => (values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length);
    const frameMs = mean(intervals);
    return {
      fps: frameMs > 0 ? 1000 / frameMs : 0,
      frameMs,
      frameMaxMs: intervals.length === 0 ? 0 : Math.max(...intervals),
      cpuMs: mean(this.cpuTimes),
      gpuMs: this.gpuTimer.meanMs,
      drawCalls: this.drawCalls,
      triangles: this.triangles,
      tilesLoaded: this.terrain.tilesLoaded,
      exposure: this.pipeline.exposure,
    };
  }

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const extension of this.extensions) extension.dispose();
    this.terrain.dispose();
    this.terrainMaterial.dispose();
    this.pipeline.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    window.__surfaceReady = false;
    delete window.__surfaceStats;
    delete window.__surfaceCamera;
    delete window.__surfaceScale;
    delete window.__surfaceScene;
  }

  private invalidate(): void {
    this.readyFrames = 0;
    this.setReady(false);
  }

  private setReady(value: boolean): void {
    if (value === this.ready) return;
    this.ready = value;
    window.__surfaceReady = value;
    this.canvas.dataset.surfaceReady = String(value);
    this.emit();
  }

  private emit(): void {
    this.onState({ ready: this.ready, error: this.error });
  }

  private resize(): void {
    const cssWidth = Math.max(1, this.canvas.clientWidth);
    const cssHeight = Math.max(1, this.canvas.clientHeight);
    let ratio = Math.min(window.devicePixelRatio || 1, 2);
    ratio = Math.min(ratio, Math.sqrt(MAX_PIXELS / (cssWidth * cssHeight)));
    const width = Math.max(1, Math.round(cssWidth * ratio));
    const height = Math.max(1, Math.round(cssHeight * ratio));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    const scale = this.renderScale * this.autoScale;
    this.pipeline.setSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private start(): void {
    if (this.running || document.hidden) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private readonly tick = (time: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);
    const interval = time - this.lastTime;
    const delta = Math.min(0.1, Math.max(0.0001, interval / 1000));
    this.lastTime = time;
    this.frameIntervals.push(interval);
    this.pace(interval);
    if (this.frameIntervals.length > FRAME_WINDOW) this.frameIntervals.shift();
    const started = performance.now();
    this.step(delta, time);
    this.cpuTimes.push(performance.now() - started);
    if (this.cpuTimes.length > FRAME_WINDOW) this.cpuTimes.shift();
    this.gpuTimer.poll();
  };

  private pace(interval: number): void {
    // A hidden tab or a long stall is not a slow GPU.
    if (interval > 250 || !this.ready) return;
    this.pacingFrames += 1;
    if (interval > SLOW_FRAME_MS) this.pacingSlow += 1;
    if (this.pacingFrames < PACING_WINDOW) return;
    const slowShare = this.pacingSlow / this.pacingFrames;
    this.pacingFrames = 0;
    this.pacingSlow = 0;
    if (slowShare <= PACING_SLOW_SHARE || this.autoScale <= PACING_FLOOR) return;
    this.autoScale = Math.max(PACING_FLOOR, this.autoScale * PACING_STEP);
    this.width = 0;
    this.resize();
  }

  private step(delta: number, now: number): void {
    if (this.terrain.error !== this.error && this.terrain.error) {
      this.error = this.terrain.error;
      this.emit();
    }
    this.controller.update(delta, this.keys, this.terrain);
    if (this.needsInitialView && this.lightingKnown && this.mode === 'walk') {
      this.walk.place(0, this.eyeHeight, 0, this.sunBearingDeg, -6);
      this.needsInitialView = false;
    }
    this.controller.apply(this.camera);
    this.terrain.update(this.camera.position.x, this.camera.position.z);
    this.terrainMaterial.update(this.lighting);
    this.gpuTimer.begin();
    for (const extension of this.extensions) extension.update(this.lighting, delta);

    const settled =
      this.lightingKnown &&
      this.surfaceLighting.current &&
      !this.needsInitialView &&
      this.extensions.every((extension) => extension.isReady?.() ?? true) &&
      this.terrain.isSettled(this.camera.position.x, this.camera.position.z);
    if (settled) this.readyFrames += 1;
    else this.readyFrames = 0;
    const snap = this.readyFrames <= SETTLE_FRAMES / 2;

    this.renderer.info.reset();
    const stateKey = `${this.lighting.clockIndex}|${this.lighting.sunDirection.x},${this.lighting.sunDirection.y},${this.lighting.sunDirection.z}|${this.terrain.version}|${settled}`;
    this.pipeline.setSun(this.lighting.sunDirection, this.lighting.sunAngularRadiusRad);
    this.pipeline.beginScene(this.camera, stateKey);
    this.renderer.setRenderTarget(this.pipeline.hdr);
    this.renderer.render(this.scene, this.camera);
    this.pipeline.endScene(this.camera);
    this.drawCalls = this.renderer.info.render.calls;
    this.triangles = this.renderer.info.render.triangles;
    overlayUniforms.lmlExposure.value = this.pipeline.exposureTexture;
    this.pipeline.finish(this.renderer, this.camera, delta, snap, now);
    this.gpuTimer.end();

    // Once ready the view stays ready while every level is installed and baked: exposure adaptation noise (a metering read-back
    // changing by a few hundredths of a stop) must not flash the loading label or reset the ready flag. Any real change calls invalidate().
    this.setReady(
      settled && this.readyFrames >= SETTLE_FRAMES && (this.ready || this.pipeline.exposureChange < SETTLE_EV) && this.pipeline.converged,
    );
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) this.stop();
    else this.start();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.dragging = true;
    this.lastPointer = { x: event.clientX, y: event.clientY };
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.controller.drag(event.clientX - this.lastPointer.x, event.clientY - this.lastPointer.y);
    this.lastPointer = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.dragging = false;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.controller.wheel(event.deltaY);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    this.keys.add(event.key.toLowerCase());
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
  };
}

import * as THREE from 'three';
import { sharedLight } from '../light/uniforms';

/** Metering and exposure constants. Exposure is the only brightness control. */
export const EXPOSURE = {
  /** Scene-referred value the metered average maps to. */
  key: 0.18,
  /** Pixels darker than this count as this dark when averaging (radiance, linear). Low enough for earthshine. */
  luminanceFloor: 1e-8,
  /** Exposure limits as multipliers: from full sunlight to a crater floor lit only by earthshine. */
  min: 1.5,
  max: 2e5,
  /**
   * Highlight protection: exposure never goes above the value that puts the brightest metered block at this
   * radiance after exposure. A camera exposing for a scene that is mostly shadow lets a small lit patch run into the shoulder of the filmic
   * curve rather than leave the whole frame black, so the limit sits just under white. Pixels above
   * `highlightIgnore` (the Sun's disc) do not count.
   */
  highlightWhite: 5,
  highlightIgnore: 1,
  /** Adaptation time constant in seconds. */
  adaptSeconds: 1,
};

const METER_WIDTH = 128;
const METER_HEIGHT = 72;
const BLOCK = 8;

const fullscreenVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const meterFirstFragment = /* glsl */ `
uniform sampler2D source;
uniform float luminanceFloor;
uniform float highlightIgnore;
varying vec2 vUv;
void main() {
  vec2 cell = vec2(1.0 / ${METER_WIDTH}.0, 1.0 / ${METER_HEIGHT}.0);
  float sumLog = 0.0;
  float sumWeight = 0.0;
  float sumBlock = 0.0;
  float countBlock = 0.0;
  for (int y = 0; y < ${BLOCK}; y++) {
    for (int x = 0; x < ${BLOCK}; x++) {
      vec2 uv = vUv - 0.5 * cell + (vec2(float(x), float(y)) + 0.5) / ${BLOCK}.0 * cell;
      vec4 c = texture2D(source, uv);
      float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec2 p = (uv - 0.5) * 2.0;
      float weight = exp(-dot(p, p) / (2.0 * 0.5 * 0.5)) * c.a;
      sumLog += weight * log2(max(lum, luminanceFloor));
      sumWeight += weight;
      if (c.a > 0.5 && lum < highlightIgnore) {
        sumBlock += lum;
        countBlock += 1.0;
      }
    }
  }
  gl_FragColor = vec4(sumLog, sumWeight, sumBlock / max(countBlock, 1.0), 1.0);
}`;

/** Averages a block of texels of the previous stage into one. */
function meterReduceFragment(blockX: number, blockY: number): string {
  return /* glsl */ `
uniform sampler2D source;
uniform vec2 sourceSize;
varying vec2 vUv;
void main() {
  vec2 origin = floor(vUv * sourceSize / vec2(${blockX}.0, ${blockY}.0)) * vec2(${blockX}.0, ${blockY}.0);
  vec2 sum = vec2(0.0);
  float peak = 0.0;
  for (int y = 0; y < ${blockY}; y++) {
    for (int x = 0; x < ${blockX}; x++) {
      vec3 texel = texture2D(source, (origin + vec2(float(x), float(y)) + 0.5) / sourceSize).rgb;
      sum += texel.rg;
      peak = max(peak, texel.b);
    }
  }
  gl_FragColor = vec4(sum / ${blockX * blockY}.0, peak, 1.0);
}`;
}

const exposureFragment = /* glsl */ `
uniform sampler2D metered;
uniform sampler2D previous;
uniform float deltaSeconds;
uniform float snap;
uniform float key;
uniform float adaptSeconds;
uniform float minLog;
uniform float maxLog;
uniform float highlightWhite;
void main() {
  vec3 m = texture2D(metered, vec2(0.5)).rgb;
  float prevLog = texture2D(previous, vec2(0.5)).g;
  float target = prevLog;
  if (m.g > 0.25) {
    float average = log2(key) - m.r / m.g;
    float protectHighlights = m.b > 0.0 ? log2(highlightWhite / m.b) : maxLog;
    target = clamp(min(average, protectHighlights), minLog, maxLog);
  }
  float mixAmount = snap > 0.5 ? 1.0 : 1.0 - exp(-deltaSeconds / adaptSeconds);
  float current = mix(prevLog, target, mixAmount);
  gl_FragColor = vec4(exp2(current), current, 0.0, 1.0);
}`;

/**
 * Camera glare: the veil a real lens adds around the Sun. A point-spread function with a power-law wing,
 *   psf(t) = c / (t^2 + t0^2)^1.5   per steradian, c = f * t0 / (2 pi) so that the wing carries a fraction f of the Sun's light,
 * is added to the frame as radiance E_sun * psf(angle to the Sun), scaled by the fraction of the Sun's disc that is not behind
 * terrain. It is a few hundred-thousandths of the Sun's energy: a tight bright core that falls off as the cube of the angle, not
 * a fog ball. (Sensor and lens flare structure beyond this is not modelled.)
 */
export const GLARE = {
  /** Fraction of the Sun's light scattered into the wing. */
  fraction: 5.0e-6,
  /** Core angle of the point-spread function, radians (about 2 pixels of a 50 degree, 1440 pixel frame). */
  coreRad: 0.0013,
};

const sunVisibilityFragment = /* glsl */ `
uniform sampler2D source;
uniform vec2 sunNdc;
uniform vec2 sunNdcRadius;
uniform float sunInFront;
varying vec2 vUv;
void main() {
  if (sunInFront < 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float visible = 0.0;
  float count = 0.0;
  for (int k = 0; k < 13; k++) {
    float angle = 2.399963 * float(k);
    float radius = k == 0 ? 0.0 : sqrt(float(k) / 12.0);
    vec2 ndc = sunNdc + sunNdcRadius * radius * vec2(cos(angle), sin(angle));
    count += 1.0;
    if (max(abs(ndc.x), abs(ndc.y)) > 0.999) {
      visible += 1.0;
    } else {
      visible += 1.0 - texture2D(source, ndc * 0.5 + 0.5).a;
    }
  }
  gl_FragColor = vec4(visible / count, 0.0, 0.0, 1.0);
}`;

const temporalFragment = /* glsl */ `
uniform sampler2D current;
uniform sampler2D history;
uniform sampler2D depthTexture;
uniform sampler2D exposureTexture;
uniform vec2 texel;
uniform float logFar;
uniform vec2 tanHalf;
uniform vec2 previousTanHalf;
uniform mat3 worldFromView;
uniform mat3 previousViewFromWorld;
uniform vec3 cameraDelta;
uniform float accumulated;
uniform float still;
varying vec2 vUv;
const float FREEZE_AFTER = 16.0;

vec3 compress(vec3 c, float e) {
  vec3 x = c * e;
  return x / (1.0 + x);
}

vec3 decompress(vec3 y, float e) {
  y = min(y, vec3(0.9995));
  return y / (1.0 - y) / e;
}

void main() {
  vec3 now = texture2D(current, vUv).rgb;
  if (accumulated < 0.5) {
    gl_FragColor = vec4(now, 1.0);
    return;
  }
  float e = texture2D(exposureTexture, vec2(0.5)).r;
  float depth = texture2D(depthTexture, vUv).r;
  float w = exp2(depth * logFar) - 1.0;
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 viewPosition = vec3(ndc * tanHalf, -1.0) * w;
  vec3 relative = worldFromView * viewPosition + cameraDelta;
  vec3 previousView = previousViewFromWorld * relative;
  vec2 previousNdc = previousView.xy / max(-previousView.z, 1.0e-3) / previousTanHalf;
  vec2 previousUv = previousNdc * 0.5 + 0.5;
  bool inside = previousView.z < 0.0 && all(greaterThan(previousUv, vec2(0.0))) && all(lessThan(previousUv, vec2(1.0)));
  if (!inside) {
    gl_FragColor = vec4(now, 1.0);
    return;
  }
  vec3 past = texture2D(history, previousUv).rgb;

  // Where the history disagrees with every neighbour of the current frame something moved: pull it back toward the frame.
  vec3 nowC = compress(now, e);
  vec3 low = nowC;
  vec3 high = nowC;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      if (x == 0 && y == 0) continue;
      vec3 c = compress(texture2D(current, vUv + vec2(float(x), float(y)) * texel).rgb, e);
      low = min(low, c);
      high = max(high, c);
    }
  }
  bool settling = still > 0.5;
  vec3 pad = (settling ? 0.5 : 0.1) * (high - low) + (settling ? 0.01 : 0.004);
  vec3 pastC = compress(past, e);
  vec3 clamped = clamp(pastC, low - pad, high + pad);
  bool outside = any(notEqual(clamped, pastC));
  float alpha;
  if (settling) {
    alpha = accumulated < FREEZE_AFTER ? 1.0 / (accumulated + 1.0) : (outside ? 0.2 : 0.0);
  } else {
    alpha = 0.1;
  }
  vec3 blended = mix(clamped, nowC, alpha);
  gl_FragColor = vec4(decompress(blended, e), 1.0);
}`;

const toneMapFragment = /* glsl */ `
uniform sampler2D hdr;
uniform sampler2D exposureTexture;
uniform sampler2D sunVisibility;
uniform vec3 sunView;
uniform vec2 tanHalf;
uniform float glareCore;
uniform float glareScale;
varying vec2 vUv;
const mat3 ACESInputMat = mat3(
  vec3(0.59719, 0.07600, 0.02840),
  vec3(0.35458, 0.90834, 0.13383),
  vec3(0.04823, 0.01566, 0.83777));
const mat3 ACESOutputMat = mat3(
  vec3(1.60475, -0.10208, -0.00327),
  vec3(-0.53108, 1.10813, -0.07276),
  vec3(-0.07367, -0.00605, 1.07602));
vec3 rrtAndOdtFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFilmic(vec3 color) {
  color = ACESInputMat * (color / 0.6);
  color = rrtAndOdtFit(color);
  return clamp(ACESOutputMat * color, 0.0, 1.0);
}
vec3 srgbEncode(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  float exposure = texture2D(exposureTexture, vec2(0.5)).r;
  vec3 color = texture2D(hdr, vUv).rgb;
  if (glareScale > 0.0 && sunView.z < -0.02) {
    vec3 ray = normalize(vec3((vUv * 2.0 - 1.0) * tanHalf, -1.0));
    float cosine = clamp(dot(ray, sunView), -1.0, 1.0);
    // Angle to the Sun; acos loses precision near zero, so use the chord for small angles.
    vec3 chord = ray - sunView;
    float angle = cosine > 0.9 ? 2.0 * asin(min(0.5 * length(chord), 1.0)) : acos(cosine);
    float visible = texture2D(sunVisibility, vec2(0.5)).r;
    float wing = glareScale / pow(angle * angle + glareCore * glareCore, 1.5);
    color += vec3(wing * visible) * step(0.0, cosine);
  }
  vec3 mapped = srgbEncode(acesFilmic(color * exposure));
  float noise = hash(gl_FragCoord.xy) + hash(gl_FragCoord.xy + 17.0) - 1.0;
  gl_FragColor = vec4(mapped + noise / 255.0, 1.0);
}`;

class FullscreenPass {
  readonly material: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mesh: THREE.Mesh;

  constructor(geometry: THREE.BufferGeometry, fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null): void {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.material.dispose();
  }
}

function meterTarget(width: number, height: number, type: THREE.TextureDataType = THREE.FloatType): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(width, height, {
    type,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    generateMipmaps: false,
  });
}

function halton(index: number, base: number): number {
  let result = 0;
  let fraction = 1 / base;
  let i = index;
  while (i > 0) {
    result += fraction * (i % base);
    i = Math.floor(i / base);
    fraction /= base;
  }
  return result;
}

/** Sub-pixel camera offsets (pixels): 16 Halton points, so the 16-frame average is the same every time. */
const JITTER = Array.from({ length: 16 }, (_, k) => [halton(k + 1, 2) - 0.5, halton(k + 1, 3) - 0.5] as const);
const JITTER_FRAMES = JITTER.length;

/** What a frame's pixels depend on: when it changes the accumulated image is dropped. */
interface Pose {
  matrix: THREE.Matrix4;
  fov: number;
  aspect: number;
  key: string;
}

/**
 * HDR scene target, GPU luminance metering, adapting exposure, temporal anti-aliasing and the filmic final pass.
 *
 * Edges are smoothed by temporal accumulation, not multisampling: the camera is offset by a sub-pixel amount each frame and
 * the frames are averaged (history reprojected through the depth buffer while the camera moves, neighbourhood-clamped so
 * moving things do not smear). A still camera converges to the exact mean of 16 jittered frames, then holds, so a still
 * view is identical every time; thin sunlit crests, which a single sample per pixel renders as dashes, become continuous.
 */
export class CameraPipeline {
  readonly hdr: THREE.WebGLRenderTarget;
  private history: THREE.WebGLRenderTarget[];
  private historyIndex = 0;
  private readonly triangle: THREE.BufferGeometry;
  private readonly meterA = meterTarget(METER_WIDTH, METER_HEIGHT);
  private readonly meterB = meterTarget(METER_WIDTH / BLOCK, METER_HEIGHT / BLOCK);
  private readonly meterC = meterTarget(1, 1);
  private readonly sunTarget = meterTarget(1, 1);
  private exposureTargets = [meterTarget(1, 1), meterTarget(1, 1)];
  private exposureIndex = 0;
  private readonly firstPass: FullscreenPass;
  private readonly secondPass: FullscreenPass;
  private readonly thirdPass: FullscreenPass;
  private readonly exposurePass: FullscreenPass;
  private readonly temporalPass: FullscreenPass;
  private readonly sunPass: FullscreenPass;
  private readonly toneMapPass: FullscreenPass;
  private readonly readback = new Float32Array(4);
  private reading = false;
  private lastRead = 0;
  private width: number;
  private height: number;
  private previous: Pose | null = null;
  private accumulated = 0;
  private readonly sunView = new THREE.Vector3(0, 0, -1);
  private readonly worldFromView = new THREE.Matrix3();
  private readonly previousViewFromWorld = new THREE.Matrix3();
  private readonly previousRotation = new THREE.Matrix4();
  private readonly previousPosition = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly scratch = new THREE.Matrix4();
  private sunRadiusRad = 0.0047;
  private sunDirection = new THREE.Vector3(0, 1, 0);

  /** The exposure texture the next tone map uses (red channel is the multiplier). */
  get exposureTexture(): THREE.Texture {
    return (this.exposureTargets[this.exposureIndex] as THREE.WebGLRenderTarget).texture;
  }

  /** Latest exposure multiplier read back from the GPU, and the change since the previous read. */
  exposure = 1;
  exposureChange = Number.POSITIVE_INFINITY;

  /** True once a still view has accumulated all of its jittered frames. */
  get converged(): boolean {
    return this.accumulated >= JITTER_FRAMES;
  }

  constructor(width: number, height: number, _samples = 0) {
    this.width = width;
    this.height = height;
    const depth = new THREE.DepthTexture(width, height);
    depth.type = THREE.UnsignedIntType;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    this.hdr = new THREE.WebGLRenderTarget(width, height, {
      // Half float: half the bandwidth of the biggest buffers in the frame. Earthshine and bounce light sit below the half-float
      // normal range (6e-5), where the step is 6e-8 absolute: under 6 per cent of the faintest lit surface and a fraction of a
      // display level after exposure, below the dither.
      type: THREE.HalfFloatType,
      depthBuffer: true,
      depthTexture: depth,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    this.history = [this.historyTarget(width, height), this.historyTarget(width, height)];
    this.triangle = new THREE.BufferGeometry();
    this.triangle.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.firstPass = new FullscreenPass(this.triangle, meterFirstFragment, {
      source: { value: this.hdr.texture },
      luminanceFloor: { value: EXPOSURE.luminanceFloor },
      highlightIgnore: { value: EXPOSURE.highlightIgnore },
    });
    this.secondPass = new FullscreenPass(this.triangle, meterReduceFragment(BLOCK, BLOCK), {
      source: { value: this.meterA.texture },
      sourceSize: { value: new THREE.Vector2(METER_WIDTH, METER_HEIGHT) },
    });
    this.thirdPass = new FullscreenPass(this.triangle, meterReduceFragment(METER_WIDTH / BLOCK, METER_HEIGHT / BLOCK), {
      source: { value: this.meterB.texture },
      sourceSize: { value: new THREE.Vector2(METER_WIDTH / BLOCK, METER_HEIGHT / BLOCK) },
    });
    this.exposurePass = new FullscreenPass(this.triangle, exposureFragment, {
      metered: { value: this.meterC.texture },
      previous: { value: this.exposureTargets[0]?.texture },
      deltaSeconds: { value: 0 },
      snap: { value: 1 },
      key: { value: EXPOSURE.key },
      adaptSeconds: { value: EXPOSURE.adaptSeconds },
      minLog: { value: Math.log2(EXPOSURE.min) },
      maxLog: { value: Math.log2(EXPOSURE.max) },
      highlightWhite: { value: EXPOSURE.highlightWhite },
    });
    this.temporalPass = new FullscreenPass(this.triangle, temporalFragment, {
      current: { value: this.hdr.texture },
      history: { value: null },
      depthTexture: { value: depth },
      exposureTexture: { value: this.exposureTargets[0]?.texture },
      texel: { value: new THREE.Vector2(1 / width, 1 / height) },
      logFar: { value: Math.log2(FAR_FOR_DEPTH + 1) },
      tanHalf: { value: new THREE.Vector2(1, 1) },
      previousTanHalf: { value: new THREE.Vector2(1, 1) },
      worldFromView: { value: this.worldFromView },
      previousViewFromWorld: { value: this.previousViewFromWorld },
      cameraDelta: { value: new THREE.Vector3() },
      accumulated: { value: 0 },
      still: { value: 0 },
    });
    this.sunPass = new FullscreenPass(this.triangle, sunVisibilityFragment, {
      source: { value: this.hdr.texture },
      sunNdc: { value: new THREE.Vector2() },
      sunNdcRadius: { value: new THREE.Vector2() },
      sunInFront: { value: 0 },
    });
    this.toneMapPass = new FullscreenPass(this.triangle, toneMapFragment, {
      hdr: { value: null },
      exposureTexture: { value: this.exposureTargets[0]?.texture },
      sunVisibility: { value: this.sunTarget.texture },
      sunView: { value: this.sunView },
      tanHalf: { value: new THREE.Vector2(1, 1) },
      glareCore: { value: GLARE.coreRad },
      glareScale: { value: 0 },
    });
  }

  private historyTarget(width: number, height: number): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.hdr.setSize(width, height);
    for (const target of this.history) target.setSize(width, height);
    (this.temporalPass.material.uniforms.texel as THREE.IUniform<THREE.Vector2>).value.set(1 / width, 1 / height);
    this.accumulated = 0;
    this.previous = null;
  }

  /**
   * Offset the camera by this frame's sub-pixel jitter. Call right before drawing the scene, and `endScene` right after.
   * `stateKey` changes whenever something other than the camera changes what the picture shows (the Sun, the clock).
   */
  beginScene(camera: THREE.PerspectiveCamera, stateKey: string): void {
    camera.updateMatrixWorld(true);
    const pose: Pose = { matrix: camera.matrixWorld.clone(), fov: camera.fov, aspect: camera.aspect, key: stateKey };
    const still =
      this.previous !== null &&
      this.previous.fov === pose.fov &&
      this.previous.aspect === pose.aspect &&
      this.previous.key === pose.key &&
      this.previous.matrix.equals(pose.matrix);
    this.stillNow = still;
    if (still) this.accumulated = Math.min(this.accumulated, 1e6);
    else if (this.previous === null) this.accumulated = 0;
    this.pendingPose = pose;
    const jitter = still ? JITTER[this.accumulated % JITTER_FRAMES] ?? [0, 0] : (JITTER[this.frameIndex % JITTER_FRAMES] ?? [0, 0]);
    this.frameIndex += 1;
    sharedLight.lmlShadowTurn.value = (((still ? this.accumulated : this.frameIndex) % JITTER_FRAMES) * 0.6180339887) % 1;
    camera.setViewOffset(this.width, this.height, jitter[0], jitter[1], this.width, this.height);
  }

  private stillNow = false;
  private pendingPose: Pose | null = null;
  private frameIndex = 0;

  endScene(camera: THREE.PerspectiveCamera): void {
    camera.clearViewOffset();
  }

  setSun(direction: THREE.Vector3, angularRadiusRad: number): void {
    this.sunDirection.copy(direction);
    this.sunRadiusRad = angularRadiusRad;
  }

  /** Meter the finished HDR target, update exposure, resolve the temporal history and draw the result to the canvas. */
  finish(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, deltaSeconds: number, snap: boolean, now: number): void {
    this.firstPass.render(renderer, this.meterA);
    this.secondPass.render(renderer, this.meterB);
    this.thirdPass.render(renderer, this.meterC);
    const previousExposure = this.exposureTargets[this.exposureIndex] as THREE.WebGLRenderTarget;
    const next = this.exposureTargets[1 - this.exposureIndex] as THREE.WebGLRenderTarget;
    const uniforms = this.exposurePass.material.uniforms;
    (uniforms.previous as THREE.IUniform).value = previousExposure.texture;
    (uniforms.deltaSeconds as THREE.IUniform).value = deltaSeconds;
    (uniforms.snap as THREE.IUniform).value = snap ? 1 : 0;
    this.exposurePass.render(renderer, next);
    this.exposureIndex = 1 - this.exposureIndex;

    // Temporal resolve.
    const pose = this.pendingPose as Pose;
    const halfTan = Math.tan((camera.fov * Math.PI) / 360);
    const tan = new THREE.Vector2(halfTan * camera.aspect, halfTan);
    const t = this.temporalPass.material.uniforms;
    const readIndex = this.historyIndex;
    const writeIndex = 1 - readIndex;
    (t.history as THREE.IUniform).value = (this.history[readIndex] as THREE.WebGLRenderTarget).texture;
    (t.exposureTexture as THREE.IUniform).value = next.texture;
    (t.tanHalf as THREE.IUniform<THREE.Vector2>).value.copy(tan);
    if (this.previous) {
      const previousHalf = Math.tan((this.previous.fov * Math.PI) / 360);
      (t.previousTanHalf as THREE.IUniform<THREE.Vector2>).value.set(previousHalf * this.previous.aspect, previousHalf);
      this.previousRotation.extractRotation(this.previous.matrix);
      this.previousPosition.setFromMatrixPosition(this.previous.matrix);
      this.previousViewFromWorld.setFromMatrix4(this.previousRotation.transpose());
    }
    this.worldFromView.setFromMatrix4(this.scratch.extractRotation(pose.matrix));
    this.position.setFromMatrixPosition(pose.matrix);
    (t.cameraDelta as THREE.IUniform<THREE.Vector3>).value.copy(this.position).sub(this.previousPosition);
    (t.accumulated as THREE.IUniform).value = this.previous === null ? 0 : this.stillNow ? this.accumulated : 1;
    (t.still as THREE.IUniform).value = this.stillNow ? 1 : 0;
    this.temporalPass.render(renderer, this.history[writeIndex] as THREE.WebGLRenderTarget);
    this.historyIndex = writeIndex;
    this.accumulated = this.stillNow ? this.accumulated + 1 : 1;
    this.previous = pose;

    // Where the Sun is on screen and how much of it terrain leaves visible.
    const viewMatrix = camera.matrixWorldInverse;
    this.sunView.copy(this.sunDirection).transformDirection(viewMatrix);
    const front = this.sunView.z < -0.02;
    const s = this.sunPass.material.uniforms;
    (s.sunInFront as THREE.IUniform).value = front ? 1 : 0;
    if (front) {
      const ndcX = this.sunView.x / -this.sunView.z / tan.x;
      const ndcY = this.sunView.y / -this.sunView.z / tan.y;
      (s.sunNdc as THREE.IUniform<THREE.Vector2>).value.set(ndcX, ndcY);
      const radius = Math.tan(this.sunRadiusRad);
      (s.sunNdcRadius as THREE.IUniform<THREE.Vector2>).value.set((radius / -this.sunView.z) / tan.x, (radius / -this.sunView.z) / tan.y);
    }
    this.sunPass.render(renderer, this.sunTarget);

    const m = this.toneMapPass.material.uniforms;
    (m.hdr as THREE.IUniform).value = (this.history[writeIndex] as THREE.WebGLRenderTarget).texture;
    (m.exposureTexture as THREE.IUniform).value = next.texture;
    (m.tanHalf as THREE.IUniform<THREE.Vector2>).value.copy(tan);
    const core = GLARE.coreRad;
    (m.glareScale as THREE.IUniform).value = front ? (GLARE.fraction * core) / (2 * Math.PI) : 0;
    this.toneMapPass.render(renderer, null);
    if (!this.reading && now - this.lastRead > 100) {
      this.reading = true;
      this.lastRead = now;
      renderer
        .readRenderTargetPixelsAsync(next, 0, 0, 1, 1, this.readback)
        .then(() => {
          const value = this.readback[0] ?? 1;
          this.exposureChange = Math.abs(Math.log2(value / this.exposure));
          this.exposure = value;
        })
        .catch(() => undefined)
        .finally(() => {
          this.reading = false;
        });
    }
  }

  dispose(): void {
    this.hdr.dispose();
    this.hdr.depthTexture?.dispose();
    for (const target of this.history) target.dispose();
    this.meterA.dispose();
    this.meterB.dispose();
    this.meterC.dispose();
    this.sunTarget.dispose();
    for (const target of this.exposureTargets) target.dispose();
    this.triangle.dispose();
    for (const pass of [this.firstPass, this.secondPass, this.thirdPass, this.exposurePass, this.temporalPass, this.sunPass, this.toneMapPass]) pass.dispose();
  }
}

/** The far plane the engine's camera uses; the logarithmic depth buffer is decoded against it. */
const FAR_FOR_DEPTH = 600_000;

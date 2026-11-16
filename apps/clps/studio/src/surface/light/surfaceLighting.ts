import * as THREE from 'three';
import type { LightingFrame, SurfaceContext, SurfaceExtension } from '../core/types';
import { HeightAtlas, LightBaker, packBody } from './bake';
import { MARCH, REBAKE_ANGLE, SECONDARY } from './constants';
import { lightingGlsl } from './glsl';
import { ObjectShadow } from './objectShadow';
import { LEVEL_COUNT, sharedLight } from './uniforms';

export interface SunProbe {
  /** Visible fraction of the Sun's disc as the terrain shader computes it (baked far plus exact near). */
  fraction: number;
  /** Elevation of the terrain horizon toward the Sun, degrees. */
  horizonElevationDeg: number;
  /** Fraction from a dense 256-step march over the whole range, no baked data. */
  denseFraction: number;
  groundY: number;
}

export interface SurfaceDebug {
  /** Shader Sun visible fraction at scene (x, z), `heightAbove` metres over the ground. */
  sunFractionAt(x: number, z: number, heightAbove?: number): number;
  sunProbe(x: number, z: number, heightAbove?: number): SunProbe;
  /** CPU reference: horizon elevation (degrees) toward the Sun from a 4 m step march of the loaded height grids. */
  referenceHorizonDeg(x: number, z: number, heightAbove?: number, rangeM?: number, stepM?: number): number;
  referenceSunFraction(x: number, z: number, heightAbove?: number): number;
  /** Bounced irradiance (relative to direct sunlight at normal incidence) baked for one texel of a level. */
  bounceAt(level: number, column: number, row: number): number;
  state(): Record<string, unknown>;
}

declare global {
  interface Window {
    __surfaceDebug?: SurfaceDebug;
  }
}

const probeFragment = /* glsl */ `
${lightingGlsl()}
uniform vec3 lmlProbe;
void main() {
  float ground = lmlGroundHeight(lmlProbe.xy);
  vec3 P = vec3(lmlProbe.x, ground + lmlProbe.z, lmlProbe.y);
  int level = lmlFindLevel(P.xz, 0);
  if (level < 0) {
    gl_FragColor = vec4(-1.0);
    return;
  }
  float spacing = lmlLevel[level].w;
  float far = texture(lmlHorizon, lmlTexUv(level, P.xz)).r;
  float near = lmlMarch(P, lmlSun.xy, LML_NEAR_START * spacing, LML_NEAR_TEXELS * spacing, LML_NEAR_STEPS, true);
  float slope = max(far, near);
  float dense = lmlMarch(P, lmlSun.xy, 0.5, LML_MAX_RANGE, 128, true);
  dense = max(dense, lmlMarch(P, lmlSun.xy, 1.0, LML_MAX_RANGE, 128, false));
  gl_FragColor = vec4(lmlFractionFromSlope(slope, lmlSun), degrees(atan(slope)), lmlFractionFromSlope(dense, lmlSun), ground);
}`;

const probeVertex = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const RAD = Math.PI / 180;

/**
 * Surface lighting extension: owns the height textures, the baked horizon and bounce textures, the object
 * shadow map and the shared uniforms, and keeps them in step with the terrain levels and the Sun and Earth.
 */
export class SurfaceLighting implements SurfaceExtension {
  private context: SurfaceContext | null = null;
  private atlas: HeightAtlas | null = null;
  private baker: LightBaker | null = null;
  private shadow: ObjectShadow | null = null;
  private readonly seenVersion: number[] = Array.from({ length: LEVEL_COUNT }, () => -1);
  private readonly seenLoaded: boolean[] = Array.from({ length: LEVEL_COUNT }, () => false);
  private readonly bakedSun = new THREE.Vector3(0, -1, 0);
  private readonly bakedEarth = new THREE.Vector3(0, -1, 0);
  private synced = false;
  private bakeCount = 0;

  attach(context: SurfaceContext): void {
    this.context = context;
    const hardwareLinear = context.renderer.extensions.has('OES_texture_float_linear');
    this.atlas = new HeightAtlas(hardwareLinear);
    this.baker = new LightBaker();
    this.shadow = new ObjectShadow();
    sharedLight.lmlLinearHeights.value = hardwareLinear ? 1 : 0;
    sharedLight.lmlHeights.value = this.atlas.texture;
    sharedLight.lmlHorizon.value = this.baker.horizon.texture;
    sharedLight.lmlBounce.value = this.baker.bounce.texture;
    sharedLight.lmlBounceCoarse.value = this.baker.coarse.texture;
    sharedLight.lmlBounceIn.value = this.baker.incident.texture;
    const tint = SECONDARY.earthTint;
    const luminance = 0.2126 * tint[0] + 0.7152 * tint[1] + 0.0722 * tint[2];
    sharedLight.lmlEarthTint.value.set(tint[0] / luminance, tint[1] / luminance, tint[2] / luminance);
    window.__surfaceDebug = this.createDebug();
  }

  /** True when every loaded level's lighting textures match the current terrain and body directions. */
  get current(): boolean {
    const baker = this.baker;
    if (!baker || !this.synced) return false;
    return baker.pending === 0;
  }

  update(frame: LightingFrame, _deltaSeconds: number): void {
    const context = this.context;
    const atlas = this.atlas;
    const baker = this.baker;
    const shadow = this.shadow;
    if (!context || !atlas || !baker || !shadow) return;
    const terrain = context.terrain;
    const info = sharedLight.lmlLevel.value;
    let changed = false;
    for (let index = 0; index < LEVEL_COUNT; index += 1) {
      const level = terrain.levels[index];
      if (!level) continue;
      if (level.version === this.seenVersion[index] && level.loaded === this.seenLoaded[index]) continue;
      this.seenVersion[index] = level.version;
      this.seenLoaded[index] = level.loaded;
      const slot = info[index] as THREE.Vector4;
      if (level.loaded) {
        atlas.upload(index, level.heights);
        slot.set(level.centreX, level.centreZ, level.half, level.spacing);
      } else {
        atlas.clear(index);
        slot.set(0, 0, -1, 1);
      }
      baker.markFinerThan(index);
      changed = true;
    }
    if (changed) sharedLight.lmlMaxHeight.value = atlas.maxHeight;

    sharedLight.lmlSunDirection.value.copy(frame.sunDirection);
    packBody(frame.sunDirection, frame.sunAngularRadiusRad, sharedLight.lmlSun.value);
    sharedLight.lmlEarthDirection.value.copy(frame.earthDirection);
    packBody(frame.earthDirection, frame.earthAngularRadiusRad, sharedLight.lmlEarth.value);
    // Earth's lit fraction: phase angle is 180 degrees minus the Sun-Earth separation in the sky.
    const separation = frame.sunDirection.angleTo(frame.earthDirection);
    const earthLit = (1 + Math.cos(Math.PI - separation)) / 2;
    sharedLight.lmlEarthIrradiance.value = SECONDARY.earthFullIrradiance * earthLit;

    if (
      frame.sunDirection.angleTo(this.bakedSun) > REBAKE_ANGLE ||
      frame.earthDirection.angleTo(this.bakedEarth) > 2 * REBAKE_ANGLE
    ) {
      this.bakedSun.copy(frame.sunDirection);
      this.bakedEarth.copy(frame.earthDirection);
      baker.markAll();
    }
    const budget = baker.pending > 2 ? 2 : 1;
    this.bakeCount += baker.step(
      context.renderer,
      this.seenLoaded,
      {
        sunDirection: frame.sunDirection,
        sunRadiusRad: frame.sunAngularRadiusRad,
        earthDirection: frame.earthDirection,
        earthRadiusRad: frame.earthAngularRadiusRad,
      },
      budget,
    );
    this.synced = true;
    shadow.update(context.renderer, context.scene, context.camera.position, frame.sunDirection);
  }

  dispose(): void {
    this.atlas?.dispose();
    this.baker?.dispose();
    this.shadow?.dispose();
    sharedLight.lmlHeights.value = null;
    sharedLight.lmlHorizon.value = null;
    sharedLight.lmlBounce.value = null;
    sharedLight.lmlBounceCoarse.value = null;
    sharedLight.lmlBounceIn.value = null;
    for (const slot of sharedLight.lmlLevel.value) slot.set(0, 0, -1, 1);
    delete window.__surfaceDebug;
    this.context = null;
  }

  private createDebug(): SurfaceDebug {
    const probe = (x: number, z: number, heightAbove = 0): SunProbe => this.probe(x, z, heightAbove);
    return {
      sunFractionAt: (x, z, heightAbove = 0) => probe(x, z, heightAbove).fraction,
      sunProbe: probe,
      referenceHorizonDeg: (x, z, heightAbove = 0, rangeM = MARCH.maxRange, stepM = 0) =>
        this.referenceHorizon(x, z, heightAbove, rangeM, stepM),
      referenceSunFraction: (x, z, heightAbove = 0) => {
        const sun = sharedLight.lmlSun.value;
        const elevation = Math.atan(sun.z);
        const horizon = this.referenceHorizon(x, z, heightAbove) * RAD;
        const u = Math.max(-1, Math.min(1, (elevation - horizon) / sun.w));
        return 0.5 + (u * Math.sqrt(1 - u * u) + Math.asin(u)) / Math.PI;
      },
      bounceAt: (level, column, row) => this.readBounce(level, column, row),
      state: () => ({
        pending: this.baker?.pending ?? -1,
        bakes: this.bakeCount,
        loaded: [...this.seenLoaded],
        levels: sharedLight.lmlLevel.value.map((slot) => slot.toArray()),
        sunDirection: sharedLight.lmlSunDirection.value.toArray(),
        earthDirection: sharedLight.lmlEarthDirection.value.toArray(),
        sunElevationDeg: Math.atan(sharedLight.lmlSun.value.z) / RAD,
        earthElevationDeg: Math.atan(sharedLight.lmlEarth.value.z) / RAD,
        earthIrradiance: sharedLight.lmlEarthIrradiance.value,
        maxHeight: sharedLight.lmlMaxHeight.value,
        linearHeights: sharedLight.lmlLinearHeights.value,
      }),
    };
  }

  private readonly halfBuffer = new Uint16Array(4);

  private readBounce(level: number, column: number, row: number): number {
    const context = this.context;
    const baker = this.baker;
    if (!context || !baker) return Number.NaN;
    const renderer = context.renderer;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(baker.incident, level);
    renderer.readRenderTargetPixels(baker.incident, column, row, 1, 1, this.halfBuffer, level);
    renderer.setRenderTarget(previous);
    return THREE.DataUtils.fromHalfFloat(this.halfBuffer[0] as number) / 4096;
  }

  private probeMaterial: THREE.ShaderMaterial | null = null;
  private probeTarget: THREE.WebGLRenderTarget | null = null;
  private probeScene: THREE.Scene | null = null;
  private probeCamera: THREE.OrthographicCamera | null = null;
  private readonly probeBuffer = new Float32Array(4);

  /** Run the Sun visibility code of the terrain shader once at one point and read the result back. */
  private probe(x: number, z: number, heightAbove: number): SunProbe {
    const context = this.context;
    if (!context) throw new Error('Lighting is not attached.');
    if (!this.probeMaterial) {
      this.probeMaterial = new THREE.ShaderMaterial({
        vertexShader: probeVertex,
        fragmentShader: probeFragment,
        uniforms: { ...sharedLight, lmlProbe: { value: new THREE.Vector3() } },
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
      });
      const triangle = new THREE.BufferGeometry();
      triangle.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
      this.probeScene = new THREE.Scene();
      const mesh = new THREE.Mesh(triangle, this.probeMaterial);
      mesh.frustumCulled = false;
      this.probeScene.add(mesh);
      this.probeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.probeTarget = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.FloatType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
      });
    }
    const material = this.probeMaterial;
    const target = this.probeTarget as THREE.WebGLRenderTarget;
    (material.uniforms.lmlProbe as THREE.IUniform<THREE.Vector3>).value.set(x, z, heightAbove);
    const renderer = context.renderer;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(this.probeScene as THREE.Scene, this.probeCamera as THREE.OrthographicCamera);
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, this.probeBuffer);
    renderer.setRenderTarget(previous);
    return {
      fraction: this.probeBuffer[0] as number,
      horizonElevationDeg: this.probeBuffer[1] as number,
      denseFraction: this.probeBuffer[2] as number,
      groundY: this.probeBuffer[3] as number,
    };
  }

  private referenceHorizon(x: number, z: number, heightAbove: number, rangeM: number = MARCH.maxRange, stepM = 0): number {
    const context = this.context;
    if (!context) return Number.NaN;
    const ground = context.ground.heightAt(x, z);
    if (!Number.isFinite(ground)) return Number.NaN;
    const origin = ground + heightAbove;
    const sun = sharedLight.lmlSun.value;
    let best = -Infinity;
    for (let t = stepM > 0 ? stepM : 2; t <= rangeM; t += stepM > 0 ? stepM : t < 400 ? 2 : t * 0.01) {
      const height = context.ground.heightAt(x + sun.x * t, z + sun.y * t);
      if (!Number.isFinite(height)) {
        if (t > 400) break;
        continue;
      }
      const slope = (height - origin) / t;
      if (slope > best) best = slope;
    }
    return Math.atan(best) / RAD;
  }
}

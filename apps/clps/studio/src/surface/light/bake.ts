import * as THREE from 'three';
import { lightingGlsl } from './glsl';
import { LEVEL_COUNT, lightingUniforms } from './uniforms';

export const TILE_SIZE = 257;
/** Coarse bounce grid: one cell per 16 texels, centred on texel 16 i. */
export const COARSE_SIZE = 17;
/** Height written for a data gap; far below any terrain so it never shadows anything. */
const GAP_HEIGHT = -9999;

/** Float height grids of all terrain levels in one array texture, one layer per level. */
export class HeightAtlas {
  readonly texture: THREE.DataArrayTexture;
  private readonly data = new Float32Array(TILE_SIZE * TILE_SIZE * LEVEL_COUNT);
  private readonly maxima = new Float32Array(LEVEL_COUNT).fill(Number.NEGATIVE_INFINITY);

  constructor(hardwareLinear: boolean) {
    this.texture = new THREE.DataArrayTexture(this.data, TILE_SIZE, TILE_SIZE, LEVEL_COUNT);
    this.texture.format = THREE.RedFormat;
    this.texture.type = THREE.FloatType;
    this.texture.minFilter = hardwareLinear ? THREE.LinearFilter : THREE.NearestFilter;
    this.texture.magFilter = hardwareLinear ? THREE.LinearFilter : THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.unpackAlignment = 1;
    this.texture.needsUpdate = true;
  }

  /** Copy a level's scene heights into its layer. */
  upload(index: number, heights: Float32Array): void {
    const offset = index * TILE_SIZE * TILE_SIZE;
    let maximum = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < heights.length; k += 1) {
      const value = heights[k] as number;
      if (Number.isFinite(value)) {
        this.data[offset + k] = value;
        if (value > maximum) maximum = value;
      } else {
        this.data[offset + k] = GAP_HEIGHT;
      }
    }
    this.maxima[index] = maximum;
    this.texture.addLayerUpdate(index);
    this.texture.needsUpdate = true;
  }

  clear(index: number): void {
    this.maxima[index] = Number.NEGATIVE_INFINITY;
  }

  get maxHeight(): number {
    let maximum = Number.NEGATIVE_INFINITY;
    for (const value of this.maxima) if (value > maximum) maximum = value;
    return Number.isFinite(maximum) ? maximum : 0;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

const fullscreenVertex = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * Per-texel baked terrain data of one level, for the Sun direction and Earth direction it was baked for.
 * Output RGBA: far Sun slope (beyond the per-fragment near range), Earth slope over the full range, full
 * Sun slope (near and far), unused.
 */
const horizonFragment = /* glsl */ `
${lightingGlsl()}
uniform float lmlLayer;
uniform vec4 lmlBakeSun;
uniform vec4 lmlBakeEarth;
void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  int k = int(lmlLayer + 0.5);
  vec4 info = lmlLevel[k];
  float h = texelFetch(lmlHeights, ivec3(ij, k), 0).r;
  if (info.z < 0.0 || h < -9000.0) {
    gl_FragColor = vec4(-1.0, -1.0, -1.0, 1.0);
    return;
  }
  vec2 xz = info.xy - info.z + vec2(ij) * info.w;
  vec3 P = vec3(xz.x, h, xz.y);
  float range = LML_NEAR_TEXELS * info.w;
  float near = lmlMarch(P, lmlBakeSun.xy, 0.5 * info.w, range, LML_BAKE_NEAR_STEPS, true);
  float far = lmlMarch(P, lmlBakeSun.xy, range, LML_MAX_RANGE, LML_FAR_STEPS, false);
  float earth = lmlMarch(P, lmlBakeEarth.xy, info.w, LML_MAX_RANGE, LML_EARTH_STEPS, false);
  gl_FragColor = vec4(far, earth, max(near, far), 1.0);
}`;

/**
 * Outgoing radiance of directly lit ground per texel: radiance, normal x, normal z. Radiance is stored times
 * LML_BOUNCE_SCALE so faint values stay out of the half-float subnormal range.
 */
const bounceFragment = /* glsl */ `
${lightingGlsl()}
uniform float lmlLayer;
uniform vec4 lmlBakeSun;
uniform vec3 lmlBakeSunDirection;
float heightAt(ivec2 ij, int k) {
  ij = clamp(ij, ivec2(0), ivec2(int(LML_TEXELS) - 1));
  float h = texelFetch(lmlHeights, ivec3(ij, k), 0).r;
  return h;
}
void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  int k = int(lmlLayer + 0.5);
  vec4 info = lmlLevel[k];
  float h = heightAt(ij, k);
  if (info.z < 0.0 || h < -9000.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  float west = heightAt(ij + ivec2(-1, 0), k);
  float east = heightAt(ij + ivec2(1, 0), k);
  float north = heightAt(ij + ivec2(0, -1), k);
  float south = heightAt(ij + ivec2(0, 1), k);
  west = west < -9000.0 ? h : west;
  east = east < -9000.0 ? h : east;
  north = north < -9000.0 ? h : north;
  south = south < -9000.0 ? h : south;
  vec3 n = normalize(vec3(-(east - west), 2.0 * info.w, -(south - north)));
  float slope = texelFetch(lmlHorizon, ivec3(ij, k), 0).b;
  float visible = lmlFractionFromSlope(slope, lmlBakeSun);
  float mu0 = max(dot(n, lmlBakeSunDirection), 0.0);
  gl_FragColor = vec4(LML_BOUNCE_SCALE * LML_BOUNCE_ALBEDO * mu0 * visible / LML_PI, n.x, n.z, 1.0);
}`;

/**
 * Bounced sunlight arriving at each texel: the gather of `lmlBounceIrradiance` at the texel's own normal,
 * from the baked emission of every level. Stored times LML_BOUNCE_SCALE.
 */
const gatherFragment = /* glsl */ `
${lightingGlsl()}
uniform float lmlLayer;
float heightAt(ivec2 ij, int k) {
  ij = clamp(ij, ivec2(0), ivec2(int(LML_TEXELS) - 1));
  return texelFetch(lmlHeights, ivec3(ij, k), 0).r;
}
void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  int k = int(lmlLayer + 0.5);
  vec4 info = lmlLevel[k];
  float h = heightAt(ij, k);
  if (info.z < 0.0 || h < -9000.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  float west = heightAt(ij + ivec2(-1, 0), k);
  float east = heightAt(ij + ivec2(1, 0), k);
  float north = heightAt(ij + ivec2(0, -1), k);
  float south = heightAt(ij + ivec2(0, 1), k);
  west = west < -9000.0 ? h : west;
  east = east < -9000.0 ? h : east;
  north = north < -9000.0 ? h : north;
  south = south < -9000.0 ? h : south;
  vec3 n = normalize(vec3(-(east - west), 2.0 * info.w, -(south - north)));
  vec2 xz = info.xy - info.z + vec2(ij) * info.w;
  vec3 P = vec3(xz.x, h, xz.y);
  vec4 incident = lmlBounceIrradiance(P, n, info.w);
  gl_FragColor = vec4(LML_BOUNCE_SCALE * incident.x, LML_BOUNCE_SCALE * incident.yzw);
}`;

/** Box average of the bounce texture over 16 x 16 texels around each coarse cell. */
const coarseFragment = /* glsl */ `
${lightingGlsl()}
uniform float lmlLayer;
void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  int k = int(lmlLayer + 0.5);
  vec4 sum = vec4(0.0);
  for (int y = -8; y < 8; y++) {
    for (int x = -8; x < 8; x++) {
      ivec2 ij = clamp(cell * 16 + ivec2(x, y), ivec2(0), ivec2(int(LML_TEXELS) - 1));
      sum += texelFetch(lmlBounce, ivec3(ij, k), 0);
    }
  }
  gl_FragColor = sum / 256.0;
}`;

class Pass {
  readonly material: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(geometry: THREE.BufferGeometry, fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, layer: number): void {
    renderer.setRenderTarget(target, layer);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.material.dispose();
  }
}

function arrayTarget(size: number): THREE.WebGLArrayRenderTarget {
  return new THREE.WebGLArrayRenderTarget(size, size, LEVEL_COUNT, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
}

export interface BakeDirections {
  sunDirection: THREE.Vector3;
  sunRadiusRad: number;
  earthDirection: THREE.Vector3;
  earthRadiusRad: number;
}

/** Pack a direction as (horizontal x, horizontal z, tan elevation, angular radius). */
export function packBody(direction: THREE.Vector3, radiusRad: number, out: THREE.Vector4): THREE.Vector4 {
  const horizontal = Math.hypot(direction.x, direction.z);
  if (horizontal < 1e-6) return out.set(1, 0, direction.y >= 0 ? 1e6 : -1e6, radiusRad);
  return out.set(direction.x / horizontal, direction.z / horizontal, direction.y / horizontal, radiusRad);
}

/**
 * Bakes, per level, the far terrain horizon toward the Sun and Earth and the outgoing radiance of lit
 * ground. A level is re-baked when its height data changes or the bodies move; baking is spread across
 * frames by `step`.
 */
export class LightBaker {
  readonly horizon = arrayTarget(TILE_SIZE);
  readonly bounce = arrayTarget(TILE_SIZE);
  readonly coarse = arrayTarget(COARSE_SIZE);
  readonly incident = arrayTarget(TILE_SIZE);
  private readonly triangle = new THREE.BufferGeometry();
  private readonly horizonPass: Pass;
  private readonly bouncePass: Pass;
  private readonly coarsePass: Pass;
  private readonly gatherPass: Pass;
  private readonly gatherDirty: boolean[] = Array.from({ length: LEVEL_COUNT }, () => false);
  private readonly dirty: boolean[] = Array.from({ length: LEVEL_COUNT }, () => false);
  private readonly bakeSun = new THREE.Vector4(1, 0, -1, 0.0046);
  private readonly bakeEarth = new THREE.Vector4(1, 0, -1, 0.0166);
  private readonly bakeSunDirection = new THREE.Vector3();
  bakedSunDirection = new THREE.Vector3(0, -1, 0);
  bakedEarthDirection = new THREE.Vector3(0, -1, 0);

  constructor() {
    this.triangle.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const shared = lightingUniforms();
    const extra = {
      lmlLayer: { value: 0 },
      lmlBakeSun: { value: this.bakeSun },
      lmlBakeEarth: { value: this.bakeEarth },
      lmlBakeSunDirection: { value: this.bakeSunDirection },
    };
    this.horizonPass = new Pass(this.triangle, horizonFragment, { ...shared, ...extra });
    this.bouncePass = new Pass(this.triangle, bounceFragment, { ...shared, ...extra });
    this.coarsePass = new Pass(this.triangle, coarseFragment, { ...shared, ...extra });
    this.gatherPass = new Pass(this.triangle, gatherFragment, { ...shared, ...extra });
  }

  get pending(): number {
    return this.dirty.filter(Boolean).length + this.gatherDirty.filter(Boolean).length;
  }

  markLevel(index: number): void {
    this.dirty[index] = true;
    this.gatherDirty[index] = true;
  }

  /** A level changed: everything at least as fine depends on it for its far horizon. */
  markFinerThan(index: number): void {
    for (let k = 0; k <= index; k += 1) {
      this.dirty[k] = true;
      this.gatherDirty[k] = true;
    }
    if (index + 1 < LEVEL_COUNT) this.gatherDirty[index + 1] = true;
  }

  markAll(): void {
    this.dirty.fill(true);
    this.gatherDirty.fill(true);
  }

  /** Bake up to `budget` dirty levels, finest first, for the given bodies. Returns how many were baked. */
  step(renderer: THREE.WebGLRenderer, loaded: readonly boolean[], bodies: BakeDirections, budget: number): number {
    let baked = 0;
    for (let k = 0; k < LEVEL_COUNT && baked < budget; k += 1) {
      if (!this.dirty[k]) continue;
      this.dirty[k] = false;
      if (!loaded[k]) continue;
      packBody(bodies.sunDirection, bodies.sunRadiusRad, this.bakeSun);
      packBody(bodies.earthDirection, bodies.earthRadiusRad, this.bakeEarth);
      this.bakeSunDirection.copy(bodies.sunDirection);
      this.bakedSunDirection.copy(bodies.sunDirection);
      this.bakedEarthDirection.copy(bodies.earthDirection);
      for (const pass of [this.horizonPass, this.bouncePass, this.coarsePass]) {
        (pass.material.uniforms.lmlLayer as THREE.IUniform).value = k;
      }
      this.horizonPass.render(renderer, this.horizon, k);
      this.bouncePass.render(renderer, this.bounce, k);
      this.coarsePass.render(renderer, this.coarse, k);
      baked += 1;
    }
    // Bounce light is gathered once every level's emission is current.
    if (!this.dirty.some(Boolean)) {
      let gathered = 0;
      for (let k = 0; k < LEVEL_COUNT && gathered < budget; k += 1) {
        if (!this.gatherDirty[k]) continue;
        this.gatherDirty[k] = false;
        if (!loaded[k]) continue;
        (this.gatherPass.material.uniforms.lmlLayer as THREE.IUniform).value = k;
        this.gatherPass.render(renderer, this.incident, k);
        gathered += 1;
      }
      baked += gathered;
    }
    return baked;
  }

  dispose(): void {
    this.horizon.dispose();
    this.bounce.dispose();
    this.coarse.dispose();
    this.incident.dispose();
    this.triangle.dispose();
    this.horizonPass.dispose();
    this.bouncePass.dispose();
    this.coarsePass.dispose();
    this.gatherPass.dispose();
  }
}

import * as THREE from 'three';
import { lightingGlsl } from '../light/glsl';
import { OBJECT_SHADOW } from '../light/constants';
import { shadowPassUniforms, addShadowCaster, removeShadowCaster, touchShadowCasters } from '../light/objectShadow';
import { lightingUniforms } from '../light/uniforms';
import type { LightingFrame, SurfaceContext, SurfaceExtension } from '../core/types';
import { chain, hash2, unit } from './hash';
import { ROCK_STRIDE, ROCKS, rockCumulative, type RockSet } from './rockPlacement';
import { rockDetailGlsl } from './rockDetailGlsl';
import { rockGeometry, ROCK_KINDS } from './rockShapes';

/** Rock albedo relative to the regolith around it: fresh rock is brighter than mature soil. */
const ROCK_ALBEDO = 1.12;
/** Subdivision per class: pebbles are a few pixels across, boulders are shapes (the surface detail comes from the shader). */
const DETAIL = [1, 2, 2, 3, 3, 3];
/** Apparent diameters (pixels) at which a rock changes to the next coarser mesh. */
const LOD_PIXELS = [80, 22];
/** Rocks smaller than this on screen are not drawn: they would only add sub-pixel speckle. */
const MIN_PIXELS = 1.2;
const WINDOW_REFRESH_FRACTION = 1 / 6;
/** Instances whose ground height is read per frame. */
const HEIGHT_BUDGET = 3000;

const placement = /* glsl */ `
attribute vec2 aPos;
attribute vec3 aSize;
attribute vec3 aRotX;
attribute vec3 aRotY;
attribute vec3 aRotZ;
attribute vec3 aMisc;
uniform vec3 uEye;
uniform float uFadeRadius;

/* World position of this vertex of this rock; writes the world normal. aMisc = buried fraction, albedo factor, ground height
   under the rock (set on the CPU from the terrain levels; far below when there is no terrain). The rotation arrives as
   three columns, built once per rock on the CPU (a vertex shader that took angles would run six trig calls per vertex). */
vec3 rockPlace(vec3 localPosition, vec3 localNormal, out vec3 worldNormal) {
  float fade = 1.0 - smoothstep(0.8 * uFadeRadius, uFadeRadius, distance(aPos, uEye.xz));
  vec3 size = aSize * fade;
  float centreY = aMisc.z + size.y * (1.0 - 2.0 * aMisc.x);
  mat3 R = mat3(aRotX, aRotY, aRotZ);
  worldNormal = normalize(R * (localNormal / max(size, vec3(1.0e-4))));
  return vec3(aPos.x, centreY, aPos.y) + R * (localPosition * size);
}
`;

const mainVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${placement}
varying vec3 vWorld;
varying vec3 vNormal;
varying float vAlbedo;
varying float vDust;
varying float vSeed;
void main() {
  if (aMisc.z < -1.0e5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vWorld = vec3(0.0); vNormal = vec3(0.0, 1.0, 0.0); vAlbedo = 1.0; vDust = 0.0; vSeed = 0.0;
    return;
  }
  vec3 n;
  vec3 world = rockPlace(position, normal, n);
  // Regolith banked against the base: the lowest part of the rock flares outward and its normal leans up, so the rock
  // is set into the ground with a concave fillet instead of standing on it.
  float fade = 1.0 - smoothstep(0.8 * uFadeRadius, uFadeRadius, distance(aPos, uEye.xz));
  float filletHeight = max(0.4 * aSize.y * fade, 1.0e-4);
  float above = world.y - aMisc.z;
  float fillet = 1.0 - smoothstep(0.0, filletHeight, above);
  vec2 outward = world.xz - aPos;
  float outwardLength = max(length(outward), 1.0e-4);
  world.xz += outward / outwardLength * (1.2 * filletHeight * fillet * fillet);
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), 0.75 * fillet));
  vWorld = world;
  vNormal = n;
  vDust = fillet;
  vSeed = aPos.x * 0.37 + aPos.y * 0.11 + aMisc.y * 13.7;
  vAlbedo = ${ROCK_ALBEDO.toFixed(3)} * aMisc.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  #include <logdepthbuf_vertex>
}`;

const mainFragment = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${lightingGlsl()}
${rockDetailGlsl}
varying vec3 vWorld;
varying vec3 vNormal;
varying float vAlbedo;
varying float vDust;
varying float vSeed;
void main() {
  #include <logdepthbuf_fragment>
  vec3 normal = normalize(vNormal);
  vec3 toViewer = normalize(cameraPosition - vWorld);
  float footprint = sqrt(length(dFdx(vWorld)) * length(dFdy(vWorld)));
  vec3 noisePosition = vWorld + vec3(vSeed, 0.0, vSeed * 0.37);
  vec3 shading = rockShadingNormal(noisePosition, normal, footprint, vDust);
  // Dust mantle: regolith settles on upward-facing surfaces and the banked fillet; steep faces stay fresh and brighter.
  float up = smoothstep(0.3, 0.95, normal.y);
  float mottle = 1.0 + 0.1 * rockNoise(noisePosition * 3.0);
  float rock = vAlbedo * mottle * (1.0 + 0.1 * (1.0 - normal.y));
  float albedo = mix(rock, 1.0, clamp(0.6 * up + vDust, 0.0, 0.95));
  vec3 radiance = lmlSurfaceRadianceShaded(vWorld, normal, shading, toViewer, albedo, 0.0);
  gl_FragColor = vec4(radiance * LML_REGOLITH_TINT, 1.0);
}`;

const shadowVertex = /* glsl */ `
${placement}
uniform vec2 lmlCullAxis;
uniform float lmlCullHalf;
uniform float lmlCullMinSize;
void main() {
  float reach = max(aSize.x, max(aSize.y, aSize.z));
  if (reach < lmlCullMinSize) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float lateral = dot(aPos - uEye.xz, lmlCullAxis);
  if (abs(lateral) > lmlCullHalf + reach) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 n;
  vec3 world = rockPlace(position, normal, n);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const shadowFragment = /* glsl */ `
void main() {
  gl_FragColor = vec4(1.0);
}`;

interface LodTarget {
  geometry: THREE.InstancedBufferGeometry;
  attributes: Record<string, THREE.InstancedBufferAttribute>;
}

interface ClassState {
  index: number;
  radius: number;
  meshes: THREE.Mesh[];
  geometries: THREE.InstancedBufferGeometry[];
  /** Every geometry (each level of detail and the shadow copy) that draws the same instances, per variant. */
  variantGeometries: THREE.InstancedBufferGeometry[][];
  /** Per variant: the drawn lists, one per level of detail. */
  lods: LodTarget[][];
  capacity: number;
  materials: THREE.ShaderMaterial[];
  windowX: number;
  windowZ: number;
  hasWindow: boolean;
  inflight: boolean;
  failed: boolean;
  /** Terrain version the ground heights under the instances were read at; -1 while they are being (re)read. */
  heightsVersion: number;
  cursorVariant: number;
  cursorIndex: number;
  cursorVersion: number;
}

/** Scattered rocks drawn as instanced meshes, lit by the surface lighting and casting sharp shadows. */
export class RockField implements SurfaceExtension {
  private context: SurfaceContext | null = null;
  private readonly group = new THREE.Group();
  private readonly classes: ClassState[] = [];
  private readonly eye = new THREE.Vector3();
  private readonly focal = { value: 1000 };
  private readonly drawing = new THREE.Vector2();
  private readonly baseGeometries: THREE.BufferGeometry[] = [];
  private generation = 0;
  private siteKey = '';

  attach(context: SurfaceContext): void {
    this.context = context;
    this.group.name = 'rocks';
    context.scene.add(this.group);
    ROCKS.classes.forEach((spec, index) => {
      const detail = DETAIL[index] ?? 1;
      const bases = Array.from({ length: ROCKS.variants }, (_, variant) =>
        rockGeometry(index * 17 + variant * 5 + 1, detail, ROCK_KINDS[variant % ROCK_KINDS.length] as (typeof ROCK_KINDS)[number]),
      );
      this.baseGeometries.push(...bases);
      const density = rockCumulative(spec.diameterM) - rockCumulative(2 * spec.diameterM);
      const capacity = Math.ceil(((density * Math.PI * spec.radiusM * spec.radiusM) / ROCKS.variants) * 2.4) + 64;
      const materials: THREE.ShaderMaterial[] = [];
      const state: ClassState = {
        index,
        radius: spec.radiusM,
        meshes: [],
        geometries: [],
        variantGeometries: [],
        lods: [],
        capacity,
        materials,
        windowX: 0,
        windowZ: 0,
        hasWindow: false,
        inflight: false,
        failed: false,
        heightsVersion: -1,
        cursorVariant: 0,
        cursorIndex: 0,
        cursorVersion: -1,
      };
      const lodDetails: number[] = [];
      for (let d = detail; d >= 1; d -= 1) lodDetails.push(d);
      const lodMaterials = lodDetails.map(() => {
        return new THREE.ShaderMaterial({
          vertexShader: mainVertex,
          fragmentShader: mainFragment,
          side: THREE.FrontSide,
          uniforms: {
            ...lightingUniforms(),
            uEye: { value: this.eye },
            uFadeRadius: { value: spec.radiusM },
          },
        });
      });
      const shadow = new THREE.ShaderMaterial({
        vertexShader: shadowVertex,
        fragmentShader: shadowFragment,
        side: THREE.DoubleSide,
        colorWrite: false,
        uniforms: {
          ...shadowPassUniforms,
          uEye: { value: this.eye },
          uFadeRadius: { value: spec.radiusM },
        },
      });
      materials.push(...lodMaterials, shadow);
      for (let variant = 0; variant < ROCKS.variants; variant += 1) {
        const kind = ROCK_KINDS[variant % ROCK_KINDS.length] as (typeof ROCK_KINDS)[number];
        const seed = index * 17 + variant * 5 + 1;
        const attributes: Record<string, THREE.InstancedBufferAttribute> = {};
        const attribute = (name: string, size: number): void => {
          const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
          a.setUsage(THREE.DynamicDrawUsage);
          attributes[name] = a;
        };
        attribute('aPos', 2);
        attribute('aSize', 3);
        attribute('aRotX', 3);
        attribute('aRotY', 3);
        attribute('aRotZ', 3);
        attribute('aMisc', 3);
        const build = (lodDetail: number, source: Record<string, THREE.InstancedBufferAttribute>): THREE.InstancedBufferGeometry => {
          const base = rockGeometry(seed, lodDetail, kind);
          this.baseGeometries.push(base);
          const geometry = new THREE.InstancedBufferGeometry();
          geometry.index = base.index;
          geometry.setAttribute('position', base.getAttribute('position'));
          geometry.setAttribute('normal', base.getAttribute('normal'));
          for (const [name, a] of Object.entries(source)) geometry.setAttribute(name, a);
          geometry.instanceCount = 0;
          return geometry;
        };
        // Drawn rocks are sorted into one list per level of detail and cut to the view every frame (see `gather`);
        // the shadow copy reads the full list.
        const group: THREE.InstancedBufferGeometry[] = [];
        const lods: LodTarget[] = [];
        lodDetails.forEach((lodDetail, lod) => {
          const visible: Record<string, THREE.InstancedBufferAttribute> = {};
          for (const [name, a] of Object.entries(attributes)) {
            const copy = new THREE.InstancedBufferAttribute(new Float32Array(a.array.length), a.itemSize);
            copy.setUsage(THREE.DynamicDrawUsage);
            visible[name] = copy;
          }
          const geometry = build(lodDetail, visible);
          const mesh = new THREE.Mesh(geometry, lodMaterials[lod] as THREE.ShaderMaterial);
          mesh.frustumCulled = false;
          mesh.name = `rocks-${index}`;
          this.group.add(mesh);
          lods.push({ geometry, attributes: visible });
        });
        state.lods.push(lods);
        // Shadows are drawn from a medium-detail copy that only the shadow maps see.
        const shadowGeometry = build(Math.min(detail, 2), attributes);
        const shadowMesh = new THREE.Mesh(shadowGeometry, lodMaterials[0] as THREE.ShaderMaterial);
        shadowMesh.frustumCulled = false;
        shadowMesh.layers.set(OBJECT_SHADOW.layer);
        shadowMesh.userData.shadowMaterial = shadow;
        shadowMesh.userData.staticShadow = true;
        shadowMesh.name = `rocks-shadow-${index}`;
        this.group.add(shadowMesh);
        addShadowCaster(shadowMesh);
        group.push(shadowGeometry);
        state.meshes.push(shadowMesh);
        state.geometries.push(shadowGeometry);
        state.variantGeometries.push(group);
      }
      this.classes.push(state);
    });
  }

  isReady(): boolean {
    const terrain = this.context?.terrain;
    if (!terrain?.site) return true;
    if (!this.eyeKnown()) return true;
    return this.classes.every(
      (state) => state.failed || (state.hasWindow && !state.inflight && !this.stale(state) && state.heightsVersion === terrain.version),
    );
  }

  update(_frame: LightingFrame, _deltaSeconds: number): void {
    const context = this.context;
    const terrain = context?.terrain;
    if (!context || !terrain) return;
    const site = terrain.site;
    if (!site) return;
    const key = `${site.mapX}|${site.mapY}`;
    if (key !== this.siteKey) {
      this.siteKey = key;
      this.generation += 1;
      for (const state of this.classes) {
        state.hasWindow = false;
        state.inflight = false;
        state.failed = false;
        for (const group of state.variantGeometries) for (const geometry of group) geometry.instanceCount = 0;
      }
    }
    this.eye.copy(context.camera.position);
    this.focal.value = (context.renderer.getDrawingBufferSize(this.drawing).y * 0.5) / Math.tan((context.camera.fov * Math.PI) / 360);
    let budget = HEIGHT_BUDGET;
    for (const state of this.classes) {
      if (state.inflight || state.failed) continue;
      if (state.hasWindow && !this.stale(state)) {
        if (state.heightsVersion !== terrain.version) budget = this.refreshHeights(state, terrain, budget);
        continue;
      }
      this.request(state, site.mapX, site.mapY);
    }
    context.camera.updateMatrixWorld();
    for (const state of this.classes) this.gather(state);
  }

  /**
   * Sort the class's rocks into the lists the level-of-detail meshes draw, leaving out those outside the view: a rock a few
   * pixels across is drawn from a coarse mesh, and one behind the camera is not drawn. Runs every frame over the master lists.
   */
  private gather(state: ClassState): void {
    const camera = this.context?.camera;
    if (!camera) return;
    const m = camera.matrixWorldInverse.elements;
    const halfTan = Math.tan((camera.fov * Math.PI) / 360);
    const tanY = halfTan;
    const tanX = halfTan * camera.aspect;
    const ex = this.eye.x;
    const ey = this.eye.y;
    const ez = this.eye.z;
    const focal = this.focal.value;
    for (let variant = 0; variant < ROCKS.variants; variant += 1) {
      const master = state.geometries[variant] as THREE.InstancedBufferGeometry;
      const targets = state.lods[variant] as LodTarget[];
      const count = master.instanceCount;
      const pos = (master.getAttribute('aPos') as THREE.InstancedBufferAttribute).array as Float32Array;
      const size = (master.getAttribute('aSize') as THREE.InstancedBufferAttribute).array as Float32Array;
      const rotX = (master.getAttribute('aRotX') as THREE.InstancedBufferAttribute).array as Float32Array;
      const rotY = (master.getAttribute('aRotY') as THREE.InstancedBufferAttribute).array as Float32Array;
      const rotZ = (master.getAttribute('aRotZ') as THREE.InstancedBufferAttribute).array as Float32Array;
      const misc = (master.getAttribute('aMisc') as THREE.InstancedBufferAttribute).array as Float32Array;
      const written = targets.map(() => 0);
      for (let k = 0; k < count; k += 1) {
        const ground = misc[k * 3 + 2] as number;
        if (ground < -1e5) continue;
        const x = pos[k * 2] as number;
        const z = pos[k * 2 + 1] as number;
        const reach = 1.6 * Math.max(size[k * 3] as number, size[k * 3 + 1] as number, size[k * 3 + 2] as number);
        const dx = x - ex;
        const dy = ground - ey;
        const dz = z - ez;
        const vz = m[2]! * dx + m[6]! * dy + m[10]! * dz;
        if (vz > reach) continue;
        const vx = m[0]! * dx + m[4]! * dy + m[8]! * dz;
        const vy = m[1]! * dx + m[5]! * dy + m[9]! * dz;
        const depth = -vz;
        if (Math.abs(vx) > tanX * depth + reach + 1 || Math.abs(vy) > tanY * depth + reach + 1.5) continue;
        const distance = Math.max(Math.hypot(dx, dy, dz), 0.2);
        const pixels = (2 * (size[k * 3] as number) * focal) / distance;
        if (pixels < MIN_PIXELS) continue;
        let lod = pixels >= LOD_PIXELS[0]! ? 0 : pixels >= LOD_PIXELS[1]! ? 1 : 2;
        if (lod >= targets.length) lod = targets.length - 1;
        const target = targets[lod] as LodTarget;
        const n = written[lod] as number;
        const a = target.attributes;
        (a.aPos as THREE.InstancedBufferAttribute).array.set(pos.subarray(k * 2, k * 2 + 2), n * 2);
        (a.aSize as THREE.InstancedBufferAttribute).array.set(size.subarray(k * 3, k * 3 + 3), n * 3);
        (a.aRotX as THREE.InstancedBufferAttribute).array.set(rotX.subarray(k * 3, k * 3 + 3), n * 3);
        (a.aRotY as THREE.InstancedBufferAttribute).array.set(rotY.subarray(k * 3, k * 3 + 3), n * 3);
        (a.aRotZ as THREE.InstancedBufferAttribute).array.set(rotZ.subarray(k * 3, k * 3 + 3), n * 3);
        (a.aMisc as THREE.InstancedBufferAttribute).array.set(misc.subarray(k * 3, k * 3 + 3), n * 3);
        written[lod] = n + 1;
      }
      targets.forEach((target, lod) => {
        const n = written[lod] as number;
        target.geometry.instanceCount = n;
        for (const attribute of Object.values(target.attributes)) {
          attribute.clearUpdateRanges();
          if (n > 0) attribute.addUpdateRange(0, n * attribute.itemSize);
          attribute.needsUpdate = n > 0;
        }
      });
    }
  }

  /**
   * Read the ground height under each instance from the terrain levels (CPU, a slice per frame), so the
   * vertex shaders need no terrain lookups. The rock rests on the lowest of nine ground points under its
   * footprint and sinks by its buried fraction. Returns the budget left.
   */
  private refreshHeights(state: ClassState, terrain: SurfaceContext['terrain'], budget: number): number {
    if (state.cursorVersion !== terrain.version) {
      state.cursorVersion = terrain.version;
      state.cursorVariant = 0;
      state.cursorIndex = 0;
    }
    while (budget > 0 && state.cursorVariant < ROCKS.variants) {
      const geometry = state.geometries[state.cursorVariant] as THREE.InstancedBufferGeometry;
      const count = geometry.instanceCount;
      const pos = (geometry.getAttribute('aPos') as THREE.InstancedBufferAttribute).array as Float32Array;
      const size = (geometry.getAttribute('aSize') as THREE.InstancedBufferAttribute).array as Float32Array;
      const misc = geometry.getAttribute('aMisc') as THREE.InstancedBufferAttribute;
      const data = misc.array as Float32Array;
      let k = state.cursorIndex;
      for (; k < count && budget > 0; k += 1, budget -= 1) {
        const x = pos[k * 2] as number;
        const z = pos[k * 2 + 1] as number;
        const reach = Math.max(size[k * 3] as number, size[k * 3 + 2] as number);
        const centre = terrain.heightAt(x, z);
        if (!Number.isFinite(centre)) {
          data[k * 3 + 2] = -1e6;
          continue;
        }
        let low = centre;
        const diagonal = 0.7 * reach;
        for (const [dx, dz] of [[reach, 0], [-reach, 0], [0, reach], [0, -reach], [diagonal, diagonal], [-diagonal, diagonal], [diagonal, -diagonal], [-diagonal, -diagonal]] as const) {
          const h = terrain.heightAt(x + dx, z + dz);
          if (Number.isFinite(h) && h < low) low = h;
        }
        // A rock rests on the low side of its footprint and is buried on the high side: its base is never above the ground anywhere.
        data[k * 3 + 2] = low;
      }
      misc.needsUpdate = true;
      state.cursorIndex = k;
      if (k >= count) {
        state.cursorVariant += 1;
        state.cursorIndex = 0;
      }
    }
    if (state.cursorVariant >= ROCKS.variants) {
      state.heightsVersion = state.cursorVersion;
      touchShadowCasters();
    }
    return budget;
  }

  dispose(): void {
    this.generation += 1;
    for (const state of this.classes) {
      for (const mesh of state.meshes) removeShadowCaster(mesh);
      for (const group of state.variantGeometries) for (const geometry of group) geometry.dispose();
      for (const targets of state.lods) for (const target of targets) target.geometry.dispose();
      for (const material of state.materials) material.dispose();
    }
    for (const base of this.baseGeometries) base.dispose();
    this.group.removeFromParent();
    this.classes.length = 0;
    touchShadowCasters();
  }

  /** Triangle total of what is drawn now, for the report. */
  get instanceCount(): number {
    let total = 0;
    for (const state of this.classes) for (const geometry of state.geometries) total += geometry.instanceCount;
    return total;
  }

  private eyeKnown(): boolean {
    return this.context !== null;
  }

  private stale(state: ClassState): boolean {
    const camera = this.context?.camera.position;
    if (!camera) return false;
    return Math.hypot(camera.x - state.windowX, camera.z - state.windowZ) > state.radius * WINDOW_REFRESH_FRACTION;
  }

  private request(state: ClassState, siteMapX: number, siteMapY: number): void {
    const context = this.context as SurfaceContext;
    const camera = context.camera.position;
    const generation = this.generation;
    state.inflight = true;
    const centreX = camera.x;
    const centreZ = camera.z;
    context.terrain.pool
      .rocks({ classIndex: state.index, centreX, centreZ, siteMapX, siteMapY, capacity: state.capacity })
      .then((set) => {
        if (generation !== this.generation) return;
        this.apply(state, set);
        state.windowX = centreX;
        state.windowZ = centreZ;
        state.hasWindow = true;
        state.inflight = false;
      })
      .catch(() => {
        if (generation !== this.generation) return;
        state.inflight = false;
        state.failed = true;
      });
  }

  private readonly rotation = new THREE.Matrix4();
  private readonly turn = new THREE.Matrix4();

  private apply(state: ClassState, set: RockSet): void {
    const { rotation, turn } = this;
    for (let variant = 0; variant < ROCKS.variants; variant += 1) {
      const geometry = state.geometries[variant] as THREE.InstancedBufferGeometry;
      const count = set.counts[variant] as number;
      const source = set.data[variant] as Float32Array;
      const pos = (geometry.getAttribute('aPos') as THREE.InstancedBufferAttribute).array as Float32Array;
      const size = (geometry.getAttribute('aSize') as THREE.InstancedBufferAttribute).array as Float32Array;
      const rotX = (geometry.getAttribute('aRotX') as THREE.InstancedBufferAttribute).array as Float32Array;
      const rotY = (geometry.getAttribute('aRotY') as THREE.InstancedBufferAttribute).array as Float32Array;
      const rotZ = (geometry.getAttribute('aRotZ') as THREE.InstancedBufferAttribute).array as Float32Array;
      const misc = (geometry.getAttribute('aMisc') as THREE.InstancedBufferAttribute).array as Float32Array;
      for (let k = 0; k < count; k += 1) {
        const o = k * ROCK_STRIDE;
        pos[k * 2] = source[o] as number;
        pos[k * 2 + 1] = source[o + 1] as number;
        size[k * 3] = source[o + 2] as number;
        size[k * 3 + 1] = source[o + 3] as number;
        size[k * 3 + 2] = source[o + 4] as number;
        // R = RotY(yaw) * RotX(pitch) * RotZ(roll), stored as its three columns.
        rotation.makeRotationY(source[o + 5] as number);
        rotation.multiply(turn.makeRotationX(source[o + 6] as number));
        rotation.multiply(turn.makeRotationZ(source[o + 7] as number));
        const e = rotation.elements;
        rotX.set([e[0] as number, e[1] as number, e[2] as number], k * 3);
        rotY.set([e[4] as number, e[5] as number, e[6] as number], k * 3);
        rotZ.set([e[8] as number, e[9] as number, e[10] as number], k * 3);
        misc[k * 3] = source[o + 8] as number;
        misc[k * 3 + 1] = source[o + 9] as number;
        misc[k * 3 + 2] = Number.NEGATIVE_INFINITY;
      }
      for (const name of ['aPos', 'aSize', 'aRotX', 'aRotY', 'aRotZ', 'aMisc']) (geometry.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true;
      for (const member of state.variantGeometries[variant] ?? []) member.instanceCount = count;
    }
    state.heightsVersion = -1;
    state.cursorVersion = -1;
    touchShadowCasters();
  }
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LightingFrame, SurfaceContext, SurfaceExtension } from '../core/types';
import { OBJECT_SHADOW } from '../light/constants';
import { addShadowCaster, removeShadowCaster, touchShadowCasters } from '../light/objectShadow';
import { sharedLight } from '../light/uniforms';
import { RockQuery } from '../rover/obstacles';
import { layoutBase, type BaseLayout } from './layout';
import { buildHabitat, buildLander, buildMast, type LeggedModel, type MastModel } from './model';
import { MaterialSet, toWorld } from './parts';

/** Sun visible fraction at or below this counts as dark: the work lights come on. */
const DARK_FRACTION = 0.01;
/** Lens radiance of a lit work light against sunlit regolith (a 20 W LED behind a 10 cm lens is about 90 times brighter). */
const LENS_EMISSIVE = 40;
const LENS_OFF = 0.02;
const FINE_COVERAGE_M = 100;
const HEIGHT_TOLERANCE_M = 0.015;
const PANEL_TOUCH_RAD = (0.25 * Math.PI) / 180;
const CABLE_LIFT_M = 0.035;
const CABLE_RADIUS_M = 0.03;
const PROBE_INTERVAL_MS = 250;

export interface BaseState {
  layout: BaseLayout;
  /** Visible fraction of the Sun at the lander, from the calculation service (the lighting probe may lower it). */
  sunFraction: number;
}

/**
 * The crewed outpost at the landing site: lander, habitat, three vertical solar arrays that turn to the Sun, cables, and work
 * lights that come on when the Sun is not visible. Everything sits on the ground the renderer draws (re-read whenever terrain
 * levels change), on ground flatter than 8 degrees, and casts and receives shadows like the rover does.
 */
export class BaseExtension implements SurfaceExtension {
  readonly root = new THREE.Group();
  /**
   * What the shadow maps draw: a few merged, position-only copies of the outpost on the caster layer only, so each of the
   * five shadow passes costs a handful of draws instead of one per part. The visible meshes in `root` do not cast.
   */
  private readonly shadowGroup = new THREE.Group();
  private staticProxy: THREE.Mesh | null = null;
  private panelProxies: THREE.Mesh[] = [];
  private readonly proxyMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });
  layout: BaseLayout | null = null;
  enabled = true;
  /** Lights forced on or off by a review hash; null follows the Sun. */
  forcedLights: boolean | null = null;
  lightsOn = false;
  /** Set by the drive code: true while the rover's own headlamps are lit and hold the shared lamp slots. */
  roverLampsOn: (() => boolean) | null = null;
  private context: SurfaceContext | null = null;
  private fine = false;
  private lander: LeggedModel | null = null;
  private habitat: LeggedModel | null = null;
  private masts: MastModel[] = [];
  private readonly cableMaterials = new MaterialSet();
  private cableMesh: THREE.Mesh | null = null;
  private lensMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly rocks = new RockQuery();
  private conformedVersion = -1;
  private registered = false;
  private sunFraction = 1;
  private probeFraction = 1;
  private lastProbe = 0;
  private lastPanelAngles: number[] = [];
  private lastPadHeights = new Map<string, number[]>();
  private cableSignature = '';
  private ownsLamps = false;
  private readonly lampPosition = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly lampDirection = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly scratch = new THREE.Vector3();

  attach(context: SurfaceContext): void {
    this.context = context;
    this.root.name = 'base';
    this.shadowGroup.name = 'base-shadow';
    this.shadowGroup.userData.staticShadow = true;
    context.scene.add(this.root, this.shadowGroup);
  }

  /** Visible fraction of the Sun at the base from the estimate series. */
  setSunFraction(fraction: number): void {
    this.sunFraction = fraction;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.root.visible = enabled;
    this.shadowGroup.visible = enabled;
  }

  /** Where the layout puts things, for cameras and the HUD. Null until the ground is loaded. */
  get state(): BaseState | null {
    return this.layout ? { layout: this.layout, sunFraction: Math.min(this.sunFraction, this.probeFraction) } : null;
  }

  /** Ground height under the base's centre, for the Stay camera. */
  centreHeight(): number {
    const layout = this.layout;
    const context = this.context;
    if (!layout || !context) return 0;
    const h = context.ground.heightAt(layout.centre.x, layout.centre.z);
    return Number.isFinite(h) ? h : 0;
  }

  isReady(): boolean {
    if (!this.enabled || !this.context) return true;
    return this.layout !== null && this.conformedVersion === this.context.terrain.version;
  }

  update(frame: LightingFrame, _deltaSeconds: number): void {
    const context = this.context;
    if (!context) return;
    if (!this.enabled) {
      this.releaseLamps();
      return;
    }
    const near = Math.hypot(context.camera.position.x, context.camera.position.z) < FINE_COVERAGE_M;
    if (this.layout === null || (!this.fine && near)) this.tryLayout(near);
    if (this.layout === null) return;
    if (this.conformedVersion !== context.terrain.version) this.conform();
    this.turnArrays(frame);
    this.updateLights();
  }

  private tryLayout(near: boolean): void {
    const context = this.context as SurfaceContext;
    if (!Number.isFinite(context.ground.heightAt(0, 0))) return;
    const site = context.terrain.site;
    if (site) this.rocks.setSite(site.mapX, site.mapY);
    this.rocks.refresh(-10, -12, context.ground, context.terrain.version, null, true);
    const layout = layoutBase(context.ground, this.rocks.obstacles);
    if (!layout) return;
    const moved = this.layout !== null;
    this.layout = layout;
    this.fine = near;
    if (!moved) this.build();
    this.place();
    this.conformedVersion = -1;
  }

  private build(): void {
    this.lander = buildLander();
    this.habitat = buildHabitat();
    this.masts = [buildMast(), buildMast(), buildMast()];
    this.root.add(this.lander.group, this.habitat.group);
    for (const mast of this.masts) this.root.add(mast.group);
    this.lensMaterials = [this.lander, this.habitat].map((model) => {
      let found: THREE.MeshBasicMaterial | null = null;
      model.group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) found = child.material;
      });
      return found as unknown as THREE.MeshBasicMaterial;
    });
    this.panelProxies = this.masts.map((mast) => {
      const parts: THREE.BufferGeometry[] = [];
      mast.panel.traverse((child) => {
        if (child instanceof THREE.Mesh) parts.push(positionsOnly(child.geometry, child.matrix));
      });
      const proxy = new THREE.Mesh(mergeGeometries(parts, false) as THREE.BufferGeometry, this.proxyMaterial);
      for (const part of parts) part.dispose();
      proxy.frustumCulled = false;
      this.shadowGroup.add(proxy);
      return proxy;
    });
    if (!this.registered) {
      this.registered = true;
      addShadowCaster(this.shadowGroup);
    }
  }

  /** Rebuild the merged static shadow caster from the visible parts (legs and cables change with the ground). */
  private rebuildProxy(): void {
    const parts: THREE.BufferGeometry[] = [];
    this.root.updateMatrixWorld(true);
    this.root.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || child.material instanceof THREE.MeshBasicMaterial) return;
      if (this.masts.some((mast) => child.parent === mast.panel)) return;
      parts.push(positionsOnly(child.geometry, child.matrixWorld));
    });
    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!merged) return;
    if (this.staticProxy) {
      this.staticProxy.geometry.dispose();
      this.staticProxy.geometry = merged;
    } else {
      this.staticProxy = new THREE.Mesh(merged, this.proxyMaterial);
      this.staticProxy.frustumCulled = false;
      this.shadowGroup.add(this.staticProxy);
    }
    this.shadowGroup.traverse((child) => child.layers.set(OBJECT_SHADOW.layer));
  }

  /** Place the models at the layout's spots; heights are set by `conform`. */
  private place(): void {
    const layout = this.layout;
    if (!layout || !this.lander || !this.habitat) return;
    this.lander.group.position.set(layout.lander.x, 0, layout.lander.z);
    this.lander.group.rotation.y = layout.lander.yaw;
    this.habitat.group.position.set(layout.habitat.x, 0, layout.habitat.z);
    this.habitat.group.rotation.y = layout.habitat.yaw;
    this.masts.forEach((mast, k) => mast.group.position.set(layout.masts[k]!.x, 0, layout.masts[k]!.z));
    this.lastPadHeights.clear();
    this.cableSignature = '';
  }

  private groundMax(x: number, z: number, radius: number): number {
    const ground = (this.context as SurfaceContext).ground;
    let top = ground.heightAt(x, z);
    for (let k = 0; k < 4; k += 1) {
      const angle = (k / 4) * Math.PI * 2;
      top = Math.max(top, ground.heightAt(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius));
    }
    return top;
  }

  /** Set every element on the ground the renderer now draws. */
  private conform(): void {
    const context = this.context as SurfaceContext;
    const layout = this.layout;
    if (!layout || !this.lander || !this.habitat) return;
    const legged: [string, LeggedModel, { x: number; z: number; yaw: number }, number][] = [
      ['lander', this.lander, layout.lander, 0.5],
      ['habitat', this.habitat, layout.habitat, 0.45],
    ];
    for (const [name, model, spot, padRadius] of legged) {
      const heights = model.pads.map(([lx, lz]) => {
        const [wx, wz] = toWorld(spot.yaw, spot.x, spot.z, lx, lz);
        return this.groundMax(wx, wz, padRadius);
      });
      const [fx, fz] = toWorld(spot.yaw, spot.x, spot.z, model.foot?.[0] ?? 0, model.foot?.[1] ?? 0);
      const footHeight = context.ground.heightAt(fx, fz);
      if (heights.some((h) => !Number.isFinite(h)) || !Number.isFinite(footHeight)) return;
      const y0 = Math.max(...heights);
      model.group.position.y = y0;
      const local = [...heights.map((h) => h - y0), footHeight - y0];
      const previous = this.lastPadHeights.get(name);
      if (!previous || local.some((value, index) => Math.abs(value - (previous[index] as number)) > HEIGHT_TOLERANCE_M)) {
        model.rebuildLegs(local.slice(0, 4), local[4] as number);
        this.lastPadHeights.set(name, local);
      }
    }
    this.masts.forEach((mast, k) => {
      const spot = layout.masts[k]!;
      const y = this.groundMax(spot.x, spot.z, 0.7);
      if (Number.isFinite(y)) mast.group.position.y = y;
    });
    this.root.updateMatrixWorld(true);
    this.buildCables();
    this.rebuildProxy();
    this.panelProxies.forEach((proxy, k) => proxy.position.copy(this.masts[k]!.group.position));
    this.conformedVersion = context.terrain.version;
    touchShadowCasters();
  }

  /** Cables from each mast and from the habitat to the lander, lying on the ground. */
  private buildCables(): void {
    const layout = this.layout;
    const context = this.context;
    if (!layout || !context || !this.lander || !this.habitat) return;
    const [lx, lz] = toWorld(layout.lander.yaw, layout.lander.x, layout.lander.z, 0, 2.95);
    const [hx, hz] = toWorld(layout.habitat.yaw, layout.habitat.x, layout.habitat.z, 0.5, 3.7);
    const starts: [number, number][] = [...layout.masts.map((m): [number, number] => [m.x, m.z]), [hx, hz]];
    const pieces: THREE.BufferGeometry[] = [];
    let signature = '';
    for (const [sx, sz] of starts) {
      const length = Math.hypot(lx - sx, lz - sz);
      const count = Math.max(4, Math.ceil(length / 1.5));
      const points: THREE.Vector3[] = [];
      for (let k = 0; k <= count; k += 1) {
        const t = k / count;
        // A gentle sideways wander so a cable is not a ruler line.
        const bend = Math.sin(t * Math.PI) * 0.6 * Math.sin(sx * 0.7 + sz);
        const x = sx + (lx - sx) * t - ((lz - sz) / length) * bend;
        const z = sz + (lz - sz) * t + ((lx - sx) / length) * bend;
        const h = context.ground.heightAt(x, z);
        if (!Number.isFinite(h)) return;
        points.push(new THREE.Vector3(x, h + CABLE_LIFT_M, z));
        signature += `${Math.round(h * 50)},`;
      }
      pieces.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.3), count * 3, CABLE_RADIUS_M, 5, false));
    }
    if (signature === this.cableSignature && this.cableMesh) {
      for (const piece of pieces) piece.dispose();
      return;
    }
    this.cableSignature = signature;
    const merged = mergeGeometries(pieces.map((piece) => piece.toNonIndexed()), false);
    for (const piece of pieces) piece.dispose();
    if (!merged) return;
    if (this.cableMesh) {
      this.cableMesh.geometry.dispose();
      this.cableMesh.geometry = merged;
    } else {
      this.cableMesh = new THREE.Mesh(merged, this.cableMaterials.get('black'));
      this.root.add(this.cableMesh);
    }
  }

  /** Each array turns about its mast to face the Sun's bearing. */
  private turnArrays(frame: LightingFrame): void {
    const sx = frame.sunDirection.x;
    const sz = frame.sunDirection.z;
    if (Math.hypot(sx, sz) < 1e-4) return;
    const angle = Math.atan2(sx, sz);
    let moved = false;
    this.masts.forEach((mast, k) => {
      mast.panel.rotation.y = angle;
      if (this.panelProxies[k]) this.panelProxies[k]!.rotation.y = angle;
      const last = this.lastPanelAngles[k];
      if (last === undefined || Math.abs(Math.atan2(Math.sin(angle - last), Math.cos(angle - last))) > PANEL_TOUCH_RAD) {
        this.lastPanelAngles[k] = angle;
        moved = true;
      }
    });
    if (moved) {
      this.root.updateMatrixWorld(true);
      touchShadowCasters();
    }
  }

  private updateLights(): void {
    const lander = this.lander;
    const habitat = this.habitat;
    const layout = this.layout;
    if (!lander || !habitat || !layout) return;
    const now = performance.now();
    if (now - this.lastProbe > PROBE_INTERVAL_MS) {
      this.lastProbe = now;
      try {
        this.probeFraction = window.__surfaceDebug ? window.__surfaceDebug.sunFractionAt(layout.lander.x, layout.lander.z, 3) : 1;
      } catch {
        this.probeFraction = 1;
      }
    }
    const dark = Math.min(this.sunFraction, this.probeFraction) <= DARK_FRACTION;
    this.lightsOn = this.forcedLights ?? dark;
    const level = this.lightsOn ? LENS_EMISSIVE : LENS_OFF;
    for (const material of this.lensMaterials) material.color.setRGB(level, level * 0.93, level * 0.8);
    if (!this.lightsOn) {
      this.releaseLamps();
      return;
    }
    // The shared headlamp slots belong to the rover whenever its lamps are lit; otherwise the work lights take them.
    if (this.roverLampsOn?.() ?? (!this.ownsLamps && sharedLight.lmlLampOn.value > 0.5)) return;
    [lander, habitat].forEach((model, i) => {
      this.lampPosition[i]!.copy(model.lamp.position);
      model.group.localToWorld(this.lampPosition[i]!);
      this.lampDirection[i]!.copy(model.lamp.direction).applyQuaternion(model.group.quaternion).normalize();
      sharedLight.lmlLampPos.value[i]!.copy(this.lampPosition[i]!);
      sharedLight.lmlLampDir.value[i]!.copy(this.lampDirection[i]!);
    });
    sharedLight.lmlLampOn.value = 1;
    this.ownsLamps = true;
  }

  private releaseLamps(): void {
    if (this.ownsLamps) {
      sharedLight.lmlLampOn.value = 0;
      this.ownsLamps = false;
    }
  }

  dispose(): void {
    this.releaseLamps();
    if (this.registered) removeShadowCaster(this.shadowGroup);
    this.shadowGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    });
    this.shadowGroup.removeFromParent();
    this.proxyMaterial.dispose();
    this.root.traverse((child) => {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    });
    this.lander?.dispose();
    this.habitat?.dispose();
    for (const mast of this.masts) mast.dispose();
    this.cableMaterials.dispose();
    this.root.removeFromParent();
    this.context = null;
    void this.scratch;
  }
}

/** A position-only, non-indexed copy of a geometry with a matrix applied, for merging into a shadow caster. */
function positionsOnly(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const copy = new THREE.BufferGeometry();
  copy.setAttribute('position', flat.getAttribute('position').clone());
  if (flat !== geometry) flat.dispose();
  copy.applyMatrix4(matrix);
  return copy;
}

import * as THREE from 'three';
import { overlayUniforms } from '../core/overlay';
import type { GroundQuery } from '../core/types';
import { pointAt, type RoutePath } from './route';
import type { EnvironmentSample } from '../../lib/mission/driveEnvironment';

/**
 * The planning overlay: a thin line on the visible ground (re-read from the terrain when levels change), amber where
 * the calculation says the Sun is visible on arrival and dimmer where it is not. Drawn in screen-space width so it stays
 * thin at any distance, depth-tested so ridges hide it, and scaled by the camera exposure so it keeps one colour on screen.
 */
export const ROUTE_LINE = {
  spacingM: 4,
  widthPx: 2.2,
  /** Lift above the ground: a little near, growing with distance so coarse terrain meshes cannot hide it. */
  liftM: 0.12,
  liftPerM: 0.0015,
  /**
   * One flat, unlit colour for lit and shadowed ground alike. It is divided by the camera exposure, so on screen it keeps
   * the same low luminance whatever the scene is doing: bright enough to read against sunlit regolith and against the
   * near-black of a shadow, never bright enough to glow.
   */
  colour: [0.5, 0.31, 0.08] as const,
  /** Beyond this far along the route from the rover the line is dashed. */
  solidAheadM: 50,
  dashM: 3,
  gapM: 3,
} as const;

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aOther;
attribute float aSide;
attribute float aS;
uniform vec2 uViewport;
uniform float uLift;
uniform float uLiftPerM;
uniform float uWidth;
varying float vS;
vec3 lifted(vec3 p) {
  return p + vec3(0.0, uLift + uLiftPerM * distance(p, cameraPosition), 0.0);
}
void main() {
  vec4 a = projectionMatrix * viewMatrix * vec4(lifted(position), 1.0);
  vec4 b = projectionMatrix * viewMatrix * vec4(lifted(aOther), 1.0);
  float eps = 0.05;
  vec4 p = a;
  if (a.w < eps) {
    if (b.w < eps) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vS = aS;
      return;
    }
    p = mix(a, b, (eps - a.w) / (b.w - a.w));
  }
  vec4 q = b;
  if (b.w < eps) q = mix(b, a, (eps - b.w) / (a.w - b.w));
  vec2 pa = p.xy / p.w * uViewport * 0.5;
  vec2 pb = q.xy / q.w * uViewport * 0.5;
  vec2 dir = pb - pa;
  float len = length(dir);
  dir = len > 1e-4 ? dir / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  vec2 offset = normal * aSide * uWidth * 0.5;
  gl_Position = vec4(p.xy + offset / (uViewport * 0.5) * p.w, p.z, p.w);
  vS = aS;
  #include <logdepthbuf_vertex>
}`;

const fragmentShader = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform sampler2D lmlExposure;
uniform vec3 uColour;
uniform float uAlpha;
uniform float uRoverS;
uniform vec3 uDash;
varying float vS;
void main() {
  #include <logdepthbuf_fragment>
  float ahead = vS - uRoverS;
  if (ahead > uDash.x && fract((vS - uDash.x) / (uDash.y + uDash.z)) * (uDash.y + uDash.z) > uDash.y) discard;
  float exposure = max(texture2D(lmlExposure, vec2(0.5)).r, 1.0e-4);
  gl_FragColor = vec4(uColour / exposure, uAlpha);
}`;

/** The target marker is always solid: its along-route coordinate is far behind the rover. */
const MARKER_S = -1e6;

class LineMesh {
  readonly mesh: THREE.Mesh;
  readonly positions: Float32Array;
  readonly others: Float32Array;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly count: number;

  constructor(segments: number, material: THREE.Material) {
    this.count = segments;
    this.positions = new Float32Array(segments * 4 * 3);
    this.others = new Float32Array(segments * 4 * 3);
    const sides = new Float32Array(segments * 4);
    const along = new Float32Array(segments * 4);
    const indices = new Uint32Array(segments * 6);
    for (let s = 0; s < segments; s += 1) {
      sides.set([-1, 1, -1, 1], s * 4);
      indices.set([s * 4, s * 4 + 1, s * 4 + 2, s * 4 + 2, s * 4 + 1, s * 4 + 3], s * 6);
    }
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aOther', new THREE.BufferAttribute(this.others, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
    this.geometry.setAttribute('aS', new THREE.BufferAttribute(along, 1));
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  get alongAttribute(): Float32Array {
    return (this.geometry.getAttribute('aS') as THREE.BufferAttribute).array as Float32Array;
  }

  /** Segment s runs from point a to point b (distances along the route sa and sb); both endpoints are written for both sides. */
  setSegment(s: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, sa: number, sb: number): void {
    const alongArray = this.alongAttribute;
    for (let v = 0; v < 4; v += 1) {
      const atStart = v < 2;
      const o = (s * 4 + v) * 3;
      this.positions[o] = atStart ? ax : bx;
      this.positions[o + 1] = atStart ? ay : by;
      this.positions[o + 2] = atStart ? az : bz;
      this.others[o] = atStart ? bx : ax;
      this.others[o + 1] = atStart ? by : ay;
      this.others[o + 2] = atStart ? bz : az;
      alongArray[s * 4 + v] = atStart ? sa : sb;
    }
  }

  touch(): void {
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aOther') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aS') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

export class RouteOverlay {
  readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private line: LineMesh | null = null;
  private marker: LineMesh | null = null;
  private path: RoutePath | null = null;
  private pointX: number[] = [];
  private pointZ: number[] = [];
  private pointS: number[] = [];
  private version = -1;
  private markerAt: { x: number; z: number } | null = null;
  private markerRadius = 0;
  private readonly viewport = new THREE.Vector2(1, 1);

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        lmlExposure: overlayUniforms.lmlExposure,
        uViewport: { value: this.viewport },
        uLift: { value: ROUTE_LINE.liftM },
        uLiftPerM: { value: ROUTE_LINE.liftPerM },
        uWidth: { value: ROUTE_LINE.widthPx },
        uColour: { value: new THREE.Vector3(...ROUTE_LINE.colour) },
        uAlpha: { value: 0.95 },
        uRoverS: { value: 0 },
        uDash: { value: new THREE.Vector3(ROUTE_LINE.solidAheadM, ROUTE_LINE.dashM, ROUTE_LINE.gapM) },
      },
    });
    this.group.name = 'route';
  }

  /** Where the rover is along the route: the line is solid for the next 50 m and dashed beyond. */
  setProgress(s: number): void {
    (this.material.uniforms.uRoverS as THREE.IUniform<number>).value = s;
  }

  /** Set the path. The environment samples are no longer drawn: the line has one colour on lit and shadowed ground. */
  setRoute(path: RoutePath | null, _environment: EnvironmentSample[]): void {
    this.path = path;
    this.version = -1;
    this.line?.mesh.removeFromParent();
    this.line?.dispose();
    this.line = null;
    this.pointX = [];
    this.pointZ = [];
    this.pointS = [];
    if (!path) return;
    const tmp = { x: 0, z: 0, tx: 0, tz: 0 };
    const count = Math.max(2, Math.ceil(path.total / ROUTE_LINE.spacingM) + 1);
    for (let k = 0; k < count; k += 1) {
      const s = (k / (count - 1)) * path.total;
      pointAt(path, s, tmp);
      this.pointX.push(tmp.x);
      this.pointZ.push(tmp.z);
      this.pointS.push(s);
    }
    this.line = new LineMesh(count - 1, this.material);
    this.group.add(this.line.mesh);
  }

  setTarget(x: number, z: number): void {
    this.markerAt = { x, z };
    this.markerRadius = 0;
  }

  clearTarget(): void {
    this.markerAt = null;
    this.marker?.mesh.removeFromParent();
    this.marker?.dispose();
    this.marker = null;
  }

  /** Conform the line to the ground (when terrain changed) and size the marker to the camera distance. */
  update(ground: GroundQuery, terrainVersion: number, camera: THREE.PerspectiveCamera, viewportPx: THREE.Vector2): void {
    this.viewport.copy(viewportPx);
    if (this.line && terrainVersion !== this.version) {
      this.version = terrainVersion;
      const n = this.pointX.length;
      const ys: number[] = [];
      for (let k = 0; k < n; k += 1) {
        const h = ground.heightAt(this.pointX[k] as number, this.pointZ[k] as number);
        ys.push(Number.isFinite(h) ? h : -1e5);
      }
      for (let k = 0; k + 1 < n; k += 1) {
        this.line.setSegment(k, this.pointX[k] as number, ys[k] as number, this.pointZ[k] as number, this.pointX[k + 1] as number, ys[k + 1] as number, this.pointZ[k + 1] as number, this.pointS[k] as number, this.pointS[k + 1] as number);
      }
      this.line.touch();
    }
    if (this.markerAt) {
      const distance = camera.position.distanceTo(new THREE.Vector3(this.markerAt.x, camera.position.y - 1, this.markerAt.z));
      const radius = Math.max(3, Math.min(120, distance * 0.012));
      if (!this.marker || Math.abs(radius - this.markerRadius) > 0.1 * this.markerRadius || terrainVersion !== this.markerVersion) {
        this.markerRadius = radius;
        this.markerVersion = terrainVersion;
        this.buildMarker(ground, this.markerAt.x, this.markerAt.z, radius);
      }
    }
  }

  private markerVersion = -1;

  private buildMarker(ground: GroundQuery, cx: number, cz: number, radius: number): void {
    this.marker?.mesh.removeFromParent();
    this.marker?.dispose();
    const ringSegments = 40;
    const spokes = 4;
    const marker = new LineMesh(ringSegments + spokes * 2, this.material);
    const y = (x: number, z: number): number => {
      const h = ground.heightAt(x, z);
      return Number.isFinite(h) ? h : -1e5;
    };
    let s = 0;
    for (let k = 0; k < ringSegments; k += 1) {
      const a0 = (k / ringSegments) * Math.PI * 2;
      const a1 = ((k + 1) / ringSegments) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * radius;
      const z0 = cz + Math.sin(a0) * radius;
      const x1 = cx + Math.cos(a1) * radius;
      const z1 = cz + Math.sin(a1) * radius;
      marker.setSegment(s, x0, y(x0, z0), z0, x1, y(x1, z1), z1, MARKER_S, MARKER_S);
      s += 1;
    }
    for (let k = 0; k < spokes; k += 1) {
      const a = (k / spokes) * Math.PI * 2 + Math.PI / 4;
      for (const [r0, r1] of [[radius * 0.15, radius * 0.5]] as const) {
        const x0 = cx + Math.cos(a) * r0;
        const z0 = cz + Math.sin(a) * r0;
        const x1 = cx + Math.cos(a) * r1;
        const z1 = cz + Math.sin(a) * r1;
        marker.setSegment(s, x0, y(x0, z0), z0, x1, y(x1, z1), z1, MARKER_S, MARKER_S);
        s += 1;
      }
    }
    for (; s < ringSegments + spokes * 2; s += 1) marker.setSegment(s, cx, -1e5, cz, cx, -1e5, cz, MARKER_S, MARKER_S);
    marker.touch();
    this.marker = marker;
    this.group.add(marker.mesh);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  dispose(): void {
    this.line?.dispose();
    this.marker?.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}

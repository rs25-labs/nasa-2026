import * as THREE from 'three';
import { OBJECT_SHADOW } from './constants';
import { sharedLight } from './uniforms';

const casters = new Set<THREE.Object3D>();

/**
 * Uniforms for depth materials that cull by position (instanced casters): the horizontal axis across the
 * light and the half width of the map being drawn. Updated before each map is rendered.
 */
export const shadowPassUniforms = {
  lmlCullAxis: { value: new THREE.Vector2(1, 0) },
  lmlCullHalf: { value: 1e9 },
  /** Casters whose largest half size is below this are left out (the map's texels are too coarse to show them). */
  lmlCullMinSize: { value: 0 },
};
const roverCasters = new Set<THREE.Object3D>();
/** The point the rover's shadow map is centred on (the rover's body), updated by the rover each frame. */
export const roverShadowFocus = new THREE.Vector3();
let casterVersion = 0;

/** Mark the rover's meshes: they cast into the rover's own map (centred on the rover) and nowhere else. */
export function addRoverShadowCaster(object: THREE.Object3D): void {
  roverCasters.add(object);
  object.traverse((child) => child.layers.enable(OBJECT_SHADOW.rover.layer));
}

export function removeRoverShadowCaster(object: THREE.Object3D): void {
  roverCasters.delete(object);
  object.traverse((child) => child.layers.disable(OBJECT_SHADOW.rover.layer));
}

/**
 * Mark an object (already added to the scene) so it casts sharp Sun shadows onto lit surfaces nearby.
 * A mesh whose geometry is placed by its own vertex shader can set `userData.shadowMaterial` to a material
 * that does the same placement for the depth pass. An object that never moves can set `userData.staticShadow`;
 * the maps are only redrawn when something changes (or any caster is not static).
 */
export function addShadowCaster(object: THREE.Object3D): void {
  casters.add(object);
  object.traverse((child) => child.layers.enable(OBJECT_SHADOW.layer));
  casterVersion += 1;
}

export function removeShadowCaster(object: THREE.Object3D): void {
  casters.delete(object);
  object.traverse((child) => child.layers.disable(OBJECT_SHADOW.layer));
  casterVersion += 1;
}

/** Call when a caster's shape or position changed without the object moving (instance data, say). */
export function touchShadowCasters(): void {
  casterVersion += 1;
}

export function shadowCasterCount(): number {
  return casters.size;
}

interface Cascade {
  target: THREE.WebGLRenderTarget;
  camera: THREE.OrthographicCamera;
  halfExtent: number;
  halfDepth: number;
  minCasterHalfSize: number;
  matrix: THREE.Matrix4;
  lastKey: string;
  /** The focus is snapped to this grid (metres) across the rays: much coarser than a texel for the wide maps, so they redraw rarely. */
  snap: number;
  stale: boolean;
}

/**
 * Orthographic depth maps around the camera, looking down the Sun's rays: a tight one for small things near
 * the viewer and a wide one for large things farther out. Only objects on the caster layer are drawn into
 * them. Terrain does not cast here: it shadows through the height-field march.
 */
export class ObjectShadow {
  private readonly cascades: Cascade[];
  private readonly depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  private readonly toLight = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();
  private readonly swapped: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];
  private active = false;
  private primed = false;
  private readonly rover: Cascade;

  constructor() {
    this.cascades = OBJECT_SHADOW.cascades.map((spec) => {
      const depth = new THREE.DepthTexture(OBJECT_SHADOW.size, OBJECT_SHADOW.size);
      depth.type = THREE.FloatType;
      depth.minFilter = THREE.LinearFilter;
      depth.magFilter = THREE.LinearFilter;
      depth.compareFunction = THREE.LessEqualCompare;
      const target = new THREE.WebGLRenderTarget(OBJECT_SHADOW.size, OBJECT_SHADOW.size, {
        depthBuffer: true,
        depthTexture: depth,
        type: THREE.UnsignedByteType,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        generateMipmaps: false,
      });
      const camera = new THREE.OrthographicCamera(
        -spec.halfExtent,
        spec.halfExtent,
        spec.halfExtent,
        -spec.halfExtent,
        0.1,
        2 * spec.halfDepth,
      );
      camera.layers.set(OBJECT_SHADOW.layer);
      return { target, camera, halfExtent: spec.halfExtent, halfDepth: spec.halfDepth, minCasterHalfSize: spec.minCasterHalfSize, matrix: new THREE.Matrix4(), lastKey: '', snap: Math.max((2 * spec.halfExtent) / OBJECT_SHADOW.size, spec.halfExtent / 8), stale: true };
    });
    const spec = OBJECT_SHADOW.rover;
    const roverDepth = new THREE.DepthTexture(spec.size, spec.size);
    roverDepth.type = THREE.FloatType;
    roverDepth.minFilter = THREE.LinearFilter;
    roverDepth.magFilter = THREE.LinearFilter;
    roverDepth.compareFunction = THREE.LessEqualCompare;
    const roverTarget = new THREE.WebGLRenderTarget(spec.size, spec.size, {
      depthBuffer: true,
      depthTexture: roverDepth,
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    const roverCamera = new THREE.OrthographicCamera(-spec.halfExtent, spec.halfExtent, spec.halfExtent, -spec.halfExtent, 0.1, 2 * spec.halfDepth);
    roverCamera.layers.set(spec.layer);
    this.rover = { target: roverTarget, camera: roverCamera, halfExtent: spec.halfExtent, halfDepth: spec.halfDepth, minCasterHalfSize: 0, matrix: new THREE.Matrix4(), lastKey: '', snap: (2 * spec.halfExtent) / spec.size, stale: true };
    sharedLight.lmlShadowMapRover.value = roverDepth;
    this.cascades.forEach((cascade, index) => {
      (sharedLight[`lmlShadowMap${index}`] as THREE.IUniform).value = cascade.target.depthTexture;
    });
  }

  get enabled(): boolean {
    return this.active;
  }

  /** Render the casters for the current Sun direction around `centre`. */
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, centre: THREE.Vector3, sunDirection: THREE.Vector3): void {
    if (!this.primed) {
      // A depth texture that was never rendered into is not allocated; sampling it breaks every draw that uses the lighting shaders.
      this.primed = true;
      for (const cascade of [...this.cascades, this.rover]) {
        renderer.setRenderTarget(cascade.target);
        renderer.clear(false, true, false);
      }
    }
    this.active = casters.size > 0;
    const roverActive = roverCasters.size > 0;
    for (let index = 0; index < this.cascades.length; index += 1) {
      (sharedLight[`lmlShadowParams${index}`] as THREE.IUniform<THREE.Vector3>).value.x = this.active ? 1 : 0;
    }
    sharedLight.lmlShadowParamsRover.value.x = roverActive ? 1 : 0;
    if (!this.active && !roverActive) return;
    this.toLight.copy(sunDirection);
    this.up.set(0, 1, 0);
    if (Math.abs(this.toLight.y) > 0.99) this.up.set(1, 0, 0);
    this.right.crossVectors(this.up, this.toLight).normalize();
    this.up.crossVectors(this.toLight, this.right).normalize();

    // A map is kept while the Sun, its focus and the set of casters are unchanged and every caster is static.
    const dynamic = ![...casters].every((caster) => caster.userData.staticShadow === true);
    let anyStale = dynamic;
    if (this.active) {
      this.cascades.forEach((cascade, index) => {
        const uniforms = sharedLight[`lmlShadowMatrix${index}`] as THREE.IUniform<THREE.Matrix4>;
        const params = sharedLight[`lmlShadowParams${index}`] as THREE.IUniform<THREE.Vector3>;
        const texel = (2 * cascade.halfExtent) / OBJECT_SHADOW.size;
        this.placeCascade(cascade, centre, cascade.snap);
        uniforms.value.copy(cascade.matrix);
        // Bias in map depth units. Light is nearly horizontal at the pole, so depth along the light is almost distance along the
        // ground: every metre of bias moves the start of a shadow a metre away from its rock. One texel is enough (the
        // depth map is 32-bit float, so no precision floor is needed beyond a few millimetres).
        params.value.y = (1.0 * texel) / (2 * cascade.halfDepth) + 2e-6;
        params.value.z = 1 / OBJECT_SHADOW.size;
        const key = `${casterVersion}|${cascade.matrix.elements.join(',')}`;
        cascade.stale = dynamic || key !== cascade.lastKey;
        if (cascade.stale) {
          cascade.lastKey = key;
          anyStale = true;
        }
      });
    }
    if (roverActive) {
      const spec = OBJECT_SHADOW.rover;
      const texel = (2 * spec.halfExtent) / spec.size;
      this.placeCascade(this.rover, roverShadowFocus, texel);
      sharedLight.lmlShadowMatrixRover.value.copy(this.rover.matrix);
      sharedLight.lmlShadowParamsRover.value.set(1, spec.biasMetres / (2 * spec.halfDepth), 1 / spec.size);
    }
    if (!anyStale && !roverActive) return;

    const previousBackground = scene.background;
    scene.background = null;
    shadowPassUniforms.lmlCullAxis.value.set(this.right.x, this.right.z).normalize();
    if (anyStale && this.active) {
      this.swapMaterials(casters, true);
      for (const cascade of this.cascades) {
        if (!cascade.stale) continue;
        shadowPassUniforms.lmlCullHalf.value = cascade.halfExtent;
        shadowPassUniforms.lmlCullMinSize.value = cascade.minCasterHalfSize;
        renderer.setRenderTarget(cascade.target);
        renderer.clear(false, true, false);
        renderer.render(scene, cascade.camera);
      }
      this.swapMaterials(casters, false);
    }
    if (roverActive) {
      this.swapMaterials(roverCasters, true);
      renderer.setRenderTarget(this.rover.target);
      renderer.clear(false, true, false);
      renderer.render(scene, this.rover.camera);
      this.swapMaterials(roverCasters, false);
    }
    scene.background = previousBackground;
  }

  /** Aim a cascade's orthographic camera down the Sun's rays at `centre`, snapped to the texel grid across the rays. */
  private placeCascade(cascade: Cascade, centre: THREE.Vector3, texel: number): void {
    const along = Math.round(this.focus.copy(centre).dot(this.toLight) / texel) * texel;
    const x = Math.round(centre.dot(this.right) / texel) * texel;
    const y = Math.round(centre.dot(this.up) / texel) * texel;
    this.focus.set(0, 0, 0).addScaledVector(this.right, x).addScaledVector(this.up, y).addScaledVector(this.toLight, along);
    cascade.camera.position.copy(this.focus).addScaledVector(this.toLight, cascade.halfDepth);
    cascade.camera.up.copy(this.up);
    cascade.camera.lookAt(this.focus);
    cascade.camera.updateMatrixWorld(true);
    cascade.camera.updateProjectionMatrix();
    cascade.matrix.multiplyMatrices(cascade.camera.projectionMatrix, cascade.camera.matrixWorldInverse);
  }

  /** Give every caster mesh its depth material for the pass, then restore. */
  private swapMaterials(roots: Set<THREE.Object3D>, forward: boolean): void {
    if (!forward) {
      for (const entry of this.swapped) entry.mesh.material = entry.material;
      this.swapped.length = 0;
      return;
    }
    for (const root of roots) {
      root.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        this.swapped.push({ mesh: child, material: child.material });
        child.material = (child.userData.shadowMaterial as THREE.Material | undefined) ?? this.depthMaterial;
      });
    }
  }

  dispose(): void {
    for (const cascade of this.cascades) {
      cascade.target.dispose();
      cascade.target.depthTexture?.dispose();
    }
    this.rover.target.dispose();
    this.rover.target.depthTexture?.dispose();
    sharedLight.lmlShadowMapRover.value = null;
    sharedLight.lmlShadowParamsRover.value.x = 0;
    this.depthMaterial.dispose();
    for (let index = 0; index < this.cascades.length; index += 1) {
      (sharedLight[`lmlShadowMap${index}`] as THREE.IUniform).value = null;
      (sharedLight[`lmlShadowParams${index}`] as THREE.IUniform<THREE.Vector3>).value.x = 0;
    }
  }
}

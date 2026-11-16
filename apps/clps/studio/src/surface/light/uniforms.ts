import * as THREE from 'three';

export const LEVEL_COUNT = 8;

/**
 * The uniforms every lit material shares. One Surface view exists at a time, so these are module-level:
 * a material that includes `LIGHTING_GLSL` and lists `lightingUniforms()` in its own uniforms is lit by
 * the same Sun, Earth, terrain shadows and bounce light as the ground.
 */
export interface LightUniformSet {
  [name: string]: THREE.IUniform;
  lmlHeights: THREE.IUniform<THREE.Texture | null>;
  lmlHorizon: THREE.IUniform<THREE.Texture | null>;
  lmlBounce: THREE.IUniform<THREE.Texture | null>;
  /** Outgoing radiance averaged over 16 x 16 texels, 17 x 17 per level. */
  lmlBounceCoarse: THREE.IUniform<THREE.Texture | null>;
  /** Bounced irradiance at each texel (times LML_BOUNCE_SCALE), gathered in the bake. */
  lmlBounceIn: THREE.IUniform<THREE.Texture | null>;
  /** Per level: centre x, centre z, half span, spacing. Half span below zero means not loaded. */
  lmlLevel: THREE.IUniform<THREE.Vector4[]>;
  lmlMaxHeight: THREE.IUniform<number>;
  /** 1 when float height textures can be filtered in hardware, else 0. */
  lmlLinearHeights: THREE.IUniform<number>;
  /** Direction to the Sun (unit, scene axes). */
  lmlSunDirection: THREE.IUniform<THREE.Vector3>;
  /** Sun: horizontal unit direction x, z, tan(elevation), angular radius in radians. */
  lmlSun: THREE.IUniform<THREE.Vector4>;
  lmlEarthDirection: THREE.IUniform<THREE.Vector3>;
  /** Earth: horizontal unit direction x, z, tan(elevation), angular radius in radians. */
  lmlEarth: THREE.IUniform<THREE.Vector4>;
  /** Earthshine irradiance relative to direct sunlight, before the horizon test. */
  lmlEarthIrradiance: THREE.IUniform<number>;
  lmlEarthTint: THREE.IUniform<THREE.Vector3>;
  /** Four object shadow cascades, finest first: map, matrix, and (active 0 or 1, depth bias in map depth units, texel size in uv). */
  lmlShadowMap0: THREE.IUniform<THREE.Texture | null>;
  lmlShadowMatrix0: THREE.IUniform<THREE.Matrix4>;
  lmlShadowParams0: THREE.IUniform<THREE.Vector3>;
  lmlShadowMap1: THREE.IUniform<THREE.Texture | null>;
  lmlShadowMatrix1: THREE.IUniform<THREE.Matrix4>;
  lmlShadowParams1: THREE.IUniform<THREE.Vector3>;
  lmlShadowMap2: THREE.IUniform<THREE.Texture | null>;
  lmlShadowMatrix2: THREE.IUniform<THREE.Matrix4>;
  lmlShadowParams2: THREE.IUniform<THREE.Vector3>;
  lmlShadowMap3: THREE.IUniform<THREE.Texture | null>;
  lmlShadowMatrix3: THREE.IUniform<THREE.Matrix4>;
  lmlShadowParams3: THREE.IUniform<THREE.Vector3>;
  /** The rover's own map (see OBJECT_SHADOW.rover): same meaning, centred on the rover. */
  lmlShadowMapRover: THREE.IUniform<THREE.Texture | null>;
  lmlShadowMatrixRover: THREE.IUniform<THREE.Matrix4>;
  lmlShadowParamsRover: THREE.IUniform<THREE.Vector3>;
  /** Headlamp positions and unit beam directions (scene axes); lmlLampOn is 0 or 1. */
  lmlLampPos: THREE.IUniform<THREE.Vector3[]>;
  lmlLampDir: THREE.IUniform<THREE.Vector3[]>;
  lmlLampOn: THREE.IUniform<number>;
  /** Fraction of a turn the soft-shadow kernels are rotated by this frame (a deterministic sequence; see the camera pipeline). */
  lmlShadowTurn: THREE.IUniform<number>;
}

const shared: LightUniformSet = {
  lmlHeights: { value: null },
  lmlHorizon: { value: null },
  lmlBounce: { value: null },
  lmlBounceCoarse: { value: null },
  lmlBounceIn: { value: null },
  lmlLevel: { value: Array.from({ length: LEVEL_COUNT }, () => new THREE.Vector4(0, 0, -1, 1)) },
  lmlMaxHeight: { value: 0 },
  lmlLinearHeights: { value: 0 },
  lmlSunDirection: { value: new THREE.Vector3(0, -1, 0) },
  lmlSun: { value: new THREE.Vector4(1, 0, -1, 0.0046) },
  lmlEarthDirection: { value: new THREE.Vector3(0, -1, 0) },
  lmlEarth: { value: new THREE.Vector4(1, 0, -1, 0.0166) },
  lmlEarthIrradiance: { value: 0 },
  lmlEarthTint: { value: new THREE.Vector3(1, 1, 1) },
  lmlShadowMap0: { value: null },
  lmlShadowMatrix0: { value: new THREE.Matrix4() },
  lmlShadowParams0: { value: new THREE.Vector3(0, 0, 0) },
  lmlShadowMap1: { value: null },
  lmlShadowMatrix1: { value: new THREE.Matrix4() },
  lmlShadowParams1: { value: new THREE.Vector3(0, 0, 0) },
  lmlShadowMap2: { value: null },
  lmlShadowMatrix2: { value: new THREE.Matrix4() },
  lmlShadowParams2: { value: new THREE.Vector3(0, 0, 0) },
  lmlShadowMap3: { value: null },
  lmlShadowMatrix3: { value: new THREE.Matrix4() },
  lmlShadowParams3: { value: new THREE.Vector3(0, 0, 0) },
  lmlShadowMapRover: { value: null },
  lmlShadowMatrixRover: { value: new THREE.Matrix4() },
  lmlShadowParamsRover: { value: new THREE.Vector3(0, 0, 0) },
  lmlLampPos: { value: [new THREE.Vector3(), new THREE.Vector3()] },
  lmlLampDir: { value: [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, -1)] },
  lmlLampOn: { value: 0 },
  lmlShadowTurn: { value: 0 },
};

/** The shared uniform objects. Spread into a material's uniforms; the values stay shared. */
export function lightingUniforms(): LightUniformSet {
  return { ...shared };
}

export const sharedLight: LightUniformSet = shared;

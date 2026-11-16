import * as THREE from 'three';

/** Camera glare. Energy-conserving: the glare image is a normalised blend of blurs, mixed into the frame by `mix`. */
export const BLOOM = {
  /** Fraction of the final HDR frame taken from the blurred image. The rest is the sharp image. */
  mix: 0.001,
  /** Half-resolution first level, then halved each level. */
  levels: 6,
  /** Weight of the wider blur at each merge; level weights halve toward the wide end and sum to 1. */
  upWeight: 0.5,
} as const;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** 13-tap downsample: weights sum to 1, no threshold, so nothing is added or removed. */
const downFragment = /* glsl */ `
uniform sampler2D source;
uniform vec2 texel;
varying vec2 vUv;
vec3 tap(vec2 offset) { return texture2D(source, vUv + offset * texel).rgb; }
void main() {
  vec3 a = tap(vec2(-2.0, 2.0)); vec3 b = tap(vec2(0.0, 2.0)); vec3 c = tap(vec2(2.0, 2.0));
  vec3 d = tap(vec2(-2.0, 0.0)); vec3 e = tap(vec2(0.0, 0.0)); vec3 f = tap(vec2(2.0, 0.0));
  vec3 g = tap(vec2(-2.0, -2.0)); vec3 h = tap(vec2(0.0, -2.0)); vec3 i = tap(vec2(2.0, -2.0));
  vec3 j = tap(vec2(-1.0, 1.0)); vec3 k = tap(vec2(1.0, 1.0));
  vec3 l = tap(vec2(-1.0, -1.0)); vec3 m = tap(vec2(1.0, -1.0));
  vec3 result = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  gl_FragColor = vec4(result, 1.0);
}`;

/** Merge a wider blur (tent filter, weights sum to 1) into the level below it. */
const upFragment = /* glsl */ `
uniform sampler2D narrow;
uniform sampler2D wide;
uniform vec2 wideTexel;
uniform float wideWeight;
varying vec2 vUv;
vec3 tap(vec2 offset) { return texture2D(wide, vUv + offset * wideTexel).rgb; }
void main() {
  vec3 tent =
    tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0)) + tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) +
    2.0 * (tap(vec2(0.0, 1.0)) + tap(vec2(0.0, -1.0)) + tap(vec2(-1.0, 0.0)) + tap(vec2(1.0, 0.0))) +
    4.0 * tap(vec2(0.0, 0.0));
  tent /= 16.0;
  gl_FragColor = vec4(mix(texture2D(narrow, vUv).rgb, tent, wideWeight), 1.0);
}`;

function target(width: number, height: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    generateMipmaps: false,
  });
}

class Pass {
  readonly material: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(geometry: THREE.BufferGeometry, fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
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

  render(renderer: THREE.WebGLRenderer, output: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(output);
    renderer.render(this.scene, this.camera);
  }
}

/** Downsample chain from half resolution, then merge back up. `render` returns the glare image (half resolution). */
export class BloomChain {
  private readonly triangle = new THREE.BufferGeometry();
  private readonly down: THREE.WebGLRenderTarget[] = [];
  private readonly merged: THREE.WebGLRenderTarget[] = [];
  private readonly downPass: Pass;
  private readonly upPass: Pass;

  constructor(width: number, height: number) {
    this.triangle.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.downPass = new Pass(this.triangle, downFragment, {
      source: { value: null },
      texel: { value: new THREE.Vector2() },
    });
    this.upPass = new Pass(this.triangle, upFragment, {
      narrow: { value: null },
      wide: { value: null },
      wideTexel: { value: new THREE.Vector2() },
      wideWeight: { value: BLOOM.upWeight },
    });
    this.allocate(width, height);
  }

  get texture(): THREE.Texture {
    return (this.merged[0] as THREE.WebGLRenderTarget).texture;
  }

  setSize(width: number, height: number): void {
    this.release();
    this.allocate(width, height);
  }

  render(renderer: THREE.WebGLRenderer, source: THREE.Texture, sourceWidth: number, sourceHeight: number): THREE.Texture {
    const down = this.downPass.material.uniforms;
    let inputTexture = source;
    let inputWidth = sourceWidth;
    let inputHeight = sourceHeight;
    for (const output of this.down) {
      (down.source as THREE.IUniform).value = inputTexture;
      (down.texel as THREE.IUniform<THREE.Vector2>).value.set(1 / inputWidth, 1 / inputHeight);
      this.downPass.render(renderer, output);
      inputTexture = output.texture;
      inputWidth = output.width;
      inputHeight = output.height;
    }
    const up = this.upPass.material.uniforms;
    for (let level = this.down.length - 2; level >= 0; level -= 1) {
      const narrow = this.down[level] as THREE.WebGLRenderTarget;
      const wide = (level === this.down.length - 2 ? this.down[level + 1] : this.merged[level + 1]) as THREE.WebGLRenderTarget;
      (up.narrow as THREE.IUniform).value = narrow.texture;
      (up.wide as THREE.IUniform).value = wide.texture;
      (up.wideTexel as THREE.IUniform<THREE.Vector2>).value.set(1 / wide.width, 1 / wide.height);
      this.upPass.render(renderer, this.merged[level] as THREE.WebGLRenderTarget);
    }
    return this.texture;
  }

  dispose(): void {
    this.release();
    this.triangle.dispose();
    this.downPass.material.dispose();
    this.upPass.material.dispose();
  }

  private allocate(width: number, height: number): void {
    for (let level = 0; level < BLOOM.levels; level += 1) {
      const w = Math.max(1, Math.ceil(width / 2 ** (level + 1)));
      const h = Math.max(1, Math.ceil(height / 2 ** (level + 1)));
      this.down.push(target(w, h));
      this.merged.push(target(w, h));
    }
  }

  private release(): void {
    for (const t of this.down) t.dispose();
    for (const t of this.merged) t.dispose();
    this.down.length = 0;
    this.merged.length = 0;
  }
}

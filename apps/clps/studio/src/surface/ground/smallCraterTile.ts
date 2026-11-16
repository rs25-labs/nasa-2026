import * as THREE from 'three';
import { CRATERS, STRIDE, craterBuffer, generateCell, profile } from './craters';

/**
 * The smallest crater octaves (0.5 to 4 m across) as a gradient texture that repeats over the map. Each octave has its own layer and period
 * (32, 64, 128 m: 16 hashed cells of the octave's grid per side, the same cells `generateCell` gives the CPU), 1024 texels per side. The
 * terrain shader samples it with trilinear filtering, so each octave fades out by itself as the pixel footprint grows past its craters
 * (a gradient averaged over a pixel is the gradient of the smoothed relief), by distance from the camera and not by terrain level.
 * One fetch per octave replaces the per-fragment crater loop, which cost several milliseconds a frame.
 */
export const TILE_OCTAVES = 3;
export const TILE_SIZE = 1024;
export const TILE_PERIODS: readonly number[] = [32, 64, 128];
/** Each layer is sampled in a frame turned by this angle (radians), so the repeat lattices of the layers do not line up. */
export const TILE_TURNS: readonly number[] = [0.0, 0.5, 1.1];

const float32 = new Float32Array(1);
const uint32 = new Uint32Array(float32.buffer);

function toHalf(value: number): number {
  float32[0] = value;
  const x = uint32[0] as number;
  const sign = (x >>> 16) & 0x8000;
  const exponent = ((x >>> 23) & 0xff) - 127 + 15;
  if (exponent <= 0) return sign;
  if (exponent >= 31) return sign | 0x7bff;
  const mantissa = (x >>> 13) & 0x3ff;
  return sign | (((exponent << 10) | mantissa) + ((x >>> 12) & 1));
}

function wrap(i: number): number {
  return ((i % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
}

/** Relief of one octave's craters on a periodic grid of TILE_SIZE texels, then its gradient (x, y in the map frame) as half floats. */
function buildLayer(octave: number, out: Uint16Array): void {
  const period = TILE_PERIODS[octave] as number;
  const spacing = period / TILE_SIZE;
  const n = TILE_SIZE;
  const height = new Float32Array(n * n);
  const buffer = craterBuffer();
  const cell = CRATERS.cellFactor * CRATERS.smallestDiameterM * 2 ** octave;
  const cells = Math.round(period / cell);
  for (let cj = 0; cj < cells; cj += 1) {
    for (let ci = 0; ci < cells; ci += 1) {
      const count = generateCell(octave, ci, cj, buffer);
      for (let m = 0; m < count; m += 1) {
        const o = m * STRIDE;
        const cx = buffer[o] as number;
        const cy = buffer[o + 1] as number;
        const radius = buffer[o + 2] as number;
        const depth = buffer[o + 3] as number;
        const rim = buffer[o + 4] as number;
        const rounding = buffer[o + 5] as number;
        const invA = buffer[o + 6] as number;
        const invB = buffer[o + 7] as number;
        const cos = buffer[o + 8] as number;
        const sin = buffer[o + 9] as number;
        const reach = CRATERS.reach * radius * 1.12;
        const i0 = Math.floor((cx - reach) / spacing);
        const i1 = Math.ceil((cx + reach) / spacing);
        const j0 = Math.floor((cy - reach) / spacing);
        const j1 = Math.ceil((cy + reach) / spacing);
        for (let j = j0; j <= j1; j += 1) {
          const dy = j * spacing - cy;
          const row = wrap(j) * n;
          for (let i = i0; i <= i1; i += 1) {
            const dx = i * spacing - cx;
            const u = dx * cos + dy * sin;
            const v = -dx * sin + dy * cos;
            const q = Math.sqrt(u * u * invA + v * v * invB);
            if (q >= CRATERS.reach) continue;
            const k = row + wrap(i);
            height[k] = (height[k] as number) + profile(q, depth, rim, rounding);
          }
        }
      }
    }
  }
  const inverse = 1 / (2 * spacing);
  for (let j = 0; j < n; j += 1) {
    const up = wrap(j - 1) * n;
    const down = wrap(j + 1) * n;
    for (let i = 0; i < n; i += 1) {
      const k = (j * n + i) * 2;
      out[k] = toHalf(((height[j * n + wrap(i + 1)] as number) - (height[j * n + wrap(i - 1)] as number)) * inverse);
      out[k + 1] = toHalf(((height[down + i] as number) - (height[up + i] as number)) * inverse);
    }
  }
}

let built: THREE.DataArrayTexture | null = null;

/** The tile texture, built on first use (a few hundred milliseconds, once per page). */
export function smallCraterTile(): THREE.DataArrayTexture {
  if (built) return built;
  const layer = TILE_SIZE * TILE_SIZE * 2;
  const data = new Uint16Array(layer * TILE_OCTAVES);
  for (let octave = 0; octave < TILE_OCTAVES; octave += 1) buildLayer(octave, data.subarray(octave * layer, (octave + 1) * layer));
  const texture = new THREE.DataArrayTexture(data, TILE_SIZE, TILE_SIZE, TILE_OCTAVES);
  texture.format = THREE.RGFormat;
  texture.type = THREE.HalfFloatType;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 1;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  built = texture;
  return texture;
}

/**
 * Per layer: cos and sin of the layer's turn, then the layer coordinate (metres) of the site's map origin, which is computed here in double
 * precision so the shader only adds small scene offsets to it. The shader's layer coordinate is R (x, -z) + offset.
 */
export function tileTransforms(mapX: number, mapY: number): THREE.Vector4[] {
  return TILE_PERIODS.map((period, octave) => {
    const turn = TILE_TURNS[octave] as number;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const tx = c * mapX - s * mapY;
    const ty = s * mapX + c * mapY;
    return new THREE.Vector4(c, s, ((tx % period) + period) % period, ((ty % period) + period) % period);
  });
}

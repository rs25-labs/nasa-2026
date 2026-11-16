import * as THREE from 'three';
import { SKY_LAYER, STARS } from './constants';

const RAD = Math.PI / 180;

/** Brightest stars, J2000 right ascension and declination in degrees, visual magnitude. */
const CATALOGUE: ReadonlyArray<readonly [number, number, number]> = [
  [101.287, -16.716, -1.46], // Sirius
  [95.988, -52.696, -0.74], // Canopus
  [219.9, -60.834, -0.27], // Rigil Kentaurus
  [213.915, 19.182, -0.05], // Arcturus
  [279.235, 38.784, 0.03], // Vega
  [79.172, 45.998, 0.08], // Capella
  [78.634, -8.202, 0.13], // Rigel
  [114.825, 5.225, 0.34], // Procyon
  [24.429, -57.237, 0.46], // Achernar
  [88.793, 7.407, 0.5], // Betelgeuse
  [210.956, -60.373, 0.61], // Hadar
  [297.696, 8.868, 0.76], // Altair
  [186.65, -63.099, 0.77], // Acrux
  [68.98, 16.509, 0.85], // Aldebaran
  [201.298, -11.161, 0.97], // Spica
  [247.352, -26.432, 1.06], // Antares
  [116.329, 28.026, 1.14], // Pollux
  [344.413, -29.622, 1.16], // Fomalhaut
  [310.358, 45.28, 1.25], // Deneb
  [191.93, -59.689, 1.25], // Mimosa
  [152.093, 11.967, 1.35], // Regulus
  [104.656, -28.972, 1.5], // Adhara
  [113.65, 31.888, 1.58], // Castor
  [263.402, -37.104, 1.62], // Shaula
  [187.791, -57.113, 1.64], // Gacrux
  [81.283, 6.35, 1.64], // Bellatrix
  [81.573, 28.608, 1.65], // Elnath
  [138.3, -69.717, 1.68], // Miaplacidus
  [84.053, -1.202, 1.69], // Alnilam
  [332.058, -46.961, 1.74], // Alnair
  [85.19, -1.943, 1.77], // Alnitak
  [193.507, 55.96, 1.77], // Alioth
  [165.932, 61.751, 1.79], // Dubhe
  [51.081, 49.861, 1.79], // Mirfak
  [107.098, -26.393, 1.83], // Wezen
  [276.043, -34.385, 1.85], // Kaus Australis
  [125.629, -59.51, 1.86], // Avior
  [206.885, 49.313, 1.86], // Alkaid
  [264.33, -42.998, 1.87], // Sargas
  [89.882, 44.947, 1.9], // Menkalinan
  [252.166, -69.028, 1.92], // Atria
  [37.955, 89.264, 1.98], // Polaris
];

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rough blackbody tint from a colour index, linear RGB with luminance near 1. */
function tint(random: () => number, out: number[]): void {
  const warmth = random();
  const r = 0.85 + 0.35 * warmth;
  const g = 1;
  const b = 1.2 - 0.55 * warmth;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  out.push(r / luminance, g / luminance, b / luminance);
}

const vertexShader = /* glsl */ `
uniform mat3 sceneFromEquatorial;
attribute float peak;
attribute vec3 tint;
varying vec3 vColor;
void main() {
  vec3 direction = sceneFromEquatorial * position;
  vec3 view = mat3(viewMatrix) * direction;
  gl_Position = projectionMatrix * vec4(view * 1000.0, 1.0);
  gl_PointSize = ${STARS.spriteSize.toFixed(1)};
  vColor = tint * peak;
}`;

const fragmentShader = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 offset = (gl_PointCoord - 0.5) * ${STARS.spriteSize.toFixed(1)};
  float falloff = exp(-dot(offset, offset) / (2.0 * ${(STARS.sigmaPixels * STARS.sigmaPixels).toFixed(4)}));
  gl_FragColor = vec4(vColor * falloff, 0.0);
}`;

export interface StarField {
  points: THREE.Points;
  /** Maps equatorial coordinates to scene directions each frame. */
  sceneFromEquatorial: THREE.Matrix3;
  dispose(): void;
}

/**
 * Real bright stars plus generated fainter ones whose count follows N(<m) = 10^(0.5 m + 0.646).
 * The pixel value of a star falls by 10^(-0.4 m); the fixed-seed generator makes the sky identical every run.
 */
export function createStarField(): StarField {
  const random = mulberry32(STARS.seed);
  const positions: number[] = [];
  const peaks: number[] = [];
  const tints: number[] = [];
  const addStar = (x: number, y: number, z: number, magnitude: number): void => {
    positions.push(x, y, z);
    peaks.push(STARS.peakRadianceMagnitudeZero * Math.pow(10, -0.4 * magnitude));
    tint(random, tints);
  };
  for (const [ra, dec, magnitude] of CATALOGUE) {
    const alpha = ra * RAD;
    const delta = dec * RAD;
    addStar(Math.cos(delta) * Math.cos(alpha), Math.cos(delta) * Math.sin(alpha), Math.sin(delta), magnitude);
  }
  const first = Math.ceil(Math.pow(10, 0.5 * STARS.catalogueLimit + STARS.logCountAtZero));
  const last = Math.floor(Math.pow(10, 0.5 * STARS.limitingMagnitude + STARS.logCountAtZero));
  for (let rank = first; rank <= last; rank += 1) {
    const magnitude = 2 * (Math.log10(rank) - STARS.logCountAtZero);
    const z = 2 * random() - 1;
    const alpha = 2 * Math.PI * random();
    const ring = Math.sqrt(1 - z * z);
    addStar(ring * Math.cos(alpha), ring * Math.sin(alpha), z, magnitude);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('peak', new THREE.Float32BufferAttribute(peaks, 1));
  geometry.setAttribute('tint', new THREE.Float32BufferAttribute(tints, 3));
  const sceneFromEquatorial = new THREE.Matrix3();
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { sceneFromEquatorial: { value: sceneFromEquatorial } },
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.ZeroFactor,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -2;
  points.layers.set(SKY_LAYER);
  return {
    points,
    sceneFromEquatorial,
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}

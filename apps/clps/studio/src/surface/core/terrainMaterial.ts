import * as THREE from 'three';
import { RING_FRACTION } from '../ground/levelBuild';
import { craterGlsl } from '../ground/craterGlsl';
import { microGlsl } from '../ground/microGlsl';
import { lightingGlsl } from '../light/glsl';
import { lightingUniforms } from '../light/uniforms';
import { DETAIL_SIZE, detailUniforms } from './detailAtlas';
import type { LightingFrame, TerrainMaterial } from './types';

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float maturity;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vMaturity;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vMaturity = maturity;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}`;

const fragmentShader = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${lightingGlsl()}
${microGlsl()}
${craterGlsl()}
#define LML_RING_FRACTION ${RING_FRACTION}
varying vec3 vWorld;
varying vec3 vNormal;
varying float vMaturity;
uniform int uLevel;
uniform highp sampler2DArray lmlDetail;
#define LML_DETAIL_SIZE ${DETAIL_SIZE}.0
void main() {
  #include <logdepthbuf_fragment>
  vec3 normal = normalize(vNormal);
  vec3 position = vWorld;
  // Skirt vertices hang below this level's surface; light them as the ground above them.
  position.y = max(position.y, lmlHeightTriangle(uLevel, position.xz));
  vec3 toViewer = normalize(cameraPosition - position);

  // Across the outer ring of a level the shading normal moves to the slope of the next coarser grid, so the two
  // levels meet without a visible line (the line was in the normals: a 2 m grid and an 8 m grid read the same
  // surface differently).
  vec4 info = lmlLevel[uLevel];
  float edge = (info.z - max(abs(position.x - info.x), abs(position.z - info.y))) / info.z;
  bool ring = uLevel < LML_LEVELS - 1 && edge < LML_RING_FRACTION && lmlLevel[uLevel + 1].z > 0.0;
  float blend = ring ? smoothstep(0.0, LML_RING_FRACTION, edge) : 1.0;
  if (ring) {
    int coarse = uLevel + 1;
    float s = lmlLevel[coarse].w;
    float here = lmlHeightLinear(coarse, position.xz);
    float east = lmlHeightLinear(coarse, position.xz + vec2(s, 0.0));
    float south = lmlHeightLinear(coarse, position.xz + vec2(0.0, s));
    vec3 coarseNormal = normalize(vec3(-(east - here), s, -(south - here)));
    normal = normalize(mix(coarseNormal, normal, blend));
  }

  float footprint = sqrt(length(dFdx(vWorld)) * length(dFdy(vWorld)));
  vec2 slope = lmlMicroGradient(position.xz, footprint);
  // Crater relief this level's mesh cannot carry: its gradient tilts the shading normal. Trilinear mip filtering averages
  // it over the pixel footprint, so it fades by distance from the camera and never by level.
  float detailSpacing = info.w * 0.25;
  vec2 detailUv = ((position.xz - (info.xy - vec2(info.z))) / detailSpacing + 0.5) / LML_DETAIL_SIZE;
  vec2 detailGradient = texture(lmlDetail, vec3(detailUv, float(uLevel))).rg;
  slope += detailGradient;
  // Shader-side small craters (lmlCraterTileGradient, lmlCraterGradient) are parked: they cost 5 ms or more a frame.
  //slope += lmlCraterGradient(vec2(lmlCraterMap.x + position.x, lmlCraterMap.y - position.z), footprint, detailSpacing);
  vec3 shading = normalize(normal - vec3(slope.x, 0.0, slope.y));
  float micro = 1.0 - smoothstep(0.1, 0.5, footprint);
  float albedo = 1.0 + LML_MATURITY_GAIN * clamp(vMaturity, 0.0, 1.0);
  vec3 radiance = lmlSurfaceRadianceLevel(position, normal, shading, toViewer, albedo, micro, uLevel);
  gl_FragColor = vec4(radiance * LML_REGOLITH_TINT, 1.0);
}`;

/**
 * Lunar terrain: radiance from the physical lighting model in `light/` (Sun with terrain shadows and a
 * disc-sized penumbra, regolith reflectance with opposition surge, earthshine, bounced sunlight). There is
 * no ambient term; the camera exposure is the only brightness control. `SurfaceLighting` feeds the uniforms.
 * Roughness below the mesh tilts the shading normal (see `ground/microGlsl`); immature material around fresh
 * craters is a few tens of per cent brighter. Neither changes the mean level.
 */
export function createTerrainMaterial(): TerrainMaterial {
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    uniforms: { ...lightingUniforms(), ...detailUniforms, uLevel: { value: 0 } },
  });
  return {
    material,
    update(_frame: LightingFrame): void {},
    dispose(): void {
      material.dispose();
    },
  };
}

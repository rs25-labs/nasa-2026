import * as THREE from 'three';
import { EARTH, SKY_LAYER, SUN_IRRADIANCE, SUN_LIMB_DARKENING } from './constants';

const vertexShader = /* glsl */ `
varying vec3 vRay;
void main() {
  vec3 view = vec3(position.x / projectionMatrix[0][0], position.y / projectionMatrix[1][1], -1.0);
  vRay = transpose(mat3(viewMatrix)) * view;
  gl_Position = vec4(position.xy, 0.999, 1.0);
}`;

/**
 * Sun and Earth, evaluated analytically per pixel along the view ray. Output is premultiplied by the disc
 * coverage (alpha carries the blend weight only; the blend state writes alpha 0 so metering ignores the sky).
 */
const fragmentShader = /* glsl */ `
#define PI 3.14159265359
uniform vec3 sunDirection;
uniform float sunSinRadius;
uniform vec3 sunMeanRadiance;
uniform vec3 sunLimb;
uniform vec3 earthDirection;
uniform float earthSinRadius;
uniform float earthAtmosphere;
uniform vec3 earthRayleigh;
uniform vec3 earthFallback;
uniform mat3 earthFixedFromScene;
uniform sampler2D earthMap;
uniform float earthHasMap;
uniform float earthLod;
uniform float sunIrradiance;
varying vec3 vRay;

void main() {
  vec3 r = normalize(vRay);
  float pixel = max(length(dFdx(r)), length(dFdy(r)));
  vec3 color = vec3(0.0);
  float cover = 0.0;

  float sunSeparation = length(cross(r, sunDirection));
  float sunCover = clamp((sunSinRadius - sunSeparation) / pixel + 0.5, 0.0, 1.0) * step(0.0, dot(r, sunDirection));
  if (sunCover > 0.0) {
    float q = min(sunSeparation / sunSinRadius, 1.0);
    float mu = sqrt(1.0 - q * q);
    vec3 shape = (vec3(1.0) - sunLimb * (1.0 - mu)) / (vec3(1.0) - sunLimb / 3.0);
    color += sunMeanRadiance * shape * sunCover;
    cover = sunCover;
  }

  float earthSeparation = length(cross(r, earthDirection));
  float reach = earthSinRadius * (1.0 + earthAtmosphere * 6.0) + 2.0 * pixel;
  if (dot(r, earthDirection) > 0.0 && earthSeparation < reach) {
    float rs = earthSinRadius;
    float b = dot(r, earthDirection);
    float discriminant = max(b * b - (1.0 - rs * rs), 0.0);
    vec3 n = normalize(r * (b - sqrt(discriminant)) - earthDirection);
    float sunCosine = dot(n, sunDirection);
    float viewCosine = clamp(dot(n, -r), 0.0, 1.0);
    float scatterCosine = dot(sunDirection, r);
    float phase = 0.75 * (1.0 + scatterCosine * scatterCosine);
    float litSurface = clamp((sunCosine + 0.04) / 1.04, 0.0, 1.0);
    // Air scatters only where it is sunlit (a few degrees of twilight past the terminator): the night side has no limb ring.
    float litAir = clamp((sunCosine + 0.05) / 0.5, 0.0, 1.0);
    float planetCover = clamp((rs - earthSeparation) / pixel + 0.5, 0.0, 1.0);

    if (planetCover > 0.0) {
      vec3 f = earthFixedFromScene * n;
      vec2 uv = vec2(atan(f.y, f.x) / (2.0 * PI) + 0.5, asin(clamp(f.z, -1.0, 1.0)) / PI + 0.5);
      vec3 albedo = earthHasMap > 0.5 ? textureLod(earthMap, uv, earthLod).rgb : earthFallback;
      vec3 slant = earthRayleigh / max(viewCosine, 0.06);
      vec3 surface = albedo * litSurface * sunIrradiance / PI * exp(-slant * 0.5);
      vec3 haze = sunIrradiance / (4.0 * PI) * phase * litAir * (vec3(1.0) - exp(-slant));
      color += (surface + haze) * planetCover;
      cover = max(cover, planetCover);
    }

    float width = rs * earthAtmosphere + 0.5 * pixel;
    float height = max(earthSeparation - rs, 0.0) / width;
    vec3 limbPath = vec3(1.0) - exp(-earthRayleigh * 25.0);
    float glowShare = (rs * earthAtmosphere) / width;
    // Backlit atmosphere: sunlight refracted around the limb. It is reddened by the long path and carries a few thousandths
    // of the radiance of the sunlit surface, so beside a sunlit crescent it vanishes and around a new Earth it is only a faint thin rim.
    vec3 refracted = vec3(1.0, 0.42, 0.16);
    // The ring exists only when the Sun is behind Earth (eclipse geometry); a few Earth radii off axis there is nothing to refract toward the viewer.
    float behindEarth = 1.0 - smoothstep(rs, 3.0 * rs, length(cross(sunDirection, earthDirection)));
    color += behindEarth * sunIrradiance / (4.0 * PI) * phase * litAir * limbPath * refracted * 0.02 * exp(-height * 1.2) * glowShare * (1.0 - planetCover);
  }

  gl_FragColor = vec4(color, cover);
}`;

export interface SkyDome {
  mesh: THREE.Mesh;
  texture: THREE.Texture | null;
  setSun(direction: THREE.Vector3, angularRadiusRad: number): void;
  setEarth(direction: THREE.Vector3, angularRadiusRad: number, earthFixedFromScene: THREE.Matrix3, pixelAngleRad: number): void;
  setTexture(texture: THREE.Texture | null): void;
  dispose(): void;
}

export function createSkyDome(): SkyDome {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const uniforms = {
    sunDirection: { value: new THREE.Vector3(0, -1, 0) },
    sunSinRadius: { value: 0.0046 },
    sunMeanRadiance: { value: new THREE.Vector3() },
    sunLimb: { value: new THREE.Vector3(...SUN_LIMB_DARKENING) },
    earthDirection: { value: new THREE.Vector3(0, -1, 0) },
    earthSinRadius: { value: 0.0166 },
    earthAtmosphere: { value: EARTH.atmosphereFraction },
    earthRayleigh: { value: new THREE.Vector3(...EARTH.rayleighDepth) },
    earthFallback: { value: new THREE.Vector3(...EARTH.fallbackAlbedo) },
    earthFixedFromScene: { value: new THREE.Matrix3() },
    earthMap: { value: null as THREE.Texture | null },
    earthHasMap: { value: 0 },
    earthLod: { value: 0 },
    sunIrradiance: { value: SUN_IRRADIANCE },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.ZeroFactor,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.layers.set(SKY_LAYER);

  const dome: SkyDome = {
    mesh,
    texture: null,
    setSun(direction, angularRadiusRad): void {
      uniforms.sunDirection.value.copy(direction);
      uniforms.sunSinRadius.value = Math.sin(angularRadiusRad);
      // Disc-mean radiance L = E / (pi sin^2 rho): the Sun delivers irradiance E from a disc of solid angle pi sin^2 rho.
      const solidAngle = Math.PI * Math.sin(angularRadiusRad) ** 2;
      const radiance = SUN_IRRADIANCE / solidAngle;
      uniforms.sunMeanRadiance.value.set(radiance, radiance, radiance);
    },
    setEarth(direction, angularRadiusRad, earthFixedFromScene, pixelAngleRad): void {
      uniforms.earthDirection.value.copy(direction);
      uniforms.earthSinRadius.value = Math.sin(angularRadiusRad);
      uniforms.earthFixedFromScene.value.copy(earthFixedFromScene);
      const texelsPerPixel = EARTH.textureWidth / (2 * Math.PI * (angularRadiusRad / Math.max(pixelAngleRad, 1e-7)));
      uniforms.earthLod.value = Math.log2(Math.max(texelsPerPixel, 1)) + 0.3;
    },
    setTexture(texture): void {
      dome.texture = texture;
      uniforms.earthMap.value = texture;
      uniforms.earthHasMap.value = texture ? 1 : 0;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
  return dome;
}

/**
 * Lighting constants. Units are linear radiometric and relative: direct sunlight at normal incidence
 * delivers irradiance 1; every other source is a fraction of that.
 */

/** Lunar regolith reflectance (Lommel-Seeliger with a shadow-hiding opposition surge). */
export const REFLECTANCE = {
  /** Radiance factor at zero phase angle and normal incidence (highland regolith: 0.12 to 0.14). */
  normalAlbedo: 0.13,
  /** Shadow-hiding opposition surge amplitude B0: extra brightness at zero phase is (1 + B0). */
  surgeAmplitude: 1.2,
  /** Surge angular width h: B(g) = B0 / (1 + tan(g / 2) / h). The surge halves near g = 7 degrees. */
  surgeWidth: 0.06,
  /** Single-particle phase function: two Henyey-Greenstein terms of opposite sign, mildly backscattering. */
  phaseAsymmetry: 0.25,
  /** Weight of the forward-scattering term; the remainder is the backscattering term. */
  phaseForwardWeight: 0.25,
  /**
   * Spectral slope of mature regolith: reflectance rises gently toward the red (the lunar continuum slope, about 5 to 8
   * per cent per 100 nm across the visible). Linear RGB ratio 1.00 : 0.94 : 0.86, scaled here so its luminance is 1, so the
   * grey level of every surface is unchanged and only its hue moves. Applied to terrain and rocks.
   */
  tint: [1.056, 0.993, 0.908] as const,
  /** Lambert albedo used for sunlight bounced between ground patches. */
  bounceAlbedo: 0.12,
} as const;

/** Real secondary light. */
export const SECONDARY = {
  /** Earthshine irradiance at full Earth, relative to direct sunlight. */
  earthFullIrradiance: 1.0e-4,
  /** Colour of earthshine (oceans and clouds), linear, scaled so that the luminance is 1. */
  earthTint: [0.93, 0.99, 1.08] as const,
} as const;

/** Terrain shadow marching. */
export const MARCH = {
  /** Texels of the level under a fragment that are marched exactly per fragment; farther is baked. */
  nearTexels: 12,
  /** Steps of the per-fragment march across the near range. */
  nearSteps: 10,
  /** First step in texels. */
  nearStart: 0.35,
  /** Farthest distance the Sun or Earth can be blocked from, metres. */
  maxRange: 150_000,
  /** Steps of the baked far march for the Sun. */
  farSteps: 96,
  /** Steps of the baked march for Earth. */
  earthSteps: 48,
  /** Steps of the baked near march that gives the bounce pass its lit fraction. */
  bakeNearSteps: 14,
  /** Margin (radians) beyond the Sun's radius by which all four baked horizons must clear the Sun to skip the per-fragment march. */
  skipGuardRad: 0.006,
  /** Height tolerance against interpolation mismatch, metres, plus this fraction of the level spacing. */
  biasMetres: 0.03,
  biasTexelFraction: 0.03,
} as const;

/** Single-bounce gather. */
export const BOUNCE = {
  rings: 9,
  azimuths: 12,
  /** Fragments at least this lit skip the gather (bounce is under 1 per cent of their direct light). */
  skipAbove: 0.98,
} as const;

/** Re-bake when the Sun or Earth moves further than this, radians. */
export const REBAKE_ANGLE = 0.25 * (Math.PI / 180);

/** Two shadow maps for objects: a tight one around the camera (pebbles) and a wide one (boulders, rover, lander). */
export const OBJECT_SHADOW = {
  /** Square size of each shadow map, pixels. */
  size: 2048,
  cascades: [
    /**
     * Half width of the covered square (metres), half depth along the light, and the smallest culled caster (half size, metres).
     * Texel sizes: 1.2 cm, 4.7 cm, 20 cm, 78 cm. A cascade serves the ground its texel size matches to a pixel of a 50 degree
     * view at about 20, 70, 300 and 1200 m; the finest two are read with one bilinear comparison (edges one texel wide, crisp at
     * contact), the coarser two with four (a soft three-texel edge, as the Sun's penumbra is wide that far from a caster).
     */
    { halfExtent: 12, halfDepth: 400, minCasterHalfSize: 0 },
    { halfExtent: 48, halfDepth: 500, minCasterHalfSize: 0.03 },
    { halfExtent: 200, halfDepth: 600, minCasterHalfSize: 0.05 },
    { halfExtent: 800, halfDepth: 800, minCasterHalfSize: 0.15 },
  ],
  /** Three.js layer that marks casters. */
  layer: 5,
  /**
   * The rover has its own map, centred on the rover instead of the camera: a rover's shadow can be 100 m long at a
   * low Sun, but it only needs the rays that pass through the rover, so a 12 m square at 6 mm texels stays crisp
   * wherever the shadow falls.
   */
  rover: { size: 2048, halfExtent: 6, halfDepth: 200, layer: 6, biasMetres: 0.02 },
} as const;

/**
 * Rover headlights. Two LED lamps. Visible-band solar irradiance is taken as 43 per cent of the 1361 W/m2
 * solar constant (585 W/m2), so a lamp's beam is stated against the same sunlight the rest of the lighting uses.
 * Intensity = electrical power x optical efficiency x optics efficiency / beam solid angle. Per lamp, 20 W x 0.40
 * x 0.80 / 0.38 sr = 16.9 W/sr, so the irradiance on the ground at 10 m is 0.17 W/m2, about 3e-4 of sunlight.
 */
export const HEADLIGHT = {
  electricalW: 5000,
  /** Visible radiant watts per electrical watt of a white LED. */
  opticalEfficiency: 0.4,
  /** Lens and reflector transmission. */
  opticsEfficiency: 0.8,
  /** Full cone angle at half intensity is about this; the beam fades out between inner and outer half angles. */
  beamInnerHalfAngleDeg: 14,
  beamOuterHalfAngleDeg: 24,
  visibleSolarIrradianceWm2: 1361 * 0.43,
  /** Beyond this the light is below earthshine on the ground, so the shader skips it. */
  maxRangeM: 140,
  pitchDownDeg: 14,
  mountHeightM: 0.62,
  mountSpacingM: 0.8,
} as const;

/** Solid angle of the beam (steradians) from its mean half angle, and per-lamp intensity relative to sunlight (m2 units). */
export function headlightIntensityRelative(): number {
  const halfAngle = (0.5 * (HEADLIGHT.beamInnerHalfAngleDeg + HEADLIGHT.beamOuterHalfAngleDeg) * Math.PI) / 180;
  const solidAngle = 2 * Math.PI * (1 - Math.cos(halfAngle));
  const watts = (HEADLIGHT.electricalW * HEADLIGHT.opticalEfficiency * HEADLIGHT.opticsEfficiency) / solidAngle;
  return watts / HEADLIGHT.visibleSolarIrradianceWm2;
}

function henyeyGreenstein(cosPhase: number, asymmetry: number): number {
  return (1 - asymmetry * asymmetry) / Math.pow(1 + asymmetry * asymmetry - 2 * asymmetry * cosPhase, 1.5);
}

/** Phase function value at zero phase angle, used to normalise the reflectance. */
export function phaseAtZero(): number {
  const { phaseAsymmetry: b, phaseForwardWeight: w } = REFLECTANCE;
  return (1 - w) * henyeyGreenstein(1, b) + w * henyeyGreenstein(1, -b);
}

function glslFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

/** GLSL `#define` lines that carry every constant above into the shaders. */
export function lightingDefines(): string {
  const lines = [
    `#define LML_ALBEDO ${glslFloat(REFLECTANCE.normalAlbedo)}`,
    `#define LML_REGOLITH_TINT vec3(${REFLECTANCE.tint.map(String).join(', ')})`,
    `#define LML_SURGE_B0 ${glslFloat(REFLECTANCE.surgeAmplitude)}`,
    `#define LML_SURGE_H ${glslFloat(REFLECTANCE.surgeWidth)}`,
    `#define LML_PHASE_B ${glslFloat(REFLECTANCE.phaseAsymmetry)}`,
    `#define LML_PHASE_FWD ${glslFloat(REFLECTANCE.phaseForwardWeight)}`,
    `#define LML_PHASE_ZERO ${glslFloat(phaseAtZero())}`,
    `#define LML_BOUNCE_SCALE 4096.0`,
    `#define LML_BOUNCE_ALBEDO ${glslFloat(REFLECTANCE.bounceAlbedo)}`,
    `#define LML_NEAR_TEXELS ${glslFloat(MARCH.nearTexels)}`,
    `#define LML_NEAR_STEPS ${MARCH.nearSteps}`,
    `#define LML_NEAR_START ${glslFloat(MARCH.nearStart)}`,
    `#define LML_MAX_RANGE ${glslFloat(MARCH.maxRange)}`,
    `#define LML_FAR_STEPS ${MARCH.farSteps}`,
    `#define LML_EARTH_STEPS ${MARCH.earthSteps}`,
    `#define LML_BAKE_NEAR_STEPS ${MARCH.bakeNearSteps}`,
    `#define LML_SKIP_GUARD ${glslFloat(MARCH.skipGuardRad)}`,
    `#define LML_BIAS_M ${glslFloat(MARCH.biasMetres)}`,
    `#define LML_BIAS_TEXEL ${glslFloat(MARCH.biasTexelFraction)}`,
    `#define LML_RINGS ${BOUNCE.rings}`,
    `#define LML_AZIMUTHS ${BOUNCE.azimuths}`,
    `#define LML_BOUNCE_SKIP ${glslFloat(BOUNCE.skipAbove)}`,
    `#define LML_LAMP_INTENSITY ${headlightIntensityRelative().toExponential(6)}`,
    `#define LML_LAMP_COS_INNER ${Math.cos((HEADLIGHT.beamInnerHalfAngleDeg * Math.PI) / 180).toFixed(6)}`,
    `#define LML_LAMP_COS_OUTER ${Math.cos((HEADLIGHT.beamOuterHalfAngleDeg * Math.PI) / 180).toFixed(6)}`,
    `#define LML_LAMP_RANGE ${glslFloat(HEADLIGHT.maxRangeM)}`,
  ];
  return lines.join('\n');
}

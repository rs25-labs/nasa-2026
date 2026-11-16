/**
 * Sky radiometry. Units are the same linear relative units as the ground: direct sunlight at normal
 * incidence delivers irradiance 1, and a Lambert surface of albedo A facing the Sun has radiance A / pi.
 */

/** Must equal the Sun irradiance the ground is lit with (light/constants.ts: "direct sunlight ... irradiance 1"). */
export const SUN_IRRADIANCE = 1;

/** Linear limb darkening I(mu) = 1 - u (1 - mu) per colour channel (red, green, blue). Solar values in the visible. */
export const SUN_LIMB_DARKENING: readonly [number, number, number] = [0.5, 0.6, 0.75];

export const EARTH = {
  /** Height of the visible atmosphere as a fraction of Earth's radius (about 75 km of 6371 km). */
  atmosphereFraction: 0.012,
  /** Rayleigh optical depth at zenith for red, green and blue. */
  rayleighDepth: [0.045, 0.097, 0.24] as const,
  /** Albedo used when the texture is missing: Earth's Bond albedo, bluish. */
  fallbackAlbedo: [0.2, 0.28, 0.4] as const,
  /** Texture width in texels, for the mip level that keeps a 40 pixel disc free of aliasing. */
  textureWidth: 1024,
  texturePath: 'sky/earth_albedo.jpg',
} as const;

export const STARS = {
  /**
   * Peak pixel radiance of a magnitude-0 star, relative units: about 1e-4 of sunlit regolith radiance. A real
   * pixel-integrated magnitude-0 star is 1e-5 to 1e-6 of it; the value is raised so a star still reads on a display
   * at the exposure limit (x2e5). It stays invisible at sunlit-ground exposure (x2 to x50) and emerges only
   * when exposure opens to the 1e4 to 2e5 range of a view dominated by shadow.
   */
  peakRadianceMagnitudeZero: 6e-6,
  /** Faintest magnitude generated. */
  limitingMagnitude: 6,
  /** Brighter than this magnitude the real catalogue entries are used; fainter stars are generated. */
  catalogueLimit: 2,
  /** log10 of the number of stars brighter than magnitude 0 (cumulative counts grow by 10^0.5 per magnitude). */
  logCountAtZero: 0.646,
  /** Point sprite size and Gaussian sigma, device pixels. */
  spriteSize: 5,
  sigmaPixels: 0.75,
  seed: 20261115,
} as const;

/** Three.js layer that carries sky objects, so no other pass of the scene draws them by accident. */
export const SKY_LAYER = 6;

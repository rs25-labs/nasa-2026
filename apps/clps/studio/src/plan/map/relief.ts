/** Neutral grey hillshade and missing-data hatch, rendered from a terrain viewport grid. */

export interface ReliefLayers {
  relief: HTMLCanvasElement;
  hatch: HTMLCanvasElement;
}

const SUN_AZIMUTH_DEG = 315;
const SUN_ALTITUDE_DEG = 40;
const VERTICAL_EXAGGERATION = 2;
const HATCH_SCALE = 4;
const HATCH_PERIOD = 8;
const HATCH_WIDTH = 2;

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Relief is opaque only where terrain exists. Hatch is opaque only where it is missing,
 * drawn at higher resolution so the lines stay thin. Row 0 is north.
 */
export function renderRelief(elevations: (number | null)[][], spacingM: number): ReliefLayers {
  const size = elevations.length;
  const relief = makeCanvas(size, size);
  const hatch = makeCanvas(size * HATCH_SCALE, size * HATCH_SCALE);
  const reliefContext = relief.getContext('2d');
  const hatchContext = hatch.getContext('2d');
  if (!reliefContext || !hatchContext) return { relief, hatch };

  const reliefImage = reliefContext.createImageData(size, size);
  const hatchSize = size * HATCH_SCALE;
  const hatchImage = hatchContext.createImageData(hatchSize, hatchSize);

  const zenith = ((90 - SUN_ALTITUDE_DEG) * Math.PI) / 180;
  const azimuth = (SUN_AZIMUTH_DEG * Math.PI) / 180;
  const height = (row: number, col: number, fallback: number): number => {
    const value = elevations[Math.min(size - 1, Math.max(0, row))]?.[Math.min(size - 1, Math.max(0, col))];
    return value ?? fallback;
  };

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const centre = elevations[row]?.[col];
      const offset = (row * size + col) * 4;
      if (centre === null || centre === undefined) continue;
      // Gradients in metres per metre; row index grows southward.
      const dzDx =
        ((height(row, col + 1, centre) - height(row, col - 1, centre)) * VERTICAL_EXAGGERATION) / (2 * spacingM);
      const dzDy =
        ((height(row - 1, col, centre) - height(row + 1, col, centre)) * VERTICAL_EXAGGERATION) / (2 * spacingM);
      const slope = Math.atan(Math.hypot(dzDx, dzDy));
      const aspect = Math.atan2(-dzDx, -dzDy); // compass bearing of the downslope direction
      const shade = Math.max(
        0,
        Math.cos(zenith) * Math.cos(slope) + Math.sin(zenith) * Math.sin(slope) * Math.cos(azimuth - aspect),
      );
      const grey = Math.round(Math.min(1, shade * 0.95) * 235 + 12);
      reliefImage.data[offset] = grey;
      reliefImage.data[offset + 1] = grey;
      reliefImage.data[offset + 2] = grey;
      reliefImage.data[offset + 3] = 255;
    }
  }

  for (let y = 0; y < hatchSize; y++) {
    const row = Math.floor(y / HATCH_SCALE);
    for (let x = 0; x < hatchSize; x++) {
      const col = Math.floor(x / HATCH_SCALE);
      const offset = (y * hatchSize + x) * 4;
      const missing = elevations[row]?.[col] == null;
      if (!missing) continue;
      const line = (x + y) % HATCH_PERIOD < HATCH_WIDTH;
      const tone = line ? 58 : 20;
      hatchImage.data[offset] = tone;
      hatchImage.data[offset + 1] = tone;
      hatchImage.data[offset + 2] = tone + 1;
      hatchImage.data[offset + 3] = 255;
    }
  }

  reliefContext.putImageData(reliefImage, 0, 0);
  hatchContext.putImageData(hatchImage, 0, 0);
  return { relief, hatch };
}

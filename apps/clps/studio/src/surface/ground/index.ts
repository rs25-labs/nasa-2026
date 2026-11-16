import type { SurfaceExtension } from '../core/types';
import { RockField } from './rocks';

/** Ground detail beyond the terrain meshes: the rock field. (Craters and undulation are in the terrain levels.) */
export function createGroundExtension(): SurfaceExtension {
  return new RockField();
}

export { detailHeight, freshnessAt } from './craters';

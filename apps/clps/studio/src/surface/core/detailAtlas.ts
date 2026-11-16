import * as THREE from 'three';
import { craterTable } from '../ground/craterGlsl';
import { smallCraterTile, tileTransforms } from '../ground/smallCraterTile';
import { DETAIL_FACTOR } from '../ground/levelBuild';

const LEVELS = 8;
export const DETAIL_SIZE = DETAIL_FACTOR * 256 + 1;

const data = new Uint16Array(DETAIL_SIZE * DETAIL_SIZE * LEVELS * 2);
const texture = new THREE.DataArrayTexture(data, DETAIL_SIZE, DETAIL_SIZE, LEVELS);
texture.format = THREE.RGFormat;
texture.type = THREE.HalfFloatType;
texture.minFilter = THREE.LinearMipmapLinearFilter;
texture.magFilter = THREE.LinearFilter;
// The mip chain is the footprint prefilter: the average of a gradient over a pixel is the gradient of the height smoothed over
// that pixel, so craters smaller than the pixel cancel out of the shading normal instead of aliasing, at every level alike.
texture.generateMipmaps = true;
texture.anisotropy = 1;
texture.unpackAlignment = 1;
texture.needsUpdate = true;

/**
 * Gradient of the crater relief below a level's mesh resolution, one layer per terrain level (see `stampDetail`), as half floats
 * (x, z). The terrain shader reads it as a shading normal, so the ground between the craters the mesh resolves shows the same crater field and a
 * coarser level never looks smoother than the one it replaces.
 */
export const detailUniforms: {
  lmlDetail: THREE.IUniform<THREE.DataArrayTexture>;
  /** Site map origin x, y (polar stereographic metres) and the terrain product's pixel size: what the shader's crater field needs. */
  lmlCraterMap: THREE.IUniform<THREE.Vector3>;
  lmlCraterTable: THREE.IUniform<THREE.Vector4[]>;
  lmlCraterTile: THREE.IUniform<THREE.DataArrayTexture>;
  lmlCraterTileXf: THREE.IUniform<THREE.Vector4[]>;
} = { lmlDetail: { value: texture }, lmlCraterMap: { value: new THREE.Vector3(0, 0, 10) }, lmlCraterTable: { value: craterTable() },
  lmlCraterTile: { value: smallCraterTile() },
  lmlCraterTileXf: { value: tileTransforms(0, 0) },
};

export function setCraterMap(mapX: number, mapY: number, pixelSizeM: number): void {
  detailUniforms.lmlCraterMap.value.set(mapX, mapY, pixelSizeM);
  detailUniforms.lmlCraterTileXf.value = tileTransforms(mapX, mapY);
}

export function uploadDetail(level: number, detail: Uint16Array): void {
  data.set(detail, level * DETAIL_SIZE * DETAIL_SIZE * 2);
  texture.addLayerUpdate(level);
  texture.needsUpdate = true;
}

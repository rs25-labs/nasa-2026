import type * as THREE from 'three';

/**
 * Planning overlays (the route, the target) are drawn in the HDR pass but must read as a fixed colour on screen, so
 * their shader divides its colour by the camera exposure. The engine points this at the pipeline's current exposure.
 */
export const overlayUniforms: { lmlExposure: THREE.IUniform<THREE.Texture | null> } = {
  lmlExposure: { value: null },
};

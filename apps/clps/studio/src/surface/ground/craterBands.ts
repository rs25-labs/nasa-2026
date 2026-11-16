/** Crater diameters, in texels of a level's detail grid, over which a crater passes from the shader's per-fragment sum to the baked grid. */
export const DETAIL_FIRST_TEXELS = 1.6;
export const DETAIL_FULL_TEXELS = 3;
/** A crater octave spans diameters dMin to 2 dMin; this multiple of dMin stands for it when a weight is taken per octave. */
export const OCTAVE_REPRESENTATIVE = 1.45;

# Sky assets

## earth_albedo.jpg (1024 x 512, equirectangular, lon -180..180, north up, sRGB)

Derived, not a photograph of the real cloud field.

- Geography: land/sea and the Antarctic and Greenland ice outlines were classified from the NASA hypsometric
  Earth map "Earth (A).jpg" in the NASA 3D Resources collection.
  Source: https://github.com/nasa/NASA-3D-Resources (Images and Textures/Earth (A)/Earth (A).jpg)
  Licence: NASA 3D Resources assets are "free and without copyright" (repository README); NASA media usage guidelines apply.
- Surface reflectances (ocean, forest, desert, snow) and the cloud layer are synthetic: fixed-seed fractal noise with
  latitude-banded cover. The cloud pattern does not correspond to any real date.
- The final image is scaled so its area-weighted mean linear luminance is 0.30, Earth's Bond albedo.
- Real Blue Marble cloud imagery (eoimages.gsfc.nasa.gov) could not be reached from the build environment.
- Generator: src/surface/sky/make_earth_albedo.py (input: the NASA map above).

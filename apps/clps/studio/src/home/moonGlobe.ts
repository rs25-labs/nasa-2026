// The landing page globe, ported from the legacy app (apps/clps/web/moon-entry.js): a lit textured sphere drawn
// by one full-screen shader, rising slowly from the bottom-right corner.

const RAD = Math.PI / 180;

const VERTEX = `attribute vec2 point; void main(){gl_Position=vec4(point,0.,1.);}`;
const FRAGMENT = `precision highp float;
  uniform vec2 center; uniform float radius; uniform mat3 camera;
  uniform sampler2D surface; uniform float textured;
  void main(){
    vec2 p=(gl_FragCoord.xy-center)/radius; float d=dot(p,p);
    if(d>1.){gl_FragColor=vec4(0.);return;}
    vec3 n=vec3(p,sqrt(max(0.,1.-d))), world=camera*n;
    vec2 uv=vec2(atan(world.x,world.z)/6.28318530718+.5,asin(clamp(world.y,-1.,1.))/3.14159265359+.5);
    vec3 color=mix(vec3(.46,.48,.5),texture2D(surface,uv).rgb,textured);
    float light=.10+.9*max(0.,dot(n,normalize(vec3(-.5,.65,1.2))));
    gl_FragColor=vec4(color*light,smoothstep(0.,.006,1.-d));
  }`;

export interface Pose {
  lat: number;
  lon: number;
  /** Radius as a fraction of the shorter side of the canvas. */
  radius: number;
  /** Centre as fractions of width and height, measured from the bottom-left corner. */
  x: number;
  y: number;
}

const smooth = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** The legacy home pose: a large Moon below the bottom-right edge, rising by 3.5% of the height over two seconds. */
export function risingPose(seconds: number, narrow: boolean): Pose {
  return { lat: -18, lon: 5, radius: narrow ? 1.65 : 1.02, x: narrow ? 0.65 : 0.69, y: -0.12 + 0.035 * smooth(seconds / 2) };
}

function basis(lat: number, lon: number): number[] {
  const a = lat * RAD;
  const b = lon * RAD;
  return [
    Math.cos(b), 0, -Math.sin(b),
    -Math.sin(b) * Math.sin(a), Math.cos(a), -Math.cos(b) * Math.sin(a),
    Math.sin(b) * Math.cos(a), Math.sin(a), Math.cos(b) * Math.cos(a),
  ];
}

export class MoonGlobe {
  private readonly gl: WebGLRenderingContext;
  private readonly uniforms: Record<'center' | 'radius' | 'camera' | 'surface' | 'textured', WebGLUniformLocation | null>;
  onTexture: (() => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, textureUrl: string) {
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, powerPreference: 'low-power' });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    const compile = (kind: number, source: string): WebGLShader => {
      const shader = gl.createShader(kind);
      if (!shader) throw new Error('Shader unavailable');
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Moon shader did not compile');
      return shader;
    };
    const program = gl.createProgram();
    if (!program) throw new Error('Program unavailable');
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Moon program did not link');
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const point = gl.getAttribLocation(program, 'point');
    gl.enableVertexAttribArray(point);
    gl.vertexAttribPointer(point, 2, gl.FLOAT, false, 0, 0);
    this.uniforms = {
      center: gl.getUniformLocation(program, 'center'),
      radius: gl.getUniformLocation(program, 'radius'),
      camera: gl.getUniformLocation(program, 'camera'),
      surface: gl.getUniformLocation(program, 'surface'),
      textured: gl.getUniformLocation(program, 'textured'),
    };
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([125, 125, 125]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const image = new Image();
    image.onload = () => {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
      gl.uniform1f(this.uniforms.textured, 1);
      this.onTexture?.();
    };
    image.src = textureUrl;
  }

  draw(pose: Pose): void {
    const box = this.canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.round(box.width * ratio);
    const height = Math.round(box.height * ratio);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const gl = this.gl;
    const radius = pose.radius * Math.min(box.width, box.height);
    gl.viewport(0, 0, width, height);
    gl.uniform2f(this.uniforms.center, pose.x * box.width * ratio, pose.y * box.height * ratio);
    gl.uniform1f(this.uniforms.radius, radius * ratio);
    gl.uniformMatrix3fv(this.uniforms.camera, false, new Float32Array(basis(pose.lat, pose.lon)));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

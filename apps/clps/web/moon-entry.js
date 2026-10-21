"use strict";
(() => {
  const $ = id => document.getElementById(id), rad = Math.PI / 180;
  const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a + (b - a) * t;
  const basis = (lat, lon) => {
    const a = lat * rad, b = lon * rad;
    return [[Math.cos(b), 0, -Math.sin(b)], [-Math.sin(b) * Math.sin(a), Math.cos(a), -Math.cos(b) * Math.sin(a)],
      [Math.sin(b) * Math.cos(a), Math.sin(a), Math.cos(b) * Math.cos(a)]];
  };
  const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const vertex = `attribute vec2 point; void main(){gl_Position=vec4(point,0.,1.);}`;
  const fragment = `precision highp float;
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

  class MoonGlobe {
    constructor(onUnavailable) {
      this.canvas = $("moon-globe");
      this.gl = this.canvas.getContext("webgl", { alpha: true, antialias: true, powerPreference: "low-power" });
      if (!this.gl) throw new Error("3D view unavailable");
      const gl = this.gl;
      const compile = (kind, source) => {
        const shader = gl.createShader(kind); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("Moon shader unavailable");
        return shader;
      };
      this.program = gl.createProgram();
      gl.attachShader(this.program, compile(gl.VERTEX_SHADER, vertex)); gl.attachShader(this.program, compile(gl.FRAGMENT_SHADER, fragment));
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error("Moon rendering unavailable");
      gl.useProgram(this.program);
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      const point = gl.getAttribLocation(this.program, "point"); gl.enableVertexAttribArray(point); gl.vertexAttribPointer(point,2,gl.FLOAT,false,0,0);
      this.uniforms = {};
      for (const name of ["center", "radius", "camera", "surface", "textured"]) this.uniforms[name] = gl.getUniformLocation(this.program,name);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,1,1,0,gl.RGB,gl.UNSIGNED_BYTE,new Uint8Array([125,125,125]));
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      const image = new Image();
      image.onload = () => {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);
        gl.uniform1f(this.uniforms.textured,1); this.onDraw?.();
      };
      image.onerror = () => onUnavailable("Moon texture unavailable · untextured preview; terrain planning remains available");
      image.src = "/media/moon-color.jpg";
      this.canvas.addEventListener("webglcontextlost", event => { event.preventDefault(); onUnavailable("3D view unavailable · use Choose a site now"); this.lost = true; this.canvas.hidden = true; $("moon-fallback").hidden = false; });
      $("moon-fallback").hidden = true;
    }
    draw(pose) {
      if (this.lost) return null;
      const box = this.canvas.getBoundingClientRect(), w = box.width, h = box.height;
      if (!w || !h) return null;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.round(w * ratio), height = Math.round(h * ratio);
      if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
      const gl = this.gl, axes = basis(pose.lat, pose.lon);
      const r = pose.radius * Math.min(w,h), cx = pose.x * w, cy = pose.y * h;
      gl.viewport(0,0,width,height); gl.uniform2f(this.uniforms.center,cx*ratio,cy*ratio);
      gl.uniform1f(this.uniforms.radius,r*ratio); gl.uniformMatrix3fv(this.uniforms.camera,false,new Float32Array(axes.flat()));
      gl.drawArrays(gl.TRIANGLES,0,6);
      return { axes, r, cx, cy, h };
    }
  }

  window.MoonJourney = class {
    constructor(onEnter, onChoose) {
      this.onEnter = onEnter; this.onChoose = onChoose; this.sites = []; this.elapsed = 0; this.state = "home";
      this.motion = window.matchMedia("(prefers-reduced-motion: reduce)");
      try { this.globe = new MoonGlobe(message => { $("moon-status").textContent = message; }); }
      catch (_) { $("moon-globe").hidden = true; $("moon-status").textContent = "3D view unavailable · mission planning remains available"; }
      this.frame = this.frame.bind(this);
      $("pause-moon").onclick = () => { this.paused = !this.paused; this.pauseLabel(); this.redraw(); };
      $("journey-sites").addEventListener("focusin", () => { this.paused = true; this.pauseLabel(); });
      window.addEventListener("hashchange", () => this.navigate());
      window.addEventListener("resize", () => this.redraw());
      document.addEventListener("visibilitychange", () => { this.previous = null; this.redraw(); });
      this.motion.addEventListener("change", () => { if (this.motion.matches && this.state === "moon") location.hash = "planner"; else this.redraw(); });
      if (this.globe) this.globe.onDraw = () => this.redraw();
      this.navigate();
    }
    pauseLabel() {
      $("pause-moon").textContent = this.paused ? "Resume journey" : "Pause journey";
      $("pause-moon").setAttribute("aria-pressed",String(!!this.paused));
    }
    navigate() {
      const next = location.hash === "#planner" ? "planner" : location.hash === "#moon" ? "moon" : "home";
      if (next === "moon" && (this.motion.matches || !this.globe || this.globe.lost)) { location.hash = "planner"; return; }
      this.state = next; this.elapsed = 0; this.previous = null; this.paused = false; this.pauseLabel();
      const planner = next === "planner";
      $("moon-entry").hidden = planner; $("planner").hidden = !planner;
      $("entry-copy").hidden = next !== "home"; $("journey-copy").hidden = next !== "moon";
      if (planner) { this.onEnter(); $("planner").focus({ preventScroll:true }); }
      else if (next === "moon") $("journey-title").focus({ preventScroll:true });
      window.scrollTo(0,0); this.redraw();
    }
    setSites(saved, draft, catalog=[]) {
      const valid = request => request && Number.isFinite(Number(request.latitude_deg)) && Number.isFinite(Number(request.longitude_deg)) && Number(request.latitude_deg)>=-90 && Number(request.latitude_deg)<=-85;
      const seen = new Set();
      this.sites = [];
      if (valid(draft)) this.sites.push({ request:draft, draft:true });
      for (const item of [...catalog.map(site=>({request:site,catalogKind:site.kind})),...saved]) {
        const r = item.request, key = `${r?.latitude_deg},${r?.longitude_deg}`;
        if (valid(r) && !seen.has(key)) { this.sites.push({ request:r, draft:false, catalogKind:item.catalogKind }); seen.add(key); }
      }
      $("moon-pins").replaceChildren(); $("journey-sites").replaceChildren();
      for (const site of this.sites) {
        const pin = document.createElement("span"); pin.className = `globe-pin${site.draft ? " draft" : site.catalogKind==="published-candidate" ? " catalog-published" : site.catalogKind ? " catalog-exploratory" : ""}`;
        pin.dataset.latitude = site.request.latitude_deg; pin.dataset.longitude = site.request.longitude_deg;
        site.pin = pin; $("moon-pins").append(pin);
        const button = document.createElement("button"); button.type = "button";
        button.textContent = `${site.draft ? "Draft" : site.request.name || site.request.site_id || "Saved site"} · ${Number(site.request.latitude_deg).toFixed(3)}°, ${Number(site.request.longitude_deg).toFixed(3)}°`;
        button.onclick = () => { this.onChoose(site.request); location.hash = "planner"; };
        $("journey-sites").append(button);
      }
      this.redraw();
    }
    pose() {
      const mobile = window.innerWidth <= 800, t = this.elapsed;
      const home = { lat:-18,lon:5,radius:mobile ? 1.65 : 1.02,x:mobile ? .65 : .69,y:-.12 };
      if (this.state === "home") { home.y += .035*smooth(t/2); return home; }
      const orbit = { lat:-18,lon:5+Math.max(0,t-1.8)*7,radius:mobile ? .35 : .41,x:mobile ? .5 : .67,y:mobile ? .48 : .52 };
      if (t<1.8) { const f=smooth(t/1.8); for (const key of Object.keys(orbit)) orbit[key]=mix(home[key],orbit[key],f); }
      if (t>4.5) { const f=smooth((t-4.5)/2); orbit.lat=mix(-18,-90,f); orbit.lon=mix(23.9,0,f); }
      if (t>6.5) { const f=smooth((t-6.5)/1.8); orbit.radius=mix(mobile ? .35 : .41,4.5,f); orbit.x=mix(mobile ? .5 : .67,.5,f); }
      return orbit;
    }
    redraw() {
      cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(this.frame);
    }
    frame(now) {
      if (this.state === "planner" || document.hidden) { this.previous = null; return; }
      if (this.previous !== null && !this.paused && !this.motion.matches) this.elapsed += Math.min((now-this.previous)/1000,.1);
      this.previous = now;
      if (this.state === "moon" && this.elapsed >= 8.3) { location.hash = "planner"; return; }
      const projection = this.globe?.draw(this.pose());
      for (const site of this.sites) {
        const a=Number(site.request.latitude_deg)*rad, b=Number(site.request.longitude_deg)*rad;
        const point=[Math.cos(a)*Math.sin(b),Math.sin(a),Math.cos(a)*Math.cos(b)];
        const visible=this.state === "moon" && this.elapsed>1.8 && projection && dot(point,projection.axes[2])>0;
        site.pin.hidden = !visible;
        if (visible) {
          site.pin.style.left = `${projection.cx + projection.r*dot(point,projection.axes[0])}px`;
          site.pin.style.top = `${projection.h-projection.cy-projection.r*dot(point,projection.axes[1])}px`;
        }
      }
      const text=this.elapsed<4.5 ? "Your mission sites, seen from orbit. Nearby sites overlap at this scale." : this.elapsed<6.5 ? "Turning toward the south pole…" : "Moving into the terrain map. Choose your exact site next.";
      if (this.state === "moon" && $("journey-status").textContent!==text) $("journey-status").textContent=text;
      if (!this.paused && !this.motion.matches && (this.state === "moon" || this.elapsed<2)) this.raf=requestAnimationFrame(this.frame);
    }
  };
})();

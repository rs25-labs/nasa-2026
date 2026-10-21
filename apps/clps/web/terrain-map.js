"use strict";
(() => {
  const R = 1737400, $ = id => document.getElementById(id);
  const xy = (lat, lon) => {
    const r = 2 * R * Math.tan((90 + lat) * Math.PI / 360), a = lon * Math.PI / 180;
    return { x: r * Math.sin(a), y: r * Math.cos(a) };
  };
  window.TerrainMap = class {
    constructor(api, onSelect) {
      this.api = api; this.onSelect = onSelect; this.view = { x: 0, y: 0, span: 320000 };
      this.revision = 0; this.siteRevision = 0; this.cache = new Map(); this.map = $("map");
      $("map-in").onclick = () => this.zoom(.5); $("map-out").onclick = () => this.zoom(2);
      $("map-reset").onclick = () => { this.view = { x: 0, y: 0, span: 320000 }; this.load(); };
      $("map-center").onclick = () => this.center(this.selected);
      $("map-result").onclick = () => this.center(this.result);
      this.map.addEventListener("keydown", event => {
        const delta = this.view.span / 4;
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault(); this.pan(event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0,
            event.key === "ArrowUp" ? delta : event.key === "ArrowDown" ? -delta : 0);
        } else if (event.key === "+" || event.key === "=") { event.preventDefault(); this.zoom(.5); }
        else if (event.key === "-") { event.preventDefault(); this.zoom(2); }
        else if (event.key === "Enter" && !this.loading) { event.preventDefault(); this.select(this.view.x, this.view.y); }
      });
      this.map.addEventListener("pointerdown", event => {
        if (event.button !== 0 || !event.isPrimary || this.loading) return;
        this.drag = { point: this.point(event), id: event.pointerId, siteId:event.target.closest?.("[data-catalog-site]")?.dataset.catalogSite }; this.map.setPointerCapture(event.pointerId);
      });
      this.map.addEventListener("pointermove", event => {
        if (!this.drag || event.pointerId !== this.drag.id) return;
        const p = this.point(event), dx = p.x - this.drag.point.x, dy = p.y - this.drag.point.y;
        $("terrain-layer").setAttribute("transform", `translate(${dx} ${dy})`);
      });
      this.map.addEventListener("pointerup", event => {
        if (!this.drag || event.pointerId !== this.drag.id) return;
        const p = this.point(event), dx = p.x - this.drag.point.x, dy = p.y - this.drag.point.y;
        const siteId=this.drag.siteId;this.drag = null; $("terrain-layer").removeAttribute("transform");
        if (Math.hypot(dx, dy) > 3) this.pan(-dx / 320 * this.view.span, dy / 320 * this.view.span);
        else if (siteId && this.onCatalogSelect) this.onCatalogSelect(siteId);
        else this.select(this.view.x + (p.x / 320 - .5) * this.view.span, this.view.y + (.5 - p.y / 320) * this.view.span);
      });
      this.map.addEventListener("pointercancel", () => { this.drag = null; $("terrain-layer").removeAttribute("transform"); });
      this.load();
    }
    point(event) {
      const p = this.map.createSVGPoint(); p.x = event.clientX; p.y = event.clientY;
      return p.matrixTransform(this.map.getScreenCTM().inverse());
    }
    pan(dx, dy) {
      this.view.x = Math.max(-200000, Math.min(200000, this.view.x + dx));
      this.view.y = Math.max(-200000, Math.min(200000, this.view.y + dy)); this.load();
    }
    zoom(factor) { this.view.span = Math.max(7680, Math.min(320000, this.view.span * factor)); this.load(); }
    center(point) {
      if (!point) return;
      this.view = { x: point.x, y: point.y, span: Math.min(this.view.span, 40000) }; this.load();
    }
    setSelected(lat, lon) {
      if (lat !== this.latitude || lon !== this.longitude) {
        this.siteRevision++; $("site-status").textContent = "";
      }
      this.latitude = lat; this.longitude = lon;
      this.selected = Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= -85 ? xy(lat, lon) : null;
      this.markers();
    }
    setResult(request) {
      this.result = xy(Number(request.latitude_deg), Number(request.longitude_deg));
      $("map-result").hidden = false; this.center(this.result);
    }
    setCatalog(sites,onSelect) {
      this.onCatalogSelect=onSelect;this.catalog=[];$("catalog-markers").replaceChildren();
      const ns="http://www.w3.org/2000/svg";
      for(const site of sites) {
        const group=document.createElementNS(ns,"g");group.dataset.catalogSite=site.site_id;group.classList.add("catalog-marker");
        const title=document.createElementNS(ns,"title");title.textContent=`${site.name} · ${site.kind}`;
        const hit=document.createElementNS(ns,"circle");hit.setAttribute("r","9");hit.setAttribute("fill","transparent");
        const shape=document.createElementNS(ns,site.kind==="published-candidate"?"circle":"path");
        if(site.kind==="published-candidate")shape.setAttribute("r","3.5");else shape.setAttribute("d","M0-4L4 0L0 4L-4 0Z");
        shape.setAttribute("fill",site.kind==="published-candidate"?"#9bc4ff":"#c6a9ef");shape.setAttribute("stroke","#142032");shape.setAttribute("stroke-width","1");
        group.append(title,hit,shape);$("catalog-markers").append(group);
        this.catalog.push({node:group,point:xy(site.latitude_deg,site.longitude_deg)});
      }
      this.markers();
    }
    markers() {
      for(const {node,point} of this.catalog || []) {
        const x=160+(point.x-this.view.x)/this.view.span*320,y=160-(point.y-this.view.y)/this.view.span*320;
        node.toggleAttribute("hidden",this.loading||x<0||x>320||y<0||y>320);node.setAttribute("transform",`translate(${x} ${y})`);
      }
      for (const [id, point] of [["selected-marker", this.selected], ["result-marker", this.result]]) {
        const x = point ? 160 + (point.x - this.view.x) / this.view.span * 320 : -1;
        const y = point ? 160 - (point.y - this.view.y) / this.view.span * 320 : -1;
        const visible = !this.loading && point && x >= 0 && x <= 320 && y >= 0 && y <= 320;
        $(id).toggleAttribute("hidden", !visible); $(id).setAttribute("transform", `translate(${x} ${y})`);
      }
    }
    async inspect() {
      if (!this.selected) { $("site-status").textContent = "Choose a site between 90°S and 85°S."; return; }
      const revision = ++this.siteRevision;
      try {
        const sample = await this.api(`/api/terrain/site?latitude=${this.latitude}&longitude=${this.longitude}`);
        if (revision === this.siteRevision) this.siteStatus(sample);
      } catch (reason) { if (revision === this.siteRevision) $("site-status").textContent = reason.message; }
    }
    siteStatus(sample) {
      $("site-status").textContent = `Selected elevation: ${sample.elevation_above_reference_sphere_m.toFixed(1)} m above reference sphere · nearest 40 m source pixel`;
    }
    async select(x, y) {
      const lat = Math.round((-90 + Math.atan(Math.hypot(x, y) / (2 * R)) * 360 / Math.PI) * 1e6) / 1e6;
      const lon = Math.round(Math.atan2(x, y) * 180 / Math.PI * 1e6) / 1e6, revision = ++this.siteRevision;
      try {
        const sample = await this.api(`/api/terrain/site?latitude=${lat}&longitude=${lon}`);
        if (revision !== this.siteRevision) return;
        this.onSelect(lat, lon); this.siteStatus(sample);
      } catch (reason) { if (revision === this.siteRevision) $("site-status").textContent = reason.message; }
    }
    async load() {
      const revision = ++this.revision, view = { ...this.view }, key = `${view.x},${view.y},${view.span}`;
      this.drag = null; $("terrain-layer").removeAttribute("transform");
      this.loading = true; $("terrain-image").style.display = "none"; this.markers();
      $("map-status").textContent = "Loading cached LOLA elevation…";
      try {
        let data = this.cache.get(key);
        if (!data) {
          data = await this.api(`/api/terrain?x=${view.x}&y=${view.y}&span=${view.span}`);
          this.cache.set(key, data); if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value);
        }
        if (revision !== this.revision) return;
        this.draw(data); this.loading = false; this.markers();
        const spacing = data.display_spacing_m >= 1000 ? `${(data.display_spacing_m / 1000).toFixed(2)} km` : `${data.display_spacing_m.toFixed(0)} m`;
        $("map-status").textContent = `${data.product} · source 40 m · display ${spacing}/pixel · view ${(data.span_m / 1000).toFixed(1)} km wide${data.elevation_range_m ? ` · elevations ${data.elevation_range_m.map(v => v.toFixed(0)).join(" to ")} m` : " · no usable coverage here"}`;
        $("map-status").title = `${data.frame} · source SHA-256 ${data.source_sha256}`;
        $("map-in").disabled = view.span <= 7680; $("map-out").disabled = view.span >= 320000;
      } catch (reason) {
        if (revision !== this.revision) return;
        this.loading = false; this.markers(); $("map-status").textContent = `Terrain unavailable: ${reason.message}`;
      }
    }
    draw(data) {
      const canvas = document.createElement("canvas"), n = data.size;
      canvas.width = canvas.height = n;
      const context = canvas.getContext("2d"), image = context.createImageData(n, n), grid = data.elevations;
      const [low, high] = data.elevation_range_m || [0, 1];
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const height = grid[r][c]; if (height === null) continue;
        const at = (y, x) => grid[Math.max(0, Math.min(n - 1, y))][Math.max(0, Math.min(n - 1, x))] ?? height;
        const dx = (at(r, c + 1) - at(r, c - 1)) / (2 * data.display_spacing_m) * 4;
        const dy = (at(r + 1, c) - at(r - 1, c)) / (2 * data.display_spacing_m) * 4;
        const shade = .5 + .5 * Math.max(0, (dx * .45 + dy * .45 + .77) / Math.hypot(dx, dy, 1));
        const t = Math.max(0, Math.min(1, (height - low) / Math.max(1, high - low))), i = (r * n + c) * 4;
        image.data[i] = (45 + t * 170) * shade; image.data[i + 1] = (67 + t * 138) * shade;
        image.data[i + 2] = (84 + t * 94) * shade; image.data[i + 3] = 255;
      }
      context.putImageData(image, 0, 0); $("terrain-image").setAttribute("href", canvas.toDataURL("image/png"));
      $("terrain-image").style.display = "";
    }
  };
})();

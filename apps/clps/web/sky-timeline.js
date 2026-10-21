"use strict";
(() => {
  const $ = id => document.getElementById(id), ns = "http://www.w3.org/2000/svg";
  const number = v => v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
  function svg(tag, attrs = {}, text) {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function textNode(tag, text, className) {
    const node = document.createElement(tag); node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  window.SkyTimeline = class {
    constructor(onSelect) {
      this.onSelect = onSelect; this.times = []; this.index = 0;
      $("time-slider").addEventListener("input", event => { this.stop(); this.select(Number(event.target.value)); });
      $("time-prev").onclick = () => { this.stop(); this.select(this.index - 1); };
      $("time-next").onclick = () => { this.stop(); this.select(this.index + 1); };
      $("time-play").onclick = () => {
        if (this.timer) { this.stop(); return; }
        if (this.index === this.times.length - 1) this.select(0);
        $("time-play").textContent = "Pause"; $("time-play").setAttribute("aria-pressed", "true");
        this.timer = setInterval(() => this.select(this.index + 1), 1000);
      };
      document.addEventListener("visibilitychange", () => { if (document.hidden) this.stop(); });
    }
    stop() {
      clearInterval(this.timer); this.timer = null;
      $("time-play").textContent = "Play samples"; $("time-play").setAttribute("aria-pressed", "false");
    }
    setResult(result) {
      this.stop(); this.result = result;
      this.times = [...new Set(result.samples.map(s => s.utc).filter(t => Number.isFinite(Date.parse(t))))].sort((a, b) => Date.parse(a) - Date.parse(b));
      $("time-slider").max = String(Math.max(0, this.times.length - 1));
      $("time-slider").disabled = !this.times.length;
      $("time-play").disabled = this.times.length < 2;
      if (!this.times.length) {
        $("selected-time").textContent = "No calculated times available";
        $("sky").replaceChildren(); $("sky-readout").replaceChildren(); return;
      }
      const elevations = [...result.samples.map(s => number(s.center_elevation_deg)), ...(result.horizon || []).map(h => number(h.horizon_elevation_deg))].filter(v => v !== null);
      this.low = Math.max(-90, Math.floor((Math.min(-5, ...elevations) - 2) / 5) * 5);
      this.high = Math.min(90, Math.ceil((Math.max(10, ...elevations) + 2) / 5) * 5);
      this.select(0);
    }
    seek(utc) {
      if (!this.times.length) return;
      this.stop(); const target = Date.parse(utc);
      let index = 0;
      for (let i = 0; i < this.times.length; i++) if (Date.parse(this.times[i]) <= target) index = i;
      this.select(index);
    }
    select(index) {
      if (!this.times.length) return;
      this.index = Math.max(0, Math.min(this.times.length - 1, index));
      const utc = this.times[this.index], samples = this.result.samples.filter(s => s.utc === utc);
      $("time-slider").value = String(this.index);
      $("time-prev").disabled = this.index === 0; $("time-next").disabled = this.index === this.times.length - 1;
      $("selected-time").textContent = utc.replace("T", " ");
      $("sample-index").textContent = `Sample ${this.index + 1} of ${this.times.length}`;
      $("time-note").textContent = this.index === this.times.length - 1 ? "Final boundary sample · adds no elapsed time. Playback shows calculated samples only." : "Playback advances one calculated sample per second. No positions or visibility are interpolated between samples.";
      this.draw(samples, utc); this.readout(samples); this.onSelect(utc);
      if (this.index === this.times.length - 1) this.stop();
    }
    readout(samples) {
      $("sky-readout").replaceChildren();
      for (const body of ["SUN", "EARTH"]) {
        const sample = samples.find(s => s.body === body), card = textNode("div", "", "sky-body");
        card.append(textNode("strong", body === "SUN" ? "Sun" : "Earth", body === "SUN" ? "gold" : "mint"));
        if (sample) {
          const lo = number(sample.visible_fraction_lower), hi = number(sample.visible_fraction_upper);
          card.append(textNode("p", `${sample.state} · visible disk ${lo === null || hi === null ? "unresolved" : `${(lo * 100).toFixed(1)}%–${(hi * 100).toFixed(1)}%`}`));
          const az = number(sample.azimuth_deg), elevation = number(sample.center_elevation_deg);
          card.append(textNode("p", `Azimuth ${az === null ? "unavailable" : az.toFixed(2) + "°"} · elevation ${elevation === null ? "unavailable" : elevation.toFixed(2) + "°"}`, "caption"));
        } else card.append(textNode("p", "No saved sample at this time."));
        $("sky-readout").append(card);
      }
    }
    draw(samples, utc) {
      const root = $("sky"), x = az => 42 + az / 360 * 578, y = elev => 252 - (elev - this.low) / (this.high - this.low) * 230;
      root.replaceChildren(); root.dataset.utc = utc;
      root.setAttribute("aria-label", `Sky at ${utc}. ${samples.map(s => `${s.body}: ${s.state}, azimuth ${s.azimuth_deg} degrees, elevation ${s.center_elevation_deg} degrees`).join(". ")}. Sampled horizon is diagnostic.`);
      root.append(svg("rect", { x: 42, y: 22, width: 578, height: 230, fill: "#0b1522", rx: 4 }));
      for (let elev = this.low; elev <= this.high; elev += 5) {
        root.append(svg("path", { d: `M42 ${y(elev)}H620`, stroke: elev === 0 ? "#698097" : "#28384c", "stroke-dasharray": elev === 0 ? "5 4" : "1 5" }),
          svg("text", { x: 34, y: y(elev) + 3, "text-anchor": "end", class: "axis-label" }, `${elev}°`));
      }
      for (const [az, label] of [[0, "N 0°"], [90, "E 90°"], [180, "S 180°"], [270, "W 270°"], [360, "N 360°"]]) {
        root.append(svg("text", { x: x(az), y: 275, "text-anchor": az === 0 ? "start" : az === 360 ? "end" : "middle", class: "axis-label" }, label));
      }
      const profile = [...(this.result.horizon || [])].sort((a, b) => Number(a.azimuth_deg) - Number(b.azimuth_deg));
      const groups = []; let group = [], last = null;
      for (const point of profile) {
        const az = number(point.azimuth_deg), elevation = number(point.horizon_elevation_deg);
        if (az === null || elevation === null || (last !== null && az - last > 15)) {
          if (group.length) groups.push(group); group = [];
        }
        if (az !== null && elevation !== null) { group.push([az, elevation]); last = az; } else last = null;
      }
      if (group.length) groups.push(group);
      if (groups.length === 1 && groups[0][0][0] === 0 && groups[0].at(-1)[0] >= 350) groups[0].push([360, groups[0][0][1]]);
      for (const segment of groups) {
        const line = segment.map(([az, elev], i) => `${i ? "L" : "M"}${x(az)} ${y(elev)}`).join(" ");
        root.append(svg("path", { d: `${line} L${x(segment.at(-1)[0])} 252 L${x(segment[0][0])} 252 Z`, fill: "#74664c", opacity: .4 }),
          svg("path", { d: line, fill: "none", stroke: "#a49478", "stroke-width": 1.5 }));
      }
      if (!groups.length) root.append(svg("text", { x: 330, y: 200, "text-anchor": "middle", class: "axis-label" }, "Diagnostic horizon unavailable"));
      for (const sample of samples) {
        const az = number(sample.azimuth_deg), elev = number(sample.center_elevation_deg); if (az === null || elev === null) continue;
        const pos = x(((az % 360) + 360) % 360), color = sample.body === "SUN" ? "#ffd58d" : "#a9e1c8";
        const marker = svg("g", { "data-body": sample.body, "data-azimuth": az, "data-elevation": elev });
        marker.append(svg("circle", { cx: pos, cy: y(elev), r: 5, fill: color, stroke: "#0b1522", "stroke-width": 1.5 }),
          svg("text", { x: pos > 570 ? pos - 9 : pos + 9, y: y(elev) + (sample.body === "SUN" ? -9 : 17), fill: color, "font-size": 11, "text-anchor": pos > 570 ? "end" : "start" }, sample.body === "SUN" ? "Sun" : "Earth"),
          svg("title", {}, `${sample.body} · ${sample.state} · ${utc}`));
        root.append(marker);
      }
    }
  };
})();

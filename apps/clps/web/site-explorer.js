"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const node = (tag,text,cls) => { const n=document.createElement(tag); if(text!==undefined)n.textContent=text; if(cls)n.className=cls; return n; };
  const kind = site => site.kind === "published-candidate" ? "Published research candidate" : "Exploratory offset";
  const fixed = (value,digits=1) => Number.isFinite(value) ? value.toFixed(digits) : "Unavailable";
  const date = value => value.replace("T"," ").replace("+00:00"," UTC");
  window.SiteExplorer = class {
    constructor(api,onLoaded,onChoose,onCompare) {
      this.api=api;this.onLoaded=onLoaded;this.onChoose=onChoose;this.onCompare=onCompare;this.sites=[];this.request=0;
      $("catalog-search").oninput=() => this.renderList();
      $("catalog-region").onchange=() => this.renderList();$("catalog-filter").onchange=() => this.renderList();
      $("catalog-refresh").onclick=() => this.load();
    }
    async load() {
      const revision=++this.request;$("catalog-refresh").disabled=true;
      try {
        const data=await this.api("/api/sites");if(revision!==this.request)return;
        this.sites=data.sites;$("catalog-notice").textContent=data.notice;
        const selectedRegion=$("catalog-region").value;
        $("catalog-region").replaceChildren(new Option("All regions",""));
        const regions=new Map(this.sites.map(s=>[s.region_id,s.region]));
        for(const [id,name] of [...regions].sort((a,b)=>a[1].localeCompare(b[1]))) $("catalog-region").add(new Option(name,id));
        $("catalog-region").value=regions.has(selectedRegion)?selectedRegion:"";
        this.renderList();
        if(this.selected)this.detail(this.sites.find(s=>s.site_id===this.selected));
        this.onLoaded(this.sites);
      } catch(reason) {
        if(revision!==this.request)return;
        $("catalog-notice").textContent=`Site catalog unavailable: ${reason.message} Coordinate entry and terrain selection remain available.`;
        this.sites=[];$("catalog-list").replaceChildren();$("catalog-count").textContent="";
        $("catalog-detail").replaceChildren(node("p","No catalog details available. Use the mission coordinates below.","caption"));
        this.onLoaded([]);
      } finally { if(revision===this.request)$("catalog-refresh").disabled=false; }
    }
    renderList() {
      const query=$("catalog-search").value.trim().toLowerCase(),region=$("catalog-region").value,filter=$("catalog-filter").value;
      const matches=this.sites.filter(s=>(!region||s.region_id===region) && (filter==="all"||s.kind===filter||(filter==="ready"&&s.data_status==="ready"))
        && `${s.name} ${s.site_id} ${s.source_site_id} ${s.parent_site_id}`.toLowerCase().includes(query));
      $("catalog-list").replaceChildren();
      $("catalog-count").textContent=`${matches.length} of ${this.sites.length} sites · ${this.sites.filter(s=>s.data_status==="ready").length} verified pilot previews`;
      for(const site of matches) {
        const button=node("button",undefined,"site-card");button.type="button";button.dataset.siteId=site.site_id;
        button.setAttribute("aria-pressed",String(site.site_id===this.selected));
        button.append(node("span",kind(site),`site-badge${site.kind==="exploratory-point"?" exploratory":""}`),node("strong",site.name),
          node("small",`${site.latitude_deg.toFixed(4)}°, ${site.longitude_deg.toFixed(4)}° · ${site.site_id}`),
          node("span",site.data_status==="ready"?"Verified two-day pilot preview":"Data collection in progress",`site-data-${site.data_status==="ready"?"ready":"pending"}`));
        button.setAttribute("aria-controls","catalog-detail");
        button.onclick=()=>{this.selected=site.site_id;for(const row of $("catalog-list").children)row.setAttribute("aria-pressed",String(row===button));this.detail(site);$("catalog-detail").querySelector("h3").focus();};
        $("catalog-list").append(button);
      }
      if(!matches.length)$("catalog-list").append(node("p","No sites match. Try another name, region or filter.","caption"));
      if(!matches.some(s=>s.site_id===this.selected)) {
        this.selected=null;$("catalog-detail").replaceChildren(node("p","Choose a matching site card to inspect its context and available data.","caption"));
      }
    }
    inspect(siteId) {
      const site=this.sites.find(s=>s.site_id===siteId);if(!site)return;
      $("catalog-search").value="";$("catalog-region").value="";$("catalog-filter").value="all";
      this.selected=siteId;this.renderList();this.detail(site);
      $("catalog-detail").scrollIntoView({block:"nearest"});
    }
    detail(site) {
      if(!site)return;
      const detail=$("catalog-detail");detail.replaceChildren();
      detail.append(node("span",kind(site),`site-badge${site.kind==="exploratory-point"?" exploratory":""}`),node("h3",site.name),
        node("p",`${site.latitude_deg.toFixed(4)}° latitude · ${site.longitude_deg.toFixed(4)}° longitude`),node("p",site.why_included));
      detail.querySelector("h3").tabIndex=-1;
      if(site.kind==="exploratory-point")detail.append(node("p",`Generated from ${site.parent_site_id}: ${site.offset_x_m} m in projected x, ${site.offset_y_m} m in projected y. Not a published landing point.`,"caption"));
      const source=node("a",`Coordinate context: ${site.source_locator}`);source.href=site.source_url;source.target="_blank";source.rel="noopener noreferrer";detail.append(source);
      if(site.terrain) {
        const grid=node("div",undefined,"site-terrain");
        for(const [label,value] of [["Elevation above reference sphere",`${fixed(site.terrain.elevation_m)} m`],["Diagnostic local slope",site.terrain.diagnostic_slope_deg===null?"Unavailable":`${fixed(site.terrain.diagnostic_slope_deg)}°`],["Local relief",site.terrain.local_relief_m===null?"Unavailable":`${fixed(site.terrain.local_relief_m)} m`]]) {
          const cell=node("div");cell.append(node("small",label),document.createTextNode(value));grid.append(cell);
        }
        detail.append(grid,node("p",`LOLA ${fixed(site.terrain.terrain_pixel_m,0)} m source · ${site.terrain.context}. Coarse terrain context does not resolve landing-footprint hazards.`,"caption"));
      } else detail.append(node("p","Verified terrain context unavailable. The live terrain map can still inspect your chosen point.","caption"));
      const preview=node("section",undefined,"site-preview");
      if(site.preview) {
        preview.append(node("strong",site.preview.label),node("p",`${date(site.preview.start_utc)} → ${date(site.preview.end_utc)}`,"site-period"),
          node("p",`${site.preview.step_hours}-hour samples · ${site.preview.observer_height_m} m observer. This preview covers these dates only; it is independent of your draft mission dates.","caption"));
        for(const condition of site.preview.conditions)preview.append(node("h4",condition.body==="SUN"?"Sunlight":"Earth-disk visibility"),node("p",condition.explanation),node("p",`Longest obstruction: ${condition.longest_obstruction_basis}.`,"caption"));
        preview.append(node("p","Visible-disk area describes geometry; it is not generated electrical power or a radio link budget.","caption"));
      } else preview.append(node("strong","Data collection in progress"),node("p","No published calculation is available for this site yet. The seasonal archive will be added after verification."));
      detail.append(preview);
      const choose=node("button","Use this site →","primary");choose.type="button";
      choose.onclick=()=>{this.onChoose(site);const status=node("p","Draft location updated. Date and height retained; no calculation started.","caption site-choice-status");status.setAttribute("role","status");detail.querySelector(".site-choice-status")?.remove();detail.append(status);};
      detail.append(choose);
      if(this.onCompare){const compare=node("button","Add to mission comparison","compare-site");compare.type="button";compare.onclick=()=>this.onCompare(site.site_id);detail.append(compare);}
    }
  };
})();

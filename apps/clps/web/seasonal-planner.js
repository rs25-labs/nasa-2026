"use strict";
(() => {
  const $=id=>document.getElementById(id);
  const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const months=Array.from({length:12},(_,i)=>new Intl.DateTimeFormat("en",{month:"long",timeZone:"UTC"}).format(new Date(Date.UTC(2026,i,1))));
  const hours=v=>Number.isFinite(v)?`${v.toFixed(1)} h`:"Unresolved";
  const range=row=>row?`${(row.mean_visible_fraction_lower*100).toFixed(1)}–${(row.mean_visible_fraction_upper*100).toFixed(1)}%`:"Unavailable";
  const joint=row=>row?`${hours(row.simultaneous_positive_visibility_hours_lower)}–${hours(row.simultaneous_positive_visibility_hours_upper)}`:"Unavailable";
  const obstruction=row=>!row?"Unavailable":`${hours(row.longest_blocked_hours)} · ${row.longest_basis || "Unresolved"}`;
  const pairs=rows=>{
    const groups=new Map();
    for(const row of rows){const key=`${row.start_utc}/${row.end_utc}/${row.mission_days||row.scope}`;if(!groups.has(key))groups.set(key,{});groups.get(key)[row.body]=row;}
    return [...groups.values()].filter(p=>p.SUN&&p.EARTH);
  };
  window.PlanningTools=class {
    constructor(api,onUse){
      this.api=api;this.onUse=onUse;this.sites=[];this.cache=new Map();this.revision=0;this.comparisonRevision=0;
      months.forEach((month,i)=>$("planning-month").add(new Option(month,String(i+1))));$("planning-month").value="11";
      for(const id of ["planning-site","planning-year","planning-month","planning-rank"])$(id).onchange=()=>this.render();
      $("planning-days").onchange=()=>{this.render();this.compare();};
      $("comparison-date").onchange=()=>this.compare();
      for(let i=0;i<3;i++)$("comparison-site-"+i).onchange=()=>this.compare();
    }
    setCatalog(sites){
      this.sites=sites;this.cache.clear();
      for(const id of ["planning-site","comparison-site-0","comparison-site-1","comparison-site-2"]){
        const select=$(id),previous=select.value;select.replaceChildren();
        if(id!=="planning-site")select.add(new Option("Choose a site",""));
        sites.forEach(s=>select.add(new Option(`${s.name} · ${s.site_id}`,s.site_id)));
        if(sites.some(s=>s.site_id===previous))select.value=previous;
        else if(id==="planning-site"||id==="comparison-site-0")select.value=sites.find(s=>s.data_status==="ready")?.site_id||sites[0]?.site_id||"";
        else select.value="";
      }
      this.render();this.compare();
    }
    async data(id){
      if(!id)return {available:false,seasonal:[],windows:[],notice:"Choose a catalog site."};
      if(!this.cache.has(id))this.cache.set(id,this.api(`/api/site-planning?site=${encodeURIComponent(id)}`).catch(()=>({available:false,seasonal:[],windows:[],notice:"Planning data could not be loaded. Refresh the site catalog to retry."})));
      return this.cache.get(id);
    }
    use(siteId,row){
      const site=this.sites.find(s=>s.site_id===siteId);if(!site)return;
      this.onUse(site,row);
      $("finder-status").textContent="Draft mission inputs updated: 2 m observer. No calculation started. The interactive calculator uses its displayed six-hour cadence; this preview uses hourly samples.";
    }
    async render(){
      const revision=++this.revision,id=$("planning-site").value;
      $("planning-notice").textContent="Loading published planning data…";
      $("planning-calendar").replaceChildren();$("planning-windows").replaceChildren();$("finder-status").textContent="";
      const data=await this.data(id);if(revision!==this.revision)return;
      const year=$("planning-year").value,month=Number($("planning-month").value),days=Number($("planning-days").value);
      $("planning-notice").textContent=data.available?`${data.label} · ${data.start_utc.slice(0,10)} → ${data.end_utc.slice(0,10)} UTC · ${data.step_hours}-hour samples · ${data.observer_height_m} m observer. ${data.notice}`:data.notice;
      const monthly=pairs(data.seasonal.filter(r=>r.scope==="month"&&r.start_utc.slice(0,4)===year));
      for(let m=1;m<=12;m++){
        const pair=monthly.find(p=>Number(p.SUN.start_utc.slice(5,7))===m),button=node("button",undefined,`month-card${pair?"":" missing"}`);button.type="button";
        button.setAttribute("aria-pressed",String(m===month));button.append(node("strong",months[m-1]));
        if(pair){
          button.append(node("small",pair.SUN.period_complete&&pair.EARTH.period_complete?"Full month covered":"Partial month · collected dates only"),node("small",`${pair.SUN.start_utc.slice(0,10)} → ${pair.SUN.end_utc.slice(0,10)} UTC`));
          for(const [body,label] of [["SUN","Sunlight"],["EARTH","Earth visibility"]]){
            const row=pair[body];button.append(node("span",`${label}: ${range(row)}`));
            const bar=node("span",undefined,"coverage-bar");bar.setAttribute("aria-hidden","true");
            for(const bound of ["upper","lower"]){const fill=node("span",undefined,bound);fill.style.width=`${row[`mean_visible_fraction_${bound}`]*100}%`;bar.append(fill);}button.append(bar);
          }
          button.append(node("small",`Unknown: Sun ${hours(pair.SUN.unknown_hours)} · Earth ${hours(pair.EARTH.unknown_hours)}`));
        }else button.append(node("span","No published data"));
        button.onclick=()=>{$("planning-month").value=String(m);this.render();};$("planning-calendar").append(button);
      }
      const rank=$("planning-rank").value;
      const score=p=>rank==="darkness"?(p.SUN.unknown_hours===0&&Number.isFinite(p.SUN.longest_blocked_hours)?-p.SUN.longest_blocked_hours:null):rank==="joint"?p.SUN.simultaneous_positive_visibility_hours_lower:p[rank==="sun"?"SUN":"EARTH"].mean_visible_fraction_lower;
      const windows=pairs(data.windows.filter(r=>r.mission_days===days&&r.period_complete&&r.start_utc.slice(0,4)===year&&Number(r.start_utc.slice(5,7))===month));
      windows.sort((a,b)=>{const x=score(a),y=score(b);return (x===null)-(y===null)||(x===null?0:y-x)||a.SUN.start_utc.localeCompare(b.SUN.start_utc);});
      $("finder-status").textContent=windows.length?`${windows.length} complete ${days}-day periods starting in ${months[month-1]} ${year}. Ranked using stored hourly estimates. Unknown darkness is unranked; ties use UTC date.`:`No complete ${days}-day periods published for this site and month. Missing coverage is not zero visibility.`;
      for(const pair of windows){
        const row=pair.SUN,card=node("article",undefined,"window-card");
        card.append(node("strong",`${row.start_utc.slice(0,10)} → ${row.end_utc.slice(0,10)} UTC`),node("p",`Sunlight ${range(row)} · Earth visibility ${range(pair.EARTH)}`),node("p",`Both disks partly visible: ${joint(row)} · Sun unknown ${hours(row.unknown_hours)} · Earth unknown ${hours(pair.EARTH.unknown_hours)}`,"caption"),node("p",`Longest darkness: ${obstruction(row)}${score(pair)===null?" · Unranked: darkness remains unresolved":""}`,"caption"));
        const use=node("button","Use these mission inputs →");use.type="button";use.onclick=()=>this.use(id,row);
        const compare=node("button","Compare this date");compare.type="button";compare.onclick=()=>{$("comparison-date").value=row.start_utc.slice(0,10);this.addComparison(id);};card.append(use,compare);$("planning-windows").append(card);
      }
    }
    addComparison(id){
      const selects=[0,1,2].map(i=>$("comparison-site-"+i));
      if(!selects.some(s=>s.value===id)){
        const empty=selects.find(s=>!s.value);if(!empty){$("comparison-status").textContent="Three sites selected. Clear a comparison slot before adding another site.";$("comparison-status").scrollIntoView({block:"nearest"});return;}
        empty.value=id;
      }
      this.compare();$("comparison-title").scrollIntoView({block:"nearest"});
    }
    async compare(){
      const revision=++this.comparisonRevision,ids=[0,1,2].map(i=>$("comparison-site-"+i).value).filter(Boolean),date=$("comparison-date").value,days=Number($("planning-days").value);
      $("comparison-table").replaceChildren();
      if(new Set(ids).size!==ids.length){$("comparison-status").textContent="Choose different sites in each comparison slot.";return;}
      if(!ids.length||!/^\d{4}-\d{2}-\d{2}$/.test(date)){$("comparison-status").textContent="Choose a UTC start date and up to three sites.";return;}
      $("comparison-status").textContent="Loading matched periods…";
      const data=await Promise.all(ids.map(id=>this.data(id)));if(revision!==this.comparisonRevision)return;
      const matches=data.map(d=>pairs(d.windows.filter(r=>r.period_complete&&r.mission_days===days&&r.start_utc.slice(0,10)===date))[0]);
      $("comparison-status").textContent=`${date} 00:00 UTC · ${days} day${days===1?"":"s"} · 2 m observer · hourly samples. ${matches.filter(Boolean).length} of ${ids.length} sites have complete coverage. Visibility describes disk geometry, not landing safety, power output or radio performance.`;
      const table=node("table"),caption=node("caption",`Matched mission periods beginning ${date} UTC`),head=node("thead"),tr=node("tr");tr.append(node("th","Measure"));
      ids.forEach(id=>tr.append(node("th",this.sites.find(s=>s.site_id===id)?.name||id)));head.append(tr);table.append(caption,head);
      const body=node("tbody");
      const metrics=[
        ["Coverage",p=>`${p.SUN.start_utc.slice(0,10)} → ${p.SUN.end_utc.slice(0,10)} UTC`],
        ["Sunlight · mean visible disk",p=>range(p.SUN)],
        ["Earth · mean visible disk",p=>range(p.EARTH)],
        ["Longest darkness",p=>obstruction(p.SUN)],
        ["Longest Earth obstruction",p=>obstruction(p.EARTH)],
        ["Unknown sampled time · Sun / Earth",p=>`${hours(p.SUN.unknown_hours)} / ${hours(p.EARTH.unknown_hours)}`],
        ["Both disks partly visible · lower–upper time",p=>joint(p.SUN)]
      ];
      for(const [label,value] of metrics){const row=node("tr"),th=node("th",label);th.scope="row";row.append(th);matches.forEach(p=>row.append(node("td",p?value(p):"Unavailable for this date/duration")));body.append(row);}
      const actions=node("tr");actions.append(node("th","Draft mission"));matches.forEach((p,i)=>{const td=node("td");if(p){const button=node("button","Use these inputs");button.type="button";button.onclick=()=>this.use(ids[i],p.SUN);td.append(button);}else td.textContent="No published period";actions.append(td);});body.append(actions);table.append(body);$("comparison-table").append(table);
    }
  };
})();

"use strict";
const $ = id => document.getElementById(id);
const form = $("mission-form");
let activeJob = null, lastJob = null, pollTimer = null, resultRequest = 0, displayedRequest = null;
const states = new Set(["FULL", "PARTIAL", "BLOCKED", "UNKNOWN"]);

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function error(message = "") { $("error").textContent = message; $("error").hidden = !message; }
function submissionError(message) {
  error(message);
  $("job-panel").hidden = false;
  $("job-title").textContent = "Unable to start calculation";
  $("job-text").textContent = message;
  $("cancel").hidden = true; $("retry").hidden = true;
  $("calculate").disabled = false;
}
async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Request failed (${response.status}).`);
  return value;
}
function pct(value) {
  if (value === "" || value === null || value === undefined || !Number.isFinite(Number(value))) return "Unresolved";
  return `${(100 * Number(value)).toFixed(1)}%`;
}
function bounds(lower, upper) {
  if (lower === "" || upper === "" || lower === undefined || upper === undefined) return "Unresolved";
  return Number(lower) === Number(upper) ? pct(lower) : `${pct(lower)}–${pct(upper)}`;
}
function hours(value) { return value === "" || value === null || value === undefined ? "Unresolved" : `${Number(value).toFixed(1)} h`; }
function utc(value) { return value.replace("T", " ").replace("+00:00", "Z"); }
const skyTimeline = new SkyTimeline(selectedTime => {
  for (const row of $("samples").children) row.classList.toggle("selected-sample", row.dataset.utc === selectedTime);
  for (const cursor of document.querySelectorAll(".time-cursor")) {
    const start = Number(cursor.dataset.start), end = Number(cursor.dataset.end);
    const percent = end > start ? (Date.parse(selectedTime) - start) / (end - start) * 100 : 0;
    cursor.style.left = `${Math.max(0, Math.min(100, percent))}%`;
  }
});
const terrainMap = new TerrainMap(api, (lat, lon) => {
  form.elements.latitude_deg.value = String(lat); form.elements.longitude_deg.value = String(lon);
  moveMarker();
});
let savedSites = [],catalogSites=[];
const moonJourney = new MoonJourney(() => {
  terrainMap.setSelected(Number(form.elements.latitude_deg.value), Number(form.elements.longitude_deg.value));
  terrainMap.center(terrainMap.selected);
  terrainMap.inspect();
}, request => {
  chooseSite(request);
});
function chooseSite(request) {
  $("planning-draft-status").textContent="";
  for (const key of ["site_id", "latitude_deg", "longitude_deg"]) {
    if (request[key] !== undefined) form.elements[key].value = String(request[key]);
  }
  moveMarker();
  terrainMap.center(terrainMap.selected);terrainMap.inspect();
}
const planningTools=new PlanningTools(api,(site,row)=>{
  form.elements.start.value=row.start_utc.slice(0,16);
  form.elements.days.value=String(row.mission_days);
  form.elements.observer_height_m.value="2";
  chooseSite(site);
  $("planning-draft-status").textContent="Copied archived mission inputs into the draft at 2 m. No calculation started. Calculate uses the six-hour cadence shown below; the planning preview uses hourly samples.";
  form.scrollIntoView({block:"start"});form.elements.start.focus({preventScroll:true});
});
const siteExplorer=new SiteExplorer(api,sites=>{
  catalogSites=sites;
  planningTools.setCatalog(sites);
  terrainMap.setCatalog(sites,siteId=>{
    const site=sites.find(s=>s.site_id===siteId);if(!site)return;
    chooseSite(site);siteExplorer.inspect(siteId);
  });
  moveMarker();
},site=>chooseSite(site),siteId=>planningTools.addComparison(siteId));
function moveMarker() {
  const lat = Number(form.elements.latitude_deg.value), lon = Number(form.elements.longitude_deg.value);
  terrainMap.setSelected(lat, lon);
  moonJourney.setSites(savedSites, { site_id:form.elements.site_id.value, latitude_deg:lat, longitude_deg:lon },catalogSites);
  if (displayedRequest) {
    const changed = ["latitude_deg", "longitude_deg", "observer_height_m", "days"].some(key => Number(form.elements[key].value) !== Number(displayedRequest[key]))
      || Date.parse(form.elements.start.value + "Z") !== Date.parse(displayedRequest.start_utc);
    $("draft-notice").hidden = !changed;
  }
}
form.addEventListener("input", moveMarker);
form.addEventListener("input",()=>{$("planning-draft-status").textContent="";});
for (const key of ["latitude_deg", "longitude_deg"]) form.elements[key].addEventListener("change", () => terrainMap.inspect());

function renderResult(result) {
  displayedRequest = result.request;
  $("empty").hidden = true; $("results").hidden = false;
  $("result-title").textContent = result.request.site_id || "Mission environment";
  $("result-meta").textContent = `${result.request.latitude_deg}° latitude · ${result.request.longitude_deg}° longitude · ${utc(result.request.start_utc)} → ${utc(result.request.end_utc)}`;
  $("run-id").textContent = `Run ${result.run_id} · calculation ${Number(result.calculation_seconds).toFixed(1)} s · ${result.cache_key}`;
  $("summary").replaceChildren(); $("timeline").replaceChildren(); $("samples").replaceChildren(); $("exports").replaceChildren();
  for (const summary of result.summaries) {
    const name = summary.body === "SUN" ? "Sunlight" : "Earth-disk visibility";
    const card = el("div", undefined, "metric");
    card.append(el("div", name, "metric-label"), el("div", bounds(summary.mean_visible_fraction_lower, summary.mean_visible_fraction_upper), "metric-value"),
      el("p", "Duration-weighted visible-disk range", "caption"),
      el("p", `${hours(summary.full_hours)} full · ${hours(summary.partial_hours)} partial · ${hours(summary.unknown_hours)} unknown`, "caption"),
      el("p", `Longest known blocked interval: ${hours(summary.longest_blocked_hours)}`, "caption"),
      el("p", summary.longest_basis || "", "caption"));
    $("summary").append(card);
    const row = el("div", undefined, "timeline-row"), label = el("div", undefined, "timeline-label");
    label.append(el("span", name), el("span", `${hours(summary.total_hours)} total`));
    const track = el("div", undefined, "track");
    track.setAttribute("role", "group"); track.setAttribute("aria-label", `${name} intervals; choose an interval to inspect its start`);
    const intervals = result.intervals.filter(i => i.body === summary.body);
    for (const interval of intervals) {
      const state = states.has(interval.state) ? interval.state : "UNKNOWN";
      const segment = el("button", undefined, `interval ${state}`); segment.type = "button";
      segment.style.width = `${Number(interval.duration_hours) / Number(summary.total_hours) * 100}%`;
      segment.title = `${state}: ${utc(interval.start_utc)} → ${utc(interval.end_utc)} (${hours(interval.duration_hours)})`;
      segment.setAttribute("aria-label", `${name} ${segment.title}`);
      segment.addEventListener("click", () => skyTimeline.seek(interval.start_utc));
      track.append(segment);
    }
    if (intervals.length) {
      const cursor = el("span", undefined, "time-cursor"); cursor.setAttribute("aria-hidden", "true");
      cursor.dataset.start = String(Date.parse(intervals[0].start_utc));
      cursor.dataset.end = String(Date.parse(intervals[intervals.length - 1].end_utc)); track.append(cursor);
    }
    row.append(label, track);
    if (intervals.length) row.append(el("p", `${utc(intervals[0].start_utc)} → ${utc(intervals[intervals.length - 1].end_utc)}`, "caption"));
    $("timeline").append(row);
  }
  for (const sample of result.samples) {
    const row = el("tr"), state = states.has(sample.state) ? sample.state : "UNKNOWN";
    row.dataset.utc = sample.utc;
    const stateCell = el("td"); stateCell.append(el("span", state, `state ${state}`));
    const timeCell = el("td"), timeButton = el("button", utc(sample.utc), "sample-time"); timeButton.type = "button";
    timeButton.setAttribute("aria-label", `Show sky at ${utc(sample.utc)} for ${sample.body}`);
    timeButton.addEventListener("click", () => skyTimeline.seek(sample.utc)); timeCell.append(timeButton);
    row.append(timeCell, el("td", sample.body), stateCell,
      el("td", bounds(sample.visible_fraction_lower, sample.visible_fraction_upper)));
    $("samples").append(row);
  }
  for (const [name, label] of [["environment-timeseries.csv", "Samples CSV"], ["environment-intervals.csv", "Intervals CSV"], ["environment-summaries.csv", "Summary CSV"], ["environment-report.json", "Evidence report JSON"]]) {
    const link = el("a", label); link.href = `/api/results/${result.cache_key}/${name}`; link.download = name;
    $("exports").append(link);
  }
  terrainMap.setResult(result.request); skyTimeline.setResult(result); moveMarker();
}
async function openResult(key) {
  const request = ++resultRequest;
  try {
    error(); const result = await api(`/api/results/${key}`);
    if (request === resultRequest) renderResult(result);
  } catch (reason) { if (request === resultRequest) error(reason.message); }
}
async function refreshSaved() {
  try {
    const items = await api("/api/saved"); $("saved-list").replaceChildren();
    savedSites = items; moveMarker();
    if (!items.length) $("saved-list").append(el("p", "Your completed calculations will appear here.", "caption"));
    for (const item of items) {
      const row = el("div", undefined, "saved-item"), button = el("button", "Open result ↗");
      button.type = "button"; button.setAttribute("aria-label", `Open saved run ${item.run_id}`);
      button.addEventListener("click", () => openResult(item.cache_key));
      const label = item.request?.site_id ? `${item.request.site_id} · ${utc(item.request.start_utc || item.run_id)}` : item.run_id;
      row.append(el("span", label), button); $("saved-list").append(row);
    }
  } catch (reason) { $("saved-list").replaceChildren(el("p", reason.message, "caption")); }
}
async function trackJob(job) {
  clearTimeout(pollTimer); activeJob = job.id; lastJob = job; $("job-panel").hidden = false;
  const running = ["queued", "running", "cancelling"].includes(job.state);
  $("calculate").disabled = running; $("cancel").hidden = !running;
  $("cancel").disabled = job.state === "cancelling";
  $("retry").hidden = running || job.state === "complete";
  $("job-title").textContent = { queued: "Calculation queued", running: "Calculating your environment", cancelling: "Stopping calculation", complete: job.cache_hit ? "Loaded matching saved result" : "Environment ready", cancelled: "Calculation cancelled", interrupted: "Previous calculation interrupted", failed: "Calculation could not finish" }[job.state] || job.state;
  $("job-text").textContent = running ? `${Math.floor(job.elapsed_seconds || 0)} s elapsed · The page remains usable. No completion percentage is estimated.` : `${Math.floor(job.elapsed_seconds || 0)} s elapsed`;
  if (job.notice) $("job-text").textContent += ` · ${job.notice}`;
  if (job.state === "complete") { activeJob = null; await openResult(job.cache_key); await refreshSaved(); }
  else if (!running) { activeJob = null; if (job.error) error(job.error); }
  else pollTimer = setTimeout(async () => {
    try { await trackJob(await api(`/api/jobs/${job.id}`)); }
    catch (reason) { error(`${reason.message} Reload the page to reconnect to the job.`); $("calculate").disabled = false; }
  }, 1500);
}
form.addEventListener("submit", async event => {
  event.preventDefault(); error();
  if (!form.checkValidity()) {
    const invalid = form.querySelector(":invalid");
    submissionError(invalid?.validationMessage || "Check the mission inputs.");
    invalid?.focus();
    return;
  }
  $("calculate").disabled = true;
  const data = Object.fromEntries(new FormData(form));
  for (const key of ["latitude_deg", "longitude_deg", "observer_height_m", "days"]) data[key] = Number(data[key]);
  data.start += "Z";
  try { await trackJob(await api("/api/jobs", data)); }
  catch (reason) { submissionError(reason.message); }
});
$("cancel").addEventListener("click", async () => {
  if (!activeJob) return;
  try { await trackJob(await api(`/api/jobs/${activeJob}/cancel`, {})); }
  catch (reason) { error(reason.message); }
});
$("retry").addEventListener("click", () => {
  if (!lastJob?.request) return;
  for (const [key, value] of Object.entries(lastJob.request)) {
    form.elements[key].value = key === "start" ? new Date(value).toISOString().slice(0, 16) : value;
  }
  moveMarker(); form.requestSubmit();
});
$("refresh").addEventListener("click", refreshSaved);
moveMarker(); refreshSaved();
siteExplorer.load();
api("/api/jobs").then(jobs => {
  const active = jobs.find(job => ["queued", "running", "cancelling"].includes(job.state));
  if (active) trackJob(active);
  else if (jobs[0]?.state === "interrupted") trackJob(jobs[0]);
}).catch(reason => error(reason.message));

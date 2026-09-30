import { loadDataset } from "./data.js";
import { createFilterStore, computeMask, maskIndices, readStateFromUrl, DEFAULTS, isReliable } from "./state.js";
import { rankedBarChart, lineChart, multiLineChart, multiBarChart, histogramChart, scatterChart, seriesColors } from "./charts.js";
import { renderTable } from "./tables.js";
import { downloadChartPng } from "./export.js";
import { loadGeoData, flowMapChart } from "./map.js";
import { icon, applyIcons } from "./icons.js";
import { monthlyPayment } from "./context.js";

const fmt = new Intl.NumberFormat("en-US");
const fmtMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtMoney0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, notation: "compact" });

const MEASURES = {
  total: { label: "Total movers", format: (v) => fmt.format(Math.round(v)) },
  count: { label: "Number of records", format: (v) => fmt.format(Math.round(v)) },
  median_zhvi: { label: "Median destination home value", format: (v) => (v == null ? "n/a" : fmtMoney.format(v)) },
  cheaper_rate: { label: "Share to cheaper state", format: (v) => (v == null ? "n/a" : v.toFixed(1) + "%") },
};
const BREAKDOWN_FIELD = { current_state: "currentState", prior_state: "priorState", current_region: "currentRegion", year: "year" };
const FILTER_LABELS = { year: "Year", current_state: "Destination", prior_state: "Origin", current_region: "Region", reliable: "Routes" };
const FILTER_VALUE_TEXT = { reliable: () => "reliable only" };
const LOW_RELIABILITY = "Low (margin of error > 30%)";
const REGIONS_ORDERED = ["Northeast", "Midwest", "South", "West", "Territory"];

let data;
let store;
const charts = {}; // panelKey -> ECharts instance

// "2024 dollars" switch: when on, every dollar amount is restated with CPI-U so years can be compared.
let dollarsReal = false;
let zhviLookup; // state index -> Map(year -> ZHVI), one value per state-year
const dollars = (value, i) => (dollarsReal ? value * data.context.realFactor(data.year[i]) : value);
const moneyLabel = (label) => (dollarsReal ? `${label} (2024 $)` : label);

// ---- small utilities ----

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function sampleArray(arr, n) {
  if (arr.length <= n) return arr;
  const out = [];
  const step = arr.length / n;
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

/** Synchronous fallback for browsers/contexts where the async Clipboard API
 * is unavailable, blocked, or (observed while testing this feature) simply
 * hangs forever waiting on a permission prompt that never resolves. */
function copyViaFallback(text) {
  const el = document.createElement("textarea");
  el.value = text;
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  el.remove();
  return ok;
}

function copyLinkToClipboard(url) {
  const clipboardWrite =
    navigator.clipboard && typeof navigator.clipboard.writeText === "function"
      ? navigator.clipboard.writeText(url)
      : Promise.reject(new Error("Clipboard API unavailable"));
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1200));

  Promise.race([clipboardWrite, timeout])
    .then(() => showToast("Link copied"))
    .catch(() => {
      showToast(copyViaFallback(url) ? "Link copied" : "Could not copy link");
    });
}

// ---- KPI computation ----

function computeKpis(indices) {
  if (!indices.length) {
    return { totalMovers: 0, routes: 0, medianZhvi: null, cheaperRate: null, avgGap: null };
  }
  let totalMovers = 0;
  const zhviVals = [];
  let gapWeighted = 0, gapMovers = 0, cheaperMovers = 0;
  for (const i of indices) {
    totalMovers += data.movers[i];
    if (!Number.isNaN(data.currentZhvi[i])) zhviVals.push(dollars(data.currentZhvi[i], i));
    if (!Number.isNaN(data.currentZhvi[i]) && !Number.isNaN(data.priorZhvi[i])) {
      const gap = dollars(data.currentZhvi[i] - data.priorZhvi[i], i);
      gapWeighted += gap * data.movers[i];
      gapMovers += data.movers[i];
      if (gap < 0) cheaperMovers += data.movers[i];
    }
  }
  return {
    totalMovers,
    routes: indices.length,
    medianZhvi: median(zhviVals),
    cheaperRate: gapMovers ? (cheaperMovers / gapMovers) * 100 : null,
    avgGap: gapMovers ? gapWeighted / gapMovers : null,
  };
}

function renderKpis(indices, filters) {
  const kpis = computeKpis(indices);
  document.getElementById("kpi-total-movers").textContent = fmt.format(kpis.totalMovers);
  document.getElementById("kpi-routes").textContent = fmt.format(kpis.routes);
  document.getElementById("kpi-median-zhvi").textContent = kpis.medianZhvi == null ? "n/a" : fmtMoney.format(kpis.medianZhvi);
  document.getElementById("kpi-cheaper-rate").textContent = kpis.cheaperRate == null ? "n/a" : kpis.cheaperRate.toFixed(1) + "%";
  document.getElementById("kpi-avg-gap").textContent = kpis.avgGap == null ? "n/a" : fmtMoney.format(kpis.avgGap);

  renderDeltas(kpis, filters);
}

function renderDeltas(current, filters) {
  const ids = {
    totalMovers: "kpi-delta-total-movers",
    routes: "kpi-delta-routes",
    medianZhvi: "kpi-delta-median-zhvi",
    cheaperRate: "kpi-delta-cheaper-rate",
    avgGap: "kpi-delta-avg-gap",
  };
  if (filters.year === "all") {
    for (const id of Object.values(ids)) document.getElementById(id).textContent = "";
    return;
  }
  const year = Number(filters.year);
  const priorYear = Math.max(-Infinity, ...data.meta.years.filter((y) => y < year));
  if (!Number.isFinite(priorYear)) {
    for (const id of Object.values(ids)) document.getElementById(id).textContent = "";
    return;
  }
  const prevMask = computeMask(data, { ...filters, year: String(priorYear) });
  const prev = computeKpis(maskIndices(prevMask));

  for (const key of Object.keys(ids)) {
    const el = document.getElementById(ids[key]);
    const curVal = current[key];
    const prevVal = prev[key];
    if (curVal == null || prevVal == null || prevVal === 0) {
      el.textContent = "";
      continue;
    }
    const pct = ((curVal - prevVal) / Math.abs(prevVal)) * 100;
    const arrow = pct >= 0 ? "▲" : "▼";
    el.textContent = `${arrow} ${Math.abs(pct).toFixed(1)}% vs ${priorYear}`;
  }
}

// ---- active filter chips ----

function renderActiveFilters(filters) {
  const container = document.getElementById("active-filters");
  const entries = Object.entries(filters).filter(([k, v]) => k in FILTER_LABELS && v !== "all");
  container.innerHTML = entries
    .map(
      ([key, value]) =>
        `<span class="chip" data-key="${key}">${FILTER_LABELS[key]}: ${FILTER_VALUE_TEXT[key] ? FILTER_VALUE_TEXT[key](value) : value}
          <button type="button" aria-label="Remove ${FILTER_LABELS[key]} filter" data-remove="${key}">&times;</button>
        </span>`
    )
    .join("");
  container.querySelectorAll("button[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => store.set({ [btn.dataset.remove]: "all" }));
  });
  updateSegmented(filters.current_region);
  syncSelect("filter-year", filters.year);
  syncSelect("filter-current-state", filters.current_state);
  syncSelect("filter-prior-state", filters.prior_state);
  document.getElementById("filter-reliable").checked = filters.reliable === "yes";
}

function syncSelect(id, value) {
  const el = document.getElementById(id);
  if (el.value !== value) el.value = value;
}

function updateSegmented(activeRegion) {
  document.querySelectorAll("#filter-region button").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.value === activeRegion);
  });
}

// ---- panel toolbar wiring (Chart / Table / PNG, generic across all panels) ----

function wirePanelToolbar(panelKey, onView) {
  const toolbar = document.querySelector(`.panel-toolbar[data-panel="${panelKey}"]`);
  const panel = toolbar.closest(".panel");
  toolbar.querySelectorAll("button[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      toolbar.querySelectorAll("button[data-view]").forEach((b) => b.classList.remove("is-on"));
      btn.classList.add("is-on");
      panel.querySelectorAll("[data-view-body]").forEach((body) => {
        body.classList.toggle("is-hidden", body.dataset.viewBody !== btn.dataset.view);
      });
      if (btn.dataset.view === "chart" && charts[panelKey]) charts[panelKey].resize();
      onView && onView(btn.dataset.view);
    });
  });
  toolbar.querySelector("button[data-action='png']").addEventListener("click", () => {
    const chart = charts[panelKey];
    if (!chart) return;
    downloadChartPng(chart, `${panelKey}.png`);
  });
}

function showEmptyState(panelKey, isEmpty) {
  const toolbar = document.querySelector(`.panel-toolbar[data-panel="${panelKey}"]`);
  const panel = toolbar.closest(".panel");
  const chartBody = panel.querySelector('[data-view-body="chart"]');
  let empty = panel.querySelector(".empty-state");
  if (isEmpty) {
    if (!empty) {
      empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = `<span class="btn-icon" aria-hidden="true">${icon("box", 32)}</span><span>Nothing packed here &mdash; try removing a filter.</span>`;
      chartBody.appendChild(empty);
    }
    empty.hidden = false;
  } else if (empty) {
    empty.hidden = true;
  }
}

// ---- panel: main flexible chart ----

function renderMainPanel(indices, controls) {
  const { measure, breakdown, charttype } = controls;
  const measureInfo = MEASURES[measure];
  const field = BREAKDOWN_FIELD[breakdown];
  document.getElementById("main-title").textContent =
    breakdown === "year"
      ? `${moneyLabelFor(measure)} by year and region`
      : `${moneyLabelFor(measure)} by ${breakdownLabel(breakdown).toLowerCase()}`;

  if (breakdown === "year") {
    // one series per region, x-axis = year
    const years = data.meta.years;
    const seriesByLabel = {};
    for (const region of REGIONS_ORDERED) {
      const regionIdx = data.regions.indexOf(region);
      if (regionIdx === -1) continue;
      seriesByLabel[region] = years.map((y) => {
        const rowsForYearRegion = indices.filter((i) => data.year[i] === y && data.currentRegion[i] === regionIdx);
        return measureValue(rowsForYearRegion, measure);
      });
    }
    const el = document.getElementById("main-chart");
    charts.main =
      charttype === "line"
        ? multiLineChart(el, years, seriesByLabel, { onCategoryClick: (y) => store.set({ year: String(y) }) })
        : multiBarChart(el, years, seriesByLabel, { stacked: charttype === "stacked", onCategoryClick: (y) => store.set({ year: String(y) }) });

    renderTable(
      document.getElementById("main-table"),
      [{ label: "Year", key: "year" }, ...REGIONS_ORDERED.map((r) => ({ label: r, key: r, format: measureInfo.format }))],
      years.map((y, i) => {
        const row = { year: y };
        for (const r of REGIONS_ORDERED) row[r] = seriesByLabel[r] ? seriesByLabel[r][i] : null;
        return row;
      }),
      { onRowClick: (row) => store.set({ year: String(row.year) }) }
    );
    showEmptyState("main", indices.length === 0);
    return;
  }

  // group by a single categorical field, one bar per category
  const groups = new Map();
  for (const i of indices) {
    const key = field === "year" ? data.year[i] : data[field][i];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  let entries = [...groups.entries()].map(([k, rows]) => [labelFor(breakdown, k), measureValue(rows, measure)]);
  entries = entries.filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]);

  const el = document.getElementById("main-chart");
  const categories = entries.map((e) => e[0]);
  const values = entries.map((e) => e[1]);
  const seriesByLabel = { [measureInfo.label]: values };
  charts.main =
    charttype === "line"
      ? multiLineChart(el, categories, seriesByLabel, { onCategoryClick: (label) => setFilterFromLabel(breakdown, label) })
      : multiBarChart(el, categories, seriesByLabel, { stacked: charttype === "stacked", onCategoryClick: (label) => setFilterFromLabel(breakdown, label) });

  renderTable(
    document.getElementById("main-table"),
    [{ label: breakdownLabel(breakdown), key: "label" }, { label: measureInfo.label, key: "value", format: measureInfo.format }],
    entries.map(([label, value]) => ({ label, value })),
    { onRowClick: (row) => setFilterFromLabel(breakdown, row.label) }
  );
  showEmptyState("main", indices.length === 0);
}

/** Measure label, marked when the value is a dollar amount shown in 2024 dollars. */
function moneyLabelFor(measure) {
  return measure === "median_zhvi" ? moneyLabel(MEASURES[measure].label) : MEASURES[measure].label;
}

function breakdownLabel(breakdown) {
  return { current_state: "Destination state", prior_state: "Origin state", current_region: "Region", year: "Year" }[breakdown];
}

function labelFor(breakdown, key) {
  if (breakdown === "current_state" || breakdown === "prior_state") return data.states[key];
  if (breakdown === "current_region") return data.regions[key];
  return key;
}

function setFilterFromLabel(breakdown, label) {
  if (breakdown === "year") store.set({ year: String(label) });
  else store.set({ [breakdown]: label });
}

function measureValue(rows, measure) {
  if (!rows.length) return measure === "median_zhvi" || measure === "cheaper_rate" ? null : 0;
  if (measure === "total") return rows.reduce((s, i) => s + data.movers[i], 0);
  if (measure === "count") return rows.length;
  if (measure === "median_zhvi") return median(rows.filter((i) => !Number.isNaN(data.currentZhvi[i])).map((i) => dollars(data.currentZhvi[i], i)));
  if (measure === "cheaper_rate") {
    let m = 0, cheaper = 0;
    for (const i of rows) {
      if (Number.isNaN(data.currentZhvi[i]) || Number.isNaN(data.priorZhvi[i])) continue;
      m += data.movers[i];
      if (data.currentZhvi[i] < data.priorZhvi[i]) cheaper += data.movers[i];
    }
    return m ? (cheaper / m) * 100 : null;
  }
  return 0;
}

// ---- panel: movers by year (fixed line chart) ----

function renderTrendPanel(indices, measure) {
  const measureInfo = MEASURES[measure];
  document.getElementById("trend-title").textContent = `${moneyLabelFor(measure)} by year`;
  const rowsByYear = new Map();
  for (const i of indices) {
    if (!rowsByYear.has(data.year[i])) rowsByYear.set(data.year[i], []);
    rowsByYear.get(data.year[i]).push(i);
  }
  const series = [...rowsByYear.entries()]
    .map(([year, rows]) => [year, measureValue(rows, measure)])
    .filter(([, v]) => v != null)
    .sort((a, b) => a[0] - b[0]);
  const [accent] = seriesColors();
  charts.trend = lineChart(document.getElementById("chart-trend"), series.length ? series : [[0, 0]], {
    color: accent,
    formatValue: measureInfo.format,
    onCategoryClick: (y) => store.set({ year: String(y) }),
  });
  renderTable(
    document.getElementById("table-trend"),
    [{ label: "Year", key: "year" }, { label: measureInfo.label, key: "value", format: measureInfo.format }],
    series.map(([year, value]) => ({ year, value })),
    { onRowClick: (row) => store.set({ year: String(row.year) }) }
  );
  showEmptyState("trend", indices.length === 0);
}

// ---- panel: busiest routes ----

function renderRoutesPanel(indices) {
  // Summing estimates: the combined margin of error is the root of the summed squares.
  const routes = new Map();
  for (const i of indices) {
    const key = `${data.states[data.priorState[i]]} → ${data.states[data.currentState[i]]}`;
    const r = routes.get(key) || { movers: 0, moeSq: 0 };
    r.movers += data.movers[i];
    r.moeSq += data.moe[i] ** 2;
    routes.set(key, r);
  }
  const top = [...routes.entries()].sort((a, b) => b[1].movers - a[1].movers).slice(0, 10);
  const moeOf = (r) => Math.round(Math.sqrt(r.moeSq));
  const low = top.map(([, r]) => !isReliable(r.movers, Math.sqrt(r.moeSq)));
  const goToRoute = (label) => {
    const [origin, destination] = label.split(" → ");
    store.set({ prior_state: origin, current_state: destination });
  };
  charts.routes = rankedBarChart(
    document.getElementById("chart-routes"),
    top.map(([route, r]) => [route, r.movers]),
    { flags: low, onBarClick: goToRoute }
  );
  renderTable(
    document.getElementById("table-routes"),
    [
      { label: "Route", key: "route" },
      { label: "Movers", key: "movers", format: (v) => fmt.format(v) },
      { label: "Margin of error (±)", key: "moe", format: (v) => fmt.format(v) },
      { label: "Reliability", key: "reliability" },
    ],
    top.map(([route, r], n) => ({ route, movers: r.movers, moe: moeOf(r), reliability: low[n] ? LOW_RELIABILITY : "Reliable" })),
    { onRowClick: (row) => goToRoute(row.route) }
  );
  showEmptyState("routes", indices.length === 0);
}

// ---- panel: home value gap histogram ----

function renderHistogramPanel(indices) {
  const gaps = [];
  for (const i of indices) {
    if (Number.isNaN(data.currentZhvi[i]) || Number.isNaN(data.priorZhvi[i])) continue;
    gaps.push(dollars(data.currentZhvi[i] - data.priorZhvi[i], i));
  }
  let bins = [];
  if (gaps.length) {
    const min = Math.min(...gaps), max = Math.max(...gaps);
    const n = 14;
    const width = (max - min) / n || 1;
    const counts = new Array(n).fill(0);
    for (const g of gaps) counts[Math.min(n - 1, Math.floor((g - min) / width))]++;
    bins = counts.map((count, i) => ({
      label: fmtMoney0.format(min + i * width),
      count,
      rangeLabel: `${fmtMoney0.format(min + i * width)} to ${fmtMoney0.format(min + (i + 1) * width)}`,
    }));
  }
  charts.histogram = histogramChart(document.getElementById("chart-histogram"), bins.length ? bins : [{ label: "n/a", count: 0 }]);
  renderTable(
    document.getElementById("table-histogram"),
    [{ label: "Gap range", key: "rangeLabel" }, { label: "Rows", key: "count", format: (v) => fmt.format(v) }],
    bins
  );
  showEmptyState("histogram", indices.length === 0);
}

// ---- panel: scatter ----

function renderScatterPanel(indices, showRefLine) {
  const sampled = sampleArray(indices, 3000);
  const pointsByGroup = {};
  const tableRows = [];
  for (const i of sampled) {
    if (Number.isNaN(data.currentZhvi[i]) || Number.isNaN(data.priorZhvi[i])) continue;
    const region = data.regions[data.currentRegion[i]];
    const gap = dollars(data.currentZhvi[i] - data.priorZhvi[i], i);
    // extra tuple fields (prior state, current state, year) ride along for
    // click-to-filter; ECharts ignores dims beyond x/y for scatter rendering.
    (pointsByGroup[region] ||= []).push([data.movers[i], Math.round(gap), data.states[data.priorState[i]], data.states[data.currentState[i]], data.year[i], !isReliable(data.movers[i], data.moe[i])]);
    tableRows.push({
      prior: data.states[data.priorState[i]],
      current: data.states[data.currentState[i]],
      year: data.year[i],
      movers: data.movers[i],
      gap: Math.round(gap),
      moe: data.moe[i],
      reliability: isReliable(data.movers[i], data.moe[i]) ? "Reliable" : LOW_RELIABILITY,
    });
  }
  let refLine = null;
  if (showRefLine) {
    const allMovers = Object.values(pointsByGroup).flat().map((p) => p[0]);
    if (allMovers.length) {
      refLine = { name: "Break-even (gap = $0)", data: [[Math.min(...allMovers), 0], [Math.max(...allMovers), 0]] };
    }
  }
  charts.scatter = scatterChart(document.getElementById("chart-scatter"), pointsByGroup, {
    refLine,
    groupOrder: REGIONS_ORDERED,
    onPointClick: (point) => store.set({ prior_state: point[2], current_state: point[3], year: String(point[4]) }),
  });
  tableRows.sort((a, b) => b.movers - a.movers);
  renderTable(
    document.getElementById("table-scatter"),
    [
      { label: "Origin", key: "prior" },
      { label: "Destination", key: "current" },
      { label: "Year", key: "year" },
      { label: "Movers", key: "movers", format: (v) => fmt.format(v) },
      { label: "Gap", key: "gap", format: (v) => fmtMoney0.format(v) },
      { label: "Margin of error (±)", key: "moe", format: (v) => fmt.format(v) },
      { label: "Reliability", key: "reliability" },
    ],
    tableRows.slice(0, 500),
    { onRowClick: (row) => store.set({ prior_state: row.prior, current_state: row.current, year: String(row.year) }) }
  );
  showEmptyState("scatter", indices.length === 0);
}

// ---- panel: migration flow map ----

let geo = null;
let mapMode = "in";

function renderMapPanel(indices, filters) {
  if (!geo) return; // geo data still loading
  const inSum = new Map(), outSum = new Map();
  const rateIn = new Map(), rateOut = new Map(); // same sums, but only in years where the state has a population estimate
  const yearsInView = new Set();
  const routeSum = new Map();
  for (const i of indices) {
    const dest = data.states[data.currentState[i]];
    const orig = data.states[data.priorState[i]];
    inSum.set(dest, (inSum.get(dest) || 0) + data.movers[i]);
    outSum.set(orig, (outSum.get(orig) || 0) + data.movers[i]);
    yearsInView.add(data.year[i]);
    if (Number.isFinite(data.context.population(data.currentState[i], data.year[i]))) rateIn.set(dest, (rateIn.get(dest) || 0) + data.movers[i]);
    if (Number.isFinite(data.context.population(data.priorState[i], data.year[i]))) rateOut.set(orig, (rateOut.get(orig) || 0) + data.movers[i]);
    const key = `${orig}→${dest}`;
    const r = routeSum.get(key) || { movers: 0, moeSq: 0 };
    r.movers += data.movers[i];
    r.moeSq += data.moe[i] ** 2;
    routeSum.set(key, r);
  }
  const stateValues = new Map();
  data.states.forEach((s, idx) => {
    const inV = inSum.get(s) || 0;
    const outV = outSum.get(s) || 0;
    if (mapMode === "rate") {
      let population = 0;
      for (const y of yearsInView) {
        const p = data.context.population(idx, y);
        if (Number.isFinite(p)) population += p;
      }
      stateValues.set(s, population > 0 ? (1000 * ((rateIn.get(s) || 0) - (rateOut.get(s) || 0))) / population : 0);
    } else {
      stateValues.set(s, mapMode === "in" ? inV : mapMode === "out" ? outV : inV - outV);
    }
  });
  const arcs = [...routeSum.entries()]
    .map(([key, r]) => {
      const [from, to] = key.split("→");
      return { from, to, movers: r.movers, unreliable: !isReliable(r.movers, Math.sqrt(r.moeSq)) };
    })
    .sort((a, b) => b.movers - a.movers)
    .slice(0, 40);

  const selectedStates = [filters.current_state, filters.prior_state].filter((s) => s !== "all");

  charts.map = flowMapChart(document.getElementById("map-chart"), {
    stateValues,
    mode: mapMode,
    arcs,
    centroids: geo.centroids,
    selectedStates,
    onStateClick: (name) => store.set({ current_state: name }),
  });

  renderTable(
    document.getElementById("map-table"),
    [
      { label: "Origin", key: "from" },
      { label: "Destination", key: "to" },
      { label: "Movers", key: "movers", format: (v) => fmt.format(v) },
      { label: "Reliability", key: "reliability" },
    ],
    arcs.map((a) => ({ ...a, reliability: a.unreliable ? LOW_RELIABILITY : "Reliable" })),
    { onRowClick: (row) => store.set({ prior_state: row.from, current_state: row.to }) }
  );
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("#map-mode button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#map-mode button").forEach((b) => b.classList.remove("is-on"));
      btn.classList.add("is-on");
      mapMode = btn.dataset.value;
      renderMapPanel(maskIndices(computeMask(data, store.get())), store.get());
    });
  });
});

// ---- "Plan your move" comparison ----

function computeStateSnapshot(stateName) {
  const idx = data.states.indexOf(stateName);
  const ctx = data.context;
  const latest = Math.max(...data.meta.years);
  let inMovers = 0, outMovers = 0, zhvi = null;
  for (let i = 0; i < data.length; i++) {
    if (data.year[i] !== latest) continue;
    if (data.currentState[i] === idx) {
      inMovers += data.movers[i];
      if (zhvi == null && !Number.isNaN(data.currentZhvi[i])) zhvi = data.currentZhvi[i];
    }
    if (data.priorState[i] === idx) outMovers += data.movers[i];
  }
  const population = ctx.population(idx, latest);
  const income = ctx.income(idx, latest);
  const payment = zhvi == null ? NaN : monthlyPayment(zhvi, ctx.mortgageRate(latest));
  return {
    year: latest,
    inMovers,
    outMovers,
    net: inMovers - outMovers,
    zhvi,
    perThousand: (1000 * (inMovers - outMovers)) / population,
    income,
    priceIncome: zhvi == null ? NaN : zhvi / income,
    rpp: ctx.rppAll(idx, latest),
    rent: ctx.rent(idx, latest),
    payment,
    paymentShare: (payment * 12 * 100) / income,
  };
}

function renderPlanYourMove() {
  const fromName = document.getElementById("plan-from").value;
  const toName = document.getElementById("plan-to").value;
  const container = document.getElementById("plan-your-move-result");
  if (!fromName || !toName) {
    container.innerHTML = "";
    return;
  }
  const from = computeStateSnapshot(fromName);
  const to = computeStateSnapshot(toName);

  const fmtOr = (f) => (v) => (v == null || !Number.isFinite(v) ? "n/a" : f(v));
  const money = fmtOr((v) => fmtMoney.format(v));
  const metrics = [
    { label: "Home value", from: from.zhvi, to: to.zhvi, format: money },
    { label: "Median household income", from: from.income, to: to.income, format: money },
    { label: "Home value \u00f7 income", from: from.priceIncome, to: to.priceIncome, format: fmtOr((v) => v.toFixed(2)) },
    { label: "Monthly mortgage payment", from: from.payment, to: to.payment, format: money },
    { label: "Mortgage payment, % of income", from: from.paymentShare, to: to.paymentShare, format: fmtOr((v) => v.toFixed(1) + "%") },
    { label: "Typical rent", from: from.rent, to: to.rent, format: money },
    { label: "Price level (U.S. = 100)", from: from.rpp, to: to.rpp, format: fmtOr((v) => v.toFixed(1)) },
    { label: "Net migration", from: from.net, to: to.net, format: fmtOr((v) => fmt.format(v)) },
    { label: "Net per 1,000 residents", from: from.perThousand, to: to.perThousand, format: fmtOr((v) => v.toFixed(1)) },
    { label: "People moving in", from: from.inMovers, to: to.inMovers, format: fmtOr((v) => fmt.format(v)) },
    { label: "People moving out", from: from.outMovers, to: to.outMovers, format: fmtOr((v) => fmt.format(v)) },
  ];

  const col = (label, tag, snap, other) => `
    <div class="compare-col">
      <span class="tag-label">${tag}</span>
      <h3>${label}</h3>
      ${metrics
        .map((m) => {
          const v = snap === "from" ? m.from : m.to;
          const ov = snap === "from" ? m.to : m.from;
          const isHigher = v != null && ov != null && v > ov;
          return `<div class="compare-row"><span class="metric-label">${m.label}</span><span class="metric-value${isHigher ? " is-higher" : ""}">${m.format(v)}</span></div>`;
        })
        .join("")}
    </div>`;

  container.innerHTML = `
    <div class="compare-grid">
      ${col(fromName, "FROM", "from")}
      <div class="compare-arrows" aria-hidden="true">${icon("truck", 28)}</div>
      ${col(toName, "TO", "to")}
    </div>
    <p class="panel-subtitle" style="margin-top: var(--space-3);">Based on ${from.year} data. Mortgage payment assumes 20% down and a 30-year fixed loan at the year\u2019s average Freddie Mac rate; rent is the average of the state\u2019s metro areas.</p>`;
}

// ---- "Surprise me" ----

function surpriseMe() {
  const routeSum = new Map();
  for (let i = 0; i < data.length; i++) {
    const key = `${data.priorState[i]}→${data.currentState[i]}`;
    routeSum.set(key, (routeSum.get(key) || 0) + data.movers[i]);
  }
  const top = [...routeSum.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200);
  const [key] = top[Math.floor(Math.random() * top.length)];
  const [origIdx, destIdx] = key.split("→").map(Number);
  store.set({ prior_state: data.states[origIdx], current_state: data.states[destIdx], year: "all", current_region: "all" });
  showToast(`Surprise! ${data.states[origIdx]} → ${data.states[destIdx]}`);
}

// ---- panel: migration per 1,000 residents ----

const PERCAP_TITLES = { net: "Net migration per 1,000 residents", in: "Movers arriving per 1,000 residents", out: "Movers leaving per 1,000 residents" };

/** Per-state moves in and out, and population, for the selected year (or every survey year: an annual average). */
function stateRates(filters) {
  const ctx = data.context;
  const years = filters.year === "all" ? data.meta.years : [Number(filters.year)];
  const yearSet = new Set(years);
  const n = data.states.length;
  const inSum = new Float64Array(n), outSum = new Float64Array(n), popSum = new Float64Array(n), popYears = new Float64Array(n);
  // Each state's moves count only in years where its population estimate exists.
  for (let i = 0; i < data.length; i++) {
    const y = data.year[i];
    if (!yearSet.has(y)) continue;
    const dest = data.currentState[i], orig = data.priorState[i];
    if (Number.isFinite(ctx.population(dest, y))) inSum[dest] += data.movers[i];
    if (Number.isFinite(ctx.population(orig, y))) outSum[orig] += data.movers[i];
  }
  for (let s = 0; s < n; s++) {
    for (const y of years) {
      const p = ctx.population(s, y);
      if (Number.isFinite(p)) {
        popSum[s] += p;
        popYears[s] += 1;
      }
    }
  }
  const rows = [];
  for (let s = 0; s < n; s++) {
    if (popSum[s] <= 0) continue;
    rows.push({
      state: data.states[s],
      population: Math.round(popSum[s] / popYears[s]),
      inMovers: Math.round(inSum[s] / popYears[s]),
      outMovers: Math.round(outSum[s] / popYears[s]),
      net: Math.round((inSum[s] - outSum[s]) / popYears[s]),
      inRate: (1000 * inSum[s]) / popSum[s],
      outRate: (1000 * outSum[s]) / popSum[s],
      netRate: (1000 * (inSum[s] - outSum[s])) / popSum[s],
    });
  }
  return rows;
}

function renderPerCapitaPanel(filters) {
  const metric = filters.percap;
  const rateKey = { net: "netRate", in: "inRate", out: "outRate" }[metric];
  const rows = stateRates(filters).sort((a, b) => b[rateKey] - a[rateKey]);
  const period = filters.year === "all" ? `annual average, ${data.meta.years[0]}–${data.meta.years.at(-1)}` : filters.year;
  document.getElementById("percap-title").textContent = `${PERCAP_TITLES[metric]} (${period})`;
  const entries = rows.map((r) => [r.state, r[rateKey]]);
  const shown = metric === "net" ? [...entries.slice(0, 8), ...entries.slice(-8)] : entries.slice(0, 12);
  charts.percap = rankedBarChart(document.getElementById("chart-percap"), shown, {
    diverging: metric === "net",
    formatValue: (v) => v.toFixed(1) + " per 1,000",
    onBarClick: (name) => store.set(metric === "out" ? { prior_state: name } : { current_state: name }),
  });
  const perThousand = (v) => v.toFixed(1);
  renderTable(
    document.getElementById("table-percap"),
    [
      { label: "State", key: "state" },
      { label: "Population", key: "population", format: (v) => fmt.format(v) },
      { label: "Moved in", key: "inMovers", format: (v) => fmt.format(v) },
      { label: "Moved out", key: "outMovers", format: (v) => fmt.format(v) },
      { label: "Net", key: "net", format: (v) => fmt.format(v) },
      { label: "In per 1,000", key: "inRate", format: perThousand },
      { label: "Out per 1,000", key: "outRate", format: perThousand },
      { label: "Net per 1,000", key: "netRate", format: perThousand },
    ],
    rows,
    { initialSortKey: rateKey, onRowClick: (row) => store.set(metric === "out" ? { prior_state: row.state } : { current_state: row.state }) }
  );
  showEmptyState("percap", rows.length === 0);
}

// ---- panel: cost of living and affordability, by state ----

const COST_METRICS = {
  home_value: { title: "Home value", money: true, format: (v) => fmtMoney.format(v) },
  price_income: { title: "Home value ÷ median household income", format: (v) => v.toFixed(2) },
  rpp_all: { title: "Regional price level, all items (U.S. = 100)", format: (v) => v.toFixed(1), from: "2008" },
  rpp_housing: { title: "Regional price level, housing (U.S. = 100)", format: (v) => v.toFixed(1), from: "2008" },
  payment: { title: "Monthly mortgage payment (principal + interest)", money: true, format: (v) => fmtMoney.format(v) },
  payment_share: { title: "Mortgage payment as a share of median household income", format: (v) => v.toFixed(1) + "%" },
  rent: { title: "Typical rent (average of the state's metro areas)", money: true, format: (v) => fmtMoney.format(v), from: "2015" },
  income: { title: "Median household income", money: true, format: (v) => fmtMoney.format(v) },
};

function costValue(metric, s, y) {
  const ctx = data.context;
  const f = COST_METRICS[metric].money && dollarsReal ? ctx.realFactor(y) : 1;
  const zhvi = zhviLookup.get(s)?.get(y) ?? NaN;
  switch (metric) {
    case "home_value": return zhvi * f;
    case "price_income": return zhvi / ctx.income(s, y);
    case "rpp_all": return ctx.rppAll(s, y);
    case "rpp_housing": return ctx.rppHousing(s, y);
    case "payment": return monthlyPayment(zhvi, ctx.mortgageRate(y)) * f;
    case "payment_share": return ((monthlyPayment(zhvi, ctx.mortgageRate(y)) * 12) / ctx.income(s, y)) * 100;
    case "rent": return ctx.rent(s, y) * f;
    case "income": return ctx.income(s, y) * f;
    default: return NaN;
  }
}

function renderCostPanel(filters) {
  const metric = filters.costmetric;
  const info = COST_METRICS[metric];
  const year = filters.year === "all" ? data.context.latest : Number(filters.year);
  const dollarNote = info.money && dollarsReal ? ", 2024 dollars" : "";
  document.getElementById("cost-title").textContent = `${info.title}, ${year}${dollarNote}`;
  const entries = data.states
    .map((name, s) => [name, costValue(metric, s, year)])
    .filter(([, v]) => Number.isFinite(v))
    .sort((a, b) => b[1] - a[1]);
  const sparse = entries.length < 5;
  document.getElementById("cost-subtitle").textContent = sparse
    ? `This series is not available for ${year}${info.from ? ` (it starts in ${info.from})` : ""}. Pick a later year.`
    : filters.year === "all"
      ? `Highest and lowest ten states, latest year (${year}). Choose a year above to see another.`
      : "Highest and lowest ten states.";
  const shown = entries.length > 20 ? [...entries.slice(0, 10), ...entries.slice(-10)] : entries;
  charts.cost = rankedBarChart(document.getElementById("chart-cost"), shown.length ? shown : [["", 0]], {
    formatValue: info.format,
    onBarClick: (name) => store.set({ current_state: name }),
  });
  renderTable(
    document.getElementById("table-cost"),
    [
      { label: "State", key: "state" },
      { label: info.title, key: "value", format: info.format },
    ],
    entries.map(([state, value]) => ({ state, value })),
    { onRowClick: (row) => store.set({ current_state: row.state }) }
  );
  showEmptyState("cost", sparse);
}

// ---- top-level render ----

function render() {
  const filters = store.get();
  const mask = computeMask(data, filters);
  const indices = maskIndices(mask);

  document.getElementById("selection-count").textContent = `${fmt.format(indices.length)} of ${fmt.format(data.length)} records selected`;
  dollarsReal = filters.dollars === "real";
  syncControls(filters);
  renderActiveFilters(filters);
  renderKpis(indices, filters);
  renderMapPanel(indices, filters);
  renderMainPanel(indices, filters);
  renderTrendPanel(indices, filters.measure);
  renderRoutesPanel(indices);
  renderHistogramPanel(indices);
  renderScatterPanel(indices, document.getElementById("scatter-refline").checked);
  renderPerCapitaPanel(filters);
  renderCostPanel(filters);
}

/** Keeps every control that lives in the store (selects, segmented buttons, dollar labels) in step with it. */
function syncControls(filters) {
  for (const [id, key] of [
    ["main-measure", "measure"],
    ["main-breakdown", "breakdown"],
    ["main-chart-type", "charttype"],
    ["percap-metric", "percap"],
    ["cost-metric", "costmetric"],
  ]) {
    syncSelect(id, filters[key]);
  }
  document.querySelectorAll("#filter-dollars button").forEach((btn) => btn.classList.toggle("is-on", btn.dataset.value === filters.dollars));
  document.querySelectorAll("[data-dollar-label]").forEach((el) => {
    if (!el.dataset.base) el.dataset.base = el.textContent;
    el.textContent = moneyLabel(el.dataset.base);
  });
}

// ---- bootstrap ----

function populateSelect(select, values, current) {
  const existing = new Set([...select.options].map((o) => o.value));
  for (const v of values) {
    if (!existing.has(String(v))) select.add(new Option(String(v), String(v)));
  }
  select.value = current;
}

function buildSegmented(container, values, labelOf) {
  container.innerHTML =
    `<button type="button" data-value="all" class="is-on">All</button>` +
    values.map((v) => `<button type="button" data-value="${v}">${labelOf ? labelOf(v) : v}</button>`).join("");
  container.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => store.set({ current_region: btn.dataset.value }));
  });
}

async function main() {
  [data, geo] = await Promise.all([loadDataset(), loadGeoData()]);
  store = createFilterStore(readStateFromUrl());
  applyIcons();

  // one ZHVI value per (state, year), taken from any row where the state is the destination
  zhviLookup = new Map();
  for (let i = 0; i < data.length; i++) {
    if (Number.isNaN(data.currentZhvi[i])) continue;
    const s = data.currentState[i];
    if (!zhviLookup.has(s)) zhviLookup.set(s, new Map());
    zhviLookup.get(s).set(data.year[i], data.currentZhvi[i]);
  }

  populateSelect(document.getElementById("filter-year"), data.meta.years, store.get().year);
  populateSelect(document.getElementById("filter-current-state"), data.states, store.get().current_state);
  populateSelect(document.getElementById("filter-prior-state"), data.states, store.get().prior_state);
  buildSegmented(document.getElementById("filter-region"), REGIONS_ORDERED.filter((r) => data.regions.includes(r)));

  document.getElementById("filter-year").addEventListener("change", (e) => store.set({ year: e.target.value }));
  document.getElementById("filter-current-state").addEventListener("change", (e) => store.set({ current_state: e.target.value }));
  document.getElementById("filter-prior-state").addEventListener("change", (e) => store.set({ prior_state: e.target.value }));

  document.getElementById("reset-filters").addEventListener("click", () => {
    store.reset();
    populateSelect(document.getElementById("filter-year"), data.meta.years, "all");
    populateSelect(document.getElementById("filter-current-state"), data.states, "all");
    populateSelect(document.getElementById("filter-prior-state"), data.states, "all");
    document.getElementById("main-measure").value = DEFAULTS.measure;
    document.getElementById("main-breakdown").value = DEFAULTS.breakdown;
    document.getElementById("main-chart-type").value = DEFAULTS.charttype;
    render();
  });

  document.getElementById("filter-reliable").addEventListener("change", (e) => store.set({ reliable: e.target.checked ? "yes" : "all" }));

  document.getElementById("copy-link").addEventListener("click", () => copyLinkToClipboard(location.href));

  document.getElementById("main-measure").value = store.get().measure;
  document.getElementById("main-breakdown").value = store.get().breakdown;
  document.getElementById("main-chart-type").value = store.get().charttype;
  document.getElementById("percap-metric").value = store.get().percap;
  document.getElementById("cost-metric").value = store.get().costmetric;
  document.getElementById("percap-metric").addEventListener("change", (e) => store.set({ percap: e.target.value }));
  document.getElementById("cost-metric").addEventListener("change", (e) => store.set({ costmetric: e.target.value }));
  document.querySelectorAll("#filter-dollars button").forEach((btn) => btn.addEventListener("click", () => store.set({ dollars: btn.dataset.value })));
  document.getElementById("main-measure").addEventListener("change", (e) => store.set({ measure: e.target.value }));
  document.getElementById("main-breakdown").addEventListener("change", (e) => store.set({ breakdown: e.target.value }));
  document.getElementById("main-chart-type").addEventListener("change", (e) => store.set({ charttype: e.target.value }));

  document.getElementById("scatter-refline").addEventListener("change", () => {
    const filters = store.get();
    renderScatterPanel(maskIndices(computeMask(data, filters)), document.getElementById("scatter-refline").checked);
  });

  wirePanelToolbar("main");
  wirePanelToolbar("trend");
  wirePanelToolbar("routes");
  wirePanelToolbar("histogram");
  wirePanelToolbar("scatter");
  wirePanelToolbar("map");
  wirePanelToolbar("percap");
  wirePanelToolbar("cost");

  populateSelect(document.getElementById("plan-from"), data.states, "");
  populateSelect(document.getElementById("plan-to"), data.states, "");
  document.getElementById("plan-from").insertAdjacentHTML("afterbegin", '<option value="">Choose a state&hellip;</option>');
  document.getElementById("plan-to").insertAdjacentHTML("afterbegin", '<option value="">Choose a state&hellip;</option>');
  document.getElementById("plan-from").value = "";
  document.getElementById("plan-to").value = "";
  document.getElementById("plan-from").addEventListener("change", renderPlanYourMove);
  document.getElementById("plan-to").addEventListener("change", renderPlanYourMove);

  document.getElementById("surprise-me").addEventListener("click", surpriseMe);

  store.subscribe(render);
  window.addEventListener("popstate", () => {
    const s = readStateFromUrl();
    store.set(s);
  });
  window.addEventListener("resize", () => {
    Object.values(charts).forEach((c) => c.resize());
  });

  render();
}

main().catch((err) => {
  console.error(err);
  document.getElementById("selection-count").textContent = "Failed to load data.";
});

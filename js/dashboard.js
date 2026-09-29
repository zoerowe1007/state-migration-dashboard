import { loadDataset } from "./data.js";
import { createFilterStore, computeMask, maskIndices, readStateFromUrl, DEFAULTS } from "./state.js";
import { rankedBarChart, lineChart, multiLineChart, multiBarChart, histogramChart, scatterChart, seriesColors } from "./charts.js";
import { renderTable } from "./tables.js";
import { downloadChartPng } from "./export.js";

const fmt = new Intl.NumberFormat("en-US");
const fmtMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtMoney0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, notation: "compact" });

const MEASURES = {
  total: { label: "Total movers", format: (v) => fmt.format(Math.round(v)) },
  count: { label: "Number of routes", format: (v) => fmt.format(Math.round(v)) },
  median_zhvi: { label: "Median home value", format: (v) => (v == null ? "n/a" : fmtMoney.format(v)) },
  cheaper_rate: { label: "Share to cheaper state", format: (v) => (v == null ? "n/a" : v.toFixed(1) + "%") },
};
const BREAKDOWN_FIELD = { current_state: "currentState", prior_state: "priorState", current_region: "currentRegion", year: "year" };
const FILTER_LABELS = { year: "Year", current_state: "Destination", prior_state: "Origin", current_region: "Region" };
const REGIONS_ORDERED = ["Northeast", "Midwest", "South", "West", "Territory"];

let data;
let store;
const charts = {}; // panelKey -> ECharts instance

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
    if (!Number.isNaN(data.currentZhvi[i])) zhviVals.push(data.currentZhvi[i]);
    if (!Number.isNaN(data.currentZhvi[i]) && !Number.isNaN(data.priorZhvi[i])) {
      const gap = data.currentZhvi[i] - data.priorZhvi[i];
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
  document.getElementById("kpi-median-zhvi").textContent = kpis.medianZhvi == null ? "n/a" : fmtMoney0.format(kpis.medianZhvi);
  document.getElementById("kpi-cheaper-rate").textContent = kpis.cheaperRate == null ? "n/a" : kpis.cheaperRate.toFixed(1) + "%";
  document.getElementById("kpi-avg-gap").textContent = kpis.avgGap == null ? "n/a" : fmtMoney0.format(kpis.avgGap);

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
        `<span class="chip" data-key="${key}">${FILTER_LABELS[key]}: ${value}
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
      empty.textContent = "No data matches these filters.";
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
      })
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
    entries.map(([label, value]) => ({ label, value }))
  );
  showEmptyState("main", indices.length === 0);
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
  if (measure === "median_zhvi") return median(rows.map((i) => data.currentZhvi[i]).filter((v) => !Number.isNaN(v)));
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

function renderTrendPanel(indices) {
  const byYear = new Map();
  for (const i of indices) byYear.set(data.year[i], (byYear.get(data.year[i]) || 0) + data.movers[i]);
  const series = [...byYear.entries()].sort((a, b) => a[0] - b[0]);
  const [accent] = seriesColors();
  charts.trend = lineChart(document.getElementById("chart-trend"), series.length ? series : [[0, 0]], {
    color: accent,
    onCategoryClick: (y) => store.set({ year: String(y) }),
  });
  renderTable(
    document.getElementById("table-trend"),
    [{ label: "Year", key: "year" }, { label: "Movers", key: "movers", format: (v) => fmt.format(v) }],
    series.map(([year, movers]) => ({ year, movers }))
  );
  showEmptyState("trend", indices.length === 0);
}

// ---- panel: busiest routes ----

function renderRoutesPanel(indices) {
  const map = new Map();
  for (const i of indices) {
    const key = `${data.states[data.priorState[i]]} → ${data.states[data.currentState[i]]}`;
    map.set(key, (map.get(key) || 0) + data.movers[i]);
  }
  const top = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  charts.routes = rankedBarChart(document.getElementById("chart-routes"), top, {
    onBarClick: (label) => {
      const [origin, destination] = label.split(" → ");
      store.set({ prior_state: origin, current_state: destination });
    },
  });
  renderTable(
    document.getElementById("table-routes"),
    [{ label: "Route", key: "route" }, { label: "Movers", key: "movers", format: (v) => fmt.format(v) }],
    top.map(([route, movers]) => ({ route, movers }))
  );
  showEmptyState("routes", indices.length === 0);
}

// ---- panel: home value gap histogram ----

function renderHistogramPanel(indices) {
  const gaps = [];
  for (const i of indices) {
    if (Number.isNaN(data.currentZhvi[i]) || Number.isNaN(data.priorZhvi[i])) continue;
    gaps.push(data.currentZhvi[i] - data.priorZhvi[i]);
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
    const gap = data.currentZhvi[i] - data.priorZhvi[i];
    // extra tuple fields (prior state, current state, year) ride along for
    // click-to-filter; ECharts ignores dims beyond x/y for scatter rendering.
    (pointsByGroup[region] ||= []).push([data.movers[i], Math.round(gap), data.states[data.priorState[i]], data.states[data.currentState[i]], data.year[i]]);
    tableRows.push({
      prior: data.states[data.priorState[i]],
      current: data.states[data.currentState[i]],
      year: data.year[i],
      movers: data.movers[i],
      gap: Math.round(gap),
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
    ],
    tableRows.slice(0, 500)
  );
  showEmptyState("scatter", indices.length === 0);
}

// ---- top-level render ----

function render() {
  const filters = store.get();
  const mask = computeMask(data, filters);
  const indices = maskIndices(mask);

  document.getElementById("selection-count").textContent = `${fmt.format(indices.length)} of ${fmt.format(data.length)} records selected`;
  renderActiveFilters(filters);
  renderKpis(indices, filters);
  renderMainPanel(indices, filters);
  renderTrendPanel(indices);
  renderRoutesPanel(indices);
  renderHistogramPanel(indices);
  renderScatterPanel(indices, document.getElementById("scatter-refline").checked);
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
  data = await loadDataset();
  store = createFilterStore(readStateFromUrl());

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

  document.getElementById("copy-link").addEventListener("click", () => copyLinkToClipboard(location.href));

  document.getElementById("main-measure").value = store.get().measure;
  document.getElementById("main-breakdown").value = store.get().breakdown;
  document.getElementById("main-chart-type").value = store.get().charttype;
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

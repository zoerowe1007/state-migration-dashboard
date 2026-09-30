import { loadDataset } from "./data.js";
import { seriesColors, lineChart, rankedBarChart, multiLineChart } from "./charts.js";
import { applyIcons } from "./icons.js";

const fmt = new Intl.NumberFormat("en-US");
const fmtMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Scroll-road progress bar: fill width tracks reading progress, a truck
 * icon rides its leading edge. This is a direct 1:1 scroll mapping (like a
 * native scrollbar), not an autoplaying animation, so it isn't gated behind
 * prefers-reduced-motion -- only the traveling dots / count-up / hover
 * animations are. */
function initScrollRoad() {
  const fill = document.getElementById("scroll-road-fill");
  if (!fill) return;
  const update = () => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    const pct = max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0;
    fill.style.width = pct + "%";
  };
  update();
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
}

/** Animates a number from 0 to its target when it scrolls into view (Phase 8:
 * "big numbers count up"). Reads the target from the element's already-set
 * textContent (a formatted string) by re-parsing it isn't reliable, so the
 * caller passes the raw numeric target and a formatter instead. */
function countUpOnVisible(el, target, formatValue) {
  if (!el) return;
  if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
    el.textContent = formatValue(target);
    return;
  }
  el.textContent = formatValue(0);
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.disconnect();
        const start = performance.now();
        const duration = 900;
        const ease = (t) => 1 - Math.pow(1 - t, 3);
        function tick(now) {
          const p = Math.min(1, (now - start) / duration);
          el.textContent = formatValue(target * ease(p));
          if (p < 1) requestAnimationFrame(tick);
          else el.textContent = formatValue(target);
        }
        requestAnimationFrame(tick);
      }
    },
    { threshold: 0.4 }
  );
  io.observe(el);
}

// ---- aggregation helpers (all operate on the typed-array Dataset from data.js) ----

function nationalTrend(data) {
  const sums = new Map();
  for (let i = 0; i < data.length; i++) sums.set(data.year[i], (sums.get(data.year[i]) || 0) + data.movers[i]);
  return [...sums.entries()].sort((a, b) => a[0] - b[0]);
}

function regionNetByYear(data) {
  // net[year][region] = movers into region - movers out of region, that year
  const net = new Map();
  for (let i = 0; i < data.length; i++) {
    const y = data.year[i];
    if (!net.has(y)) net.set(y, new Float64Array(data.regions.length));
    net.get(y)[data.currentRegion[i]] += data.movers[i];
    net.get(y)[data.priorRegion[i]] -= data.movers[i];
  }
  return net;
}

function netMigrationByState(data, minYear) {
  const inSum = new Map();
  const outSum = new Map();
  for (let i = 0; i < data.length; i++) {
    if (minYear != null && data.year[i] < minYear) continue;
    inSum.set(data.currentState[i], (inSum.get(data.currentState[i]) || 0) + data.movers[i]);
    outSum.set(data.priorState[i], (outSum.get(data.priorState[i]) || 0) + data.movers[i]);
  }
  const net = [];
  for (let s = 0; s < data.states.length; s++) {
    if (!inSum.has(s) && !outSum.has(s)) continue;
    net.push([data.states[s], (inSum.get(s) || 0) - (outSum.get(s) || 0)]);
  }
  return net.sort((a, b) => b[1] - a[1]);
}

function topFlows(data, year, topN) {
  const map = new Map();
  for (let i = 0; i < data.length; i++) {
    if (data.year[i] !== year) continue;
    const key = `${data.states[data.priorState[i]]} → ${data.states[data.currentState[i]]}`;
    map.set(key, (map.get(key) || 0) + data.movers[i]);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
}

function cheaperShareByYear(data) {
  const movers = new Map();
  const cheaperMovers = new Map();
  for (let i = 0; i < data.length; i++) {
    const cz = data.currentZhvi[i], pz = data.priorZhvi[i];
    if (Number.isNaN(cz) || Number.isNaN(pz)) continue;
    const y = data.year[i];
    movers.set(y, (movers.get(y) || 0) + data.movers[i]);
    if (cz < pz) cheaperMovers.set(y, (cheaperMovers.get(y) || 0) + data.movers[i]);
  }
  return [...movers.entries()].sort((a, b) => a[0] - b[0]).map(([y, m]) => [y, ((cheaperMovers.get(y) || 0) / m) * 100]);
}

function weightedGapByYear(data) {
  const weighted = new Map();
  const movers = new Map();
  for (let i = 0; i < data.length; i++) {
    const cz = data.currentZhvi[i], pz = data.priorZhvi[i];
    if (Number.isNaN(cz) || Number.isNaN(pz)) continue;
    const y = data.year[i];
    weighted.set(y, (weighted.get(y) || 0) + (cz - pz) * data.movers[i]);
    movers.set(y, (movers.get(y) || 0) + data.movers[i]);
  }
  return [...weighted.entries()].sort((a, b) => a[0] - b[0]).map(([y, w]) => [y, w / movers.get(y)]);
}

function homeValueChangeByState(data, fromYear, toYear) {
  // one ZHVI value per (state, year): take it from any row where that state is the destination
  const zhvi = new Map(); // state -> Map(year -> value)
  for (let i = 0; i < data.length; i++) {
    if (Number.isNaN(data.currentZhvi[i])) continue;
    const s = data.currentState[i];
    if (!zhvi.has(s)) zhvi.set(s, new Map());
    zhvi.get(s).set(data.year[i], data.currentZhvi[i]);
  }
  const out = [];
  for (const [s, byYear] of zhvi) {
    const from = byYear.get(fromYear), to = byYear.get(toYear);
    if (from == null || to == null) continue;
    out.push([data.states[s], ((to - from) / from) * 100]);
  }
  return out.sort((a, b) => b[1] - a[1]);
}

function prOutflowByYear(data) {
  const prIdx = data.states.indexOf("Puerto Rico");
  const sums = new Map();
  for (let i = 0; i < data.length; i++) {
    if (data.priorState[i] !== prIdx) continue;
    sums.set(data.year[i], (sums.get(data.year[i]) || 0) + data.movers[i]);
  }
  return [...sums.entries()].sort((a, b) => a[0] - b[0]);
}

// ---- decorative hero background: thin, low-opacity bars from the real national trend ----

function renderHeroPattern(container, series) {
  const max = Math.max(...series.map((s) => s[1]));
  container.innerHTML = series
    .map(([, v]) => `<div style="flex:1; height:${(v / max) * 100}%; background:var(--color-accent); opacity:0.07;"></div>`)
    .join("");
}

// ---- main ----

async function main() {
  const data = await loadDataset();
  const LATEST = Math.max(...data.meta.years);

  // Hero
  const gapSeries = weightedGapByYear(data);
  const latestGap = gapSeries[gapSeries.length - 1][1];
  countUpOnVisible(document.getElementById("headline-number"), latestGap, (v) => fmtMoney.format(Math.round(v)));
  document.getElementById("headline-year").textContent = String(LATEST);
  const [accent] = seriesColors();
  lineChart(document.getElementById("headline-chart"), gapSeries, { color: accent, formatValue: (v) => fmtMoney.format(Math.round(v)), labelEnds: true });

  // Headline numbers block
  const trend = nationalTrend(data);
  const flows = topFlows(data, LATEST, 6);
  const cheaperShare = cheaperShareByYear(data);
  const totalMovers = trend.reduce((sum, [, v]) => sum + v, 0);
  document.querySelectorAll(".stat-year").forEach((el) => (el.textContent = String(LATEST)));
  document.getElementById("stat-route-name").textContent = flows[0][0].replace(" → ", " \u2192 ");
  countUpOnVisible(document.getElementById("stat-total"), totalMovers, (v) => fmt.format(Math.round(v)));
  countUpOnVisible(document.getElementById("stat-latest"), trend[trend.length - 1][1], (v) => fmt.format(Math.round(v)));
  countUpOnVisible(document.getElementById("stat-cheaper"), cheaperShare[cheaperShare.length - 1][1], (v) => v.toFixed(1) + "%");
  countUpOnVisible(document.getElementById("stat-route"), flows[0][1], (v) => fmt.format(Math.round(v)));

  renderHeroPattern(document.getElementById("hero-pattern"), trend);

  // 1. National trend
  lineChart(document.getElementById("chart-national-trend"), trend, { color: accent });

  // 2. Regional net migration over time
  const regionNet = regionNetByYear(data);
  const years = data.meta.years;
  const regionsToShow = ["Northeast", "Midwest", "South", "West"];
  const seriesByLabel = {};
  for (const r of regionsToShow) {
    const idx = data.regions.indexOf(r);
    seriesByLabel[r] = years.map((y) => Math.round(regionNet.get(y)[idx]));
  }
  multiLineChart(document.getElementById("chart-region-trend"), years, seriesByLabel);

  // 3. Gainers/losers, 5-year average net migration
  const net5 = netMigrationByState(data, LATEST - 4);
  const top5 = net5.slice(0, 5);
  const bottom5 = net5.slice(-5).reverse();
  rankedBarChart(document.getElementById("chart-gainers-losers"), [...top5, ...bottom5], { diverging: true });

  // 4. Busiest routes, latest year
  rankedBarChart(document.getElementById("chart-top-flows"), flows);

  // 5. Cheaper-share trend
  lineChart(document.getElementById("chart-cheaper-share"), cheaperShare, { color: accent, formatValue: (v) => v.toFixed(1) + "%" });

  // 6. Cost gap trend
  lineChart(document.getElementById("chart-cost-gap"), gapSeries, { color: accent, formatValue: (v) => fmtMoney.format(Math.round(v)) });

  // 7. Home value change by state
  const change = homeValueChangeByState(data, 2005, LATEST);
  const topChange = change.slice(0, 8);
  const bottomChange = change.slice(-8);
  rankedBarChart(document.getElementById("chart-home-value-change"), [...topChange, ...bottomChange], {
    formatValue: (v) => v.toFixed(1) + "%",
  });

  // 8. Puerto Rico outflow
  const prOutflow = prOutflowByYear(data);
  lineChart(document.getElementById("chart-pr-outflow"), prOutflow, { color: accent });

  window.addEventListener("resize", () => {
    document.querySelectorAll("[id^='chart-'], #headline-chart").forEach((el) => {
      const chart = echarts.getInstanceByDom(el);
      if (chart) chart.resize();
    });
  });

  applyIcons();
  initScrollRoad();
}

main().catch((err) => {
  console.error(err);
  document.getElementById("headline-number").textContent = "Failed to load data";
});

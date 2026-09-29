import { loadDataset } from "./data.js";
import { seriesColors, lineChart, rankedBarChart, multiLineChart } from "./charts.js";

const fmt = new Intl.NumberFormat("en-US");
const fmtMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

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
  document.getElementById("headline-number").textContent = fmtMoney.format(Math.round(latestGap));
  document.getElementById("headline-year").textContent = String(LATEST);
  const [accent] = seriesColors();
  lineChart(document.getElementById("headline-chart"), gapSeries, { color: accent, formatValue: (v) => fmtMoney.format(Math.round(v)), labelEnds: true });

  const trend = nationalTrend(data);
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
  const flows = topFlows(data, LATEST, 6);
  rankedBarChart(document.getElementById("chart-top-flows"), flows);

  // 5. Cheaper-share trend
  const cheaperShare = cheaperShareByYear(data);
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
}

main().catch((err) => {
  console.error(err);
  document.getElementById("headline-number").textContent = "Failed to load data";
});

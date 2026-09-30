import { loadDataset } from "./data.js";
import { seriesColors, lineChart, rankedBarChart, multiLineChart } from "./charts.js";
import { applyIcons } from "./icons.js";
import { loadIrs, monthlyPayment, median } from "./context.js";

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

/** Map of state index -> Map(year -> ZHVI). One value per (state, year): taken from any row where that state is the destination. */
function zhviByStateYear(data) {
  const zhvi = new Map();
  for (let i = 0; i < data.length; i++) {
    if (Number.isNaN(data.currentZhvi[i])) continue;
    const s = data.currentState[i];
    if (!zhvi.has(s)) zhvi.set(s, new Map());
    zhvi.get(s).set(data.year[i], data.currentZhvi[i]);
  }
  return zhvi;
}

/** Percent change in home value between two years; with `real`, both ends are in latest-year dollars. */
function homeValueChangeByState(data, fromYear, toYear, { real = false } = {}) {
  const f = (y) => (real ? data.context.realFactor(y) : 1);
  const out = [];
  for (const [s, byYear] of zhviByStateYear(data)) {
    const from = byYear.get(fromYear), to = byYear.get(toYear);
    if (from == null || to == null) continue;
    out.push([data.states[s], ((to * f(toYear)) / (from * f(fromYear)) - 1) * 100]);
  }
  return out.sort((a, b) => b[1] - a[1]);
}

/** The movers-weighted home value gap, restated in latest-year dollars so years can be compared. */
function realGapByYear(data) {
  return weightedGapByYear(data).map(([y, gap]) => [y, gap * data.context.realFactor(y)]);
}

/** Net migration per 1,000 residents, as an annual average over the survey years from `minYear` on.
 * Each state's moves are counted only in years where its population estimate exists. */
function netPerThousand(data, minYear) {
  const ctx = data.context;
  const n = data.states.length;
  const inSum = new Float64Array(n), outSum = new Float64Array(n), popSum = new Float64Array(n);
  for (let i = 0; i < data.length; i++) {
    const y = data.year[i];
    if (y < minYear) continue;
    const dest = data.currentState[i], orig = data.priorState[i];
    if (Number.isFinite(ctx.population(dest, y))) inSum[dest] += data.movers[i];
    if (Number.isFinite(ctx.population(orig, y))) outSum[orig] += data.movers[i];
  }
  for (let s = 0; s < n; s++) {
    for (const y of data.meta.years) {
      if (y < minYear) continue;
      const p = ctx.population(s, y);
      if (Number.isFinite(p)) popSum[s] += p;
    }
  }
  const out = [];
  for (let s = 0; s < n; s++) if (popSum[s] > 0) out.push([data.states[s], (1000 * (inSum[s] - outSum[s])) / popSum[s]]);
  return out.sort((a, b) => b[1] - a[1]);
}

/** Per year: share of movers (percent) headed to a state where `indexAt(state, year)` is lower than where they came from. */
function moverShareToLower(data, indexAt) {
  const total = new Map(), lower = new Map();
  for (let i = 0; i < data.length; i++) {
    const y = data.year[i];
    const c = indexAt(data.currentState[i], y), p = indexAt(data.priorState[i], y);
    if (!Number.isFinite(c) || !Number.isFinite(p)) continue;
    total.set(y, (total.get(y) || 0) + data.movers[i]);
    if (c < p) lower.set(y, (lower.get(y) || 0) + data.movers[i]);
  }
  return [...total.entries()].sort((a, b) => a[0] - b[0]).map(([y, t]) => [y, ((lower.get(y) || 0) / t) * 100]);
}

/** Price-to-income ratio (state home value index / median household income): the typical state, and movers-weighted for destinations and origins. */
function priceToIncomeByYear(data) {
  const ctx = data.context;
  const zhvi = zhviByStateYear(data);
  const typical = data.meta.years.map((y) =>
    median(data.states.map((_, s) => (zhvi.get(s)?.get(y) ?? NaN) / ctx.income(s, y)))
  );
  const w = new Map(); // year -> [destSum, origSum, movers]
  for (let i = 0; i < data.length; i++) {
    const y = data.year[i];
    const ci = ctx.income(data.currentState[i], y), pi = ctx.income(data.priorState[i], y);
    const cz = data.currentZhvi[i], pz = data.priorZhvi[i];
    if (!(Number.isFinite(ci) && Number.isFinite(pi) && Number.isFinite(cz) && Number.isFinite(pz))) continue;
    const acc = w.get(y) || [0, 0, 0];
    acc[0] += (cz / ci) * data.movers[i];
    acc[1] += (pz / pi) * data.movers[i];
    acc[2] += data.movers[i];
    w.set(y, acc);
  }
  const years = data.meta.years;
  return {
    years,
    typical,
    destination: years.map((y) => w.get(y)[0] / w.get(y)[2]),
    origin: years.map((y) => w.get(y)[1] / w.get(y)[2]),
  };
}

/** Monthly cost of owning vs renting in the typical (median) state, in latest-year dollars. */
function monthlyCostByYear(data) {
  const ctx = data.context;
  const zhvi = zhviByStateYear(data);
  const years = data.meta.years;
  const payment = [], rent = [], incomeShare = [];
  for (const y of years) {
    const f = ctx.realFactor(y);
    const pays = [], shares = [], rents = [];
    data.states.forEach((_, s) => {
      const z = zhvi.get(s)?.get(y);
      if (z != null) {
        const pay = monthlyPayment(z, ctx.mortgageRate(y));
        pays.push(pay);
        shares.push(((pay * 12) / ctx.income(s, y)) * 100);
      }
      rents.push(ctx.rent(s, y));
    });
    payment.push(median(pays) * f);
    incomeShare.push(median(shares));
    const r = median(rents);
    rent.push(Number.isFinite(r) ? r * f : null);
  }
  return { years, payment, rent, incomeShare };
}

/** IRS flows for one period: people, returns and income arriving in / leaving each state. */
function irsNetByState(irs, periodIndex) {
  const n = irs.states.length;
  const acc = { inPeople: new Float64Array(n), outPeople: new Float64Array(n), inAgi: new Float64Array(n), outAgi: new Float64Array(n), inReturns: new Float64Array(n), outReturns: new Float64Array(n) };
  for (let i = 0; i < irs.length; i++) {
    if (irs.period[i] !== periodIndex) continue;
    acc.inPeople[irs.currentState[i]] += irs.people[i];
    acc.outPeople[irs.priorState[i]] += irs.people[i];
    acc.inAgi[irs.currentState[i]] += irs.agiThousands[i];
    acc.outAgi[irs.priorState[i]] += irs.agiThousands[i];
    acc.inReturns[irs.currentState[i]] += irs.returns[i];
    acc.outReturns[irs.priorState[i]] += irs.returns[i];
  }
  return acc;
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
  const gapSeries = realGapByYear(data);
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

  // 7. Home value change by state, after inflation
  const change = homeValueChangeByState(data, 2005, LATEST, { real: true });
  const topChange = change.slice(0, 8);
  const bottomChange = change.slice(-8);
  rankedBarChart(document.getElementById("chart-home-value-change"), [...topChange, ...bottomChange], {
    formatValue: (v) => v.toFixed(1) + "%",
  });

  // 8. Puerto Rico outflow
  const prOutflow = prOutflowByYear(data);
  lineChart(document.getElementById("chart-pr-outflow"), prOutflow, { color: accent });

  // 9. Per-resident migration, 2020-2024
  const perThousand = netPerThousand(data, LATEST - 4);
  rankedBarChart(
    document.getElementById("chart-per-capita"),
    [...perThousand.slice(0, 6), ...perThousand.slice(-6).reverse()],
    { diverging: true, formatValue: (v) => v.toFixed(1) + " per 1,000" }
  );

  // 10. A broader price index: Regional Price Parities
  const ctx = data.context;
  const rppShare = moverShareToLower(data, ctx.rppAll);
  const rppYears = rppShare.map((r) => r[0]);
  const zhviShareByYear = new Map(cheaperShare);
  multiLineChart(
    document.getElementById("chart-rpp-share"),
    rppYears,
    {
      "Regional Price Parities (all items)": rppShare.map((r) => +r[1].toFixed(1)),
      "Zillow home values": rppYears.map((y) => +zhviShareByYear.get(y).toFixed(1)),
    },
    { yAxisFormatter: (v) => v + "%" }
  );

  // 11. Affordability: home value relative to household income
  const pti = priceToIncomeByYear(data);
  const r2 = (v) => +v.toFixed(2);
  multiLineChart(document.getElementById("chart-affordability"), pti.years, {
    "Typical state": pti.typical.map(r2),
    "Where movers went": pti.destination.map(r2),
    "Where movers came from": pti.origin.map(r2),
  });

  // 12. Monthly cost of owning vs renting
  const cost = monthlyCostByYear(data);
  multiLineChart(
    document.getElementById("chart-monthly-cost"),
    cost.years,
    {
      "Mortgage payment (principal + interest)": cost.payment.map(Math.round),
      "Rent": cost.rent.map((v) => (v == null ? null : Math.round(v))),
    },
    { yAxisFormatter: (v) => "$" + fmt.format(v) }
  );

  // 13. Income moving with people (IRS)
  const irs = await loadIrs();
  const latestPeriod = irs.periods.length - 1;
  const irsNet = irsNetByState(irs, latestPeriod);
  const netAgi = irs.states
    .map((name, s) => [name, (irsNet.inAgi[s] - irsNet.outAgi[s]) / 1e6])
    .filter(([, v]) => v !== 0)
    .sort((a, b) => b[1] - a[1]);
  rankedBarChart(document.getElementById("chart-irs-net"), [...netAgi.slice(0, 6), ...netAgi.slice(-6).reverse()], {
    diverging: true,
    formatValue: (v) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(1) + " billion",
  });

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

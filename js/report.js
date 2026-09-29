import { loadDataset } from "./data.js";
import { initChart, setOption } from "./charts.js";

const fmtMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function weightedGapByYear(data) {
  const sums = new Map(); // year -> {gapWeighted, movers}
  for (let i = 0; i < data.length; i++) {
    const cz = data.currentZhvi[i];
    const pz = data.priorZhvi[i];
    if (Number.isNaN(cz) || Number.isNaN(pz)) continue;
    const y = data.year[i];
    const m = data.movers[i];
    const entry = sums.get(y) || { weighted: 0, movers: 0 };
    entry.weighted += (cz - pz) * m;
    entry.movers += m;
    sums.set(y, entry);
  }
  return [...sums.entries()].sort((a, b) => a[0] - b[0]).map(([year, v]) => [year, v.weighted / v.movers]);
}

async function main() {
  const data = await loadDataset();
  const series = weightedGapByYear(data);
  const latest = series[series.length - 1][1];

  document.getElementById("headline-number").textContent = fmtMoney.format(Math.round(latest));

  const chart = initChart(document.getElementById("headline-chart"));
  setOption(chart, {
    xAxis: { type: "category", data: series.map((s) => s[0]) },
    yAxis: { type: "value" },
    series: [{ type: "line", data: series.map((s) => Math.round(s[1])) }],
    tooltip: { trigger: "axis" },
  });
  window.addEventListener("resize", () => chart.resize());
}

main().catch((err) => {
  console.error(err);
  document.getElementById("headline-number").textContent = "Failed to load data";
});

import { loadDataset } from "./data.js";
import { initChart, setOption, seriesColors, themeDefaults } from "./charts.js";

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

  const theme = themeDefaults();
  const [accent] = seriesColors();
  const chart = initChart(document.getElementById("headline-chart"));
  setOption(chart, {
    textStyle: theme.textStyle,
    xAxis: { type: "category", data: series.map((s) => s[0]), axisLine: theme.axisLine, axisLabel: theme.axisLabel },
    yAxis: { type: "value", axisLine: theme.axisLine, axisLabel: theme.axisLabel, splitLine: theme.splitLine },
    series: [{ type: "line", data: series.map((s) => Math.round(s[1])), color: accent, lineStyle: { width: 2 } }],
    tooltip: { trigger: "axis" },
  });
  window.addEventListener("resize", () => chart.resize());
}

main().catch((err) => {
  console.error(err);
  document.getElementById("headline-number").textContent = "Failed to load data";
});

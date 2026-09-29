// PNG export for chart panels.

/**
 * Downloads a chart's current rendering as a PNG, named after the panel title.
 * @param {import('echarts').ECharts} chart
 * @param {string} filename
 */
export function downloadChartPng(chart, filename) {
  const url = chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--color-card").trim() || "#fff" });
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

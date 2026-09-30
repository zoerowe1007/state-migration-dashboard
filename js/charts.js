// ECharts setup/rendering helpers, shared by index.html and dashboard.html.

const fmt = new Intl.NumberFormat("en-US");
const fmtCompact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Reads a CSS custom property's current value (theme-aware). */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The chart series palette, in spec order, read live from the current theme. */
export function seriesColors() {
  return [cssVar("--chart-1"), cssVar("--chart-2"), cssVar("--chart-3"), cssVar("--chart-4")];
}

export function otherColor() {
  return cssVar("--chart-other");
}

/** Color for the i-th series: the 4-color spec palette, then the "Other"
 * gray for any series beyond that (never wraps back to slot 0, which would
 * make two series indistinguishable). */
function colorAt(i) {
  const colors = seriesColors();
  return i < colors.length ? colors[i] : otherColor();
}

/** Shared axis/text styling so charts match the surrounding page in both themes. */
export function themeDefaults() {
  const text = cssVar("--color-text-secondary");
  const grid = cssVar("--color-border");
  return {
    textStyle: { fontFamily: "Inter, system-ui, sans-serif", color: text },
    axisLine: { lineStyle: { color: grid } },
    axisLabel: { color: text, hideOverlap: true },
    splitLine: { lineStyle: { color: grid } },
  };
}

/** Creates (or reuses) an ECharts instance on the given container element. */
export function initChart(el) {
  return echarts.getInstanceByDom(el) || echarts.init(el);
}

/** Applies an option object to a chart, replacing series/axes cleanly between renders. */
export function setOption(chart, option) {
  chart.setOption(option, { notMerge: true, lazyUpdate: true });
}

export function lineChart(el, series, { color, formatValue = (v) => fmt.format(Math.round(v)), labelEnds = false, onCategoryClick } = {}) {
  const theme = themeDefaults();
  const chart = initChart(el);
  const markPoint = labelEnds
    ? {
        data: [
          { coord: [0, series[0][1]], value: formatValue(series[0][1]), symbolSize: 0, label: { position: "top" } },
          {
            coord: [series.length - 1, series[series.length - 1][1]],
            value: formatValue(series[series.length - 1][1]),
            symbolSize: 0,
            label: { position: "top" },
          },
        ],
      }
    : undefined;
  setOption(chart, {
    grid: { left: 48, right: 16, top: labelEnds ? 32 : 16, bottom: 28 },
    textStyle: theme.textStyle,
    xAxis: { type: "category", data: series.map((s) => s[0]), axisLine: theme.axisLine, axisLabel: theme.axisLabel },
    yAxis: { type: "value", axisLine: theme.axisLine, axisLabel: { ...theme.axisLabel, formatter: (v) => fmtCompact.format(v) }, splitLine: theme.splitLine },
    series: [
      {
        type: "line",
        data: series.map((s) => s[1]),
        color,
        lineStyle: { width: 2 },
        symbol: labelEnds ? "circle" : "none",
        symbolSize: 6,
        markPoint,
      },
    ],
    tooltip: { trigger: "axis", valueFormatter: formatValue },
  });
  wireClick(chart, el, (idx) => onCategoryClick && onCategoryClick(series[idx][0]));
  return chart;
}

/** `flags[i]` true draws bar i in the muted "other" gray (used for low-reliability routes). */
export function rankedBarChart(el, entries, { formatValue = (v) => fmt.format(Math.round(v)), diverging = false, flags = null, onBarClick } = {}) {
  const theme = themeDefaults();
  const [c1, , , c4] = seriesColors();
  const chart = initChart(el);
  setOption(chart, {
    grid: { left: 150, right: 24, top: 8, bottom: 28 },
    textStyle: theme.textStyle,
    xAxis: { type: "value", splitNumber: 3, axisLine: theme.axisLine, axisLabel: { ...theme.axisLabel, formatter: (v) => fmtCompact.format(v) }, splitLine: theme.splitLine },
    yAxis: { type: "category", data: entries.map((e) => e[0]), inverse: true, axisLine: theme.axisLine, axisLabel: theme.axisLabel },
    series: [
      {
        type: "bar",
        data: entries.map((e) => e[1]),
        itemStyle: { color: (p) => (flags && flags[p.dataIndex] ? otherColor() : diverging ? (p.value >= 0 ? c1 : c4) : c1), borderRadius: 3 },
        barMaxWidth: 18,
      },
    ],
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: formatValue },
  });
  wireClick(chart, el, (idx) => onBarClick && onBarClick(entries[idx][0]));
  return chart;
}

export function multiLineChart(el, categories, seriesByLabel, { onCategoryClick } = {}) {
  const theme = themeDefaults();
  const colors = seriesColors();
  const chart = initChart(el);
  setOption(chart, {
    grid: { left: 48, right: 16, top: 32, bottom: 40 },
    textStyle: theme.textStyle,
    legend: { bottom: 0, textStyle: theme.textStyle },
    xAxis: { type: "category", data: categories, axisLine: theme.axisLine, axisLabel: theme.axisLabel },
    yAxis: { type: "value", axisLine: theme.axisLine, axisLabel: { ...theme.axisLabel, formatter: (v) => fmtCompact.format(v) }, splitLine: theme.splitLine },
    series: Object.entries(seriesByLabel).map(([label, data], i) => ({
      name: label,
      type: "line",
      data,
      color: colorAt(i),
      lineStyle: { width: 2 },
      symbol: "none",
    })),
    tooltip: { trigger: "axis" },
  });
  wireClick(chart, el, (idx) => onCategoryClick && onCategoryClick(categories[idx]));
  return chart;
}

/** Grouped or stacked bars, one series per label, one bar-group per category. */
export function multiBarChart(el, categories, seriesByLabel, { stacked = false, onCategoryClick } = {}) {
  const theme = themeDefaults();
  const colors = seriesColors();
  const chart = initChart(el);
  setOption(chart, {
    grid: { left: 60, right: 16, top: 32, bottom: 60 },
    textStyle: theme.textStyle,
    legend: { bottom: 0, textStyle: theme.textStyle },
    xAxis: { type: "category", data: categories, axisLine: theme.axisLine, axisLabel: { ...theme.axisLabel, rotate: categories.length > 8 ? 45 : 0 } },
    yAxis: { type: "value", axisLine: theme.axisLine, axisLabel: { ...theme.axisLabel, formatter: (v) => fmtCompact.format(v) }, splitLine: theme.splitLine },
    series: Object.entries(seriesByLabel).map(([label, data], i) => ({
      name: label,
      type: "bar",
      data,
      color: colorAt(i),
      stack: stacked ? "total" : undefined,
      barMaxWidth: 28,
    })),
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
  });
  wireClick(chart, el, (idx) => onCategoryClick && onCategoryClick(categories[idx]));
  return chart;
}

export function histogramChart(el, bins, { formatValue = (v) => fmt.format(v) } = {}) {
  const theme = themeDefaults();
  const [c1] = seriesColors();
  const chart = initChart(el);
  setOption(chart, {
    grid: { left: 48, right: 16, top: 16, bottom: 40 },
    textStyle: theme.textStyle,
    xAxis: { type: "category", data: bins.map((b) => b.label), axisLine: theme.axisLine, axisLabel: { ...theme.axisLabel, rotate: 30 } },
    yAxis: { type: "value", axisLine: theme.axisLine, axisLabel: theme.axisLabel, splitLine: theme.splitLine, name: "rows" },
    series: [{ type: "bar", data: bins.map((b) => b.count), color: c1, barMaxWidth: 34, itemStyle: { borderRadius: 3 } }],
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (p) => `${p[0].name}<br/>${fmt.format(p[0].value)} rows` },
  });
  return chart;
}

export function scatterChart(el, pointsByGroup, { refLine = null, groupOrder = null, onPointClick } = {}) {
  const theme = themeDefaults();
  const chart = initChart(el);
  const groups = Object.keys(pointsByGroup);
  // Color by each group's position in a fixed, caller-supplied order (falls
  // back to insertion order) so a region's color never shifts just because
  // a filter changed which regions happen to have data this time.
  const order = groupOrder || groups;
  const series = groups.map((g) => ({
    name: g,
    type: "scatter",
    // a 6th tuple field of true marks a low-reliability point, drawn faded
    data: pointsByGroup[g].map((p) => ({ value: p, itemStyle: { opacity: p[5] ? 0.18 : 0.75 } })),
    symbolSize: 5,
    color: colorAt(order.indexOf(g)),
  }));
  if (refLine) {
    series.push({
      name: refLine.name,
      type: "line",
      data: refLine.data,
      showSymbol: false,
      lineStyle: { type: "dashed", color: cssVar("--color-text-secondary"), width: 1.5 },
      tooltip: { show: false },
    });
  }
  setOption(chart, {
    grid: { left: 60, right: 16, top: 32, bottom: 60 },
    textStyle: theme.textStyle,
    legend: { bottom: 0, textStyle: theme.textStyle },
    xAxis: { type: "value", name: "movers", splitNumber: 3, axisLine: theme.axisLine, axisLabel: { ...theme.axisLabel, formatter: (v) => fmtCompact.format(v) }, splitLine: theme.splitLine },
    yAxis: { type: "value", name: "home value gap ($)", axisLine: theme.axisLine, axisLabel: { ...theme.axisLabel, formatter: (v) => fmtCompact.format(v) }, splitLine: theme.splitLine },
    series,
    tooltip: {
      trigger: "item",
      formatter: (p) => (p.seriesType === "scatter" ? `${p.seriesName}<br/>Movers: ${fmt.format(p.value[0])}<br/>Gap: ${fmt.format(Math.round(p.value[1]))}` : ""),
    },
  });
  chart.off("click");
  if (onPointClick) {
    chart.on("click", (params) => {
      if (params.seriesType === "scatter") onPointClick(params.value);
    });
    el.style.cursor = "pointer";
  }
  return chart;
}

/** Wires a click handler on bar/line/scatter charts using ECharts' own click
 * event (unlike a Chart.js quirk hit in an earlier iteration of this
 * project, ECharts' addEventListener('click', ...) is reliable across
 * setOption calls on the same instance, verified in a live browser below). */
function wireClick(chart, el, onIndex) {
  chart.off("click");
  chart.on("click", (params) => {
    if (params.componentType === "series" && typeof params.dataIndex === "number") onIndex(params.dataIndex);
  });
  el.style.cursor = "pointer";
}

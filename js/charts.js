// ECharts setup/rendering helpers, shared by index.html and dashboard.html.
// Implemented in Phase 5 (dashboard build-out); stubs only for now so the
// module boundary is settled before the design system (Phase 3) lands.

/** Reads a CSS custom property's current value (theme-aware). */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The chart series palette, in spec order, read live from the current theme. */
export function seriesColors() {
  return [cssVar("--chart-1"), cssVar("--chart-2"), cssVar("--chart-3"), cssVar("--chart-4")];
}

/** Shared axis/text styling so charts match the surrounding page in both themes. */
export function themeDefaults() {
  const text = cssVar("--color-text-secondary");
  const grid = cssVar("--color-border");
  return {
    textStyle: { fontFamily: "Inter, system-ui, sans-serif", color: text },
    axisLine: { lineStyle: { color: grid } },
    axisLabel: { color: text },
    splitLine: { lineStyle: { color: grid } },
  };
}

/**
 * Creates (or reuses) an ECharts instance on the given container element.
 * @param {HTMLElement} el
 * @returns {import('echarts').ECharts}
 */
export function initChart(el) {
  return echarts.init(el);
}

/**
 * Applies an option object to a chart, animating between states.
 * @param {import('echarts').ECharts} chart
 * @param {object} option
 */
export function setOption(chart, option) {
  chart.setOption(option, { notMerge: false, lazyUpdate: true });
}

// TODO (Phase 5/6): panel-specific option builders (line, ranked bars,
// stacked/grouped bars, histogram, scatter), click-to-filter wiring, and
// resize handling all land here.

// ECharts setup/rendering helpers, shared by index.html and dashboard.html.
// Implemented in Phase 5 (dashboard build-out); stubs only for now so the
// module boundary is settled before the design system (Phase 3) lands.

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

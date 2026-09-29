// The "moving across the country" flow map: a choropleth (moving in / out /
// net) plus curved arcs for the busiest routes, with traveling dots and
// click-to-filter on states. Built on Apache ECharts' 'map', 'lines', and
// 'effectScatter' series types over a locally-saved US states GeoJSON.

import { cssVar } from "./charts.js";

const fmt = new Intl.NumberFormat("en-US");
const fmtCompact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

let registered = false;

export async function loadGeoData() {
  const [geoRes, centroidRes] = await Promise.all([
    fetch("data/geo/us-states.json"),
    fetch("data/geo/state-centroids.json"),
  ]);
  const geoJson = await geoRes.json();
  const centroids = await centroidRes.json();
  if (!registered) {
    echarts.registerMap("USA", geoJson);
    registered = true;
  }
  return { geoJson, centroids };
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * @param {HTMLElement} el
 * @param {object} opts
 * @param {Map<string, number>} opts.stateValues - state name -> value for the current mode
 * @param {'in'|'out'|'net'} opts.mode
 * @param {{from: string, to: string, movers: number}[]} opts.arcs - top routes to draw
 * @param {Record<string, [number, number]>} opts.centroids
 * @param {string[]} opts.selectedStates - states to mark with a pin
 * @param {(stateName: string) => void} opts.onStateClick
 * @param {(row: {prior:string, current:string, movers:number}) => string} [opts.postcardStats] - extra lines for the hover tooltip
 */
export function flowMapChart(el, opts) {
  const { stateValues, mode, arcs, centroids, selectedStates = [], onStateClick, postcardExtra } = opts;
  const chart = echarts.getInstanceByDom(el) || echarts.init(el);
  const reduced = prefersReducedMotion();

  const ink = cssVar("--color-text");
  const border = cssVar("--color-border");
  const card = cssVar("--color-card");
  const accent = cssVar("--color-accent");
  const gray = cssVar("--chart-2");

  const values = [...stateValues.entries()].map(([name, value]) => ({ name, value }));
  const maxAbs = Math.max(1, ...values.map((v) => Math.abs(v.value)));

  const visualMap =
    mode === "net"
      ? {
          type: "continuous",
          min: -maxAbs,
          max: maxAbs,
          calculable: true,
          orient: "horizontal",
          left: "center",
          bottom: 4,
          itemWidth: 12,
          itemHeight: 100,
          textStyle: { color: ink },
          inRange: { color: [accent, card, gray] },
        }
      : {
          type: "continuous",
          min: 0,
          max: maxAbs,
          calculable: true,
          orient: "horizontal",
          left: "center",
          bottom: 4,
          itemWidth: 12,
          itemHeight: 100,
          textStyle: { color: ink },
          inRange: { color: [card, mode === "in" ? gray : accent] },
        };

  const maxMovers = Math.max(1, ...arcs.map((a) => a.movers));
  const arcLines = arcs.map((a) => ({
    coords: [centroids[a.from], centroids[a.to]],
    value: a.movers,
    fromName: a.from,
    toName: a.to,
    lineStyle: { width: 0.6 + (a.movers / maxMovers) * 5 },
  }));

  const pinData = selectedStates.filter((s) => centroids[s]).map((s) => ({ name: s, value: centroids[s] }));

  chart.setOption(
    {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        backgroundColor: card,
        borderColor: border,
        textStyle: { color: ink },
        formatter: (p) => {
          if (p.componentSubType === "map") {
            const v = stateValues.get(p.name);
            const label = mode === "net" ? "Net change" : mode === "in" ? "Moving in" : "Moving out";
            const extra = postcardExtra ? postcardExtra(p.name) : "";
            return `<strong>Greetings from ${p.name}!</strong><br/>${label}: ${v == null ? "n/a" : fmt.format(Math.round(v))}${extra}`;
          }
          if (p.componentSubType === "lines") {
            return `${p.data.fromName} → ${p.data.toName}<br/>${fmt.format(p.data.value)} movers`;
          }
          return "";
        },
      },
      visualMap,
      geo: {
        map: "USA",
        roam: true,
        left: 10,
        right: 10,
        top: 10,
        bottom: 90,
        itemStyle: { areaColor: card, borderColor: border, borderWidth: 1 },
        emphasis: { itemStyle: { areaColor: accent, opacity: 0.35 }, label: { show: false } },
        select: { itemStyle: { borderColor: accent, borderWidth: 2.5 } },
        selectedMode: false,
      },
      series: [
        {
          name: "States",
          type: "map",
          map: "USA",
          geoIndex: 0,
          data: values,
          emphasis: { label: { show: false } },
        },
        {
          name: "Routes",
          type: "lines",
          coordinateSystem: "geo",
          data: arcLines,
          polyline: false,
          lineStyle: { color: accent, curveness: 0.25, opacity: 0.35 },
          effect: reduced
            ? { show: false }
            : { show: true, period: 5, trailLength: 0.35, symbol: "circle", symbolSize: 4, color: accent },
          silent: false,
          z: 5,
        },
        {
          name: "Selected",
          type: "effectScatter",
          coordinateSystem: "geo",
          data: pinData,
          symbol: "pin",
          symbolSize: 26,
          itemStyle: { color: accent },
          label: { show: false },
          rippleEffect: reduced ? { period: 0, scale: 1 } : { period: 2, scale: 2.2 },
          z: 10,
        },
      ],
    },
    { notMerge: true }
  );

  chart.off("click");
  chart.on("click", (params) => {
    if (params.componentSubType === "map" && onStateClick) onStateClick(params.name);
  });

  return chart;
}

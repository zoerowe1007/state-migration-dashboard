(function () {
  const root = getComputedStyle(document.documentElement);
  const c = (name) => root.getPropertyValue(name).trim();

  const fmt = new Intl.NumberFormat("en-US");
  const fmtCompact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
  const fmtMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  Chart.defaults.font.family = "system-ui, -apple-system, 'Segoe UI', sans-serif";
  Chart.defaults.color = c("--ink-2");
  Chart.defaults.borderColor = c("--grid");

  function gridOptions(extra) {
    extra = extra || {};
    const base = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: c("--surface"),
          titleColor: c("--ink"),
          bodyColor: c("--ink-2"),
          borderColor: c("--border"),
          borderWidth: 1,
          padding: 10,
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: c("--ink-muted") } },
        y: { grid: { color: c("--grid") }, border: { display: false }, ticks: { color: c("--ink-muted") } },
      },
    };
    return Object.assign({}, base, extra, {
      plugins: Object.assign({}, base.plugins, extra.plugins),
      scales: Object.assign({}, base.scales, extra.scales, {
        x: Object.assign({}, base.scales.x, extra.scales && extra.scales.x),
        y: Object.assign({}, base.scales.y, extra.scales && extra.scales.y),
      }),
    });
  }

  fetch("assets/data/report_data.json")
    .then((r) => r.json())
    .then((data) => {
      renderHeadline(data.headline);
      renderNationalTrend(data.national_trend);
      renderRegionTrend(data.region_trend);
      renderGainersLosers(data.gainers_losers);
      renderTopFlows(data.top_flows);
      renderCheaperShare(data.cheaper_share_trend);
      renderCostGap(data.cost_gap_trend);
      renderHomeValueChange(data.home_value_change);
      renderPrOutflow(data.pr_outflow, data.pr_outflow_stats);
    })
    .catch((err) => {
      console.error("Failed to load report data", err);
    });

  function renderHeadline(h) {
    Common.countUp(document.getElementById("stat-total-movers"), h.total_movers_latest, {
      format: (v) => fmt.format(Math.round(v)),
    });
    const gainerEl = document.getElementById("stat-top-gainer");
    if (gainerEl) {
      Common.countUp(gainerEl, h.top_gainer_value, {
        format: (v) => `${h.top_gainer_state} +${fmt.format(Math.round(v))}`,
      });
    }
    Common.countUp(document.getElementById("stat-cheaper-share"), h.cheaper_share_latest_pct, {
      format: (v) => `${v.toFixed(1)}%`,
    });
    Common.countUp(document.getElementById("stat-home-value"), h.national_median_home_value_latest, {
      format: (v) => fmtMoney.format(Math.round(v)),
    });
    document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = h.latest_year));
  }

  function renderNationalTrend(d) {
    new Chart(document.getElementById("chart-national-trend"), {
      type: "line",
      data: {
        labels: d.years,
        datasets: [{
          data: d.movers,
          borderColor: c("--blue"),
          backgroundColor: c("--blue") + "1a",
          fill: true,
          tension: 0.25,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: c("--blue"),
          pointHoverBorderColor: c("--surface"),
          pointHoverBorderWidth: 2,
        }],
      },
      options: gridOptions({
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: c("--surface"), titleColor: c("--ink"), bodyColor: c("--ink-2"),
            borderColor: c("--border"), borderWidth: 1, padding: 10,
            callbacks: { label: (ctx) => ` ${fmt.format(ctx.parsed.y)} movers` },
          },
        },
        scales: { y: { grid: { color: c("--grid") }, ticks: { callback: (v) => fmtCompact.format(v) } } },
      }),
    });
  }

  function renderRegionTrend(d) {
    const colors = { Northeast: c("--blue"), South: c("--orange"), Midwest: c("--yellow"), West: c("--aqua") };
    new Chart(document.getElementById("chart-region-trend"), {
      type: "line",
      data: {
        labels: d.years,
        datasets: Object.keys(d.series).map((region) => ({
          label: region,
          data: d.series[region],
          borderColor: colors[region],
          backgroundColor: colors[region],
          borderWidth: 2,
          tension: 0.25,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBorderColor: c("--surface"),
          pointHoverBorderWidth: 2,
        })),
      },
      options: gridOptions({
        plugins: {
          legend: {
            display: true, position: "bottom", align: "start",
            labels: { color: c("--ink-2"), boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "circle" },
          },
          tooltip: {
            backgroundColor: c("--surface"), titleColor: c("--ink"), bodyColor: c("--ink-2"),
            borderColor: c("--border"), borderWidth: 1, padding: 10,
            callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt.format(ctx.parsed.y)}` },
          },
        },
        scales: { y: { grid: { color: c("--grid") }, ticks: { callback: (v) => fmtCompact.format(v) } } },
      }),
    });
  }

  function renderGainersLosers(d) {
    const colors = d.values.map((v) => (v >= 0 ? c("--blue") : c("--red")));
    new Chart(document.getElementById("chart-gainers-losers"), {
      type: "bar",
      data: { labels: d.states, datasets: [{ data: d.values, backgroundColor: colors, borderRadius: 4, maxBarThickness: 24 }] },
      options: gridOptions({
        indexAxis: "y",
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: c("--surface"), titleColor: c("--ink"), bodyColor: c("--ink-2"),
            borderColor: c("--border"), borderWidth: 1, padding: 10,
            callbacks: { label: (ctx) => ` ${fmt.format(ctx.parsed.x)} net movers` },
          },
        },
        scales: {
          x: { grid: { color: c("--grid") }, ticks: { callback: (v) => fmtCompact.format(v) } },
          y: { grid: { display: false } },
        },
      }),
    });
  }

  function renderTopFlows(d) {
    new Chart(document.getElementById("chart-top-flows"), {
      type: "bar",
      data: { labels: d.labels, datasets: [{ data: d.values, backgroundColor: c("--blue"), borderRadius: 4, maxBarThickness: 20 }] },
      options: gridOptions({
        indexAxis: "y",
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: c("--surface"), titleColor: c("--ink"), bodyColor: c("--ink-2"),
            borderColor: c("--border"), borderWidth: 1, padding: 10,
            callbacks: { label: (ctx) => ` ${fmt.format(ctx.parsed.x)} movers` },
          },
        },
        scales: {
          x: { grid: { color: c("--grid") }, ticks: { callback: (v) => fmtCompact.format(v) } },
          y: { grid: { display: false } },
        },
      }),
    });
  }

  function renderCheaperShare(d) {
    new Chart(document.getElementById("chart-cheaper-share"), {
      type: "line",
      data: {
        labels: d.years,
        datasets: [{
          data: d.pct, borderColor: c("--aqua"), backgroundColor: c("--aqua") + "1a",
          fill: true, tension: 0.25, borderWidth: 2, pointRadius: 0,
          pointHoverRadius: 5, pointHoverBackgroundColor: c("--aqua"), pointHoverBorderColor: c("--surface"), pointHoverBorderWidth: 2,
        }],
      },
      options: gridOptions({
        plugins: {
          tooltip: {
            backgroundColor: c("--surface"), titleColor: c("--ink"), bodyColor: c("--ink-2"),
            borderColor: c("--border"), borderWidth: 1, padding: 10,
            callbacks: { label: (ctx) => ` ${ctx.parsed.y}% moved to a cheaper state` },
          },
        },
        scales: { y: { min: 45, max: 60, grid: { color: c("--grid") }, ticks: { callback: (v) => v + "%" } } },
      }),
    });
  }

  function renderCostGap(d) {
    new Chart(document.getElementById("chart-cost-gap"), {
      type: "bar",
      data: { labels: d.years, datasets: [{ data: d.gap, backgroundColor: c("--violet"), borderRadius: 4, maxBarThickness: 22 }] },
      options: gridOptions({
        plugins: {
          tooltip: {
            backgroundColor: c("--surface"), titleColor: c("--ink"), bodyColor: c("--ink-2"),
            borderColor: c("--border"), borderWidth: 1, padding: 10,
            callbacks: { label: (ctx) => ` ${fmtMoney.format(ctx.parsed.y)} avg. gap` },
          },
        },
        scales: { y: { grid: { color: c("--grid") }, ticks: { callback: (v) => fmtMoney.format(v) } } },
      }),
    });
  }

  function renderHomeValueChange(d) {
    const colors = d.pct.map((v) => (v >= 0 ? c("--blue") : c("--red")));
    new Chart(document.getElementById("chart-home-value-change"), {
      type: "bar",
      data: { labels: d.states, datasets: [{ data: d.pct, backgroundColor: colors, borderRadius: 4, maxBarThickness: 18 }] },
      options: gridOptions({
        indexAxis: "y",
        plugins: {
          tooltip: {
            backgroundColor: c("--surface"), titleColor: c("--ink"), bodyColor: c("--ink-2"),
            borderColor: c("--border"), borderWidth: 1, padding: 10,
            callbacks: { label: (ctx) => ` ${ctx.parsed.x}% since 2005` },
          },
        },
        scales: {
          x: { grid: { color: c("--grid") }, ticks: { callback: (v) => v + "%" } },
          y: { grid: { display: false }, ticks: { font: { size: 10 } } },
        },
      }),
    });
  }

  function renderPrOutflow(d, stats) {
    new Chart(document.getElementById("chart-pr-outflow"), {
      type: "line",
      data: {
        labels: d.years,
        datasets: [{
          data: d.movers, borderColor: c("--orange"), backgroundColor: c("--orange") + "1a",
          fill: true, tension: 0.25, borderWidth: 2, pointRadius: 0,
          pointHoverRadius: 5, pointHoverBackgroundColor: c("--orange"), pointHoverBorderColor: c("--surface"), pointHoverBorderWidth: 2,
        }],
      },
      options: gridOptions({
        plugins: {
          tooltip: {
            backgroundColor: c("--surface"), titleColor: c("--ink"), bodyColor: c("--ink-2"),
            borderColor: c("--border"), borderWidth: 1, padding: 10,
            callbacks: { label: (ctx) => ` ${fmt.format(ctx.parsed.y)} left Puerto Rico` },
          },
        },
        scales: { y: { grid: { color: c("--grid") }, ticks: { callback: (v) => fmtCompact.format(v) } } },
      }),
    });
  }
})();

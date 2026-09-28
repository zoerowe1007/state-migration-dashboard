(function () {
  const CSV_PATH = "data/processed/state_migration_cost_panel.csv";

  const root = getComputedStyle(document.documentElement);
  const c = (name) => root.getPropertyValue(name).trim();
  const fmt = new Intl.NumberFormat("en-US");
  const fmtCompact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
  const fmtMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  Chart.defaults.font.family = "system-ui, -apple-system, 'Segoe UI', sans-serif";
  Chart.defaults.color = c("--ink-2");
  Chart.defaults.borderColor = c("--grid");

  const MEASURES = {
    total: { label: "Total movers", format: (v) => fmt.format(Math.round(v)) },
    count: { label: "Number of routes", format: (v) => fmt.format(Math.round(v)) },
    median_zhvi: { label: "Median home value (destination)", format: (v) => (v == null ? "n/a" : fmtMoney.format(v)) },
    cheaper_rate: { label: "Share moving to a cheaper state", format: (v) => (v == null ? "n/a" : v.toFixed(1) + "%") },
  };
  const BREAKDOWNS = {
    current_state: "Destination state",
    prior_state: "Origin state",
    current_region: "Region",
    year: "Year",
  };

  const state = {
    rows: [],
    years: [],
    states: [],
    regions: [],
    filters: { year: "all", current_state: "all", prior_state: "all", current_region: "all" },
    chart1: { measure: "total", breakdown: "current_state" },
    charts: {},
  };

  function parseCsv(text) {
    const lines = text.trim().split("\n");
    const header = lines[0].split(",");
    const idx = Object.fromEntries(header.map((h, i) => [h, i]));
    const rows = new Array(lines.length - 1);
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      rows[i - 1] = {
        year: +cols[idx.year],
        current_state: cols[idx.current_state],
        current_region: cols[idx.current_region],
        prior_state: cols[idx.prior_state],
        prior_region: cols[idx.prior_region],
        movers: +cols[idx.movers],
        moe: cols[idx.moe] === "" ? null : +cols[idx.moe],
        current_zhvi: cols[idx.current_zhvi] === "" ? null : +cols[idx.current_zhvi],
        prior_zhvi: cols[idx.prior_zhvi] === "" ? null : +cols[idx.prior_zhvi],
      };
    }
    return rows;
  }

  function median(nums) {
    if (!nums.length) return null;
    const s = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function applyFilters(rows) {
    const f = state.filters;
    return rows.filter(
      (r) =>
        (f.year === "all" || r.year === +f.year) &&
        (f.current_state === "all" || r.current_state === f.current_state) &&
        (f.prior_state === "all" || r.prior_state === f.prior_state) &&
        (f.current_region === "all" || r.current_region === f.current_region)
    );
  }

  function computeMeasure(rows, measure) {
    if (!rows.length) return measure === "median_zhvi" || measure === "cheaper_rate" ? null : 0;
    if (measure === "total") return rows.reduce((s, r) => s + r.movers, 0);
    if (measure === "count") return rows.length;
    if (measure === "median_zhvi") return median(rows.map((r) => r.current_zhvi).filter((v) => v != null));
    if (measure === "cheaper_rate") {
      const withGap = rows.filter((r) => r.current_zhvi != null && r.prior_zhvi != null);
      const totalMovers = withGap.reduce((s, r) => s + r.movers, 0);
      if (!totalMovers) return null;
      const cheaperMovers = withGap
        .filter((r) => r.current_zhvi < r.prior_zhvi)
        .reduce((s, r) => s + r.movers, 0);
      return (cheaperMovers / totalMovers) * 100;
    }
    return 0;
  }

  function groupBy(rows, key) {
    const map = new Map();
    for (const r of rows) {
      const k = r[key];
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    return map;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function populateFilterOptions() {
    const yearSel = document.getElementById("filter-year");
    const destSel = document.getElementById("filter-current-state");
    const origSel = document.getElementById("filter-prior-state");
    const regionSel = document.getElementById("filter-region");

    for (const y of state.years) yearSel.add(new Option(y, y));
    for (const s of state.states) {
      destSel.add(new Option(s, s));
      origSel.add(new Option(s, s));
    }
    for (const r of state.regions) regionSel.add(new Option(r, r));
  }

  function buildChartOptions(extra) {
    extra = extra || {};
    const base = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: c("--surface"), titleColor: c("--ink"), bodyColor: c("--ink-2"),
          borderColor: c("--border"), borderWidth: 1, padding: 10,
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

  function destroy(key) {
    if (state.charts[key]) {
      state.charts[key].destroy();
      delete state.charts[key];
    }
  }

  function renderSummary(filtered) {
    const total = computeMeasure(filtered, "total");
    const routes = computeMeasure(filtered, "count");
    const medianZhvi = computeMeasure(filtered, "median_zhvi");
    const cheaperRate = computeMeasure(filtered, "cheaper_rate");

    setText("summary-total-movers", fmt.format(total));
    setText("summary-routes", fmt.format(routes));
    setText("summary-median-zhvi", medianZhvi == null ? "n/a" : fmtMoney.format(medianZhvi));
    setText("summary-cheaper-rate", cheaperRate == null ? "n/a" : cheaperRate.toFixed(1) + "%");
  }

  function renderChart1(filtered) {
    const { measure, breakdown } = state.chart1;
    const groups = groupBy(filtered, breakdown);
    let entries = Array.from(groups.entries()).map(([key, rows]) => [key, computeMeasure(rows, measure)]);
    entries = entries.filter(([, v]) => v != null);

    const isYear = breakdown === "year";
    if (isYear) entries.sort((a, b) => a[0] - b[0]);
    else {
      entries.sort((a, b) => b[1] - a[1]);
      entries = entries.slice(0, 12);
    }

    const labels = entries.map(([k]) => String(k));
    const values = entries.map(([, v]) => v);

    destroy("chart1");
    const ctx = document.getElementById("chart-dashboard-1");
    const measureInfo = MEASURES[measure];

    if (isYear) {
      state.charts.chart1 = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [{
            data: values, borderColor: c("--blue"), backgroundColor: c("--blue") + "1a",
            fill: true, tension: 0.25, borderWidth: 2, pointRadius: 0,
            pointHoverRadius: 5, pointHoverBackgroundColor: c("--blue"), pointHoverBorderColor: c("--surface"), pointHoverBorderWidth: 2,
          }],
        },
        options: buildChartOptions({
          plugins: { tooltip: { callbacks: { label: (ctx) => ` ${measureInfo.format(ctx.parsed.y)}` } } },
          scales: { y: { ticks: { callback: (v) => (measure === "total" || measure === "count" ? fmtCompact.format(v) : v) } } },
        }),
      });
    } else {
      state.charts.chart1 = new Chart(ctx, {
        type: "bar",
        data: { labels, datasets: [{ data: values, backgroundColor: c("--blue"), borderRadius: 4, maxBarThickness: 22 }] },
        options: buildChartOptions({
          indexAxis: "y",
          plugins: { tooltip: { callbacks: { label: (ctx) => ` ${measureInfo.format(ctx.parsed.x)}` } } },
          scales: {
            x: { ticks: { callback: (v) => (measure === "total" || measure === "count" ? fmtCompact.format(v) : v) } },
            y: { grid: { display: false } },
          },
        }),
      });
    }
  }

  function renderChart2(filtered) {
    const groups = groupBy(filtered, "year");
    const entries = Array.from(groups.entries())
      .map(([y, rows]) => [+y, rows.reduce((s, r) => s + r.movers, 0)])
      .sort((a, b) => a[0] - b[0]);

    destroy("chart2");
    state.charts.chart2 = new Chart(document.getElementById("chart-dashboard-2"), {
      type: "line",
      data: {
        labels: entries.map((e) => e[0]),
        datasets: [{
          data: entries.map((e) => e[1]), borderColor: c("--aqua"), backgroundColor: c("--aqua") + "1a",
          fill: true, tension: 0.25, borderWidth: 2, pointRadius: 0,
          pointHoverRadius: 5, pointHoverBackgroundColor: c("--aqua"), pointHoverBorderColor: c("--surface"), pointHoverBorderWidth: 2,
        }],
      },
      options: buildChartOptions({
        plugins: { tooltip: { callbacks: { label: (ctx) => ` ${fmt.format(ctx.parsed.y)} movers` } } },
        scales: { y: { ticks: { callback: (v) => fmtCompact.format(v) } } },
      }),
    });
  }

  function renderChart3(filtered) {
    const routeMap = new Map();
    for (const r of filtered) {
      const key = `${r.prior_state} → ${r.current_state}`;
      routeMap.set(key, (routeMap.get(key) || 0) + r.movers);
    }
    const top = Array.from(routeMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);

    destroy("chart3");
    state.charts.chart3 = new Chart(document.getElementById("chart-dashboard-3"), {
      type: "bar",
      data: { labels: top.map((t) => t[0]), datasets: [{ data: top.map((t) => t[1]), backgroundColor: c("--orange"), borderRadius: 4, maxBarThickness: 20 }] },
      options: buildChartOptions({
        indexAxis: "y",
        plugins: { tooltip: { callbacks: { label: (ctx) => ` ${fmt.format(ctx.parsed.x)} movers` } } },
        scales: { x: { ticks: { callback: (v) => fmtCompact.format(v) } }, y: { grid: { display: false } } },
      }),
    });
  }

  function renderChart4(filtered) {
    const groups = groupBy(filtered, "current_region");
    const entries = Array.from(groups.entries())
      .map(([k, rows]) => [k, rows.reduce((s, r) => s + r.movers, 0)])
      .filter(([k]) => k)
      .sort((a, b) => b[1] - a[1]);

    const colors = { Northeast: c("--blue"), South: c("--orange"), Midwest: c("--yellow"), West: c("--aqua"), Territory: c("--violet") };

    destroy("chart4");
    state.charts.chart4 = new Chart(document.getElementById("chart-dashboard-4"), {
      type: "doughnut",
      data: {
        labels: entries.map((e) => e[0]),
        datasets: [{ data: entries.map((e) => e[1]), backgroundColor: entries.map((e) => colors[e[0]] || c("--ink-muted")), borderColor: c("--surface"), borderWidth: 2 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: "bottom", labels: { color: c("--ink-2"), boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "circle" } },
          tooltip: {
            backgroundColor: c("--surface"), titleColor: c("--ink"), bodyColor: c("--ink-2"), borderColor: c("--border"), borderWidth: 1, padding: 10,
            callbacks: { label: (ctx) => ` ${ctx.label}: ${fmt.format(ctx.parsed)} movers` },
          },
        },
      },
    });
  }

  function renderTable(filtered) {
    const sorted = [...filtered].sort((a, b) => b.movers - a.movers);
    const shown = sorted.slice(0, 500);
    const tbody = document.getElementById("table-body");
    tbody.innerHTML = shown
      .map(
        (r) => `<tr>
          <td>${r.year}</td>
          <td>${r.prior_state}</td>
          <td>${r.current_state}</td>
          <td>${fmt.format(r.movers)}</td>
          <td>${r.moe == null ? "–" : fmt.format(r.moe)}</td>
          <td>${r.current_zhvi == null ? "–" : fmtMoney.format(r.current_zhvi)}</td>
          <td>${r.prior_zhvi == null ? "–" : fmtMoney.format(r.prior_zhvi)}</td>
        </tr>`
      )
      .join("");
    setText(
      "table-caption",
      `Showing ${fmt.format(shown.length)} of ${fmt.format(sorted.length)} rows, sorted by movers (highest first).`
    );
  }

  function update() {
    const filtered = applyFilters(state.rows);
    renderSummary(filtered);
    renderChart1(filtered);
    renderChart2(filtered);
    renderChart3(filtered);
    renderChart4(filtered);
    renderTable(filtered);
  }

  function wireControls() {
    document.getElementById("filter-year").addEventListener("change", (e) => {
      state.filters.year = e.target.value;
      update();
    });
    document.getElementById("filter-current-state").addEventListener("change", (e) => {
      state.filters.current_state = e.target.value;
      update();
    });
    document.getElementById("filter-prior-state").addEventListener("change", (e) => {
      state.filters.prior_state = e.target.value;
      update();
    });
    document.getElementById("filter-region").addEventListener("change", (e) => {
      state.filters.current_region = e.target.value;
      update();
    });

    document.getElementById("reset-filters").addEventListener("click", () => {
      state.filters = { year: "all", current_state: "all", prior_state: "all", current_region: "all" };
      for (const id of ["filter-year", "filter-current-state", "filter-prior-state", "filter-region"]) {
        document.getElementById(id).value = "all";
      }
      update();
    });

    document.querySelectorAll("#measure-switch button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#measure-switch button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.chart1.measure = btn.dataset.measure;
        renderChart1(applyFilters(state.rows));
      });
    });
    document.querySelectorAll("#breakdown-switch button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#breakdown-switch button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.chart1.breakdown = btn.dataset.breakdown;
        renderChart1(applyFilters(state.rows));
      });
    });
  }

  fetch(CSV_PATH)
    .then((r) => r.text())
    .then((text) => {
      state.rows = parseCsv(text);
      state.years = [...new Set(state.rows.map((r) => r.year))].sort((a, b) => a - b);
      state.states = [...new Set(state.rows.map((r) => r.current_state))].sort();
      state.regions = [...new Set(state.rows.map((r) => r.current_region))].filter(Boolean).sort();

      populateFilterOptions();
      wireControls();
      document.getElementById("loading-note").hidden = true;
      update();
    })
    .catch((err) => {
      console.error("Failed to load panel data", err);
      document.getElementById("loading-note").textContent = "Could not load the data file.";
    });
})();

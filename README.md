# State Migration & Cost of Living

Where people move between U.S. states, and how that compares with home values in
the states they leave and the states they choose. Built for the Financial Data
Analytics data website project.

- **Live site:** https://zoerowe1007.github.io/state-migration-dashboard/
- **Report** (`index.html`): headline numbers, eight findings with a chart each, and a closing "About the data" section.
- **Dashboard** (`dashboard.html`): filter the full data set in the browser, switch measures and breakdowns, and read the table behind each chart.

## Files

### Site

| File | What it does |
|---|---|
| `index.html` | The report page: title and summary, four headline numbers, eight findings (heading, explanation, chart), and the closing data-notes section. |
| `dashboard.html` | The dashboard page: filter bar, five summary numbers, flow map, "Plan your move" comparison, and six charts (the map, a main chart, and four more) with Chart / Table / PNG toggles. |
| `css/styles.css` | The one stylesheet both pages share: colors, fonts, nav bar, cards, layout, dark mode. |
| `js/data.js` | Fetches `data/site_data.json` once and turns it into typed arrays for fast in-memory filtering. |
| `js/state.js` | Holds the filter and control state, keeps it in the URL (so "Copy link to this view" and Back work), and builds the row mask for the current filters. |
| `js/dashboard.js` | Dashboard logic: summary numbers, every chart and table, measure/breakdown switches, reset, "Plan your move", "Surprise me". |
| `js/report.js` | Report logic: computes the headline numbers and draws the eight report charts from the same data the dashboard uses. |
| `js/charts.js` | Shared Apache ECharts helpers (line, bar, histogram, scatter) themed from the CSS colors. |
| `js/map.js` | The U.S. flow map. Moves Alaska and Hawaii into insets so the lower 48 fill the map. |
| `js/tables.js` | Sortable table renderer used for each panel's Table view. |
| `js/export.js` | Downloads a chart as a PNG. |
| `js/icons.js` | Small inline SVG icons for the moving-across-the-country theme. |

### Data and scripts

| File | What it does |
|---|---|
| `data/raw/census_migration/` | Raw Census Bureau state-to-state flow tables, one file per year, 2005-2024 (no 2020). |
| `data/raw/zhvi_state.csv` | Raw Zillow Home Value Index, state level, monthly. |
| `data/prepare_data.py` | Reads the raw files and writes the panel CSV. |
| `data/processed/state_migration_cost_panel.csv` | The final panel (50,066 rows, 9 columns). Every number on both pages comes from this file. |
| `data/build_site_data.py` | Converts the panel CSV into the compact `data/site_data.json` the browser loads. |
| `data/site_data.json` | The panel in column form, with states and regions stored as small integer codes. This is what the two pages fetch. |
| `data/validate.py` | Recomputes every figure quoted in the report and the dashboard's default numbers from the CSV and prints PASS/FAIL. |
| `data/geo/us-states.json` | A public-domain U.S. state-boundary GeoJSON used for the map. |
| `data/geo/state-centroids.json` | One centroid per state (computed from the boundaries), used for the map's route arcs and pins. |
| `pyproject.toml`, `uv.lock`, `.python-version` | Python environment for the scripts, managed with [uv](https://docs.astral.sh/uv/). |

## Run it

The pages fetch JSON, so open them through a local web server rather than by double-clicking the file:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000.

To rebuild the data and re-check the numbers:

```bash
uv run python data/prepare_data.py      # raw files -> panel CSV
uv run python data/build_site_data.py   # panel CSV -> data/site_data.json
uv run python data/validate.py          # recompute every number the report quotes
```

## Where the data came from

**Migration flows:** U.S. Census Bureau, [State-to-State Migration Flows](https://www.census.gov/data/tables/time-series/demo/geographic-mobility/state-to-state-migration.html),
American Community Survey 1-year estimates, 2005-2024. The Census Bureau released
no 1-year estimates for 2020, so that year is missing (19 survey years).

**Home values:** [Zillow Home Value Index (ZHVI)](https://www.zillow.com/research/data/),
state level, all homes, smoothed and seasonally adjusted, monthly. The twelve monthly
values in each calendar year are averaged to one value per state per year, then joined
to the migration rows by state and year: once for the destination (`current_zhvi`) and
once for the origin (`prior_zhvi`).

### What one row is

One row is one **origin state -> destination state -> survey year**: the estimated number
of people who lived in `prior_state` a year before the survey and in `current_state` when
surveyed.

| Column | Meaning |
|---|---|
| `year` | Survey year (2005-2024, no 2020) |
| `current_state` | State of residence at the time of the survey (destination) |
| `current_region` | Census region of `current_state` (Puerto Rico is "Territory") |
| `prior_state` | State of residence one year earlier (origin) |
| `prior_region` | Census region of `prior_state` |
| `movers` | Estimated number of people who made this move |
| `moe` | 90% margin of error on `movers` |
| `current_zhvi` | Annual average home value index in `current_state` |
| `prior_zhvi` | Annual average home value index in `prior_state` |

The table covers 52 places (50 states, D.C., Puerto Rico) and 19 years.

### Rows dropped or left out

- **Same-state rows** (people who moved within a state): the project is about moves between states.
- **Suppressed or not-applicable cells** (N or X in the Census tables): there is no estimate to keep.
- **Non-state rows** such as national and regional totals: they would double-count the state rows.
- **Missing home values:** Zillow publishes no state index for Puerto Rico, and none for North Dakota before 2009. Those 2,313 rows (4.6%) stay in every migration count but are excluded from every home-value figure.

### How the rates and averages are computed

- **Net migration** = movers arriving minus movers leaving, summed over the years shown.
- **Share moving to a cheaper state** = movers whose destination index is below their origin's, divided by all movers with both indexes.
- **Home value gap** = destination index minus origin index. The **movers-weighted** gap is sum(gap x movers) / sum(movers).
- **Home value change** = (2024 index - 2005 index) / 2005 index, per state.
- **Median destination home value** (dashboard) is the median over the records in view; each record counts once.

The "About the data" section at the bottom of the report page gives the same definitions for readers.

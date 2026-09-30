# State Migration & Cost of Living

Where people move between U.S. states, and how that compares with home values in
the states they leave and the states they choose. Built for the Financial Data
Analytics data website project.

- **Live site:** https://zoerowe1007.github.io/state-migration-dashboard/
- **Report** (`index.html`): headline numbers, thirteen findings with a chart each, and a closing "About the data" section.
- **Dashboard** (`dashboard.html`): filter the full data set in the browser, switch measures, breakdowns and dollar basis (as reported or 2024 dollars), and read the table behind each chart.

## Files

### Site

| File | What it does |
|---|---|
| `index.html` | The report page: title and summary, four headline numbers, thirteen findings (heading, explanation, chart), and the closing data-notes section. |
| `dashboard.html` | The dashboard page: filter bar (year, destination, origin, region, route quality, dollar basis), five summary numbers, flow map, "Plan your move" comparison, and eight charts (the map, a main chart, four more, and two state-level panels: migration per 1,000 residents and cost of living/affordability) with Chart / Table / PNG toggles. |
| `css/styles.css` | The one stylesheet both pages share: colors, fonts, nav bar, cards, layout, dark mode. |
| `js/data.js` | Fetches `data/site_data.json` once and turns it into typed arrays for fast in-memory filtering. |
| `js/context.js` | Lookups for the supplementary data (population, income, price parities, rent, CPI, mortgage rates), the inflation and mortgage-payment helpers, and the loader for the IRS flows. |
| `js/state.js` | Holds the filter and control state, keeps it in the URL (so "Copy link to this view" and Back work), and builds the row mask for the current filters (including the reliable-routes-only filter). |
| `js/dashboard.js` | Dashboard logic: summary numbers, every chart and table, measure/breakdown switches, reset, "Plan your move", "Surprise me". |
| `js/report.js` | Report logic: computes the headline numbers and draws the thirteen report charts from the same data the dashboard uses. |
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
| `data/download_raw.sh` | Downloads the supplementary raw data listed below into `data/raw/`. |
| `data/raw/population/`, `bea/`, `income/`, `cpi/`, `freddie_mac/`, `zillow/`, `irs_soi/` | Raw files for population, price parities, household income, CPI, mortgage rates, rent and IRS migration (see "Where the data came from"). |
| `data/prepare_data.py` | Reads the Census and Zillow home-value files and writes the migration panel CSV. |
| `data/prepare_context.py` | Reads the supplementary raw files and writes the three tables below. |
| `data/processed/state_migration_cost_panel.csv` | The migration panel (50,109 rows, 9 columns). |
| `data/processed/state_year_context.csv` | One row per place and year: population, median household income, price parities, rent. |
| `data/processed/year_context.csv` | One row per year: CPI-U and the average 30-year mortgage rate. |
| `data/processed/irs_state_flows.csv` | IRS state-to-state flows: returns, people, and adjusted gross income, 2011-12 to 2022-23. |
| `data/build_site_data.py` | Converts the processed tables into the compact JSON files the browser loads. |
| `data/site_data.json` | The panel plus the state and year context, in column form, with states and regions as small integer codes. Both pages fetch this. |
| `data/irs_flows.json` | The IRS flows in the same compact form; fetched by the report's last section. |
| `data/validate.py` | Recomputes every figure quoted in the report and the dashboard's default numbers from the tables and prints PASS/FAIL. |
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
sh data/download_raw.sh                  # fetch the supplementary raw files (once)
uv run python data/prepare_data.py       # Census + Zillow files -> migration panel CSV
uv run python data/prepare_context.py    # supplementary raw files -> context tables
uv run python data/build_site_data.py    # processed tables -> data/site_data.json, data/irs_flows.json
uv run python data/validate.py           # recompute every number the report quotes
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

**Supplementary sources** (all downloaded by `data/download_raw.sh`):

- **Population:** Census Population Estimates, July 1, from three releases (2000-2010 intercensal for 2005-09, Vintage 2019 for 2010-19, Vintage 2024 for 2020-24). No Puerto Rico estimate for 2005-09.
- **Income:** Census CPS ASEC Historical Table H-8, median household income by state. Covers the 50 states and D.C. (no Puerto Rico). For 2013 and 2017 the table lists two columns; the first-listed is used.
- **Price levels:** BEA Regional Price Parities, all items and housing, 50 states and D.C., 2008-2024.
- **Inflation:** annual-average CPI-U, all items, U.S. city average (Bureau of Labor Statistics), taken from the Minneapolis Fed's table because BLS and FRED block scripted downloads.
- **Mortgage rates:** Freddie Mac Primary Mortgage Market Survey, weekly 30-year fixed, averaged by calendar year.
- **Rent:** Zillow Observed Rent Index. Zillow publishes no state-level file, so each state's value is the plain average of its metro areas' annual ZORI (2015 on; none for D.C. or Puerto Rico).
- **Income that moves with people:** IRS Statistics of Income state-to-state migration files (tax returns), periods 2011-12 to 2022-23. The 2014-15 period is unusually low in the source.

The Census ACS API now requires a key, so income comes from the CPS table above instead of ACS.

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
- **Missing home values:** Zillow publishes no state index for Puerto Rico, and none for North Dakota before 2009. Those 2,314 rows (4.6%) stay in every migration count but are excluded from every home-value figure.
- **Census suppressions in 2024:** the 2024 table marks 279 small routes `N` that earlier years report (about 71,000 movers in 2023, roughly 1%). Movers fell 4.8% from 2023 to 2024 on routes reported in both years.
- **Data-prep bug fixed:** the 2024 file spells some origins `"District of Columbia "` with a trailing space, which once caused 43 rows to be dropped silently. `prepare_data.py` now strips whitespace.
- **IRS files:** rows for moves from abroad, national totals and non-movers are dropped.

### How the rates and averages are computed

- **Net migration** = movers arriving minus movers leaving, summed over the years shown.
- **Share moving to a cheaper state** = movers whose destination index is below their origin's, divided by all movers with both indexes.
- **Home value gap** = destination index minus origin index. The **movers-weighted** gap is sum(gap x movers) / sum(movers).
- **Home value change** = (2024 index - 2005 index) / 2005 index, per state.
- **Median destination home value** (dashboard) is the median over the records in view; each record counts once.
- **Net migration per 1,000 residents** = 1,000 x (movers in - movers out) / population, using the July 1 estimate of each year counted (an annual average over a window).
- **2024 dollars:** each year's amount x CPI-U(2024) / CPI-U(that year).
- **Price-to-income ratio** = state home value / state median household income. "Typical state" = median across the places that have both.
- **Monthly mortgage payment** = principal and interest on a 30-year fixed loan for 80% of the state's home value at that year's average Freddie Mac rate (no taxes, insurance or fees).
- **Net IRS income** = adjusted gross income arriving minus leaving; "average return" = total AGI / returns.
- **Margin of error:** a route-year is "reliable" when its 90% margin of error is at most 30% of its estimate. 88.6% of route-years fail this test but hold only 41.7% of movers, so the report rests on state, region and year totals.

The "About the data" section at the bottom of the report page gives the same definitions for readers.

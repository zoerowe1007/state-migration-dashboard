# State Migration & Cost of Living

Where people move between U.S. states, and how that compares to the cost of
living (home values) where they're moving from and to. Built for a Financial
Data Analytics course project.

Live site: https://zoerowe1007.github.io/state-migration-dashboard/

## Files

- `index.html` — the report page: findings, headline numbers, and charts.
- `dashboard.html` — the interactive dashboard: filter the data live in the browser.
- `assets/style.css` — shared nav, layout, and component styles for both pages.
- `assets/report.js` — fetches `assets/data/report_data.json` and renders the
  report page's headline numbers and Chart.js charts.
- `assets/dashboard.js` — loads `data/processed/state_migration_cost_panel.csv`
  directly in the browser and drives the dashboard's filters, summary numbers,
  switchable charts, and data table. All filtering and aggregation happens
  client-side, live, as you change the controls.
- `assets/data/report_data.json` — every number and chart series on the report
  page, built by `data/generate_report_data.py` so it always matches the data.
- `data/prepare_data.py` — rebuilds `data/processed/state_migration_cost_panel.csv`
  from the raw files in `data/raw/`. Run with `uv run python data/prepare_data.py`.
- `data/generate_report_data.py` — rebuilds `assets/data/report_data.json` from
  the processed panel. Run with `uv run python data/generate_report_data.py`.
- `data/processed/state_migration_cost_panel.csv` — the final panel dataset used
  by both pages.
- `data/raw/census_migration/` — raw Census Bureau state-to-state migration
  flow tables, one file per year (2005–2024, 2020 omitted).
- `data/raw/zhvi_state.csv` — raw Zillow Home Value Index, state level, monthly.
- `pyproject.toml` / `uv.lock` — Python environment for `prepare_data.py` (managed with `uv`).

## Data

**Migration flows**: U.S. Census Bureau, [State-to-State Migration Flows](https://www.census.gov/data/tables/time-series/demo/geographic-mobility/state-to-state-migration.html),
American Community Survey 1-year estimates, 2005–2024 (the ACS did not release
1-year estimates for 2020, so that year is absent). Each row is the estimated
number of people who lived in one state ("prior_state") one year before the
survey and lived in another state ("current_state") at the time of the survey.
Intrastate movers (same state both years) are dropped, since the project is
about migration *between* states.

**Cost of living**: [Zillow Home Value Index (ZHVI)](https://www.zillow.com/research/data/),
state level, smoothed/seasonally adjusted, all-homes tier, monthly from 2000
to present. Averaged to an annual figure per state and joined onto the
migration data by state and year, once for the destination state
(`current_zhvi`) and once for the origin state (`prior_zhvi`).

Zillow does not publish a state-level ZHVI for North Dakota or Puerto Rico, so
`current_zhvi`/`prior_zhvi` are blank for rows involving those two
(~2.3% of rows). Every other column is complete.

### Columns

| Column | Meaning |
|---|---|
| `year` | Survey year (2005–2024, 2020 omitted) |
| `current_state` | State of residence at the time of the survey (destination) |
| `current_region` | Census region of `current_state` |
| `prior_state` | State of residence one year earlier (origin) |
| `prior_region` | Census region of `prior_state` |
| `movers` | Estimated number of people who made this state-to-state move |
| `moe` | Margin of error (90% confidence) on `movers` |
| `current_zhvi` | Average home value index in `current_state` that year |
| `prior_zhvi` | Average home value index in `prior_state` that year |

50,066 rows total: 19 years x up to 52x51 state/territory pairs (some
small-sample pairs are suppressed by the Census Bureau and dropped).

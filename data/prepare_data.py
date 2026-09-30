"""
Builds data/processed/state_migration_cost_panel.csv from the raw sources in data/raw/.

Sources:
- data/raw/census_migration/{year}.xls(x): U.S. Census Bureau, State-to-State
  Migration Flows, ACS 1-year estimates, 2005-2024 (2020 omitted; ACS did not
  release 1-year estimates that year). Downloaded from
  https://www.census.gov/data/tables/time-series/demo/geographic-mobility/state-to-state-migration.html
- data/raw/zhvi_state.csv: Zillow Home Value Index (ZHVI), state level, monthly,
  smoothed/seasonally adjusted, all-homes tier. Downloaded from
  https://www.zillow.com/research/data/

One row in the final panel = one (destination state, origin state, year) flow:
the estimated number of people who lived in `prior_state` one year before the
survey and live in `current_state` at the time of the survey, plus the home
value index in each state that year.

Run with: uv run python data/prepare_data.py
"""

import pandas as pd

RAW_DIR = "data/raw"
OUT_PATH = "data/processed/state_migration_cost_panel.csv"

US_STATES = {
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
    "Connecticut", "Delaware", "District of Columbia", "Florida", "Georgia",
    "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky",
    "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
    "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
    "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina",
    "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania",
    "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas",
    "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin",
    "Wyoming", "Puerto Rico",
}

REGION = {
    "Connecticut": "Northeast", "Maine": "Northeast", "Massachusetts": "Northeast",
    "New Hampshire": "Northeast", "Rhode Island": "Northeast", "Vermont": "Northeast",
    "New Jersey": "Northeast", "New York": "Northeast", "Pennsylvania": "Northeast",
    "Illinois": "Midwest", "Indiana": "Midwest", "Michigan": "Midwest",
    "Ohio": "Midwest", "Wisconsin": "Midwest", "Iowa": "Midwest", "Kansas": "Midwest",
    "Minnesota": "Midwest", "Missouri": "Midwest", "Nebraska": "Midwest",
    "North Dakota": "Midwest", "South Dakota": "Midwest",
    "Delaware": "South", "Florida": "South", "Georgia": "South", "Maryland": "South",
    "North Carolina": "South", "South Carolina": "South", "Virginia": "South",
    "District of Columbia": "South", "West Virginia": "South", "Alabama": "South",
    "Kentucky": "South", "Mississippi": "South", "Tennessee": "South",
    "Arkansas": "South", "Louisiana": "South", "Oklahoma": "South", "Texas": "South",
    "Arizona": "West", "Colorado": "West", "Idaho": "West", "Montana": "West",
    "Nevada": "West", "New Mexico": "West", "Utah": "West", "Wyoming": "West",
    "Alaska": "West", "California": "West", "Hawaii": "West", "Oregon": "West",
    "Washington": "West", "Puerto Rico": "Territory",
}

MATRIX_YEARS = {
    2005: "xls", 2006: "xls", 2007: "xls", 2008: "xls", 2009: "xls",
    2010: "xls", 2011: "xls", 2012: "xls", 2013: "xls", 2014: "xls",
    2015: "xls", 2016: "xls", 2017: "xls", 2018: "xls", 2019: "xls",
    2021: "xls", 2022: "xlsx", 2023: "xlsx",
}
TIDY_YEARS = {2024: "xlsx"}


def parse_matrix_year(path, year):
    """2005-2023 files: a wide matrix, states as both row and column headers,
    with an Estimate/MOE column pair for each destination state."""
    df = pd.read_excel(path, header=None)

    row_state = df.iloc[6].ffill()
    row_kind = df.iloc[7]
    origin_labels = df.iloc[:, 0].astype(str).str.strip()

    data_rows = [r for r in range(9, len(df)) if origin_labels[r] in US_STATES]

    est_cols = []
    for c in range(1, df.shape[1] - 1):
        if row_kind[c] == "Estimate":
            dest = str(row_state[c]).strip()
            if dest in US_STATES:
                est_cols.append((c, c + 1, dest))

    records = []
    for r in data_rows:
        origin = origin_labels[r]
        for c_est, c_moe, dest in est_cols:
            if origin == dest:
                continue  # same-state (intrastate movers), not an interstate move
            val = df.iat[r, c_est]
            moe = df.iat[r, c_moe]
            if isinstance(val, str) or pd.isna(val):
                continue  # 'N' or 'X' = not applicable / suppressed
            moe_val = None if isinstance(moe, str) or pd.isna(moe) else int(moe)
            records.append((year, origin, dest, int(val), moe_val))

    return pd.DataFrame(records, columns=["year", "current_state", "prior_state", "movers", "moe"])


def parse_tidy_year(path, year):
    """2024 file: already a long table (current residence, residence 1 year
    ago, estimate, margin of error)."""
    df = pd.read_excel(path, sheet_name="Table", header=None)
    body = df.iloc[8:].copy()
    body.columns = ["current_state", "prior_state", "movers", "moe"]
    body = body.dropna(subset=["current_state", "prior_state"])
    # Some labels carry stray whitespace (e.g. "District of Columbia " as an
    # origin); without this they fail the isin() check below and are silently lost.
    body["current_state"] = body["current_state"].astype(str).str.strip()
    body["prior_state"] = body["prior_state"].astype(str).str.strip()
    body = body[body["current_state"].isin(US_STATES) & body["prior_state"].isin(US_STATES)]
    body = body[body["current_state"] != body["prior_state"]]

    def clean_num(x):
        return None if isinstance(x, str) or pd.isna(x) else int(x)

    body["movers"] = body["movers"].map(clean_num)
    body["moe"] = body["moe"].map(clean_num)
    body = body.dropna(subset=["movers"])
    body["year"] = year
    return body[["year", "current_state", "prior_state", "movers", "moe"]]


def load_zhvi_annual(path):
    df = pd.read_csv(path)
    date_cols = [c for c in df.columns if c[:4].isdigit()]
    long = df.melt(id_vars=["RegionName"], value_vars=date_cols,
                    var_name="date", value_name="zhvi")
    long["year"] = long["date"].str[:4].astype(int)
    annual = (
        long.groupby(["RegionName", "year"], as_index=False)["zhvi"]
        .mean()
        .rename(columns={"RegionName": "state"})
    )
    annual["zhvi"] = annual["zhvi"].round(0)
    return annual


def main():
    frames = [
        parse_matrix_year(f"{RAW_DIR}/census_migration/{yr}.{ext}", yr)
        for yr, ext in MATRIX_YEARS.items()
    ]
    frames += [
        parse_tidy_year(f"{RAW_DIR}/census_migration/{yr}.{ext}", yr)
        for yr, ext in TIDY_YEARS.items()
    ]
    panel = pd.concat(frames, ignore_index=True)
    panel["movers"] = panel["movers"].astype(int)

    panel["current_region"] = panel["current_state"].map(REGION)
    panel["prior_region"] = panel["prior_state"].map(REGION)

    zhvi = load_zhvi_annual(f"{RAW_DIR}/zhvi_state.csv")
    panel = panel.merge(
        zhvi.rename(columns={"state": "current_state", "zhvi": "current_zhvi"}),
        on=["current_state", "year"], how="left",
    )
    panel = panel.merge(
        zhvi.rename(columns={"state": "prior_state", "zhvi": "prior_zhvi"}),
        on=["prior_state", "year"], how="left",
    )

    cols = [
        "year", "current_state", "current_region", "prior_state", "prior_region",
        "movers", "moe", "current_zhvi", "prior_zhvi",
    ]
    panel = panel[cols].sort_values(["year", "current_state", "prior_state"]).reset_index(drop=True)

    panel.to_csv(OUT_PATH, index=False)
    print(f"wrote {OUT_PATH}: {len(panel)} rows, {panel.shape[1]} columns, "
          f"{panel.year.nunique()} years, {panel.current_state.nunique()} states")


if __name__ == "__main__":
    main()

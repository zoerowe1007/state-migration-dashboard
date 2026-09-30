"""
Converts data/processed/state_migration_cost_panel.csv into a compact,
columnar JSON file the browser fetches once and filters entirely in memory
(data/site_data.json). Categorical columns (state, region) are encoded as
small integer indices into lookup arrays, so ~50k rows stay small and fast
to filter with typed arrays.

It also packs the supplementary tables from prepare_context.py into site_data.json
("context": population, income, price parities, rent, CPI, mortgage rates) and writes the
IRS state-to-state flows to data/irs_flows.json.

Run with: uv run python data/build_site_data.py
"""

import json
import pandas as pd

df = pd.read_csv("data/processed/state_migration_cost_panel.csv")

states = sorted(set(df.current_state) | set(df.prior_state))
regions = sorted(set(df.current_region.dropna()) | set(df.prior_region.dropna()))
state_index = {s: i for i, s in enumerate(states)}
region_index = {r: i for i, r in enumerate(regions)}


def nullable_num(series, round_to=None):
    out = []
    for v in series:
        if pd.isna(v):
            out.append(None)
        else:
            out.append(round(float(v), round_to) if round_to is not None else int(v))
    return out


payload = {
    "meta": {
        "source": "Census ACS State-to-State Migration Flows + Zillow ZHVI",
        "rows": len(df),
        "years": sorted(int(y) for y in df.year.unique()),
    },
    "lookups": {"states": states, "regions": regions},
    "rows": {
        "year": [int(y) for y in df.year],
        "current_state": [state_index[s] for s in df.current_state],
        "current_region": [region_index[r] for r in df.current_region],
        "prior_state": [state_index[s] for s in df.prior_state],
        "prior_region": [region_index[r] for r in df.prior_region],
        "movers": [int(v) for v in df.movers],
        "moe": nullable_num(df.moe),
        "current_zhvi": nullable_num(df.current_zhvi),
        "prior_zhvi": nullable_num(df.prior_zhvi),
    },
}

# ---- supplementary context (state x year grids, state-major: index = state_index * n_years + year_index) ----
ctx = pd.read_csv("data/processed/state_year_context.csv")
yr = pd.read_csv("data/processed/year_context.csv").set_index("year")
ctx_years = [int(y) for y in yr.index]
grid = pd.MultiIndex.from_product([states, ctx_years], names=["state", "year"])
ctx = ctx.set_index(["state", "year"]).reindex(grid)


def grid_values(col, round_to=None):
    return nullable_num(ctx[col], round_to)


payload["context"] = {
    "years": ctx_years,
    "population": grid_values("population"),
    "median_income": grid_values("median_income"),
    "rpp_all": grid_values("rpp_all", 3),
    "rpp_housing": grid_values("rpp_housing", 3),
    "rent": grid_values("rent"),
    "rent_metros": grid_values("rent_metros"),
    "cpi": [float(v) for v in yr.cpi],
    "mortgage_rate": [round(float(v), 3) for v in yr.mortgage_rate_30yr],
}

out_path = "data/site_data.json"
with open(out_path, "w") as f:
    json.dump(payload, f, separators=(",", ":"))

import os

size_kb = os.path.getsize(out_path) / 1024
print(f"wrote {out_path}: {len(df)} rows, {len(states)} states, {len(regions)} regions, {size_kb:.0f} KB")


# ---- IRS state-to-state flows (separate file; only the dashboard/report sections that use it fetch it) ----
irs = pd.read_csv("data/processed/irs_state_flows.csv")
periods = sorted(irs.period.unique())
irs_payload = {
    "meta": {"source": "IRS SOI state-to-state migration (tax returns)", "rows": len(irs), "periods": periods},
    "lookups": {"states": states},
    "rows": {
        "period": [periods.index(p) for p in irs.period],
        "current_state": [state_index[x] for x in irs.current_state],
        "prior_state": [state_index[x] for x in irs.prior_state],
        "returns": [int(v) for v in irs.returns],
        "people": [int(v) for v in irs.people],
        "agi_thousands": [int(v) for v in irs.agi_thousands],
    },
}
with open("data/irs_flows.json", "w") as f:
    json.dump(irs_payload, f, separators=(",", ":"))
print(f"wrote data/irs_flows.json: {len(irs)} rows, {os.path.getsize('data/irs_flows.json') / 1024:.0f} KB")

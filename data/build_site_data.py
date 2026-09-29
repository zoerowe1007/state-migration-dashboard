"""
Converts data/processed/state_migration_cost_panel.csv into a compact,
columnar JSON file the browser fetches once and filters entirely in memory
(data/site_data.json). Categorical columns (state, region) are encoded as
small integer indices into lookup arrays, so ~50k rows stay small and fast
to filter with typed arrays.

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

out_path = "data/site_data.json"
with open(out_path, "w") as f:
    json.dump(payload, f, separators=(",", ":"))

import os

size_kb = os.path.getsize(out_path) / 1024
print(f"wrote {out_path}: {len(df)} rows, {len(states)} states, {len(regions)} regions, {size_kb:.0f} KB")

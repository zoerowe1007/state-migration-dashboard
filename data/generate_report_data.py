"""Builds assets/data/report_data.json: every number and chart series used by
index.html. Run after prepare_data.py. Keeping this as a separate build step
means every number on the report page traces back to one script and the raw
data, per the assignment's reproducibility requirement.
"""

import json
import pandas as pd

df = pd.read_csv("data/processed/state_migration_cost_panel.csv")
LATEST = int(df.year.max())
YEARS = sorted(df.year.unique().tolist())

out = {}

# ---- headline numbers ----
total_latest = int(df.loc[df.year == LATEST, "movers"].sum())
net_latest = (
    df[df.year == LATEST].groupby("current_state").movers.sum()
    - df[df.year == LATEST].groupby("prior_state").movers.sum()
).dropna()
top_gainer_state = net_latest.idxmax()
top_gainer_value = int(net_latest.max())

d2024 = df[(df.year == LATEST)].dropna(subset=["current_zhvi", "prior_zhvi"]).copy()
d2024["gap"] = d2024["current_zhvi"] - d2024["prior_zhvi"]
cheaper_share_latest = float(d2024.loc[d2024.gap < 0, "movers"].sum() / d2024["movers"].sum())

zhvi_by_state_year = df.drop_duplicates(["year", "current_state"])[["year", "current_state", "current_zhvi"]]
piv = zhvi_by_state_year.pivot(index="current_state", columns="year", values="current_zhvi")
national_median_2005 = float(piv[2005].median())
national_median_latest = float(piv[LATEST].median())
national_median_change_pct = (national_median_latest - national_median_2005) / national_median_2005 * 100

out["headline"] = {
    "latest_year": LATEST,
    "total_movers_latest": total_latest,
    "top_gainer_state": top_gainer_state,
    "top_gainer_value": top_gainer_value,
    "cheaper_share_latest_pct": round(cheaper_share_latest * 100, 1),
    "national_median_home_value_latest": round(national_median_latest),
    "national_median_home_value_change_pct": round(national_median_change_pct, 1),
}

# ---- section 1: national trend ----
by_year = df.groupby("year").movers.sum().reindex(YEARS)
out["national_trend"] = {"years": YEARS, "movers": [int(v) for v in by_year.values]}
out["national_trend_stats"] = {
    "min_year": int(by_year.idxmin()), "min_value": int(by_year.min()),
    "max_year": int(by_year.idxmax()), "max_value": int(by_year.max()),
    "avg_value": round(by_year.mean()),
}

# ---- section 2: regional net migration over time ----
regions = ["Northeast", "Midwest", "South", "West"]
region_in = df.groupby(["year", "current_region"]).movers.sum().unstack()
region_out = df.groupby(["year", "prior_region"]).movers.sum().unstack()
region_net = (region_in - region_out)[regions].reindex(YEARS)
out["region_trend"] = {
    "years": YEARS,
    "series": {r: [int(v) for v in region_net[r].values] for r in regions},
}
out["region_trend_stats"] = {
    "south_total": int(region_net["South"].sum()),
    "west_2024": int(region_net.loc[LATEST, "West"]),
    "northeast_total": int(region_net["Northeast"].sum()),
    "midwest_total": int(region_net["Midwest"].sum()),
}

# ---- section 3: top gainers / losers, 5-year average ----
recent = df[df.year >= LATEST - 4]
net5 = (
    recent.groupby("current_state").movers.sum() - recent.groupby("prior_state").movers.sum()
).dropna().sort_values(ascending=False)
top5 = net5.head(5)
bottom5 = net5.tail(5).iloc[::-1]
out["gainers_losers"] = {
    "period": f"{LATEST - 4}-{LATEST}",
    "states": [*top5.index, *bottom5.index],
    "values": [int(v) for v in [*top5.values, *bottom5.values]],
}

# ---- section 4: top single state-to-state flows, latest year ----
d = df[df.year == LATEST].sort_values("movers", ascending=False).head(8)
out["top_flows"] = {
    "labels": [f"{r.prior_state} → {r.current_state}" for r in d.itertuples()],
    "values": [int(v) for v in d.movers],
}

# ---- section 5: share of movers headed to a cheaper state, over time ----
cheaper_by_year = []
for yr in YEARS:
    g = df[df.year == yr].dropna(subset=["current_zhvi", "prior_zhvi"]).copy()
    g["gap"] = g["current_zhvi"] - g["prior_zhvi"]
    cheaper_by_year.append(float(g.loc[g.gap < 0, "movers"].sum() / g["movers"].sum() * 100))
out["cheaper_share_trend"] = {"years": YEARS, "pct": [round(v, 1) for v in cheaper_by_year]}

# ---- section 6: movers-weighted cost gap over time ----
gap_by_year = []
for yr in YEARS:
    g = df[df.year == yr].dropna(subset=["current_zhvi", "prior_zhvi"]).copy()
    g["gap"] = g["current_zhvi"] - g["prior_zhvi"]
    gap_by_year.append(round((g["gap"] * g["movers"]).sum() / g["movers"].sum()))
out["cost_gap_trend"] = {"years": YEARS, "gap": gap_by_year}
out["cost_gap_stats"] = {
    "gap_2019": gap_by_year[YEARS.index(2019)],
    "gap_latest": gap_by_year[-1],
    "gap_2021": gap_by_year[YEARS.index(2021)],
}

# ---- section 7: home value change by state, 2005 -> latest ----
change = ((piv[LATEST] - piv[2005]) / piv[2005] * 100).dropna().sort_values(ascending=False)
top8 = change.head(8)
bottom8 = change.tail(8)
out["home_value_change"] = {
    "states": [*top8.index, *bottom8.index],
    "pct": [round(v, 1) for v in [*top8.values, *bottom8.values]],
}

# ---- section 8: Puerto Rico outflow over time ----
pr_out = df[df.prior_state == "Puerto Rico"].groupby("year").movers.sum().reindex(YEARS)
out["pr_outflow"] = {"years": YEARS, "movers": [int(v) if pd.notna(v) else None for v in pr_out.values]}
out["pr_outflow_stats"] = {
    "2017": int(pr_out.loc[2017]), "2018": int(pr_out.loc[2018]),
    "pct_increase": round((pr_out.loc[2018] - pr_out.loc[2017]) / pr_out.loc[2017] * 100, 1),
}

with open("assets/data/report_data.json", "w") as f:
    json.dump(out, f, indent=2)

print(json.dumps(out, indent=2))

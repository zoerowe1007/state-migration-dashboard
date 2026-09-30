"""
Independently recomputes every headline number, KPI, and chart total shown on
the report (index.html) and dashboard (dashboard.html) directly from
data/processed/state_migration_cost_panel.csv, and prints a PASS/FAIL summary
against the values currently hardcoded in the report prose and the values
the dashboard shows with all filters cleared.

This exists to catch the report text drifting from the data (e.g. after a
re-run of prepare_data.py) rather than to be run automatically on every build.

Run with: uv run python data/validate.py
"""

import pandas as pd

df = pd.read_csv("data/processed/state_migration_cost_panel.csv")
LATEST = int(df.year.max())

results = []


def check(label, actual, expected, tol=0.0, fmt=lambda v: str(v)):
    ok = abs(actual - expected) <= tol if isinstance(expected, (int, float)) else actual == expected
    results.append((ok, label, fmt(actual), fmt(expected)))


fmt_int = lambda v: f"{v:,.0f}"
fmt_money = lambda v: f"${v:,.0f}"
fmt_pct = lambda v: f"{v:.1f}%"

# ---- Stop 1: national trend low/high ----
by_year = df.groupby("year").movers.sum()
check("National movers, 2010 (low point)", by_year.loc[2010], 6_830_000, tol=10_000, fmt=fmt_int)
check("National movers, 2022 (high point)", by_year.loc[2022], 8_300_000, tol=10_000, fmt=fmt_int)

# ---- Stop 2: region net migration, cumulative across all years ----
region_in = df.groupby("current_region").movers.sum()
region_out = df.groupby("prior_region").movers.sum()
region_net = region_in.subtract(region_out, fill_value=0)
check("South cumulative net migration (2005-latest)", region_net.get("South", 0), 8_700_000, tol=100_000, fmt=fmt_int)
check("Northeast cumulative net migration (2005-latest)", region_net.get("Northeast", 0), -5_000_000, tol=100_000, fmt=fmt_int)
check("Midwest cumulative net migration (2005-latest)", region_net.get("Midwest", 0), -2_500_000, tol=100_000, fmt=fmt_int)

west_in_2024 = df[(df.year == 2024) & (df.current_region == "West")].movers.sum()
west_out_2024 = df[(df.year == 2024) & (df.prior_region == "West")].movers.sum()
check("West net migration, 2024", west_in_2024 - west_out_2024, -148_000, tol=1_000, fmt=fmt_int)

# ---- Stop 3: 5-year net migration by state (LATEST-4 .. LATEST, summed not averaged) ----
recent = df[df.year >= LATEST - 4]
state_in = recent.groupby("current_state").movers.sum()
state_out = recent.groupby("prior_state").movers.sum()
state_net = state_in.subtract(state_out, fill_value=0).sort_values(ascending=False)
check("Florida net migration, 5-yr window (sum, not average)", state_net.get("Florida", 0), 667_000, tol=1_000, fmt=fmt_int)
check("Texas net migration, 5-yr window (sum, not average)", state_net.get("Texas", 0), 534_000, tol=1_000, fmt=fmt_int)
check("California net migration, 5-yr window (sum, not average)", state_net.get("California", 0), -1_270_000, tol=5_000, fmt=fmt_int)
check("New York net migration, 5-yr window (sum, not average)", state_net.get("New York", 0), -835_000, tol=1_000, fmt=fmt_int)

check("Third-largest 5-yr net loser is Illinois (-438,000)", state_net.get("Illinois", 0), -438_000, tol=1_000, fmt=fmt_int)

# ---- Stop 4: busiest single route, latest year ----
flows_latest = df[df.year == LATEST].groupby(["prior_state", "current_state"]).movers.sum()
ca_tx = flows_latest.get(("California", "Texas"), 0)
check("California -> Texas movers, 2024", ca_tx, 77_161, tol=1, fmt=fmt_int)
check("Busiest route in 2024 is California -> Texas", flows_latest.idxmax() == ("California", "Texas"), True)
check("Texas -> California movers, 2024 (the reverse trip)", flows_latest.get(("Texas", "California"), 0), 45_447, tol=1, fmt=fmt_int)
check("CA->TX minus TX->CA, 2024 ('about 31,700 more')", ca_tx - flows_latest.get(("Texas", "California"), 0), 31_700, tol=100, fmt=fmt_int)

# ---- Stop 5: share of movers to a cheaper state ----
priced = df.dropna(subset=["current_zhvi", "prior_zhvi"])
cheaper_2024 = priced[(priced.year == LATEST) & (priced.current_zhvi < priced.prior_zhvi)].movers.sum()
total_2024 = priced[priced.year == LATEST].movers.sum()
check("Share moving to a cheaper state, 2024", 100 * cheaper_2024 / total_2024, 53.5, tol=0.05, fmt=fmt_pct)

# ---- Stop 6: movers-weighted home value gap ----
def weighted_gap(year):
    rows = priced[priced.year == year]
    return ((rows.current_zhvi - rows.prior_zhvi) * rows.movers).sum() / rows.movers.sum()

check("Weighted home value gap, 2019", weighted_gap(2019), -10_895, tol=200, fmt=fmt_money)
check("Weighted home value gap, 2021", weighted_gap(2021), -24_899, tol=200, fmt=fmt_money)
check("Weighted home value gap, 2024", weighted_gap(LATEST), -19_541, tol=10, fmt=fmt_money)
check("Gap 2024 / gap 2019 ('79% wider')", weighted_gap(LATEST) / weighted_gap(2019), 1.79, tol=0.01, fmt=lambda v: f"{v:.2f}x")
check("Gap 2021 / gap 2019 ('more than doubled')", weighted_gap(2021) / weighted_gap(2019), 2.29, tol=0.02, fmt=lambda v: f"{v:.2f}x")

# ---- Stop 7: home value change, 2005 to latest, by state ----
zhvi_by_state_year = df.dropna(subset=["current_zhvi"]).drop_duplicates(["current_state", "year"]).set_index(["current_state", "year"]).current_zhvi
def pct_change(state):
    try:
        return 100 * (zhvi_by_state_year[(state, LATEST)] - zhvi_by_state_year[(state, 2005)]) / zhvi_by_state_year[(state, 2005)]
    except KeyError:
        return None

check("Home value change 2005-latest, Idaho", pct_change("Idaho"), 191.0, tol=3.0, fmt=fmt_pct)
check("Home value change 2005-latest, Utah", pct_change("Utah"), 178.0, tol=3.0, fmt=fmt_pct)
check("Home value change 2005-latest, Montana", pct_change("Montana"), 174.0, tol=3.0, fmt=fmt_pct)
check("Home value change 2005-latest, Illinois", pct_change("Illinois"), 37.0, tol=3.0, fmt=fmt_pct)
check("Home value change 2005-latest, Nevada", pct_change("Nevada"), 41.0, tol=3.0, fmt=fmt_pct)

# ---- Stop 7: do the fastest-rising markets gain people, the slowest lose them? ----
change = pd.Series({st: pct_change(st) for st in zhvi_by_state_year.index.get_level_values(0).unique()}).dropna().sort_values()
net_all = (df.groupby("current_state").movers.sum() - df.groupby("prior_state").movers.sum())
check("Of the 8 fastest-rising states, number that are net gainers", int((net_all[change.index[-8:]] > 0).sum()), 8)
check("Of the 8 slowest-rising states, number that are net losers", int((net_all[change.index[:8]] < 0).sum()), 6)
check("Illinois cumulative net migration (-1.8 million)", net_all["Illinois"], -1_800_000, tol=10_000, fmt=fmt_int)
check("Nevada cumulative net migration (+446,000)", net_all["Nevada"], 447_000, tol=1_000, fmt=fmt_int)

# ---- Stop 8: Puerto Rico outflow ----
pr_out = df[df.prior_state == "Puerto Rico"].groupby("year").movers.sum()
check("Puerto Rico outflow, 2018", pr_out.get(2018, 0), 133_451, tol=1, fmt=fmt_int)
check("Puerto Rico outflow, 2017", pr_out.get(2017, 0), 97_488, tol=1, fmt=fmt_int)
check("Puerto Rico 2018 is its highest year on record", pr_out.idxmax(), 2018)
check("Puerto Rico 2018 vs 2017 (+37%)", 100 * (pr_out[2018] / pr_out[2017] - 1), 37.0, tol=0.5, fmt=fmt_pct)

# ---- Headline numbers block and summary paragraph ----
check("Headline: total movers 2005-2024", df.movers.sum(), 142_101_872, tol=1, fmt=fmt_int)
check("Headline: movers in 2024", by_year.loc[LATEST], 7_188_344, tol=1, fmt=fmt_int)
check("Headline: 2024 is 13% below the 2022 peak", 100 * (1 - by_year.loc[LATEST] / by_year.loc[2022]), 13.0, tol=0.5, fmt=fmt_pct)
check("Average movers per survey year (7.5 million)", by_year.mean(), 7_500_000, tol=50_000, fmt=fmt_int)
check("Survey years in the data (2020 absent)", df.year.nunique(), 19)
check("Places in the data (50 states + DC + PR)", df.current_state.nunique(), 52)

# ---- About-the-data section ----
check("Rows", len(df), 50_109)
check("Columns", df.shape[1], 9)
unusable = len(df) - len(priced)
check("Rows without both home values ('2,314 rows, 4.6%')", unusable, 2_314)
check("...as a share of all rows", 100 * unusable / len(df), 4.6, tol=0.05, fmt=fmt_pct)
check("North Dakota ZHVI starts in 2009", int(df[(df.current_state == "North Dakota") & df.current_zhvi.notna()].year.min()), 2009)
check("Puerto Rico has no ZHVI in any year", int(df[df.current_state == "Puerto Rico"].current_zhvi.notna().sum()), 0)
# ---- 2024 consistency (the 2024 file is laid out differently from 2005-2023) ----
per_year = df.groupby("year").size()
check("2024 keeps D.C. as an origin (stray trailing space once dropped 43 rows)", int(((df.year == 2024) & (df.prior_state == "District of Columbia")).sum()), 43)
check("2024 route count (2,652 minus 279 Census 'N' suppressions)", int(per_year[2024]), 2_373)
a23 = df[df.year == 2023].set_index(["current_state", "prior_state"]).movers
a24 = df[df.year == 2024].set_index(["current_state", "prior_state"]).movers
both = a23.index.intersection(a24.index)
check("Routes Census suppressed in 2024 but reported in 2023", len(a23.index.difference(a24.index)), 279)
check("...their 2023 movers ('about 71,000')", int(a23.loc[a23.index.difference(a24.index)].sum()), 71_000, tol=1_000, fmt=fmt_int)
check("Like-for-like change in movers 2023 to 2024 (-4.8%)", 100 * (a24.loc[both].sum() / a23.loc[both].sum() - 1), -4.8, tol=0.1, fmt=fmt_pct)

# ---- Margin of error ----
reliable = (df.moe / df.movers) <= 0.30
check("Rows with margin of error above 30% of the estimate", 100 * (~reliable).mean(), 88.6, tol=0.1, fmt=fmt_pct)
check("CA->TX margin of error (+/-9,059)", int(df[(df.year == LATEST) & (df.prior_state == "California") & (df.current_state == "Texas")].moe.iloc[0]), 9_059)
check("CA->TX margin of error as share of estimate (12%)", 100 * 9_059 / 77_161, 12.0, tol=0.5, fmt=fmt_pct)
check("...their share of all movers", 100 * df.movers[~reliable].sum() / df.movers.sum(), 41.7, tol=0.1, fmt=fmt_pct)

check("No same-state rows", int((df.current_state == df.prior_state).sum()), 0)
check("No duplicate (year, origin, destination) rows", int(df.duplicated(["year", "current_state", "prior_state"]).sum()), 0)

# ---- Dashboard default KPIs (all filters cleared) ----
check("Dashboard: total movers, all rows", df.movers.sum(), 142_101_872, tol=1, fmt=fmt_int)
check("Dashboard: routes in view, all rows", len(df), 50_109, tol=0, fmt=fmt_int)
check("Dashboard: median destination home value, all rows", df.current_zhvi.dropna().median(), 212_715, tol=5, fmt=fmt_money)
check(
    "Dashboard: share moved to cheaper state, all rows",
    100 * priced[priced.current_zhvi < priced.prior_zhvi].movers.sum() / priced.movers.sum(),
    53.2,
    tol=0.05,
    fmt=fmt_pct,
)

# ---- report ----
passed = sum(1 for ok, *_ in results if ok)
print(f"\n{'PASS' if passed == len(results) else 'FAIL'}  {passed}/{len(results)} checks passed\n")
for ok, label, actual, expected in results:
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {label:55s} got {actual:>14s}  (report says {expected})")

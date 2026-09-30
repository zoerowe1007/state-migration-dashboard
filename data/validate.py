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

# Stop 6 is stated in 2024 dollars, so restate each year's gap with CPI-U
yrctx = pd.read_csv("data/processed/year_context.csv").set_index("year")
def real_factor(year):
    return yrctx.cpi[LATEST] / yrctx.cpi[year]
check("Gap 2019 in 2024 dollars", weighted_gap(2019) * real_factor(2019), -13_366, tol=10, fmt=fmt_money)
check("Gap 2021 in 2024 dollars", weighted_gap(2021) * real_factor(2021), -28_822, tol=10, fmt=fmt_money)
check("Gap 2024 / gap 2019, real ('46% wider')", weighted_gap(LATEST) * real_factor(LATEST) / (weighted_gap(2019) * real_factor(2019)), 1.46, tol=0.01, fmt=lambda v: f"{v:.2f}x")
check("Gap 2021 / gap 2019, real ('more than doubled')", (weighted_gap(2021) * real_factor(2021)) / (weighted_gap(2019) * real_factor(2019)), 2.16, tol=0.02, fmt=lambda v: f"{v:.2f}x")
check("CPI-U rise 2005 to 2024 ('61%')", 100 * (yrctx.cpi[LATEST] / yrctx.cpi[2005] - 1), 61.0, tol=0.6, fmt=fmt_pct)
check("Hero chart gap 2024 equals nominal gap (factor 1)", weighted_gap(LATEST) * real_factor(LATEST), weighted_gap(LATEST), tol=0.001, fmt=fmt_money)

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

def real_change(state):
    nominal = pct_change(state)
    return None if nominal is None else 100 * ((1 + nominal / 100) / (yrctx.cpi[LATEST] / yrctx.cpi[2005]) - 1)
check("Real home value change 2005-latest, Idaho (+81%)", real_change("Idaho"), 81.0, tol=1.0, fmt=fmt_pct)
check("Real home value change 2005-latest, Utah (+73%)", real_change("Utah"), 73.0, tol=1.0, fmt=fmt_pct)
check("Real home value change 2005-latest, Montana (+70%)", real_change("Montana"), 70.0, tol=1.0, fmt=fmt_pct)
check("Real home value change 2005-latest, Illinois (-15%)", real_change("Illinois"), -15.0, tol=1.0, fmt=fmt_pct)
check("Real home value change 2005-latest, Nevada (-13%)", real_change("Nevada"), -13.0, tol=1.0, fmt=fmt_pct)
check("Real home value change 2005-latest, Connecticut (-12%)", real_change("Connecticut"), -12.0, tol=1.0, fmt=fmt_pct)
check("Real home value change 2005-latest, Maryland (-11%)", real_change("Maryland"), -11.0, tol=1.0, fmt=fmt_pct)
_states_both = [st for st in zhvi_by_state_year.index.get_level_values(0).unique() if pct_change(st) is not None]
check("Places with data in both years", len(_states_both), 50)
check("...of which below their 2005 value after inflation ('eight')", sum(real_change(st) < 0 for st in _states_both), 8)

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

# ======================================================================
# Supplementary tables (prepare_context.py) and Stops 9-13
# ======================================================================
ctx = pd.read_csv("data/processed/state_year_context.csv")
irs = pd.read_csv("data/processed/irs_state_flows.csv")
ctx_i = ctx.set_index(["state", "year"])
survey_years = sorted(df.year.unique())

check("Context rows (52 places x 20 years)", len(ctx), 1_040)
check("Population missing only for Puerto Rico 2005-2009", int(ctx.population.isna().sum()), 5)
check("Income missing only for Puerto Rico", int(ctx.median_income.isna().sum()), 20)
check("Price parities cover 51 places x 17 years (2008-2024)", int(ctx.rpp_all.notna().sum()), 867)
check("Texas population 2024 (Census, 31,290,831)", int(ctx_i.population[("Texas", 2024)]), 31_290_831)
check("CPI-U 2005 (BLS annual average)", yrctx.cpi[2005], 195.3, tol=0.01)
check("CPI-U 2024 (BLS annual average)", yrctx.cpi[2024], 313.7, tol=0.01)
check("30-year mortgage rate, 2021 average (2.96%)", yrctx.mortgage_rate_30yr[2021], 2.96, tol=0.01, fmt=lambda v: f"{v:.2f}%")
check("30-year mortgage rate, 2024 average (6.72%)", yrctx.mortgage_rate_30yr[2024], 6.72, tol=0.01, fmt=lambda v: f"{v:.2f}%")

# ---- Stop 9: migration per 1,000 residents, 2020-2024 (annual average over the four survey years) ----
win = [y for y in survey_years if y >= LATEST - 4]
w_df = df[df.year >= LATEST - 4]
net_w = w_df.groupby("current_state").movers.sum().subtract(w_df.groupby("prior_state").movers.sum(), fill_value=0)
pop_w = pd.Series({st: sum(ctx_i.population[(st, y)] for y in win) for st in net_w.index})
per_k = (1000 * net_w / pop_w).sort_values(ascending=False)
rank = per_k.rank(ascending=False)
check("Places ranked", len(per_k), 52)
check("Vermont net per 1,000 (13.4)", per_k["Vermont"], 13.4, tol=0.05, fmt=lambda v: f"{v:.2f}")
check("South Carolina net per 1,000 (12.6)", per_k["South Carolina"], 12.6, tol=0.05, fmt=lambda v: f"{v:.2f}")
check("Idaho net per 1,000 (11.0)", per_k["Idaho"], 11.0, tol=0.05, fmt=lambda v: f"{v:.2f}")
check("Florida net per 1,000 (7.4) and rank 11", per_k["Florida"], 7.4, tol=0.05, fmt=lambda v: f"{v:.2f}")
check("Florida rank by rate", int(rank["Florida"]), 11)
check("Texas net per 1,000 (4.4) and rank 17", per_k["Texas"], 4.4, tol=0.05, fmt=lambda v: f"{v:.2f}")
check("Texas rank by rate", int(rank["Texas"]), 17)
check("New York net per 1,000 (-10.5), rank 52", per_k["New York"], -10.5, tol=0.05, fmt=lambda v: f"{v:.2f}")
check("New York rank", int(rank["New York"]), 52)
check("Illinois net per 1,000 (-8.6), rank 51", per_k["Illinois"], -8.6, tol=0.05, fmt=lambda v: f"{v:.2f}")
check("Illinois rank", int(rank["Illinois"]), 51)
check("California net per 1,000 (-8.1), rank 50", per_k["California"], -8.1, tol=0.05, fmt=lambda v: f"{v:.2f}")
check("California rank", int(rank["California"]), 50)
check("Top three by rate are VT, SC, ID", list(per_k.index[:3]) == ["Vermont", "South Carolina", "Idaho"], True)

# ---- Stop 10: Regional Price Parities ----
def rpp_stats(col, year):
    x = df[df.year == year].copy()
    x["c"] = [ctx_i[col].get((st, year), float("nan")) for st in x.current_state]
    x["p"] = [ctx_i[col].get((st, year), float("nan")) for st in x.prior_state]
    x = x.dropna(subset=["c", "p"])
    return 100 * x.loc[x.c < x.p, "movers"].sum() / x.movers.sum(), ((x.c - x.p) * x.movers).sum() / x.movers.sum()
check("Share moving to a lower price level (RPP), 2024", rpp_stats("rpp_all", 2024)[0], 54.3, tol=0.05, fmt=fmt_pct)
_rpp_shares = [rpp_stats("rpp_all", y)[0] for y in survey_years if y >= 2008]
check("RPP share, lowest year since 2008 (52.2%)", min(_rpp_shares), 52.2, tol=0.05, fmt=fmt_pct)
check("RPP share, highest year since 2008 (57.2%)", max(_rpp_shares), 57.2, tol=0.05, fmt=fmt_pct)
check("Mover-weighted RPP gap, 2024 (-0.9 points)", rpp_stats("rpp_all", 2024)[1], -0.9, tol=0.05, fmt=lambda v: f"{v:.2f}")
check("Mover-weighted RPP gap, 2021 (-1.7 points)", rpp_stats("rpp_all", 2021)[1], -1.7, tol=0.05, fmt=lambda v: f"{v:.2f}")
check("Mover-weighted housing RPP gap, 2024 (-3.4 points)", rpp_stats("rpp_housing", 2024)[1], -3.4, tol=0.05, fmt=lambda v: f"{v:.2f}")
check("Share moving to a cheaper state by home value, 2024 (53.5%)", 100 * cheaper_2024 / total_2024, 53.5, tol=0.05, fmt=fmt_pct)
check("North Dakota has price parities in 2008", int(ctx_i.rpp_all.get(("North Dakota", 2008)) is not None and ctx_i.rpp_all[("North Dakota", 2008)] > 0), 1)

# ---- Stop 11: price-to-income ----
zhvi_si = df.dropna(subset=["current_zhvi"]).drop_duplicates(["current_state", "year"]).set_index(["current_state", "year"]).current_zhvi
pti = (zhvi_si / ctx_i.median_income.reindex(zhvi_si.index)).dropna()
pti_med = pti.groupby(level=1).median()
check("Typical-state price-to-income, 2005 (3.85)", pti_med[2005], 3.85, tol=0.005, fmt=lambda v: f"{v:.2f}")
check("Typical-state price-to-income, 2012 (3.20)", pti_med[2012], 3.20, tol=0.005, fmt=lambda v: f"{v:.2f}")
check("Typical-state price-to-income, 2022 (4.44), its peak", pti_med[2022], 4.44, tol=0.005, fmt=lambda v: f"{v:.2f}")
check("Peak year of typical-state ratio", int(pti_med.idxmax()), 2022)
check("Typical-state price-to-income, 2024 (4.17)", pti_med[2024], 4.17, tol=0.005, fmt=lambda v: f"{v:.2f}")
p24 = pti.xs(2024, level=1)
check("Iowa price-to-income, 2024 (2.64)", p24["Iowa"], 2.64, tol=0.005, fmt=lambda v: f"{v:.2f}")
check("Hawaii price-to-income, 2024 (8.59)", p24["Hawaii"], 8.59, tol=0.005, fmt=lambda v: f"{v:.2f}")
check("California price-to-income, 2024 (7.65)", p24["California"], 7.65, tol=0.005, fmt=lambda v: f"{v:.2f}")
check("Lowest ratio in 2024 is Iowa, highest Hawaii", (p24.idxmin(), p24.idxmax()) == ("Iowa", "Hawaii"), True)
m = df[df.year == 2024].copy()
m["ci"] = [ctx_i.median_income.get((st, 2024), float("nan")) for st in m.current_state]
m["pi"] = [ctx_i.median_income.get((st, 2024), float("nan")) for st in m.prior_state]
m = m.dropna(subset=["current_zhvi", "prior_zhvi", "ci", "pi"])
m["cr"], m["pr"] = m.current_zhvi / m.ci, m.prior_zhvi / m.pi
check("Movers-weighted destination ratio, 2024 (4.57)", (m.cr * m.movers).sum() / m.movers.sum(), 4.57, tol=0.005, fmt=lambda v: f"{v:.2f}")
check("Movers-weighted origin ratio, 2024 (4.70)", (m.pr * m.movers).sum() / m.movers.sum(), 4.70, tol=0.005, fmt=lambda v: f"{v:.2f}")
check("Share of movers to a lower-ratio state, 2024 (52.7%)", 100 * m.loc[m.cr < m.pr, "movers"].sum() / m.movers.sum(), 52.7, tol=0.05, fmt=fmt_pct)

# ---- Stop 12: monthly cost ----
def payment(value, rate_pct, down=0.2, years=30):
    r = rate_pct / 1200
    return value * (1 - down) * r / (1 - (1 + r) ** (-years * 12))
def typical_payment(year, rate=None):
    z = zhvi_si.xs(year, level=1)
    return payment(z, yrctx.mortgage_rate_30yr[year] if rate is None else rate)
pay21, pay24 = typical_payment(2021).median() * real_factor(2021), typical_payment(2024).median()
check("Typical monthly payment 2021, in 2024 dollars ($1,139)", pay21, 1_139, tol=1, fmt=fmt_money)
check("Typical monthly payment 2024 ($1,751)", pay24, 1_751, tol=1, fmt=fmt_money)
check("Payment increase 2021 to 2024 in real terms (+54%)", 100 * (pay24 / pay21 - 1), 54.0, tol=0.5, fmt=fmt_pct)
check("2024 price at the 2021 rate ($1,135)", typical_payment(2024, yrctx.mortgage_rate_30yr[2021]).median(), 1_135, tol=1, fmt=fmt_money)
def income_share(year):
    z = zhvi_si.xs(year, level=1)
    inc = ctx_i.median_income.xs(year, level=1).reindex(z.index)
    return (typical_payment(year) * 12 / inc * 100).median()
check("Payment as share of median income, 2021 (16.6%)", income_share(2021), 16.6, tol=0.05, fmt=fmt_pct)
check("Payment as share of median income, 2024 (25.9%)", income_share(2024), 25.9, tol=0.05, fmt=fmt_pct)
check("Typical rent, 2024 ($1,409)", ctx[ctx.year == 2024].rent.median(), 1_409, tol=1, fmt=fmt_money)
check("States with a rent figure in 2024", int(ctx[(ctx.year == 2024)].rent.notna().sum()), 50)

# ---- Stop 13: IRS income that moves with people (2022-23) ----
i23 = irs[irs.period == "2022-23"]
inn = i23.groupby("current_state")[["people", "agi_thousands", "returns"]].sum()
out = i23.groupby("prior_state")[["people", "agi_thousands", "returns"]].sum()
net = inn.subtract(out, fill_value=0)
check("IRS people who changed states, 2022-23 (6.6 million)", i23.people.sum(), 6_600_000, tol=50_000, fmt=fmt_int)
check("IRS AGI that moved, 2022-23 ($335 billion)", i23.agi_thousands.sum() / 1e6, 335.0, tol=0.5, fmt=lambda v: f"{v:,.1f}")
check("Florida net AGI ($20.6 billion)", net.agi_thousands["Florida"] / 1e6, 20.6, tol=0.05, fmt=lambda v: f"{v:.2f}")
check("Texas net AGI ($5.5 billion)", net.agi_thousands["Texas"] / 1e6, 5.5, tol=0.05, fmt=lambda v: f"{v:.2f}")
check("California net AGI (-$11.9 billion)", net.agi_thousands["California"] / 1e6, -11.9, tol=0.05, fmt=lambda v: f"{v:.2f}")
check("New York net AGI (-$9.9 billion)", net.agi_thousands["New York"] / 1e6, -9.9, tol=0.05, fmt=lambda v: f"{v:.2f}")
check("Florida net people (about 112,000)", net.people["Florida"], 112_000, tol=500, fmt=fmt_int)
check("Texas net people (about 112,000)", net.people["Texas"], 112_000, tol=1_000, fmt=fmt_int)
check("Florida is the top net AGI gainer", net.agi_thousands.idxmax(), "Florida")
check("Florida / Texas net AGI ('nearly four times')", net.agi_thousands["Florida"] / net.agi_thousands["Texas"], 3.7, tol=0.1, fmt=lambda v: f"{v:.1f}x")
fl_in = i23[i23.current_state == "Florida"]; fl_out = i23[i23.prior_state == "Florida"]
check("Average AGI per return moving into Florida ($122,539)", fl_in.agi_thousands.sum() * 1000 / fl_in.returns.sum(), 122_539, tol=1, fmt=fmt_money)
check("Average AGI per return leaving Florida ($76,134)", fl_out.agi_thousands.sum() * 1000 / fl_out.returns.sum(), 76_134, tol=1, fmt=fmt_money)
raw_out = pd.read_csv("data/raw/irs_soi/stateoutflow2223.csv", dtype=str, encoding="latin-1")
raw_out = raw_out[raw_out.y2_statefips.str.fullmatch(r"\d\d") & (raw_out.y2_statefips.astype(int) <= 56) & (raw_out.y1_statefips != raw_out.y2_statefips)]
check("IRS inflow and outflow files agree on total AGI, 2022-23", pd.to_numeric(raw_out.AGI).sum(), int(i23.agi_thousands.sum()), tol=0, fmt=fmt_int)
check("IRS periods loaded", irs.period.nunique(), 12)

# ---- report ----
passed = sum(1 for ok, *_ in results if ok)
print(f"\n{'PASS' if passed == len(results) else 'FAIL'}  {passed}/{len(results)} checks passed\n")
for ok, label, actual, expected in results:
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {label:55s} got {actual:>14s}  (report says {expected})")

"""
Builds the supplementary tables from the raw files downloaded by data/download_raw.sh:

  data/processed/state_year_context.csv   one row per state and year: population, median household
                                          income, Regional Price Parities, rent index
  data/processed/year_context.csv         one row per year: CPI-U and the 30-year mortgage rate
  data/processed/irs_state_flows.csv      IRS SOI state-to-state flows: returns, people, and the
                                          adjusted gross income that moved with them

The migration panel (prepare_data.py) and these tables share state names and years, so the
browser joins them on (state, year).

Run with: uv run python data/prepare_context.py
"""

import csv
import glob
import io
import os
import re
import zipfile

import numpy as np
import pandas as pd

RAW = "data/raw"
OUT = "data/processed"
YEARS = list(range(2005, 2025))

STATES = [
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
    "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
    "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
    "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
    "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
    "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah",
    "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming", "Puerto Rico",
]

STATE_ABBR = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
    "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia",
    "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}


def long_from_wide(df, name_col, value_cols, value_name):
    """Wide table (one column per year) to long (state, year, value)."""
    out = df.melt(id_vars=[name_col], value_vars=list(value_cols), var_name="year", value_name=value_name)
    out["year"] = out["year"].str.extract(r"(\d{4})")[0].astype(int)
    return out.rename(columns={name_col: "state"})


# ---------- population (Census Population Estimates, July 1 of each year) ----------

def load_population():
    # 2005-2009 from the 2000-2010 intercensal estimates (total rows only: all sexes, origins, races, ages)
    a = pd.read_csv(f"{RAW}/population/st-est00int-alldata.csv", encoding="latin-1")
    a = a[(a.SEX == 0) & (a.ORIGIN == 0) & (a.RACE == 0) & (a.AGEGRP == 0)]
    a = long_from_wide(a, "NAME", [f"POPESTIMATE{y}" for y in range(2005, 2010)], "population")
    # 2010-2019 and 2020-2024 from the Vintage 2019 and Vintage 2024 state totals (these also carry Puerto Rico)
    b = pd.read_csv(f"{RAW}/population/nst-est2019-alldata.csv", encoding="latin-1")
    b = b[b.SUMLEV == 40]
    b = long_from_wide(b, "NAME", [f"POPESTIMATE{y}" for y in range(2010, 2020)], "population")
    c = pd.read_csv(f"{RAW}/population/NST-EST2024-ALLDATA.csv", encoding="latin-1")
    c = c[c.SUMLEV == 40]
    c = long_from_wide(c, "NAME", [f"POPESTIMATE{y}" for y in range(2020, 2025)], "population")
    pop = pd.concat([a, b, c], ignore_index=True)
    return pop[pop.state.isin(STATES)]


# ---------- Regional Price Parities (BEA) ----------

def load_rpp():
    with zipfile.ZipFile(f"{RAW}/bea/SARPP.zip") as z:
        raw = z.read("SARPP_STATE_2008_2024.csv").decode("utf-8-sig")
    df = pd.read_csv(io.StringIO(raw))
    df["GeoName"] = df["GeoName"].astype(str).str.strip()
    df["LineCode"] = pd.to_numeric(df["LineCode"], errors="coerce")  # footnote rows at the end have none
    df = df[df.GeoName.isin(STATES) & df.LineCode.notna()]
    out = []
    for line, name in ((1, "rpp_all"), (3, "rpp_housing")):
        part = df[df.LineCode == line]
        out.append(long_from_wide(part, "GeoName", [str(y) for y in range(2008, 2025)], name).set_index(["state", "year"]))
    return pd.concat(out, axis=1).reset_index()


# ---------- median household income (Census CPS ASEC, table H-8, current dollars) ----------

def load_income():
    x = pd.read_excel(f"{RAW}/income/h08.xlsx", header=None)
    header = x.iloc[7].tolist()
    # First block (current dollars) ends at the row that repeats the "State" header.
    end = next(i for i in range(9, len(x)) if str(x.iat[i, 0]).strip() == "State")
    body = x.iloc[9:end]
    # Two years (2013 and 2017) appear twice because Census changed its income questions.
    # The first-listed column of each pair is the newer method; keep it.
    cols = {}
    for c, label in enumerate(header):
        m = re.match(r"(\d{4})", str(label))
        if m and c % 2 == 1 and int(m.group(1)) not in cols:
            cols[int(m.group(1))] = c
    rows = []
    for _, r in body.iterrows():
        name = re.sub(r"\s*\d+$", "", str(r[0]).strip())
        if name not in STATES:
            continue
        for y in YEARS:
            v = r[cols[y]]
            if pd.notna(v):
                rows.append((name, y, float(v)))
    return pd.DataFrame(rows, columns=["state", "year", "median_income"])


# ---------- rent (Zillow Observed Rent Index; metro level, averaged to states) ----------

def load_rent():
    z = pd.read_csv(f"{RAW}/zillow/metro_zori.csv")
    z = z[z.RegionType == "msa"].copy()
    z["state"] = z.StateName.map(STATE_ABBR)
    date_cols = [c for c in z.columns if re.match(r"\d{4}-\d{2}", c)]
    long = z.melt(id_vars=["RegionName", "state"], value_vars=date_cols, var_name="date", value_name="zori")
    long["year"] = long.date.str[:4].astype(int)
    # Annual average of each metro (only years with all twelve months), then the plain average of the
    # metros in each state. Zillow publishes no state-level ZORI, so this is a metro-based proxy.
    metro_year = long.groupby(["RegionName", "state", "year"]).zori.agg(["mean", "count"]).reset_index()
    metro_year = metro_year[(metro_year["count"] == 12) & metro_year.state.notna()]
    out = metro_year.groupby(["state", "year"]).agg(rent=("mean", "mean"), rent_metros=("RegionName", "nunique")).reset_index()
    return out[out.year <= 2024]


# ---------- CPI-U and mortgage rates, by year ----------

def load_cpi():
    html = open(f"{RAW}/cpi/minneapolis_fed_cpi.html", encoding="utf-8", errors="ignore").read()
    rows = re.findall(r">\s*(?:&nbsp;)?(\d{4})</div>\s*</td>\s*<td[^>]*>\s*<div[^>]*>\s*([\d.]+)</div>", html)
    cpi = {int(y): float(v) for y, v in rows}
    return pd.Series({y: cpi[y] for y in YEARS}, name="cpi")


def load_mortgage():
    m = pd.read_csv(f"{RAW}/freddie_mac/PMMS_history.csv", usecols=["date", "pmms30"])
    m["date"] = pd.to_datetime(m["date"], format="%m/%d/%Y")
    m["pmms30"] = pd.to_numeric(m["pmms30"], errors="coerce")
    by_year = m.groupby(m.date.dt.year).pmms30.mean()
    return by_year.reindex(YEARS).round(3).rename("mortgage_rate_30yr")


# ---------- IRS SOI state-to-state migration ----------

def load_irs():
    """Filing-year pairs 2011-12 ... 2022-23. The inflow files list, for each destination state, every
    origin state with returns (n1), people claimed on them (n2) and adjusted gross income (AGI, $ thousands)."""
    frames = []
    for path in sorted(glob.glob(f"{RAW}/irs_soi/stateinflow*.csv")):
        yy = re.search(r"stateinflow(\d{2})(\d{2})\.csv", path)
        period = f"20{yy.group(1)}-{yy.group(2)}"
        d = pd.read_csv(path, dtype={"y2_statefips": str, "y1_statefips": str}, encoding="latin-1")
        d = d[d.y1_statefips.str.fullmatch(r"\d\d") & (d.y1_statefips.astype(int) <= 56)]  # drop 57 foreign, 96-98 totals
        d = d[d.y1_statefips != d.y2_statefips]  # drop non-migrants
        d["period"] = period
        frames.append(d)
    irs = pd.concat(frames, ignore_index=True)
    fips = {}
    for path in sorted(glob.glob(f"{RAW}/irs_soi/stateinflow*.csv")):
        for _, r in pd.read_csv(path, dtype=str, encoding="latin-1").iterrows():
            if r.y1_state in STATE_ABBR:
                fips[r.y1_statefips] = STATE_ABBR[r.y1_state]
    irs["current_state"] = irs.y2_statefips.map(fips)
    irs["prior_state"] = irs.y1_statefips.map(fips)
    irs = irs.dropna(subset=["current_state", "prior_state"])
    irs = irs.rename(columns={"n1": "returns", "n2": "people", "AGI": "agi_thousands"})
    return irs[["period", "current_state", "prior_state", "returns", "people", "agi_thousands"]]


def main():
    os.makedirs(OUT, exist_ok=True)

    ctx = (
        pd.DataFrame([(s, y) for s in STATES for y in YEARS], columns=["state", "year"])
        .merge(load_population(), on=["state", "year"], how="left")
        .merge(load_income(), on=["state", "year"], how="left")
        .merge(load_rpp(), on=["state", "year"], how="left")
        .merge(load_rent(), on=["state", "year"], how="left")
    )
    ctx["population"] = ctx["population"].astype("Int64")
    for c in ("median_income", "rent"):
        ctx[c] = ctx[c].round(0)
    ctx[["rpp_all", "rpp_housing"]] = ctx[["rpp_all", "rpp_housing"]].round(3)
    ctx.to_csv(f"{OUT}/state_year_context.csv", index=False)

    yr = pd.concat([load_cpi(), load_mortgage()], axis=1)
    yr.index.name = "year"
    yr.to_csv(f"{OUT}/year_context.csv")

    irs = load_irs()
    irs.to_csv(f"{OUT}/irs_state_flows.csv", index=False)

    print(f"state_year_context.csv: {len(ctx)} rows")
    print(ctx.drop(columns=["state", "year"]).notna().sum().to_string())
    print(f"year_context.csv: {len(yr)} rows")
    print(f"irs_state_flows.csv: {len(irs)} rows, {irs.period.nunique()} periods, {irs.current_state.nunique()} states")


if __name__ == "__main__":
    main()

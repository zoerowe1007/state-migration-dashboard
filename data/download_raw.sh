#!/bin/sh
# Downloads the supplementary raw data used by data/prepare_data.py.
# (The Census migration tables and Zillow ZHVI in data/raw/ were downloaded by hand earlier;
# see the README for their URLs.)  Run from the repository root:  sh data/download_raw.sh
set -e
UA="Mozilla/5.0 (student project; https://github.com/zoerowe1007/state-migration-dashboard)"
get() { curl -fsSL --http1.1 -A "$UA" --retry 3 --retry-delay 2 -o "$2" "$1" && echo "ok  $2"; }

mkdir -p data/raw/population data/raw/bea data/raw/income data/raw/cpi data/raw/freddie_mac data/raw/zillow data/raw/irs_soi

# Census population estimates by state (three vintages cover 2005-2024)
P=https://www2.census.gov/programs-surveys/popest/datasets
get $P/2000-2010/intercensal/state/st-est00int-alldata.csv data/raw/population/st-est00int-alldata.csv
get $P/2010-2019/national/totals/nst-est2019-alldata.csv   data/raw/population/nst-est2019-alldata.csv
get $P/2020-2024/state/totals/NST-EST2024-ALLDATA.csv      data/raw/population/NST-EST2024-ALLDATA.csv

# BEA Regional Price Parities by state
get https://apps.bea.gov/regional/zip/SARPP.zip data/raw/bea/SARPP.zip
unzip -oq data/raw/bea/SARPP.zip -d data/raw/bea/SARPP

# Census CPS/ASEC historical table H-8: median household income by state
get https://www2.census.gov/programs-surveys/cps/tables/time-series/historical-income-households/h08.xlsx data/raw/income/h08.xlsx

# Annual-average CPI-U (all items, U.S. city average, from BLS) as tabulated by the Minneapolis Fed.
# BLS and FRED both refuse scripted requests, so this republished table is the source; it is parsed by prepare_data.py.
get https://www.minneapolisfed.org/about-us/monetary-policy/inflation-calculator/consumer-price-index-1913- data/raw/cpi/minneapolis_fed_cpi.html

# Freddie Mac Primary Mortgage Market Survey, weekly 30-year fixed rate (the series FRED calls MORTGAGE30US)
get https://www.freddiemac.com/pmms/docs/PMMS_history.csv data/raw/freddie_mac/PMMS_history.csv

# Zillow Observed Rent Index. Zillow publishes no state-level file, so use the metro file.
get https://files.zillowstatic.com/research/public_csvs/zori/Metro_zori_uc_sfrcondomfr_sm_month.csv data/raw/zillow/metro_zori.csv

# IRS SOI state-to-state migration, filing years 2011-12 through 2022-23
for yy in 1112 1213 1314 1415 1516 1617 1718 1819 1920 2021 2122 2223; do
  for kind in inflow outflow; do
    get https://www.irs.gov/pub/irs-soi/state${kind}${yy}.csv data/raw/irs_soi/state${kind}${yy}.csv
  done
done

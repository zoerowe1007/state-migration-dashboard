// Supplementary data that sits beside the migration panel: state-by-year population, median
// household income, BEA Regional Price Parities and rents; year-level CPI and mortgage rates; and
// the IRS state-to-state flows. All of it is keyed by the same state indexes and years as the panel.

const IRS_URL = "data/irs_flows.json";

/**
 * @param {object} raw  the "context" object from data/site_data.json
 * @param {string[]} states  state names, in the same order the grids were built
 */
export function buildContext(raw, states) {
  const years = raw.years;
  const nYears = years.length;
  const yearIndex = new Map(years.map((y, i) => [y, i]));
  const toFloats = (a) => Float64Array.from(a, (v) => (v == null ? NaN : v));
  const grids = {
    population: toFloats(raw.population),
    income: toFloats(raw.median_income),
    rppAll: toFloats(raw.rpp_all),
    rppHousing: toFloats(raw.rpp_housing),
    rent: toFloats(raw.rent),
    rentMetros: toFloats(raw.rent_metros),
  };
  const cpi = toFloats(raw.cpi);
  const mortgage = toFloats(raw.mortgage_rate);
  const latest = years[nYears - 1];

  const grid = (name) => (state, year) => {
    const j = yearIndex.get(year);
    return j === undefined ? NaN : grids[name][state * nYears + j];
  };
  const byYear = (arr) => (year) => {
    const j = yearIndex.get(year);
    return j === undefined ? NaN : arr[j];
  };
  const cpiAt = byYear(cpi);
  const mortgageAt = byYear(mortgage);

  return {
    states,
    years,
    latest,
    population: grid("population"),
    income: grid("income"),
    rppAll: grid("rppAll"),
    rppHousing: grid("rppHousing"),
    rent: grid("rent"),
    rentMetros: grid("rentMetros"),
    cpi: cpiAt,
    mortgageRate: mortgageAt,
    /** Multiplier that turns a dollar amount from `year` into latest-year dollars (CPI-U). */
    realFactor: (year) => cpiAt(latest) / cpiAt(year),
  };
}

/** Monthly principal-and-interest payment on a fixed-rate loan for a home worth `homeValue`. */
export function monthlyPayment(homeValue, annualRatePct, { downShare = 0.2, termYears = 30 } = {}) {
  const r = annualRatePct / 1200;
  const n = termYears * 12;
  const loan = homeValue * (1 - downShare);
  return r === 0 ? loan / n : (loan * r) / (1 - Math.pow(1 + r, -n));
}

export function median(nums) {
  const s = nums.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * IRS SOI state-to-state flows as typed arrays.
 * @returns {Promise<{periods: string[], length: number, period: Uint8Array, currentState: Uint8Array,
 *   priorState: Uint8Array, returns: Int32Array, people: Int32Array, agiThousands: Float64Array}>}
 */
export async function loadIrs() {
  const res = await fetch(IRS_URL);
  if (!res.ok) throw new Error(`Failed to load ${IRS_URL}: ${res.status}`);
  const raw = await res.json();
  const r = raw.rows;
  return {
    periods: raw.meta.periods,
    states: raw.lookups.states,
    length: raw.meta.rows,
    period: Uint8Array.from(r.period),
    currentState: Uint8Array.from(r.current_state),
    priorState: Uint8Array.from(r.prior_state),
    returns: Int32Array.from(r.returns),
    people: Int32Array.from(r.people),
    agiThousands: Float64Array.from(r.agi_thousands),
  };
}

// Filter + control state: a small store that stays in sync with the URL
// query string, so "Copy link to this view" and the browser back/forward
// buttons both work. Covers the 4 data filters AND the main chart's
// measure/breakdown/chart-type controls, since Phase 6 asks for "all
// filter/control state" to live in the URL, not just the data filters.

// A route-year is "reliable" when its 90% margin of error is at most this share
// of its estimate. About 89% of rows fail this test, yet they hold only ~42% of
// all movers, so the dashboard lets readers hide them.
export const RELIABLE_MAX_MOE_SHARE = 0.3;
export const isReliable = (movers, moe) => moe <= RELIABLE_MAX_MOE_SHARE * movers;

export const FILTER_KEYS = ["year", "current_state", "prior_state", "current_region", "reliable"];
export const CONTROL_KEYS = ["measure", "breakdown", "charttype", "dollars", "percap", "costmetric"];
export const ALL_KEYS = [...FILTER_KEYS, ...CONTROL_KEYS];

export const DEFAULTS = Object.freeze({
  year: "all",
  current_state: "all",
  prior_state: "all",
  current_region: "all",
  reliable: "all",
  measure: "total",
  breakdown: "current_state",
  charttype: "bar",
  dollars: "nominal", // "real" restates every dollar amount in 2024 dollars
  percap: "net", // per-1,000-residents panel: net | in | out
  costmetric: "home_value", // cost-of-living panel metric
});

/** Reads state from the current URL's query string, falling back to defaults. */
export function readStateFromUrl() {
  const params = new URLSearchParams(location.search);
  const state = { ...DEFAULTS };
  for (const key of ALL_KEYS) {
    const v = params.get(key);
    if (v) state[key] = v;
  }
  return state;
}

/** Writes state into the URL (replace by default; push for "real" navigation, e.g. reset). */
export function writeStateToUrl(state, { push = false } = {}) {
  const params = new URLSearchParams();
  for (const key of ALL_KEYS) {
    if (state[key] && state[key] !== DEFAULTS[key]) params.set(key, state[key]);
  }
  const query = params.toString();
  const url = query ? `${location.pathname}?${query}` : location.pathname;
  if (push) history.pushState(state, "", url);
  else history.replaceState(state, "", url);
}

/** Creates a small observable state store, persisted to the URL on every change. */
export function createFilterStore(initial) {
  let state = { ...DEFAULTS, ...initial };
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) fn(state);
  }

  return {
    get: () => state,
    set(patch, opts) {
      state = { ...state, ...patch };
      writeStateToUrl(state, opts);
      notify();
    },
    reset() {
      state = { ...DEFAULTS };
      writeStateToUrl(state, { push: true });
      notify();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/**
 * Computes a boolean mask over the dataset for the 4 data filters (ignores
 * the main-chart control keys, which don't filter rows).
 * @param {import('./data.js').Dataset} data
 * @param {ReturnType<typeof readStateFromUrl>} filters
 * @returns {Uint8Array}
 */
export function computeMask(data, filters) {
  const mask = new Uint8Array(data.length);
  const stateIdx = filters.current_state === "all" ? -1 : data.states.indexOf(filters.current_state);
  const priorIdx = filters.prior_state === "all" ? -1 : data.states.indexOf(filters.prior_state);
  const regionIdx = filters.current_region === "all" ? -1 : data.regions.indexOf(filters.current_region);
  const year = filters.year === "all" ? -1 : Number(filters.year);
  const reliableOnly = filters.reliable === "yes";

  for (let i = 0; i < data.length; i++) {
    if (year !== -1 && data.year[i] !== year) continue;
    if (stateIdx !== -1 && data.currentState[i] !== stateIdx) continue;
    if (priorIdx !== -1 && data.priorState[i] !== priorIdx) continue;
    if (regionIdx !== -1 && data.currentRegion[i] !== regionIdx) continue;
    if (reliableOnly && !isReliable(data.movers[i], data.moe[i])) continue;
    mask[i] = 1;
  }
  return mask;
}

/** Returns the array indices where mask[i] === 1. */
export function maskIndices(mask) {
  const out = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) out.push(i);
  return out;
}

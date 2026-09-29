// Filter state: a small store that stays in sync with the URL query string,
// so "Copy link to this view" and the browser back/forward buttons both work.

/** @typedef {{year: string, current_state: string, prior_state: string, current_region: string}} Filters */

export const FILTER_KEYS = ["year", "current_state", "prior_state", "current_region"];

export const DEFAULT_FILTERS = Object.freeze({
  year: "all",
  current_state: "all",
  prior_state: "all",
  current_region: "all",
});

/** Reads filters from the current URL's query string, falling back to defaults. */
export function readFiltersFromUrl() {
  const params = new URLSearchParams(location.search);
  const filters = { ...DEFAULT_FILTERS };
  for (const key of FILTER_KEYS) {
    const v = params.get(key);
    if (v) filters[key] = v;
  }
  return filters;
}

/** Writes filters into the URL (replacing history so back/forward tracks real navigation only on push). */
export function writeFiltersToUrl(filters, { push = false } = {}) {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    if (filters[key] && filters[key] !== "all") params.set(key, filters[key]);
  }
  const query = params.toString();
  const url = query ? `${location.pathname}?${query}` : location.pathname;
  if (push) history.pushState(filters, "", url);
  else history.replaceState(filters, "", url);
}

/**
 * Creates a small observable filter store.
 * @param {Partial<Filters>} initial
 */
export function createFilterStore(initial) {
  let filters = { ...DEFAULT_FILTERS, ...initial };
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) fn(filters);
  }

  return {
    get: () => filters,
    set(patch, opts) {
      filters = { ...filters, ...patch };
      writeFiltersToUrl(filters, opts);
      notify();
    },
    reset() {
      filters = { ...DEFAULT_FILTERS };
      writeFiltersToUrl(filters, { push: true });
      notify();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/**
 * Computes a boolean mask over the dataset for the given filters.
 * @param {import('./data.js').Dataset} data
 * @param {Filters} filters
 * @returns {Uint8Array}
 */
export function computeMask(data, filters) {
  const mask = new Uint8Array(data.length);
  const stateIdx = filters.current_state === "all" ? -1 : data.states.indexOf(filters.current_state);
  const priorIdx = filters.prior_state === "all" ? -1 : data.states.indexOf(filters.prior_state);
  const regionIdx = filters.current_region === "all" ? -1 : data.regions.indexOf(filters.current_region);
  const year = filters.year === "all" ? -1 : Number(filters.year);

  for (let i = 0; i < data.length; i++) {
    if (year !== -1 && data.year[i] !== year) continue;
    if (stateIdx !== -1 && data.currentState[i] !== stateIdx) continue;
    if (priorIdx !== -1 && data.priorState[i] !== priorIdx) continue;
    if (regionIdx !== -1 && data.currentRegion[i] !== regionIdx) continue;
    mask[i] = 1;
  }
  return mask;
}

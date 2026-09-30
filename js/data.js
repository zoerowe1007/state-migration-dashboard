// Loads data/site_data.json once and exposes it as typed arrays for fast,
// in-memory filtering (no re-fetching, no re-parsing on every filter change).

import { buildContext } from "./context.js";

const DATA_URL = "data/site_data.json";

/**
 * @typedef {Object} Dataset
 * @property {Object} meta
 * @property {string[]} states
 * @property {string[]} regions
 * @property {Int16Array} year
 * @property {Uint8Array} currentState
 * @property {Uint8Array} currentRegion
 * @property {Uint8Array} priorState
 * @property {Uint8Array} priorRegion
 * @property {Int32Array} movers
 * @property {Float32Array} moe        NaN where missing
 * @property {Float32Array} currentZhvi NaN where missing
 * @property {Float32Array} priorZhvi   NaN where missing
 * @property {number} length
 * @property {ReturnType<typeof buildContext>} context  population, income, price parities, rent, CPI, mortgage rates
 */

/** @returns {Promise<Dataset>} */
export async function loadDataset() {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`Failed to load ${DATA_URL}: ${res.status}`);
  const raw = await res.json();
  const rows = raw.rows;
  const n = raw.meta.rows;

  const toTypedNullable = (arr, TypedArrayCtor) => {
    const out = new TypedArrayCtor(n);
    for (let i = 0; i < n; i++) out[i] = arr[i] == null ? NaN : arr[i];
    return out;
  };

  return {
    meta: raw.meta,
    states: raw.lookups.states,
    regions: raw.lookups.regions,
    year: Int16Array.from(rows.year),
    currentState: Uint8Array.from(rows.current_state),
    currentRegion: Uint8Array.from(rows.current_region),
    priorState: Uint8Array.from(rows.prior_state),
    priorRegion: Uint8Array.from(rows.prior_region),
    movers: Int32Array.from(rows.movers),
    moe: toTypedNullable(rows.moe, Float32Array),
    currentZhvi: toTypedNullable(rows.current_zhvi, Float32Array),
    priorZhvi: toTypedNullable(rows.prior_zhvi, Float32Array),
    length: n,
    context: buildContext(raw.context, raw.lookups.states),
  };
}

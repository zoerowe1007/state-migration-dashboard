import { loadDataset } from "./data.js";
import { createFilterStore, computeMask, readFiltersFromUrl } from "./state.js";

function populateSelect(select, values, current) {
  select.innerHTML = '<option value="all">All</option>';
  for (const v of values) {
    const opt = new Option(String(v), String(v));
    if (String(current) === String(v)) opt.selected = true;
    select.add(opt);
  }
}

async function main() {
  const data = await loadDataset();
  const store = createFilterStore(readFiltersFromUrl());

  const yearSel = document.getElementById("filter-year");
  const destSel = document.getElementById("filter-current-state");
  const origSel = document.getElementById("filter-prior-state");
  const regionSel = document.getElementById("filter-region");

  populateSelect(yearSel, data.meta.years, store.get().year);
  populateSelect(destSel, data.states, store.get().current_state);
  populateSelect(origSel, data.states, store.get().prior_state);
  populateSelect(regionSel, data.regions, store.get().current_region);

  yearSel.addEventListener("change", () => store.set({ year: yearSel.value }));
  destSel.addEventListener("change", () => store.set({ current_state: destSel.value }));
  origSel.addEventListener("change", () => store.set({ prior_state: origSel.value }));
  regionSel.addEventListener("change", () => store.set({ current_region: regionSel.value }));
  document.getElementById("reset-filters").addEventListener("click", () => {
    store.reset();
    populateSelect(yearSel, data.meta.years, "all");
    populateSelect(destSel, data.states, "all");
    populateSelect(origSel, data.states, "all");
    populateSelect(regionSel, data.regions, "all");
    render();
  });

  function render() {
    const mask = computeMask(data, store.get());
    let count = 0;
    for (let i = 0; i < mask.length; i++) count += mask[i];
    document.getElementById("selection-count").textContent = `${count.toLocaleString()} of ${data.length.toLocaleString()} records selected`;
  }

  store.subscribe(render);
  render();
}

main().catch((err) => {
  console.error(err);
  document.getElementById("selection-count").textContent = "Failed to load data";
});

// Sortable-table rendering, used as the "Table" alternative view for every
// chart panel.

/**
 * Renders rows into a table, wiring click-to-sort on column headers and
 * (optionally) click-to-filter on rows, per Phase 6's "clicking a ... table
 * row adds it as a filter" requirement.
 * @param {HTMLTableElement} table
 * @param {{label: string, key: string, format?: (v:any)=>string}[]} columns
 * @param {object[]} rows
 * @param {{initialSortKey?: string, initialSortDir?: 'asc'|'desc', onRowClick?: (row:object)=>void}} [opts]
 */
export function renderTable(table, columns, rows, opts = {}) {
  let sortKey = opts.initialSortKey || columns[0].key;
  let sortDir = opts.initialSortDir || "desc";

  function sorted() {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }

  function renderHead() {
    const thead = table.querySelector("thead") || table.createTHead();
    thead.innerHTML = "";
    const tr = thead.insertRow();
    for (const col of columns) {
      const th = document.createElement("th");
      th.textContent = col.label + (col.key === sortKey ? (sortDir === "asc" ? " ↑" : " ↓") : "");
      th.style.cursor = "pointer";
      th.tabIndex = 0;
      th.setAttribute("role", "button");
      th.setAttribute("aria-label", `Sort by ${col.label}`);
      const activate = () => {
        if (sortKey === col.key) sortDir = sortDir === "asc" ? "desc" : "asc";
        else {
          sortKey = col.key;
          sortDir = "desc";
        }
        render();
      };
      th.addEventListener("click", activate);
      th.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      });
      tr.appendChild(th);
    }
  }

  function renderBody() {
    const tbody = table.tBodies[0] || table.createTBody();
    const full = sorted();
    const shown = full.slice(0, 500);
    tbody.innerHTML = shown
      .map((row) => `<tr>${columns.map((col) => `<td>${col.format ? col.format(row[col.key]) : row[col.key]}</td>`).join("")}</tr>`)
      .join("");
    if (opts.onRowClick) {
      [...tbody.rows].forEach((tr, i) => {
        tr.style.cursor = "pointer";
        tr.tabIndex = 0;
        tr.setAttribute("role", "button");
        const activate = () => opts.onRowClick(shown[i]);
        tr.addEventListener("click", activate);
        tr.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            activate();
          }
        });
      });
    }
    return full.length;
  }

  function render() {
    renderHead();
    return renderBody();
  }

  return render();
}

// Small hand-drawn-style inline SVG icons for the "moving across the
// country" theme. Plain stroked line-art, sized to inherit currentColor so
// they pick up surrounding text color automatically. No external image
// files or icon fonts, per the theme's own rule.

const stroke = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

export const icons = {
  truck: `<svg viewBox="0 0 24 24" ${stroke}><rect x="1" y="7" width="12" height="9"/><path d="M13 10h5l4 4v2h-2"/><circle cx="6" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/><path d="M1 18h3M13 18h2"/></svg>`,
  box: `<svg viewBox="0 0 24 24" ${stroke}><path d="M3 7l9-4 9 4-9 4-9-4Z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" ${stroke}><path d="M12 21s7-7.2 7-12a7 7 0 1 0-14 0c0 4.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2.4"/></svg>`,
  house: `<svg viewBox="0 0 24 24" ${stroke}><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>`,
  sign: `<svg viewBox="0 0 24 24" ${stroke}><path d="M12 3v18"/><path d="M12 6h8l-2 2.5L20 11h-8"/></svg>`,
  dice: `<svg viewBox="0 0 24 24" ${stroke}><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8.5" cy="8.5" r="1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1" fill="currentColor" stroke="none"/></svg>`,
};

/** Returns an icon's SVG markup sized to `size`px, or "" if unknown. */
export function icon(name, size = 18) {
  const svg = icons[name];
  if (!svg) return "";
  return svg.replace("<svg ", `<svg width="${size}" height="${size}" `);
}

/** Fills every `[data-icon="name"]` element in the document with its SVG. */
export function applyIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.dataset.icon, el.dataset.iconSize ? Number(el.dataset.iconSize) : 16);
  });
}

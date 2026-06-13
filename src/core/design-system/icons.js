const icons = {
  home:
    '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/>',
  wardrobe:
    '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 3v18"/><path d="M9 12h1"/><path d="M14 12h1"/>',
  camera:
    '<path d="M7 7h.5l1-2h7l1 2H17a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3Z"/><circle cx="12" cy="13" r="3.5"/>',
  sparkles:
    '<path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6Z"/><path d="m5 14 .8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8Z"/><path d="m19 14 .6 1.6L21 16l-1.4.4L19 18l-.6-1.6L17 16l1.4-.4Z"/>',
  user:
    '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  heart:
    '<path d="M20.8 5.7a5.2 5.2 0 0 0-7.4 0L12 7.1l-1.4-1.4a5.2 5.2 0 1 0-7.4 7.4L12 22l8.8-8.9a5.2 5.2 0 0 0 0-7.4Z"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 2v4h-4"/><path d="M6 22v-4h4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/>',
  sliders:
    '<path d="M4 7h10"/><path d="M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h2"/><path d="M10 17h10"/><circle cx="8" cy="17" r="2"/>',
  shirt:
    '<path d="M8 4 4 7l3 4 2-1v10h6V10l2 1 3-4-4-3-2 3h-4Z"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
};

export function icon(name, size = 20, className = "") {
  const body = icons[name] || icons.sparkles;
  return `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/**
 * Forced landscape. The game is landscape-only, but phones held upright (or with rotation lock on, common on
 * iPhone home-screen apps) report a portrait viewport. In that case the whole page is rotated 90° with CSS
 * (html.rot, see styles.css) so the game is played sideways immediately, with no "rotate your device" stop.
 * Everything that reads the viewport or pointer coordinates goes through these helpers.
 */
const root = document.documentElement;

export const isRotated = () => root.classList.contains('rot');

/** Re-evaluates the rotation (touch devices in portrait only; desktop windows are never rotated). */
export function updateRotation() {
  // ?rot forces it on desktop for testing.
  const r = innerHeight > innerWidth && (matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('rot'));
  root.classList.toggle('rot', r);
  // Layout size classes from the game's landscape size (CSS media queries would see the unrotated screen).
  const { w, h } = viewSize();
  root.classList.toggle('compact', h <= 460);
  root.classList.toggle('tall', h >= 700 && w / h >= 4 / 3);
}

/** Size of the game's own (landscape) coordinate space. */
export function viewSize() { return isRotated() ? { w: innerHeight, h: innerWidth } : { w: innerWidth, h: innerHeight }; }

/**
 * Screen (client) coordinates → game coordinates.
 * The page is transformed with translateX(100vw) rotate(90deg): game (x, y) shows at screen (W − y, x).
 */
export function toLocal(sx: number, sy: number) { return isRotated() ? { x: sy, y: innerWidth - sx } : { x: sx, y: sy }; }

/** An element's box in game coordinates (its client rect is axis-aligned on screen either way). */
export function localRect(el: Element) {
  const r = el.getBoundingClientRect();
  return isRotated() ? { left: r.top, top: innerWidth - r.right } : { left: r.left, top: r.top };
}

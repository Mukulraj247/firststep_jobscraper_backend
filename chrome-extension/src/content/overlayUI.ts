/**
 * Overlay UI - Injected DOM elements for visual feedback.
 * Creates highlight overlay and status badge on the page.
 */

let overlay: HTMLDivElement | null = null;
let badge: HTMLDivElement | null = null;
let firstPickOverlay: HTMLDivElement | null = null;

export function ensureOverlay(): HTMLDivElement {
  if (overlay && document.documentElement.contains(overlay)) return overlay;

  overlay = document.createElement('div');
  overlay.id = '__maxun_overlay';
  document.documentElement.appendChild(overlay);
  return overlay;
}

export function ensureBadge(): HTMLDivElement {
  if (badge && document.documentElement.contains(badge)) return badge;

  badge = document.createElement('div');
  badge.id = '__maxun_badge';
  document.documentElement.appendChild(badge);
  return badge;
}

export function showOverlay(rect: DOMRect) {
  const el = ensureOverlay();
  el.style.display = 'block';
  // fixed + client coords — avoids scroll-offset drift on long job grids
  el.style.position = 'fixed';
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
}

export function hideOverlay() {
  if (overlay) overlay.style.display = 'none';
}

export function showBadge(text: string) {
  const el = ensureBadge();
  el.textContent = text;
  el.classList.remove('__maxun_tooltip');
  el.style.display = 'block';
  el.style.top = '12px';
  el.style.right = '12px';
  el.style.left = 'auto';
}

/**
 * Show the badge as a tooltip next to the cursor (or near a DOM rect).
 */
export function showTooltip(text: string, x: number, y: number) {
  const el = ensureBadge();
  el.textContent = text;
  el.classList.add('__maxun_tooltip');
  el.style.display = 'block';

  // Badge uses position:fixed — use client coordinates only (no scroll offset)
  el.style.top = `${y + 18}px`;
  el.style.left = `${x + 14}px`;
  el.style.right = 'auto';
}

export function hideBadge() {
  if (badge) badge.style.display = 'none';
}

export function hideAll() {
  hideOverlay();
  hideBadge();
}

/**
 * Show a persistent "first pick" overlay (pink outline) without mutating the
 * target element. Positioned absolutely over the element's bounding box.
 */
export function showFirstPickOverlay(rect: DOMRect) {
  if (!firstPickOverlay || !document.documentElement.contains(firstPickOverlay)) {
    firstPickOverlay = document.createElement('div');
    firstPickOverlay.id = '__maxun_first_pick_overlay';
    Object.assign(firstPickOverlay.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '2147483646',
      border: '3px solid #ff00c3',
      borderRadius: '4px',
      boxShadow: '0 0 0 1px rgba(255, 0, 195, 0.3) inset',
      boxSizing: 'border-box',
    });
    document.documentElement.appendChild(firstPickOverlay);
  }

  firstPickOverlay.style.display = 'block';
  firstPickOverlay.style.position = 'fixed';
  firstPickOverlay.style.left = `${rect.left}px`;
  firstPickOverlay.style.top = `${rect.top}px`;
  firstPickOverlay.style.width = `${rect.width}px`;
  firstPickOverlay.style.height = `${rect.height}px`;
}

export function hideFirstPickOverlay() {
  if (firstPickOverlay) firstPickOverlay.style.display = 'none';
}

export function cleanupOverlays() {
  overlay?.remove();
  badge?.remove();
  firstPickOverlay?.remove();
  overlay = null;
  badge = null;
  firstPickOverlay = null;
}

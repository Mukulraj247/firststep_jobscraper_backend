/**
 * overlayDismisser - Heuristic auto-dismissal of cookie banners, consent
 * popups, and generic modal overlays that block list extraction.
 *
 * Design:
 *   - One-shot `dismissNow(page)` runs in the page via `evaluate` and clicks
 *     visible "accept / agree / close" controls across known consent managers
 *     (OneTrust, Cookiebot, TrustArc, Didomi, Quantcast, OSANO, Klaro, ...)
 *     plus generic `[aria-label*="close" i]` / `.modal-close` / `.close-btn`
 *     buttons inside anything that looks like a modal/dialog.
 *
 *   - `attachAutoDismiss(context)` hooks every page so overlays get dismissed
 *     after each main-frame navigation (debounced), so lazy-loaded banners
 *     don't survive into the first extraction.
 *
 *   - `installDialogHandler(page)` accepts or dismisses JavaScript `alert`,
 *     `confirm`, `prompt`, and `beforeunload` dialogs so they don't hang the
 *     scraper.
 *
 * None of the heuristics interact with CAPTCHA widgets — those are handled by
 * `captchaGate.ts` which intentionally refuses to auto-click them.
 */

import type { BrowserContext, Page, Frame } from 'playwright-core';
import logger from '../../logger';

export interface OverlayDismisserOptions {
  autoDismiss?: boolean;
  acceptDialogs?: boolean;
}

const CONTEXT_DESTROYED_RX =
  /execution context was destroyed|target (?:page|closed)|frame was detached/i;

/**
 * In-page overlay dismiss pass. Must stay self-contained so Playwright can
 * serialize it into the browser via `page.evaluate(dismissOverlaysInDocument)`.
 *
 * Optional `rootDoc` is for unit tests; the browser call always uses `document`.
 */
export function dismissOverlaysInDocument(rootDoc?: Document): number {
  const doc = rootDoc ?? document;
  const view = doc.defaultView;
  const readStyle = (el: Element): CSSStyleDeclaration => {
    if (view && typeof view.getComputedStyle === 'function') {
      return view.getComputedStyle(el as Element);
    }
    return {
      visibility: 'visible',
      display: 'block',
      opacity: '1',
      pointerEvents: 'auto',
    } as CSSStyleDeclaration;
  };

  const isVisible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = readStyle(el);
    if (
      style.visibility === 'hidden' ||
      style.display === 'none' ||
      style.opacity === '0' ||
      style.pointerEvents === 'none'
    ) {
      return false;
    }
    return true;
  };

  const safeQuery = (root: Document | Element, sel: string): Element[] => {
    try {
      return Array.from(root.querySelectorAll(sel));
    } catch {
      return [];
    }
  };

  // Cookie/consent only — `continue` / `ok` / `allow` match job-board chrome
  // (Oracle HCM filters, pagination, apply CTAs) and must not be used there.
  const CONSENT_ACCEPT_RX =
    /\b(accept(?:\s+all)?(?:\s+cookies)?|agree(?:\s+to\s+all)?|got\s*it|i\s*agree|i\s*accept|allow\s+(?:all\s+)?cookies|save\s+and\s+accept|understood)\b/i;
  const CLOSE_RX = /\b(close|dismiss|no\s*thanks|not\s*now|×|✕)\b/i;
  // Findly / DXC career sites show a language confirmation modal.
  const LANG_CONFIRM_RX =
    /^(english|anglais|englisch|inglese|inglés|inglês|continue\s+in\s+english)$/i;
  const LANG_MODAL_RX = /langue|language|idioma|sprache|言語|ngôn\s*ngữ/;
  const CONSENT_COPY_RX = /cookie|consent|privacy|gdpr|we use cookies/;

  const VENDOR_BUTTONS: string[][] = [
    ['#onetrust-accept-btn-handler', '#accept-recommended-btn-handler'],
    ['#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '#CybotCookiebotDialogBodyButtonAccept'],
    ['#truste-consent-button', '.truste-button2'],
    ['#didomi-notice-agree-button', '.didomi-components-button--primary'],
    ['.qc-cmp2-summary-buttons button[mode="primary"]'],
    ['.osano-cm-accept-all'],
    ['.klaro .cm-btn-accept-all', '.klaro .cm-btn-accept'],
    ['[data-testid="uc-accept-all-button"]', '[data-testid="uc-deny-all-button"]'],
    ['.sp_choice_type_11', '.message-component.message-button.primary'],
    ['#cookiescript_accept'],
    ['.iubenda-cs-accept-btn'],
    ['#gdpr-accept', '#accept-cookies', '.cookie-accept', '.cookie-consent-accept'],
  ];

  const MAX_CLICKS = 3;
  let clicks = 0;
  const clicked = new Set<Element>();

  const wouldNavigate = (el: Element): boolean => {
    if (el.tagName !== 'A') return false;
    const href = (el.getAttribute('href') || '').trim();
    if (!href || href === '#' || href.startsWith('#') || /^javascript:/i.test(href)) {
      return false;
    }
    return true;
  };

  const clickEl = (el: Element): boolean => {
    if (clicks >= MAX_CLICKS) return false;
    if (clicked.has(el)) return false;
    if (!isVisible(el)) return false;
    if (wouldNavigate(el)) return false;
    try {
      (el as HTMLElement).click();
      clicked.add(el);
      clicks++;
      return true;
    } catch {
      return false;
    }
  };

  // 1) Vendor-specific buttons. First visible match per vendor group.
  for (const group of VENDOR_BUTTONS) {
    for (const sel of group) {
      const el = safeQuery(doc, sel)[0];
      if (el && clickEl(el)) {
        break;
      }
    }
  }

  // 2) Only real dialogs and cookie/consent nodes — never generic
  //    modal/overlay/banner/lang chrome. Oracle HCM (and similar SPAs) stamp
  //    those class fragments on search chrome, job cards, and the language
  //    switcher; clicking "Continue" / "English" / "OK" there navigates away
  //    and destroys the Playwright execution context.
  const DIALOG_SELECTORS = ['[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]'];
  const CONSENT_SELECTORS = [
    '[class*="cookie" i]',
    '[class*="consent" i]',
    '[id*="cookie" i]',
    '[id*="consent" i]',
  ];

  const seen = new Set<Element>();
  const dialogs: Element[] = [];
  const consentNodes: Element[] = [];
  for (const sel of DIALOG_SELECTORS) {
    for (const el of safeQuery(doc, sel)) {
      if (!isVisible(el) || seen.has(el)) continue;
      seen.add(el);
      dialogs.push(el);
    }
  }
  for (const sel of CONSENT_SELECTORS) {
    for (const el of safeQuery(doc, sel)) {
      if (!isVisible(el) || seen.has(el)) continue;
      seen.add(el);
      consentNodes.push(el);
    }
  }

  const outermost = (els: Element[]): Element[] =>
    els.filter((el) => !els.some((other) => other !== el && other.contains(el)));

  const clickInside = (container: Element, rx: RegExp): boolean => {
    const buttons = safeQuery(
      container,
      'button, a, [role="button"], input[type="button"], input[type="submit"]'
    );
    for (const btn of buttons) {
      if (!isVisible(btn)) continue;
      const label =
        (btn.getAttribute('aria-label') || '') +
        ' ' +
        (btn.textContent || '') +
        ' ' +
        ((btn as HTMLElement).title || '');
      if (rx.test(label.trim()) && clickEl(btn)) return true;
    }
    return false;
  };

  const clickCloseIcons = (container: Element): boolean => {
    const closeIconSelectors = [
      '[aria-label="close" i]',
      '[aria-label*="dismiss" i]',
      '.modal-close',
      '.close-btn',
      '.btn-close',
      'button.close',
    ];
    for (const sel of closeIconSelectors) {
      for (const el of safeQuery(container, sel)) {
        if (isVisible(el) && clickEl(el)) return true;
      }
    }
    return false;
  };

  // 2a) Language confirmation — only inside an actual dialog, never a
  //     header/nav `[id*="lang"]` / `[class*="lang"]` switcher.
  for (const container of outermost(dialogs)) {
    const blob = (container.textContent || '').toLowerCase();
    if (!LANG_MODAL_RX.test(blob)) continue;
    const buttons = safeQuery(container, 'button, a, [role="button"]');
    for (const btn of buttons) {
      if (!isVisible(btn)) continue;
      if (LANG_CONFIRM_RX.test((btn.textContent || '').trim()) && clickEl(btn)) break;
    }
  }

  for (const container of outermost(consentNodes)) {
    if (!clickInside(container, CONSENT_ACCEPT_RX)) {
      clickInside(container, CLOSE_RX);
    }
  }

  for (const container of outermost(dialogs)) {
    const blob = (container.textContent || '').toLowerCase();
    if (CONSENT_COPY_RX.test(blob)) {
      if (!clickInside(container, CONSENT_ACCEPT_RX)) {
        if (!clickInside(container, CLOSE_RX)) clickCloseIcons(container);
      }
      continue;
    }
    if (LANG_MODAL_RX.test(blob)) continue;
    if (!clickInside(container, CLOSE_RX)) clickCloseIcons(container);
  }

  return clicks;
}

/**
 * Executes the overlay-dismiss pass inside the page. Returns how many
 * elements it clicked. Safe to call repeatedly.
 */
export async function dismissNow(
  page: Page,
  options: OverlayDismisserOptions = {}
): Promise<number> {
  if (options.autoDismiss === false) return 0;
  try {
    // Cast: Playwright PageFunction expects `(arg: void) => R`, but the helper
    // takes an optional Document for unit tests. Runtime still serializes the
    // full function body into the page (no Node closure).
    const dismissed = await page.evaluate(dismissOverlaysInDocument as () => number);

    if (dismissed > 0) {
      logger.log('info', `overlayDismisser: dismissed ${dismissed} overlay element(s)`);
    }
    return dismissed;
  } catch (error: any) {
    const message = error?.message || String(error);
    const level = CONTEXT_DESTROYED_RX.test(message) ? 'info' : 'warn';
    logger.log(level, `overlayDismisser.dismissNow failed: ${message}`);
    return 0;
  }
}

/**
 * Install a `page.on('dialog', ...)` handler on every page in the context so
 * `window.alert/confirm/prompt/beforeunload` popups don't hang the scraper.
 *
 * By default we `dismiss()` — `acceptDialogs: true` will `accept()` instead
 * (useful for legal "are you 18+" gates).
 */
export function installDialogHandler(page: Page, options: OverlayDismisserOptions = {}): () => void {
  const accept = options.acceptDialogs === true;
  const handler = async (dialog: any) => {
    try {
      logger.log(
        'info',
        `Dialog ${accept ? 'accepted' : 'dismissed'}: type=${dialog.type()} message="${(dialog.message() || '').slice(0, 120)}"`
      );
      if (accept) {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    } catch {
      /* dialog already gone */
    }
  };
  page.on('dialog', handler);
  return () => {
    try {
      page.off('dialog', handler);
    } catch {
      /* ignore */
    }
  };
}

/**
 * Attach an auto-dismiss hook on every page in `context`, firing on every
 * main-frame navigation (debounced). Returns a dispose function.
 *
 * This complements `dismissNow` — use that before each extraction; use this
 * to catch lazy banners that appear after the first paint.
 */
export function attachAutoDismiss(
  context: BrowserContext,
  options: OverlayDismisserOptions = {}
): () => void {
  if (options.autoDismiss === false) {
    return () => undefined;
  }

  const disposers: Array<() => void> = [];

  const hookPage = (page: Page) => {
    disposers.push(installDialogHandler(page, options));

    let debounceTimer: NodeJS.Timeout | null = null;
    const onFrameNav = (frame: Frame) => {
      if (frame !== page.mainFrame()) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void dismissNow(page, options).catch(() => undefined);
      }, 800);
    };
    page.on('framenavigated', onFrameNav);
    disposers.push(() => {
      page.off('framenavigated', onFrameNav);
      if (debounceTimer) clearTimeout(debounceTimer);
    });
  };

  context.pages().forEach(hookPage);
  const onNewPage = (p: Page) => hookPage(p);
  context.on('page', onNewPage);
  disposers.push(() => context.off('page', onNewPage));

  return () => {
    disposers.forEach((d) => {
      try {
        d();
      } catch {
        /* ignore */
      }
    });
  };
}

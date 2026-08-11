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
    const dismissed = await page.evaluate(() => {
      const isVisible = (el: Element): boolean => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        const style = getComputedStyle(el as HTMLElement);
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

      // Text-match regex for accept/dismiss buttons. Kept English-first but
      // tolerant of common aliases / emoji glyphs. NOTE: we intentionally
      // avoid matching captcha/challenge buttons.
      const ACCEPT_RX =
        /\b(accept|agree|got\s*it|allow|understood|ok(?:ay)?|continue|i\s*agree|i\s*accept|allow\s*all|accept\s*all|allow\s*cookies|accept\s*cookies|save\s*and\s*accept)\b/i;
      const CLOSE_RX = /\b(close|dismiss|no\s*thanks|not\s*now|maybe\s*later|skip|later|×|✕)\b/i;
      // Findly / DXC career sites show a language confirmation modal.
      const LANG_CONFIRM_RX =
        /^(english|anglais|englisch|inglese|inglés|inglês|continue\s+in\s+english)$/i;

      // Known cookie-consent vendor selectors. Each entry is a list of
      // specific selectors we'll click in order if visible.
      const VENDOR_BUTTONS: string[][] = [
        // OneTrust
        ['#onetrust-accept-btn-handler', '#accept-recommended-btn-handler'],
        // Cookiebot
        ['#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '#CybotCookiebotDialogBodyButtonAccept'],
        // TrustArc
        ['#truste-consent-button', '.truste-button2'],
        // Didomi
        ['#didomi-notice-agree-button', '.didomi-components-button--primary'],
        // Quantcast Choice
        ['.qc-cmp2-summary-buttons button[mode="primary"]'],
        // OSANO
        ['.osano-cm-accept-all'],
        // Klaro
        ['.klaro .cm-btn-accept-all', '.klaro .cm-btn-accept'],
        // UserCentrics
        ['[data-testid="uc-accept-all-button"]', '[data-testid="uc-deny-all-button"]'],
        // Sourcepoint
        ['.sp_choice_type_11', '.message-component.message-button.primary'],
        // Cookie-script
        ['#cookiescript_accept'],
        // Iubenda
        ['.iubenda-cs-accept-btn'],
        // Generic GDPR / consent DIV IDs/classes
        ['#gdpr-accept', '#accept-cookies', '.cookie-accept', '.cookie-consent-accept'],
      ];

      let clicks = 0;
      const clickEl = (el: Element): boolean => {
        if (!isVisible(el)) return false;
        try {
          (el as HTMLElement).click();
          clicks++;
          return true;
        } catch {
          return false;
        }
      };

      // 1) Vendor-specific buttons, in order. Click the first visible one in
      //    each vendor group (so we don't click "reject" after "accept").
      for (const group of VENDOR_BUTTONS) {
        for (const sel of group) {
          const el = safeQuery(document, sel)[0];
          if (el && clickEl(el)) {
            break;
          }
        }
      }

      // 2) Generic: look for visible accept/close buttons inside anything that
      //    looks like a consent banner / modal / dialog / overlay.
      const containerSelectors = [
        '[role="dialog"]',
        '[role="alertdialog"]',
        '[aria-modal="true"]',
        '[class*="cookie" i]',
        '[class*="consent" i]',
        '[id*="cookie" i]',
        '[id*="consent" i]',
        '[class*="modal" i]',
        '[class*="popup" i]',
        '[class*="overlay" i]',
        '[class*="banner" i]',
        '[id*="lang" i]',
        '[class*="lang" i]',
      ];
      const containers: Element[] = [];
      for (const sel of containerSelectors) {
        for (const el of safeQuery(document, sel)) {
          if (isVisible(el)) containers.push(el);
        }
      }

      const clickInside = (container: Element, rx: RegExp): boolean => {
        const buttons = safeQuery(container, 'button, a, [role="button"], input[type="button"], input[type="submit"]');
        for (const btn of buttons) {
          if (!isVisible(btn)) continue;
          const label =
            (btn.getAttribute('aria-label') || '') +
            ' ' +
            (btn.textContent || '') +
            ' ' +
            ((btn as HTMLElement).title || '');
          if (rx.test(label.trim())) {
            if (clickEl(btn)) return true;
          }
        }
        return false;
      };

      // 2a) Language confirmation modals (Findly / DXC / multilingual career sites).
      // Only click English/Anglais inside a modal that mentions language — never the
      // site nav language switcher (that navigates away from the job list).
      for (const container of containers) {
        const blob = (container.textContent || '').toLowerCase();
        if (!/langue|language|idioma|sprache|言語|ngôn\s*ngữ|confirmation/.test(blob)) continue;
        const buttons = safeQuery(container, 'button, a, [role="button"]');
        for (const btn of buttons) {
          if (!isVisible(btn)) continue;
          if (LANG_CONFIRM_RX.test((btn.textContent || '').trim()) && clickEl(btn)) break;
        }
      }

      for (const container of containers) {
        // Prefer accept over close so cookie banners actually go away, then
        // fall back to close/dismiss for generic non-essential modals.
        if (!clickInside(container, ACCEPT_RX)) {
          clickInside(container, CLOSE_RX);
        }

        // Explicit close-icon buttons that don't have text — e.g. "×" / aria-label="close"
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
            if (isVisible(el)) {
              clickEl(el);
              break;
            }
          }
        }
      }

      return clicks;
    });

    if (dismissed > 0) {
      logger.log('info', `overlayDismisser: dismissed ${dismissed} overlay element(s)`);
    }
    return dismissed;
  } catch (error: any) {
    logger.log('warn', `overlayDismisser.dismissNow failed: ${error?.message || String(error)}`);
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

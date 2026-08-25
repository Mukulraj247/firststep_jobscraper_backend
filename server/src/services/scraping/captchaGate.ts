/**
 * captchaGate - Detect CAPTCHA / challenge widgets and surface them to the
 * caller without attempting to auto-solve (no third-party solver).
 *
 * Broader than the text-only `detectCaptcha` in `unblocker.ts`:
 *   - Scans iframe `src` for recaptcha / hcaptcha / turnstile / geetest /
 *     arkoselabs / funcaptcha.
 *   - Looks for `[data-sitekey]` / `.g-recaptcha` / `.h-captcha` /
 *     `.cf-turnstile` widgets embedded directly.
 *   - Still checks page text for the generic markers.
 *
 * When a CAPTCHA is detected with `pauseOnDetect` enabled, callers should
 * catch `CaptchaEncounteredError`, emit a `captcha:required` socket event,
 * and mark the run as `failed` with a clear reason so the user can decide
 * whether to retry later from the dashboard / sidepanel.
 */

import type { Page } from 'playwright-core';
import logger from '../../logger';

export type CaptchaKind =
  | 'recaptcha'
  | 'hcaptcha'
  | 'turnstile'
  | 'geetest'
  | 'arkoselabs'
  | 'funcaptcha'
  | 'text-marker'
  | 'unknown';

export interface CaptchaDetection {
  present: boolean;
  kind?: CaptchaKind;
  evidence?: string;
}

export interface CaptchaGateOptions {
  pauseOnDetect?: boolean;
}

export class CaptchaEncounteredError extends Error {
  readonly kind: CaptchaKind;
  readonly url: string;
  readonly evidence?: string;

  constructor(detection: CaptchaDetection, url: string) {
    super(
      `CAPTCHA detected (${detection.kind || 'unknown'}) at ${url}${
        detection.evidence ? ` — ${detection.evidence.slice(0, 160)}` : ''
      }`
    );
    this.name = 'CaptchaEncounteredError';
    this.kind = detection.kind || 'unknown';
    this.url = url;
    this.evidence = detection.evidence;
  }
}

const IFRAME_RX =
  /\b(recaptcha|hcaptcha|turnstile|geetest|arkoselabs|funcaptcha|cloudflare-challenge)\b/i;

/** Invisible reCAPTCHA v3 badge (Yahoo careers, etc.) is not a blocking challenge. */
export function isRecaptchaV3BadgeContext(src: string, classChain: string): boolean {
  return /recaptcha/i.test(src || '') && /\bgrecaptcha-badge\b/i.test(classChain || '');
}

const WIDGET_SELECTORS: Array<{ sel: string; kind: CaptchaKind }> = [
  { sel: '.g-recaptcha', kind: 'recaptcha' },
  { sel: 'iframe[src*="recaptcha/api2"]', kind: 'recaptcha' },
  { sel: '#recaptcha', kind: 'recaptcha' },
  { sel: '.h-captcha', kind: 'hcaptcha' },
  { sel: 'iframe[src*="hcaptcha.com"]', kind: 'hcaptcha' },
  { sel: '.cf-turnstile', kind: 'turnstile' },
  { sel: 'iframe[src*="challenges.cloudflare.com"]', kind: 'turnstile' },
  { sel: 'iframe[src*="geetest.com"]', kind: 'geetest' },
  { sel: '[id^="arkose"]', kind: 'arkoselabs' },
  { sel: 'iframe[src*="arkoselabs.com"]', kind: 'arkoselabs' },
  { sel: 'iframe[src*="funcaptcha.com"]', kind: 'funcaptcha' },
  { sel: '[data-sitekey]', kind: 'unknown' },
];

const TEXT_MARKERS: Array<{ rx: RegExp; kind: CaptchaKind }> = [
  { rx: /\bverify\s+you\s*(?:are\s*|['\u2019]\s*re\s*)?(?:a\s*)?human\b/i, kind: 'text-marker' },
  { rx: /\brecaptcha\b/i, kind: 'recaptcha' },
  { rx: /\bhcaptcha\b/i, kind: 'hcaptcha' },
  { rx: /\bturnstile\b/i, kind: 'turnstile' },
  { rx: /\bi['\u2019]?m\s+not\s+a\s+robot\b/i, kind: 'text-marker' },
  { rx: /\bplease\s+complete\s+the\s+security\s+check\b/i, kind: 'text-marker' },
];

/**
 * Inspect the page DOM + text for CAPTCHA widgets. Fast (no mutations).
 */
export async function detect(page: Page): Promise<CaptchaDetection> {
  try {
    const domDetection = await page.evaluate(
      ({ widgetSelectors, iframeRxSource }) => {
        const iframeRx = new RegExp(iframeRxSource, 'i');
        const isVisible = (el: Element): boolean => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return false;
          const style = getComputedStyle(el as HTMLElement);
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          return true;
        };

        for (const { sel, kind } of widgetSelectors) {
          let nodes: Element[] = [];
          try {
            nodes = Array.from(document.querySelectorAll(sel));
          } catch {
            nodes = [];
          }
          for (const node of nodes) {
            // reCAPTCHA v3 always injects a bottom-right badge iframe (api2/anchor).
            // That is not a blocking challenge (Yahoo, etc.).
            if (typeof (node as Element).closest === 'function' && (node as Element).closest('.grecaptcha-badge')) {
              continue;
            }
            if (isVisible(node)) {
              return {
                present: true,
                kind,
                evidence: `widget: ${sel}`,
              };
            }
          }
        }

        let iframes: HTMLIFrameElement[] = [];
        try {
          iframes = Array.from(document.querySelectorAll('iframe'));
        } catch {
          iframes = [];
        }
        for (const frame of iframes) {
          if (frame.closest('.grecaptcha-badge')) continue;
          const src = frame.getAttribute('src') || '';
          const m = iframeRx.exec(src);
          if (m) {
            return {
              present: true,
              kind: m[0].toLowerCase().includes('recaptcha')
                ? 'recaptcha'
                : m[0].toLowerCase().includes('hcaptcha')
                ? 'hcaptcha'
                : m[0].toLowerCase().includes('turnstile') || m[0].toLowerCase().includes('cloudflare')
                ? 'turnstile'
                : m[0].toLowerCase().includes('geetest')
                ? 'geetest'
                : m[0].toLowerCase().includes('arkose')
                ? 'arkoselabs'
                : 'funcaptcha',
              evidence: `iframe: ${src.slice(0, 120)}`,
            };
          }
        }

        return { present: false };
      },
      {
        widgetSelectors: WIDGET_SELECTORS,
        iframeRxSource: IFRAME_RX.source,
      }
    );

    if (domDetection?.present) {
      return domDetection as CaptchaDetection;
    }

    // Fall back to visible body text markers.
    try {
      const text = (await page.innerText('body')) || '';
      for (const { rx, kind } of TEXT_MARKERS) {
        const m = rx.exec(text);
        if (m) {
          return { present: true, kind, evidence: `text: "${m[0]}"` };
        }
      }
    } catch {
      /* ignore */
    }
  } catch (error: any) {
    logger.log('warn', `captchaGate.detect failed: ${error?.message || String(error)}`);
  }
  return { present: false };
}

/**
 * Detect + throw. Use between pagination iterations / right before
 * extraction so we fail early instead of scraping a challenge page.
 */
export async function assertNoCaptcha(
  page: Page,
  options: CaptchaGateOptions = {}
): Promise<CaptchaDetection> {
  const detection = await detect(page);
  if (detection.present && options.pauseOnDetect !== false) {
    const url = page.url() || '';
    logger.log(
      'warn',
      `CAPTCHA detected (${detection.kind || 'unknown'}) at ${url} — aborting run. Evidence: ${
        detection.evidence || 'n/a'
      }`
    );
    throw new CaptchaEncounteredError(detection, url);
  }
  return detection;
}

/**
 * Build a serialisable payload for socket / webhook delivery.
 */
export function describe(detection: CaptchaDetection, runId: string, automationId: string, url: string) {
  return {
    runId,
    automationId,
    url,
    kind: detection.kind || 'unknown',
    evidence: detection.evidence || null,
    timestamp: new Date().toISOString(),
  };
}

import { describe, it, expect, vi } from 'vitest';
import * as cheerio from 'cheerio';
import logger from '../../logger';
import {
  dismissNow,
  dismissOverlaysInDocument,
  installDialogHandler,
} from './overlayDismisser';

/** Cheerio does not honor the CSS `i` flag; strip it so fixtures still match. */
const toCheerioSel = (sel: string): string => sel.replace(/\s+i]/gi, ']');

function documentFromHtml(html: string): { document: Document; clicked: string[] } {
  const $ = cheerio.load(`<!DOCTYPE html><html><body>${html}</body></html>`);
  const clicked: string[] = [];
  const wrapCache = new Map<object, Element>();

  const wrap = (node: any): Element => {
    const cached = wrapCache.get(node);
    if (cached) return cached;
    const $el = $(node);
    const api: any = {
      get tagName() {
        return String(node.tagName || '').toUpperCase();
      },
      get textContent() {
        return $el.text();
      },
      get title() {
        return $el.attr('title') || '';
      },
      getBoundingClientRect() {
        return { width: 80, height: 24, top: 0, left: 0, right: 80, bottom: 24 };
      },
      getAttribute(name: string) {
        return $el.attr(name) ?? null;
      },
      click() {
        clicked.push(($el.attr('data-name') || $el.text() || $el.attr('id') || '').trim());
      },
      querySelectorAll(sel: string) {
        return $el.find(toCheerioSel(sel)).toArray().map(wrap);
      },
      contains(other: any) {
        const otherNode = other?.__node;
        if (!otherNode || otherNode === node) return false;
        return $el.find(otherNode).length > 0;
      },
      __node: node,
    };
    wrapCache.set(node, api);
    return api;
  };

  const document = {
    defaultView: {
      getComputedStyle() {
        return {
          visibility: 'visible',
          display: 'block',
          opacity: '1',
          pointerEvents: 'auto',
        };
      },
    },
    querySelectorAll(sel: string) {
      return $(toCheerioSel(sel)).toArray().map(wrap);
    },
  } as unknown as Document;

  return { document, clicked };
}

const ORACLE_HCM_CHROME = `
  <header class="app-banner">
    <div id="lang-switcher" class="lang-menu">
      <button data-name="nav-english">English</button>
      <a data-name="nav-french" href="/hcmUI/CandidateExperience/fr/sites/CX_1001/jobs">Français</a>
    </div>
  </header>
  <div class="search-overlay">
    <button data-name="overlay-continue">Continue</button>
    <a data-name="overlay-next" href="/hcmUI/CandidateExperience/en/sites/CX_1001/jobs?page=2">Next</a>
  </div>
  <div class="oj-modal oj-overlay">
    <button data-name="modal-ok">OK</button>
    <button data-name="modal-skip">Skip</button>
  </div>
  <div class="job-card-overlay">
    <a data-name="job-link" href="/hcmUI/CandidateExperience/en/sites/CX_1001/job/210686668">Data Engineer</a>
  </div>
  <div class="results-banner">
    <button data-name="banner-allow">Allow</button>
    <button data-name="banner-later">Later</button>
  </div>
  <div class="popup-filter">
    <button data-name="filter-continue">Continue</button>
  </div>
`;

describe('dismissOverlaysInDocument', () => {
  it('does not click Oracle HCM search chrome that only matches modal/overlay/banner/lang', () => {
    const { document, clicked } = documentFromHtml(ORACLE_HCM_CHROME);
    const clicks = dismissOverlaysInDocument(document);
    expect(clicks).toBe(0);
    expect(clicked).toEqual([]);
  });

  it('does not click Continue/OK inside a non-consent filter dialog', () => {
    const { document, clicked } = documentFromHtml(`
      <div role="dialog">
        <p>Filter jobs</p>
        <button data-name="filter-continue">Continue</button>
        <button data-name="filter-ok">OK</button>
      </div>
    `);
    const clicks = dismissOverlaysInDocument(document);
    expect(clicked).not.toContain('filter-continue');
    expect(clicked).not.toContain('filter-ok');
    expect(clicks).toBe(0);
  });

  it('does not follow a navigational Continue link even inside a cookie node', () => {
    const { document, clicked } = documentFromHtml(`
      <div class="cookie-banner">
        <a data-name="cookie-continue" href="https://jpmc.fa.oraclecloud.com/hcmUI/foo">Continue</a>
      </div>
    `);
    expect(dismissOverlaysInDocument(document)).toBe(0);
    expect(clicked).toEqual([]);
  });

  it('clicks a known OneTrust accept button', () => {
    const { document, clicked } = documentFromHtml(`
      <div id="onetrust-banner-sdk" class="cookie-banner">
        <button id="onetrust-accept-btn-handler" data-name="onetrust">Accept All</button>
      </div>
    `);
    expect(dismissOverlaysInDocument(document)).toBe(1);
    expect(clicked).toEqual(['onetrust']);
  });

  it('clicks Accept cookies inside a generic consent container', () => {
    const { document, clicked } = documentFromHtml(`
      <div class="cookie-consent">
        <p>We use cookies</p>
        <button data-name="accept-cookies">Accept cookies</button>
      </div>
    `);
    expect(dismissOverlaysInDocument(document)).toBe(1);
    expect(clicked).toEqual(['accept-cookies']);
  });

  it('clicks English only inside a language confirmation dialog, not the nav switcher', () => {
    const { document, clicked } = documentFromHtml(`
      <div id="lang-nav" class="lang-switcher">
        <button data-name="nav-english">English</button>
      </div>
      <div role="dialog" aria-modal="true">
        <p>Please confirm your language</p>
        <button data-name="dialog-english">English</button>
        <button data-name="dialog-french">Français</button>
      </div>
    `);
    expect(dismissOverlaysInDocument(document)).toBe(1);
    expect(clicked).toEqual(['dialog-english']);
  });

  it('clicks Accept all inside a consent dialog', () => {
    const { document, clicked } = documentFromHtml(`
      <div role="dialog" aria-modal="true">
        <p>We use cookies to improve your experience</p>
        <button data-name="accept-all">Accept all</button>
      </div>
    `);
    expect(dismissOverlaysInDocument(document)).toBe(1);
    expect(clicked).toEqual(['accept-all']);
  });

  it('closes a blocking dialog with an explicit close control', () => {
    const { document, clicked } = documentFromHtml(`
      <div role="dialog">
        <p>Subscribe to job alerts</p>
        <button data-name="close-dialog" aria-label="close"></button>
      </div>
    `);
    expect(dismissOverlaysInDocument(document)).toBe(1);
    expect(clicked).toEqual(['close-dialog']);
  });
});

describe('dismissNow', () => {
  it('no-ops when autoDismiss=false', async () => {
    const page: any = { evaluate: vi.fn(async () => 3) };
    const clicks = await dismissNow(page, { autoDismiss: false });
    expect(clicks).toBe(0);
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('returns the number of clicks reported by the page evaluator', async () => {
    const page: any = { evaluate: vi.fn(async () => 2) };
    const clicks = await dismissNow(page);
    expect(clicks).toBe(2);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(page.evaluate).toHaveBeenCalledWith(dismissOverlaysInDocument);
  });

  it('returns 0 and swallows errors when evaluate rejects', async () => {
    const page: any = {
      evaluate: vi.fn(async () => {
        throw new Error('evaluate failed');
      }),
    };
    const clicks = await dismissNow(page);
    expect(clicks).toBe(0);
  });

  it('logs navigation-destroyed evaluate errors at info, not warn', async () => {
    const log = vi.spyOn(logger, 'log').mockImplementation(() => logger);
    const page: any = {
      evaluate: vi.fn(async () => {
        throw new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation');
      }),
    };
    await expect(dismissNow(page)).resolves.toBe(0);
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('Execution context was destroyed'));
    log.mockRestore();
  });
});

describe('installDialogHandler', () => {
  it('registers a page dialog listener and returns a detach fn', () => {
    const page: any = { on: vi.fn(), off: vi.fn() };
    const detach = installDialogHandler(page);
    expect(page.on).toHaveBeenCalledWith('dialog', expect.any(Function));
    detach();
    expect(page.off).toHaveBeenCalledTimes(1);
  });

  it('dismisses dialogs by default', async () => {
    let handler: ((d: any) => void) | undefined;
    const page: any = { on: (evt: string, h: any) => ((handler = h), undefined), off: vi.fn() };
    installDialogHandler(page);
    expect(handler).toBeDefined();

    const dialog = { type: () => 'confirm', message: () => 'continue?', accept: vi.fn(), dismiss: vi.fn() };
    await handler!(dialog);
    expect(dialog.dismiss).toHaveBeenCalled();
    expect(dialog.accept).not.toHaveBeenCalled();
  });

  it('accepts dialogs when acceptDialogs=true', async () => {
    let handler: ((d: any) => void) | undefined;
    const page: any = { on: (_: string, h: any) => ((handler = h), undefined), off: vi.fn() };
    installDialogHandler(page, { acceptDialogs: true });

    const dialog = { type: () => 'alert', message: () => '18+?', accept: vi.fn(), dismiss: vi.fn() };
    await handler!(dialog);
    expect(dialog.accept).toHaveBeenCalled();
    expect(dialog.dismiss).not.toHaveBeenCalled();
  });
});

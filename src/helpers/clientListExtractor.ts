/**
 * Client-Side List Data Extractor
 * Ported from src/helpers/clientListExtractor.ts for Chrome extension content script.
 * Handles XPath, CSS selectors, iframe combinators, shadow DOM traversal.
 */

interface ExtractedListData {
  [key: string]: string;
}

interface Field {
  selector: string;
  attribute: string;
  tag?: string;
  isShadow?: boolean;
  /** If true, this field comes from Schema.org JSON-LD — selector IS the value, not a CSS selector */
  fromSchema?: boolean;
}

export class ClientListExtractor {
  private static readonly COMPANY_NOISE_PATTERNS = [
    /why this job is a match/i,
    /good match/i,
    /strong match/i,
    /ask orion/i,
    /^recommended$/i,
    /** Short mega-menu labels mistaken for employer (e.g. SIA "Culture" under Join us) */
    /^culture$/i,
    /^insights$/i,
  ];

  private isNoisyCompanyValue(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return true;
    return ClientListExtractor.COMPANY_NOISE_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  /** Single-word / short nav labels that are not employer names */
  private isLikelyNavOrSectionLabel(text: string): boolean {
    const t = text.trim();
    if (!t || t.length > 120) return false;
    return /^(culture|insights|about(\s+us)?|contact|join\s+us)$/i.test(t.trim());
  }

  /**
   * `[class*="company"]` matches compound classes like `company-culture` (nav), not just employer fields.
   */
  private isCompanyCandidateClassFalsePositive(node: Element): boolean {
    const raw = (node as HTMLElement).className;
    const cn = typeof raw === 'string' ? raw.toLowerCase() : '';
    return /\bcompany-culture\b|companyculture|culture-link|menu-item--culture|nav-company\b/i.test(cn);
  }

  private inferCompanyFromPageMetadata(doc: Document | null): string | null {
    if (!doc) return null;
    const og = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim();
    if (og && og.length <= 160 && !this.isLikelyNavOrSectionLabel(og)) return og;
    const app = doc.querySelector('meta[name="application-name"]')?.getAttribute('content')?.trim();
    if (app && app.length <= 160 && !this.isLikelyNavOrSectionLabel(app)) return app;
    return null;
  }

  private inferCompanyFromContainer(container: Element): string | null {
    const candidateSelectors = [
      '[data-testid*="company"]',
      '[data-company]',
      '[data-employer]',
      '[class*="company-name"]',
      '[class*="employer-name"]',
      '[class*="employer"]',
      '[class*="subtitle"]',
      '[class*="meta"]',
      'a[href*="/company/"]',
      'h2 + div',
      'h3 + div',
      /** Last — substring "company" also matches `company-culture` etc.; filter below */
      '[class*="company"]',
    ];

    for (const selector of candidateSelectors) {
      for (const node of Array.from(container.querySelectorAll(selector))) {
        if (this.isCompanyCandidateClassFalsePositive(node)) continue;
        if (node.closest('nav, header, [role="navigation"]')) continue;

        const text = ((node as HTMLElement).innerText || node.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!text || this.isNoisyCompanyValue(text) || this.isLikelyNavOrSectionLabel(text)) continue;

        // Common job-card subtitle format: "Company / Industry · Stage"
        const firstChunk = text.split('·')[0]?.split('/')[0]?.trim() || text;
        if (
          firstChunk &&
          !this.isNoisyCompanyValue(firstChunk) &&
          !this.isLikelyNavOrSectionLabel(firstChunk) &&
          firstChunk.length <= 120
        ) {
          return firstChunk;
        }
      }
    }

    return null;
  }

  private inferUrlFromContainer(container: Element): string | null {
    const resolveAbs = (raw: string): string | null => {
      const value = (raw || '').trim();
      if (!value) return null;
      const low = value.toLowerCase();
      if (low.startsWith('javascript:') || low === '#' || low.startsWith('mailto:') || low.startsWith('tel:')) {
        return null;
      }
      const base = container.ownerDocument?.location?.href || window.location.href;
      try {
        return new URL(value, base).href;
      } catch {
        return null;
      }
    };

    const isLikelyJobUrl = (url: string): boolean => {
      const low = url.toLowerCase();
      return (
        /\/job|\/jobs|jobid|job-id|position|career|opening|vacanc/.test(low) &&
        !/linkedin\.com\/feed|\/messages|\/settings|\/profile/.test(low)
      );
    };

    // 1) Prefer obvious anchors likely to be detail pages.
    const anchorSelectors = [
      'a[href*="/job"]',
      'a[href*="/jobs"]',
      'a[href*="jobId"]',
      'a[href*="position"]',
      'a[aria-label*="Apply"]',
      'a[aria-label*="View"]',
      'h2 a[href]',
      'h3 a[href]',
      'a[href]',
    ];

    for (const selector of anchorSelectors) {
      for (const el of Array.from(container.querySelectorAll(selector))) {
        const href = resolveAbs((el as HTMLAnchorElement).getAttribute('href') || '');
        if (href && isLikelyJobUrl(href)) return href;
      }
    }

    // 2) Try common data attributes used by card frameworks.
    const dataUrlAttrs = ['data-href', 'data-url', 'data-link', 'data-job-url', 'data-job-link'];
    for (const attr of dataUrlAttrs) {
      const nodes = Array.from(container.querySelectorAll(`[${attr}]`));
      for (const node of nodes) {
        const candidate = resolveAbs(node.getAttribute(attr) || '');
        if (candidate && isLikelyJobUrl(candidate)) return candidate;
      }
    }

    // 3) Last resort: use broad picker scorer.
    const best = this.pickBestUrlFromListRow(container);
    if (best && isLikelyJobUrl(best)) return best;
    return best;
  }

  private evaluateXPath(
    rootElement: Element | Document,
    xpath: string
  ): Element | null {
    try {
      const ownerDoc =
        rootElement.nodeType === Node.DOCUMENT_NODE
          ? (rootElement as Document)
          : rootElement.ownerDocument;
      if (!ownerDoc) return null;

      const result = ownerDoc.evaluate(
        xpath, rootElement, null,
        XPathResult.FIRST_ORDERED_NODE_TYPE, null
      );
      return result.singleNodeValue as Element | null;
    } catch {
      return null;
    }
  }

  private evaluateXPathAll(
    rootElement: Element | Document,
    xpath: string
  ): Element[] {
    try {
      const ownerDoc =
        rootElement.nodeType === Node.DOCUMENT_NODE
          ? (rootElement as Document)
          : rootElement.ownerDocument;
      if (!ownerDoc) return [];

      const result = ownerDoc.evaluate(
        xpath, rootElement, null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
      );

      const elements: Element[] = [];
      for (let i = 0; i < result.snapshotLength; i++) {
        const node = result.snapshotItem(i);
        if (node && node.nodeType === Node.ELEMENT_NODE) {
          elements.push(node as Element);
        }
      }
      return elements;
    } catch {
      return [];
    }
  }

  private queryElement(
    rootElement: Element | Document,
    selector: string
  ): Element | null {
    // XPath selectors
    if (selector.startsWith('//') || selector.startsWith('/') || selector.startsWith('./')) {
      return this.evaluateXPath(rootElement, selector);
    }

    // Selector uses iframe (:>>) or shadow DOM (>>) combinators
    if (selector.includes('>>') || selector.includes(':>>')) {
      return this.queryElementWithCombinators(rootElement, selector);
    }

    // Plain CSS selector (may include > combinators between simple selectors)
    // e.g. ".parent > .child" — querySelector handles this natively
    return rootElement.querySelector(selector);
  }

  /**
   * Handle selectors with >> or :>> iframe/shadow DOM combinators.
   */
  private queryElementWithCombinators(
    rootElement: Element | Document,
    selector: string
  ): Element | null {
    const parts = selector.split(/(?:>>|:>>)/).map((p) => p.trim());
    let currentElement: Element | Document | null = rootElement;

    for (let i = 0; i < parts.length; i++) {
      if (!currentElement) return null;

      if ((currentElement as Element).tagName === 'IFRAME' || (currentElement as Element).tagName === 'FRAME') {
        try {
          const frameElement = currentElement as HTMLIFrameElement | HTMLFrameElement;
          const frameDoc = frameElement.contentDocument || frameElement.contentWindow?.document;
          if (!frameDoc) return null;

          if (parts[i].startsWith('//') || parts[i].startsWith('/') || parts[i].startsWith('./')) {
            currentElement = this.evaluateXPath(frameDoc, parts[i]);
          } else {
            currentElement = frameDoc.querySelector(parts[i]);
          }
          continue;
        } catch {
          return null;
        }
      }

      if ('querySelector' in currentElement) {
        if (parts[i].startsWith('//') || parts[i].startsWith('/') || parts[i].startsWith('./')) {
          currentElement = this.evaluateXPath(currentElement, parts[i]);
        } else {
          currentElement = currentElement.querySelector(parts[i]);
        }
      } else {
        currentElement = null;
      }
    }

    return currentElement as Element | null;
  }

  private queryElementAll(
    rootElement: Element | Document,
    selector: string
  ): Element[] {
    if (!selector.includes('>>') && !selector.includes(':>>')) {
      if (selector.startsWith('//') || selector.startsWith('/')) {
        return this.evaluateXPathAll(rootElement, selector);
      }
      return Array.from(rootElement.querySelectorAll(selector));
    }

    const parts = selector.split(/(?:>>|:>>)/).map((p) => p.trim());
    let currentElements: (Element | Document)[] = [rootElement];

    for (const part of parts) {
      const nextElements: Element[] = [];

      for (const element of currentElements) {
        if ((element as Element).tagName === 'IFRAME' || (element as Element).tagName === 'FRAME') {
          try {
            const frameElement = element as HTMLIFrameElement | HTMLFrameElement;
            const frameDoc = frameElement.contentDocument || frameElement.contentWindow?.document;
            if (frameDoc) {
              if (part.startsWith('//') || part.startsWith('/')) {
                nextElements.push(...this.evaluateXPathAll(frameDoc, part));
              } else {
                nextElements.push(...Array.from(frameDoc.querySelectorAll(part)));
              }
            }
          } catch {
            continue;
          }
        } else if ('querySelectorAll' in element) {
          if (part.startsWith('//') || part.startsWith('/')) {
            nextElements.push(...this.evaluateXPathAll(element, part));
          } else {
            nextElements.push(...Array.from(element.querySelectorAll(part)));
          }
        }
      }

      currentElements = nextElements;
    }

    return currentElements as Element[];
  }

  /**
   * @param listItemContainer - The list row root (used to find job URLs when the
   *   matched field node is not inside the same `<a>` as the detail link).
   */
  /**
   * Best-effort job detail URL from a list row (and a few ancestors) when the
   * configured url selector misses or points at a non-link node.
   */
  private pickBestUrlFromListRow(container: Element | null): string | null {
    if (!container) return null;
    const resolveUrlLikeFromEl = (el: Element | null): string | null => {
      if (!el) return null;
      const raw = (
        el.getAttribute('href') ||
        el.getAttribute('data-href') ||
        el.getAttribute('data-url') ||
        el.getAttribute('data-link') ||
        ''
      ).trim();
      if (!raw) return null;
      const low = raw.toLowerCase();
      if (low.startsWith('javascript:') || low === '#' || low.startsWith('mailto:') || low.startsWith('tel:'))
        return null;
      const base = el.ownerDocument?.location?.href || window.location.origin;
      try {
        return new URL(raw, base).href;
      } catch {
        return raw;
      }
    };
    const scorePath = (pathname: string, absLower: string): number => {
      const p = pathname.toLowerCase();
      let score = 12 + Math.min(pathname.length, 120) / 40;
      if (p.includes('/job')) score += 110;
      if (p.includes('/jobs')) score += 90;
      if (p.includes('/content/en/jobs')) score += 95;
      if (p.includes('job-detail') || p.includes('jobdetail')) score += 75;
      if (p.includes('/career')) score += 38;
      if (absLower.includes('amazon.jobs') && p.length > 15) score += 15;
      return score;
    };
    const scored: { href: string; score: number }[] = [];
    const gather = (row: Element, depthPenalty: number) => {
      const seen = new Set<Element>();
      const q = 'a, [href], [data-href], [data-url], [data-link], [role="link"]';
      for (const n of Array.from(row.querySelectorAll(q))) {
        if (seen.has(n)) continue;
        seen.add(n);
        const abs = resolveUrlLikeFromEl(n);
        if (!abs) continue;
        let path = '';
        try {
          path = new URL(abs).pathname;
        } catch {
          path = abs;
        }
        let sc = scorePath(path, abs.toLowerCase()) - depthPenalty;
        if (n.getAttribute('aria-disabled') === 'true') sc -= 45;
        if (n.tagName === 'A' && !(n.getAttribute('href') || '').trim()) sc -= 25;
        scored.push({ href: abs, score: sc });
      }
    };
    let hop: Element | null = container;
    for (let d = 0; d < 5 && hop; d++) {
      gather(hop, d * 28);
      hop = hop.parentElement;
    }
    if (!scored.length) return null;
    const best = new Map<string, number>();
    for (const { href: h, score: s } of scored) {
      const prev = best.get(h);
      if (prev === undefined || s > prev) best.set(h, s);
    }
    let topHref = '';
    let topScore = -1e9;
    for (const [h, s] of best) {
      if (s > topScore) {
        topScore = s;
        topHref = h;
      }
    }
    return topHref || null;
  }

  private extractValue(
    element: Element | null,
    attribute: string,
    fixedValue?: string,
    listItemContainer?: Element | null
  ): string | null {
    if (attribute === 'href' && !element && listItemContainer) {
      return this.pickBestUrlFromListRow(listItemContainer);
    }
    if (!element) return null;

    // Fixed value: company name from page-level detection, not from DOM
    if (attribute === 'fixed' && fixedValue !== undefined) {
      return fixedValue;
    }

    const baseURL = element.ownerDocument?.location?.href || window.location.origin;

    if (element.shadowRoot) {
      const shadowContent = element.shadowRoot.textContent;
      if (shadowContent?.trim()) return shadowContent.trim();
    }

    if (attribute === 'innerText') {
      // Try direct text first
      let textContent =
        (element as HTMLElement).innerText?.trim() ||
        (element as HTMLElement).textContent?.trim();

      // If empty, try recursively collecting text from children (handles nested spans like Amazon prices)
      if (!textContent) {
        textContent = this.collectTextDeep(element);
      }

      // If still empty, try data attributes
      if (!textContent) {
        const dataAttributes = ['data-600', 'data-text', 'data-label', 'data-value', 'data-content', 'data-price', 'data-amount', 'aria-label'];
        for (const attr of dataAttributes) {
          const dataValue = element.getAttribute(attr);
          if (dataValue?.trim()) {
            textContent = dataValue.trim();
            break;
          }
        }
      }

      return textContent || null;
    } else if (attribute === 'innerHTML') {
      return element.innerHTML?.trim() || null;
    } else if (attribute === 'href') {
      const resolveUrlLikeFromEl = (anchorEl: Element | null): string | null => {
        if (!anchorEl) return null;
        const hrefValue =
          anchorEl.getAttribute('href') ||
          anchorEl.getAttribute('data-href') ||
          anchorEl.getAttribute('data-url') ||
          anchorEl.getAttribute('data-link') ||
          '';
        if (!hrefValue.trim()) return null;
        const low = hrefValue.trim().toLowerCase();
        if (low.startsWith('javascript:') || low === '#' || low.startsWith('mailto:') || low.startsWith('tel:'))
          return null;
        try {
          return new URL(hrefValue.trim(), baseURL).href;
        } catch {
          return hrefValue.trim();
        }
      };

      let anchorElement: Element = element;
      if (element.tagName !== 'A') {
        const up = element.closest('a') || element.parentElement?.closest('a');
        if (up) anchorElement = up;
      }
      const fromAncestor = resolveUrlLikeFromEl(anchorElement);
      if (fromAncestor) return fromAncestor;

      return this.pickBestUrlFromListRow(listItemContainer || element);
    } else if (attribute === 'src') {
      const attrValue = element.getAttribute(attribute);
      const dataAttr = attrValue || element.getAttribute('data-' + attribute);
      if (!dataAttr?.trim()) {
        const style = window.getComputedStyle(element as HTMLElement);
        const bgImage = style.backgroundImage;
        if (bgImage && bgImage !== 'none') {
          const matches = bgImage.match(/url\(['"]?([^'")]+)['"]?\)/);
          return matches ? new URL(matches[1], baseURL).href : null;
        }
        return null;
      }
      try {
        return new URL(dataAttr, baseURL).href;
      } catch {
        return dataAttr;
      }
    }

    return element.getAttribute(attribute);
  }

  /**
   * Recursively collect text from an element and its children.
   * Handles cases like Amazon's price structure: <span class="a-price"><sup>$</sup><span class="a-price-whole">59</span></span>
   */
  private collectTextDeep(element: Element): string {
    const parts: string[] = [];

    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim();
        if (text) parts.push(text);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        const tag = el.tagName;
        // Skip script/style/decorative elements
        if (['SCRIPT', 'STYLE', 'SVG', 'NOSCRIPT', 'IFRAME'].includes(tag)) continue;
        const childText = this.collectTextDeep(el);
        if (childText) parts.push(childText);
      }
    }

    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Extract list data from the document.
   * @param doc - The document to extract from (page document in extension context)
   * @param listSelector - CSS or XPath selector for list items
   * @param fields - Map of field name -> { selector, attribute }
   * @param limit - Max items to extract (0 = unlimited)
   */
  public extractListData(
    doc: Document,
    listSelector: string,
    fields: Record<string, Field>,
    limit: number = 0
  ): ExtractedListData[] {
    try {
      const containers = this.queryElementAll(doc, listSelector);
      if (containers.length === 0) return [];

      const extractedData: ExtractedListData[] = [];
      const maxItems = limit > 0 ? Math.min(containers.length, limit) : containers.length;

      for (let i = 0; i < maxItems; i++) {
        const container = containers[i];
        const record: ExtractedListData = {};

        for (const [label, { selector, attribute, isShadow, fromSchema }] of Object.entries(fields)) {
          // Schema.org JSON-LD fields: selector IS the value, return it directly
          if (fromSchema || attribute === 'fixed') {
            record[label] = selector;
            continue;
          }

          let element: Element | null = null;

          if (selector.startsWith('//')) {
            const indexedSelector = this.createIndexedXPath(selector, listSelector, i + 1);
            element = this.evaluateXPathSingle(doc, indexedSelector, isShadow);
          } else {
            element = this.queryElement(container, selector);
          }

          if (element) {
            const value = this.extractValue(element, attribute, undefined, container);
            record[label] = value !== null && value !== '' ? value : '';
          } else if (attribute === 'href' && container) {
            const value = this.extractValue(null, attribute, undefined, container);
            record[label] = value !== null && value !== '' ? value : '';
          } else {
            record[label] = '';
          }
        }

        // Heuristic correction: some boards return recommendation badge text for company.
        const companyKey = Object.keys(record).find((key) => /company/i.test(key));
        if (companyKey) {
          const rawCompany = (record[companyKey] || '').trim();
          const doc = container.ownerDocument;
          if (
            !rawCompany ||
            this.isNoisyCompanyValue(rawCompany) ||
            this.isLikelyNavOrSectionLabel(rawCompany)
          ) {
            let inferredCompany = this.inferCompanyFromContainer(container);
            if (!inferredCompany || this.isLikelyNavOrSectionLabel(inferredCompany)) {
              inferredCompany = this.inferCompanyFromPageMetadata(doc);
            }
            if (inferredCompany) {
              record[companyKey] = inferredCompany;
            }
          }
        }

        const urlKey = Object.keys(record).find((key) => /(url|link)/i.test(key));
        if (urlKey) {
          const rawUrl = (record[urlKey] || '').trim();
          if (!rawUrl) {
            const inferredUrl = this.inferUrlFromContainer(container);
            if (inferredUrl) {
              record[urlKey] = inferredUrl;
            }
          }
        }

        if (Object.values(record).some((v) => v !== '')) {
          extractedData.push(record);
        }
      }

      return extractedData;
    } catch (error) {
      console.error('Error in extractListData:', error);
      return [];
    }
  }

  /**
   * Count how many items match the list selector.
   */
  public countListItems(doc: Document, listSelector: string): number {
    try {
      return this.queryElementAll(doc, listSelector).length;
    } catch {
      return 0;
    }
  }

  private createIndexedXPath(childSelector: string, listSelector: string, containerIndex: number): string {
    if (childSelector.includes(listSelector.replace('//', ''))) {
      const listPattern = listSelector.replace('//', '');
      const indexedListSelector = `(${listSelector})[${containerIndex}]`;
      return childSelector.replace(`//${listPattern}`, indexedListSelector);
    }
    return `(${listSelector})[${containerIndex}]${childSelector.replace('//', '/')}`;
  }

  private evaluateXPathSingle(
    doc: Document,
    xpath: string,
    isShadow: boolean = false
  ): Element | null {
    try {
      const result = doc.evaluate(
        xpath, doc, null,
        XPathResult.FIRST_ORDERED_NODE_TYPE, null
      ).singleNodeValue as Element | null;

      if (!isShadow) return result;

      // Shadow DOM traversal for XPath
      let cleanPath = xpath;
      let isIndexed = false;
      const indexedMatch = xpath.match(/^\((.*?)\)\[(\d+)\](.*)$/);
      if (indexedMatch) {
        cleanPath = indexedMatch[1] + indexedMatch[3];
        isIndexed = true;
      }

      const pathParts = cleanPath
        .replace(/^\/\//, '')
        .split('/')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      let currentContexts: (Document | Element | ShadowRoot)[] = [doc];

      for (const part of pathParts) {
        const nextContexts: (Element | ShadowRoot)[] = [];

        for (const ctx of currentContexts) {
          const { tagName, conditions } = this.parseXPathPart(part);
          const matched = Array.from(ctx.querySelectorAll(tagName)).filter(
            (el) => this.elementMatchesConditions(el, conditions)
          );

          const positionalMatch = part.match(/^([^[]+)\[(\d+)\]$/);
          if (positionalMatch) {
            const idx = parseInt(positionalMatch[2]) - 1;
            if (idx >= 0 && idx < matched.length) {
              const el = matched[idx];
              nextContexts.push(el);
              const shadow = el.shadowRoot;
              if (shadow) nextContexts.push(shadow);
            }
          } else {
            matched.forEach((el) => {
              nextContexts.push(el);
              const shadow = el.shadowRoot;
              if (shadow) nextContexts.push(shadow);
            });
          }
        }

        if (nextContexts.length === 0) return null;
        currentContexts = nextContexts;
      }

      if (currentContexts.length > 0) {
        if (isIndexed && indexedMatch) {
          const requestedIndex = parseInt(indexedMatch[2]) - 1;
          if (requestedIndex >= 0 && requestedIndex < currentContexts.length) {
            return currentContexts[requestedIndex] as Element;
          }
          return null;
        }
        return currentContexts[0] as Element;
      }

      return null;
    } catch {
      return null;
    }
  }

  private parseXPathPart(part: string): { tagName: string; conditions: string[] } {
    const tagMatch = part.match(/^([a-zA-Z0-9-]+)/);
    const tagName = tagMatch ? tagMatch[1] : '*';
    const conditionMatches = part.match(/\[([^\]]+)\]/g);
    const conditions = conditionMatches ? conditionMatches.map((c) => c.slice(1, -1)) : [];
    return { tagName, conditions };
  }

  private elementMatchesConditions(element: Element, conditions: string[]): boolean {
    return conditions.every((c) => this.elementMatchesCondition(element, c));
  }

  private elementMatchesCondition(element: Element, condition: string): boolean {
    condition = condition.trim();
    if (/^\d+$/.test(condition)) return true;

    const attrMatch = condition.match(/^@([^=]+)=["']([^"']+)["']$/);
    if (attrMatch) return element.getAttribute(attrMatch[1]) === attrMatch[2];

    const classContainsMatch = condition.match(/^contains\(@class,\s*["']([^"']+)["']\)$/);
    if (classContainsMatch) return element.classList.contains(classContainsMatch[1]);

    const attrContainsMatch = condition.match(/^contains\(@([^,]+),\s*["']([^"']+)["']\)$/);
    if (attrContainsMatch) return (element.getAttribute(attrContainsMatch[1]) || '').includes(attrContainsMatch[2]);

    const textMatch = condition.match(/^text\(\)=["']([^"']+)["']$/);
    if (textMatch) return (element.textContent?.trim() || '') === textMatch[1];

    const textContainsMatch = condition.match(/^contains\(text\(\),\s*["']([^"']+)["']\)$/);
    if (textContainsMatch) return (element.textContent?.trim() || '').includes(textContainsMatch[1]);

    if (condition === 'count(*)=0') return element.children.length === 0;

    const countMatch = condition.match(/^count\(\*\)=(\d+)$/);
    if (countMatch) return element.children.length === parseInt(countMatch[1]);

    return true;
  }
}

export const clientListExtractor = new ClientListExtractor();

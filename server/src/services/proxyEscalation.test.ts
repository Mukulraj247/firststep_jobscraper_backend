import { describe, expect, it } from 'vitest';
import {
  classifyProxyEscalation,
  hasConfiguredLastResortProxy,
  isProxyAllowedForAttempt,
  retryReasonFromEscalation,
} from './proxyEscalation';

describe('classifyProxyEscalation', () => {
  it('treats captcha as block-like', () => {
    expect(classifyProxyEscalation('anything', { isCaptcha: true })).toBe('blockLike');
  });

  it('detects proxy tunnel failures', () => {
    expect(
      classifyProxyEscalation('page.goto: net::ERR_TUNNEL_CONNECTION_FAILED at https://x/')
    ).toBe('proxyTunnel');
  });

  it('detects OOM without escalating to proxy', () => {
    expect(classifyProxyEscalation('JavaScript heap out of memory')).toBe('networkOrOom');
    expect(classifyProxyEscalation('Target page closed after OOM kill')).toBe('networkOrOom');
  });

  it('detects plain network failures without proxy escalate', () => {
    expect(classifyProxyEscalation('page.goto: net::ERR_CONNECTION_RESET')).toBe('networkOrOom');
    expect(classifyProxyEscalation('page.goto: net::ERR_NAME_NOT_RESOLVED')).toBe('networkOrOom');
  });

  it('detects block-like challenges without treating a closed browser as proxy spend', () => {
    expect(classifyProxyEscalation('Cloudflare challenge did not clear before extraction')).toBe(
      'blockLike'
    );
    expect(
      classifyProxyEscalation('locator.count: Target page, context or browser has been closed')
    ).toBe('networkOrOom');
    expect(
      classifyProxyEscalation('page.waitForTimeout: Target page, context or browser has been closed')
    ).toBe('networkOrOom');
    expect(classifyProxyEscalation('Amazon anti-bot challenge did not clear')).toBe('blockLike');
  });

  it('does not burn proxy on bare navigation timeouts', () => {
    expect(classifyProxyEscalation('page.goto: Timeout 20000ms exceeded.')).toBe('networkOrOom');
  });

  it('detects Page crashed as network/OOM without proxy spend', () => {
    expect(classifyProxyEscalation('page.goto: Page crashed')).toBe('networkOrOom');
    expect(classifyProxyEscalation('page.evaluate: Target crashed')).toBe('networkOrOom');
  });
});

describe('retryReasonFromEscalation', () => {
  it('maps kinds to queue retry reasons', () => {
    expect(retryReasonFromEscalation('blockLike')).toBe('block');
    expect(retryReasonFromEscalation('proxyTunnel')).toBe('proxy-tunnel');
    expect(retryReasonFromEscalation('networkOrOom')).toBe('network');
  });
});

describe('isProxyAllowedForAttempt', () => {
  it('keeps attempt 0 direct unless the robot remembers needsProxy', () => {
    expect(
      isProxyAllowedForAttempt({ attemptsMade: 0, needsProxy: false, retryReason: undefined })
    ).toBe(false);
    expect(
      isProxyAllowedForAttempt({ attemptsMade: 0, needsProxy: true, retryReason: undefined })
    ).toBe(true);
  });

  it('allows proxy from attempt 0 when forceProxyFromStart is explicitly set', () => {
    expect(
      isProxyAllowedForAttempt({
        attemptsMade: 0,
        needsProxy: false,
        forceProxyFromStart: true,
      })
    ).toBe(true);
  });

  it('allows proxy only after captcha or block escalate', () => {
    expect(
      isProxyAllowedForAttempt({ attemptsMade: 1, needsProxy: false, retryReason: 'captcha' })
    ).toBe(true);
    expect(
      isProxyAllowedForAttempt({ attemptsMade: 1, needsProxy: false, retryReason: 'block' })
    ).toBe(true);
    expect(
      isProxyAllowedForAttempt({ attemptsMade: 1, needsProxy: false, retryReason: 'network' })
    ).toBe(false);
    expect(
      isProxyAllowedForAttempt({
        attemptsMade: 1,
        needsProxy: false,
        retryReason: 'proxy-tunnel',
      })
    ).toBe(false);
  });
});

describe('hasConfiguredLastResortProxy', () => {
  it('is false when neither UI nor env proxy exists (normal direct path)', () => {
    expect(
      hasConfiguredLastResortProxy({ robotProxyAvailable: false, envProxyAvailable: false })
    ).toBe(false);
  });

  it('is true when UI or env proxy is available', () => {
    expect(
      hasConfiguredLastResortProxy({ robotProxyAvailable: true, envProxyAvailable: false })
    ).toBe(true);
    expect(
      hasConfiguredLastResortProxy({ robotProxyAvailable: false, envProxyAvailable: true })
    ).toBe(true);
  });
});

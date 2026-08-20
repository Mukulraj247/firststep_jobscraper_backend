import { describe, expect, it } from 'vitest';
import {
  inAppBackHref,
  inAppBackLabel,
  isSafeInAppReturnPath,
  popReturnNavigateOptions,
  pushReturnState,
} from './inAppReturn';

describe('inAppReturn', () => {
  it('rejects off-site and auth return paths', () => {
    expect(isSafeInAppReturnPath('/failures?reason=captcha')).toBe(true);
    expect(isSafeInAppReturnPath('https://evil.example')).toBe(false);
    expect(isSafeInAppReturnPath('//evil.example')).toBe(false);
    expect(isSafeInAppReturnPath('/login')).toBe(false);
  });

  it('preserves a stack so nested details can walk back one page at a time', () => {
    const fromFailures = pushReturnState({
      pathname: '/run/abc',
      search: '',
      state: { returnTo: '/failures?reason=captcha' },
    });
    expect(fromFailures).toEqual({
      returnTo: '/run/abc',
      from: '/failures?reason=captcha',
    });

    const closingData = popReturnNavigateOptions(fromFailures, '/automations');
    expect(closingData).toEqual({
      href: '/run/abc',
      state: { returnTo: '/failures?reason=captcha' },
    });
    expect(inAppBackHref('https://evil.example', '/automations')).toBe('/automations');
    expect(inAppBackLabel('/failures?q=jhu')).toBe('Back to Failures');
    expect(inAppBackLabel('/run/abc')).toBe('Back to Run');
  });
});

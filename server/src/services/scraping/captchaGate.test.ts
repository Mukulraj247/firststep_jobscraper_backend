import { describe as vdescribe, it, expect, vi } from 'vitest';
import {
  assertNoCaptcha,
  CaptchaEncounteredError,
  describe as describeCaptcha,
  detect,
  isRecaptchaV3BadgeContext,
} from './captchaGate';

function mockPage(opts: {
  evaluateReturn?: any;
  innerText?: string;
  url?: string;
}): any {
  return {
    evaluate: vi.fn(async () => opts.evaluateReturn ?? { present: false }),
    innerText: vi.fn(async () => opts.innerText ?? ''),
    url: () => opts.url ?? 'https://example.test/',
  };
}

vdescribe('isRecaptchaV3BadgeContext', () => {
  it('ignores Yahoo-style recaptcha/api2/anchor inside .grecaptcha-badge', () => {
    expect(
      isRecaptchaV3BadgeContext(
        'https://www.google.com/recaptcha/api2/anchor?ar=1&k=6LeWOiIfAAAAAEbO7wAwK5PGq2Zj4Idvyphjo4qK',
        'grecaptcha-badge'
      )
    ).toBe(true);
  });

  it('does not ignore a standalone checkbox recaptcha iframe', () => {
    expect(
      isRecaptchaV3BadgeContext(
        'https://www.google.com/recaptcha/api2/anchor?k=checkbox',
        'g-recaptcha'
      )
    ).toBe(false);
  });
});

vdescribe('captchaGate.detect', () => {
  it('returns present=true when the DOM evaluator finds a widget', async () => {
    const page = mockPage({
      evaluateReturn: { present: true, kind: 'recaptcha', evidence: 'widget: .g-recaptcha' },
    });
    const detection = await detect(page);
    expect(detection.present).toBe(true);
    expect(detection.kind).toBe('recaptcha');
  });

  it('falls back to body-text markers when the DOM pass is empty', async () => {
    const page = mockPage({
      evaluateReturn: { present: false },
      innerText: 'Please verify you are human before continuing.',
    });
    const detection = await detect(page);
    expect(detection.present).toBe(true);
    expect(detection.kind).toBe('text-marker');
  });

  it('returns present=false when the page is clean', async () => {
    const page = mockPage({
      evaluateReturn: { present: false },
      innerText: 'All good here, nothing to see.',
    });
    const detection = await detect(page);
    expect(detection.present).toBe(false);
  });

  it('swallows errors and reports present=false', async () => {
    const page = {
      evaluate: vi.fn(async () => {
        throw new Error('boom');
      }),
      innerText: vi.fn(),
      url: () => 'https://example.test/',
    } as any;
    const detection = await detect(page);
    expect(detection.present).toBe(false);
  });
});

vdescribe('assertNoCaptcha', () => {
  it('throws CaptchaEncounteredError when a CAPTCHA is present and pauseOnDetect defaults to true', async () => {
    const page = mockPage({
      evaluateReturn: { present: true, kind: 'hcaptcha', evidence: 'widget: .h-captcha' },
      url: 'https://target.example/login',
    });
    await expect(assertNoCaptcha(page)).rejects.toBeInstanceOf(CaptchaEncounteredError);
  });

  it('does NOT throw when pauseOnDetect is explicitly false', async () => {
    const page = mockPage({
      evaluateReturn: { present: true, kind: 'recaptcha', evidence: 'widget: #recaptcha' },
    });
    await expect(assertNoCaptcha(page, { pauseOnDetect: false })).resolves.toMatchObject({
      present: true,
      kind: 'recaptcha',
    });
  });

  it('resolves with present=false on clean pages', async () => {
    const page = mockPage({ evaluateReturn: { present: false }, innerText: 'hello world' });
    const result = await assertNoCaptcha(page);
    expect(result.present).toBe(false);
  });
});

vdescribe('describeCaptcha', () => {
  it('produces a serialisable payload with all expected fields', () => {
    const payload = describeCaptcha(
      { present: true, kind: 'recaptcha', evidence: 'widget: .g-recaptcha' },
      'run-123',
      'auto-456',
      'https://target.example/x'
    );
    expect(payload).toMatchObject({
      runId: 'run-123',
      automationId: 'auto-456',
      url: 'https://target.example/x',
      kind: 'recaptcha',
      evidence: 'widget: .g-recaptcha',
    });
    expect(typeof payload.timestamp).toBe('string');
    expect(() => new Date(payload.timestamp)).not.toThrow();
  });
});

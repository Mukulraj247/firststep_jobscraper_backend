import { describe, expect, it } from 'vitest';
import {
  isHttp2ProtocolNavigationError,
  probeHttp11,
  summarizeHttp11Probe,
} from './navigationDiagnostics';

describe('isHttp2ProtocolNavigationError', () => {
  it('recognizes Chromium HTTP/2 protocol navigation failures', () => {
    expect(
      isHttp2ProtocolNavigationError(
        'page.goto: net::ERR_HTTP2_PROTOCOL_ERROR at https://careers.persistent.com/explore-opportunities'
      )
    ).toBe(true);
  });

  it('does not classify unrelated navigation failures as HTTP/2 failures', () => {
    expect(isHttp2ProtocolNavigationError('page.goto: net::ERR_TIMED_OUT')).toBe(false);
  });

  it('recognizes the error when Playwright provides an Error instance', () => {
    expect(
      isHttp2ProtocolNavigationError(
        new Error('page.goto: net::ERR_HTTP2_PROTOCOL_ERROR at https://example.com/jobs')
      )
    ).toBe(true);
  });
});

describe('summarizeHttp11Probe', () => {
  it('keeps only the hostname and status in a successful probe log', () => {
    expect(summarizeHttp11Probe('https://careers.persistent.com/explore-opportunities', 200)).toBe(
      'host=careers.persistent.com status=200'
    );
  });

  it('does not include path or query data in the probe log', () => {
    expect(summarizeHttp11Probe('https://careers.persistent.com/jobs?candidate=private', 503)).toBe(
      'host=careers.persistent.com status=503'
    );
  });
});

describe('probeHttp11', () => {
  it('returns a safe result for invalid URLs without throwing', async () => {
    await expect(probeHttp11('not a URL')).resolves.toBe('host=invalid-url result=invalid-url');
  });

  it('does not probe non-HTTPS URLs', async () => {
    await expect(probeHttp11('http://example.com/jobs?candidate=private')).resolves.toBe(
      'host=example.com result=unsupported-protocol'
    );
  });
});

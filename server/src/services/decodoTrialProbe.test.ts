import { describe, expect, it } from 'vitest';
import {
  buildStickyProxyUsername,
  parseDecodoProbeEnv,
} from './decodoTrialProbe';

describe('buildStickyProxyUsername', () => {
  it('appends a short session so one page keeps the same residential IP', () => {
    expect(buildStickyProxyUsername('user-abc', 'trial1')).toBe('user-abc-session-trial1');
  });

  it('leaves an existing Decodo session suffix alone', () => {
    expect(buildStickyProxyUsername('user-abc-session-keepme', 'other')).toBe(
      'user-abc-session-keepme'
    );
  });
});

describe('parseDecodoProbeEnv', () => {
  it('requires server, credentials, and a public https job URL', () => {
    expect(() => parseDecodoProbeEnv({})).toThrow(/DECODO_PROXY_SERVER/);
    expect(() =>
      parseDecodoProbeEnv({
        DECODO_PROXY_SERVER: 'gate.decodo.com:7000',
        DECODO_PROXY_USERNAME: 'user-x',
        DECODO_PROXY_PASSWORD: 'secret',
      })
    ).toThrow(/DECODO_TEST_URL/);
  });

  it('normalizes the gateway and applies sticky username by default', () => {
    const cfg = parseDecodoProbeEnv({
      DECODO_PROXY_SERVER: 'gate.decodo.com:7000',
      DECODO_PROXY_USERNAME: 'user-x',
      DECODO_PROXY_PASSWORD: 'secret',
      DECODO_TEST_URL: 'https://jobs.example.com/search',
    });
    expect(cfg.server).toBe('http://gate.decodo.com:7000');
    expect(cfg.username).toBe('user-x-session-scoutxtrial');
    expect(cfg.url).toBe('https://jobs.example.com/search');
  });
});

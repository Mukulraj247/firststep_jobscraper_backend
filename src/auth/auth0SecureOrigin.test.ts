import { describe, expect, it } from 'vitest';
import { isAuth0SecureOrigin } from './auth0SecureOrigin';

describe('isAuth0SecureOrigin', () => {
  it('allows https and localhost http', () => {
    expect(isAuth0SecureOrigin('https://scoutx-dev.firststepjob.com')).toBe(true);
    expect(isAuth0SecureOrigin('http://localhost:5173')).toBe(true);
    expect(isAuth0SecureOrigin('http://127.0.0.1:5173')).toBe(true);
  });

  it('rejects bare HTTP IP and non-local HTTP hosts', () => {
    expect(isAuth0SecureOrigin('http://174.138.34.210:8080')).toBe(false);
    expect(isAuth0SecureOrigin('http://scoutx-dev.firststepjob.com')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { auth0RedirectUri, urlLooksLikeAuth0Callback } from '../../auth/ScoutXAuth0Provider';

describe('Auth0 callback landing', () => {
  it('uses /login as redirect_uri so / does not strip the code', () => {
    expect(auth0RedirectUri('http://localhost:5173')).toBe('http://localhost:5173/login');
    expect(auth0RedirectUri('https://scoutx-dev.firststepjob.com/')).toBe(
      'https://scoutx-dev.firststepjob.com/login'
    );
  });

  it('detects Auth0 code/state query', () => {
    expect(urlLooksLikeAuth0Callback('?code=abc&state=xyz')).toBe(true);
    expect(urlLooksLikeAuth0Callback('?q=jobs')).toBe(false);
  });
});

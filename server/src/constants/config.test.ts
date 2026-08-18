import { describe, expect, it } from 'vitest';
import { CORS_ALLOWED_HEADERS } from './config';

describe('CORS_ALLOWED_HEADERS', () => {
  it('allows Idempotency-Key for cross-origin retry preflight', () => {
    expect(CORS_ALLOWED_HEADERS).toContain('Idempotency-Key');
  });
});

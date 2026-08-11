import { describe, expect, it } from 'vitest';
import {
  SCOUT_ID_PATTERN,
  generateScoutId,
  generateUniqueScoutId,
  isValidScoutId,
  normalizeScoutIdInput,
} from './scoutId';

describe('scoutId', () => {
  it('matches SX + 2 digits + 2 letters + 2 digits', () => {
    expect(isValidScoutId('SX47KX19')).toBe(true);
    expect(isValidScoutId('SX00AA00')).toBe(true);
    expect(isValidScoutId('sx47kx19')).toBe(false);
    expect(isValidScoutId('SX47kx19')).toBe(false);
    expect(isValidScoutId('SX4AKX19')).toBe(false);
    expect(isValidScoutId('SX47K119')).toBe(false);
    expect(isValidScoutId('AB47KX19')).toBe(false);
    expect(isValidScoutId('SX47KX1')).toBe(false);
  });

  it('normalizeScoutIdInput uppercases and trims', () => {
    expect(normalizeScoutIdInput('  sx47kx19  ')).toBe('SX47KX19');
    expect(normalizeScoutIdInput('')).toBe(null);
    expect(normalizeScoutIdInput(null)).toBe(null);
  });

  it('generateScoutId always matches the pattern', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateScoutId()).toMatch(SCOUT_ID_PATTERN);
    }
  });

  it('generateUniqueScoutId retries on collision', async () => {
    let calls = 0;
    const id = await generateUniqueScoutId(async () => {
      calls += 1;
      return calls < 3;
    });
    expect(isValidScoutId(id)).toBe(true);
    expect(calls).toBe(3);
  });

  it('generateUniqueScoutId throws after max attempts', async () => {
    await expect(generateUniqueScoutId(async () => true, 3)).rejects.toThrow(
      /unique Scout-X ID/
    );
  });
});

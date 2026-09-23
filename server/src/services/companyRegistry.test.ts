import { describe, expect, it } from 'vitest';
import {
  COMPANY_ID_PATTERN,
  generateCompanyId,
  isValidCompanyId,
  normalizeCompanyIdInput,
} from '../utils/companyId';
import { NAME_PRECEDENCE } from './companyRegistry';
import { resolveCompanyKey } from './companyIdentity';

describe('companyId', () => {
  it('generates CX-XXXXXXXX ids', () => {
    const id = generateCompanyId();
    expect(id).toMatch(COMPANY_ID_PATTERN);
    expect(isValidCompanyId(id)).toBe(true);
  });

  it('normalizes input to uppercase', () => {
    expect(normalizeCompanyIdInput('cx-a1b2c3d4')).toBe('CX-A1B2C3D4');
    expect(normalizeCompanyIdInput('')).toBeNull();
  });
});

describe('name precedence', () => {
  it('orders sources so automation beats aggregator', () => {
    expect(NAME_PRECEDENCE.ops).toBeGreaterThan(NAME_PRECEDENCE.automation);
    expect(NAME_PRECEDENCE.automation).toBeGreaterThan(NAME_PRECEDENCE.ats_hint);
    expect(NAME_PRECEDENCE.ats_hint).toBeGreaterThan(NAME_PRECEDENCE.aggregator);
    expect(NAME_PRECEDENCE.aggregator).toBeGreaterThan(NAME_PRECEDENCE.derived);
  });
});

describe('resolve + key stability for registry', () => {
  it('Dell career hosts share one companyKey for registry upsert', () => {
    const a = resolveCompanyKey('https://jobs.dell.com/en/job/software-engineer/1');
    const b = resolveCompanyKey(
      'https://enterpriseplatform.dell.com/job/Del-Technologies-Software-Engineer/1'
    );
    expect(a?.companyKey).toBe('dell.com');
    expect(b?.companyKey).toBe('dell.com');
  });
});

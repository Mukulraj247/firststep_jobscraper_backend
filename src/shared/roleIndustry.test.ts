import { describe, expect, it } from 'vitest';
import { resolveIndustryFromTitle } from './roleIndustry';
import { resolveFrozenIndustries } from './frozenIndustries';

describe('resolveIndustryFromTitle', () => {
  it('maps Salesforce / platform engineering to Software / SaaS', () => {
    expect(resolveIndustryFromTitle('Lead Salesforce Platform Architect').industries).toEqual([
      'Software / SaaS',
    ]);
    expect(resolveIndustryFromTitle('Senior Salesforce Platform Engineer').industries).toEqual([
      'Software / SaaS',
    ]);
    expect(resolveIndustryFromTitle('Principal Enterprise Architect, Digital Solutions').industries).toEqual([
      'Software / SaaS',
    ]);
  });

  it('maps clinical and pharmacy titles to Healthcare', () => {
    expect(resolveIndustryFromTitle('Pharmacy Technician').industries).toEqual(['Healthcare']);
    expect(
      resolveIndustryFromTitle('Regional Director, Ambulatory Surgery Center Sales').industries
    ).toEqual(['Healthcare']);
  });

  it('maps CDL / truck driving to logistics', () => {
    expect(
      resolveIndustryFromTitle('Truck Driver - CDL Class A | Starting at $35.79+/Hour').industries
    ).toEqual(['Logistics / Supply Chain']);
  });

  it('returns nothing for ambiguous titles', () => {
    expect(resolveIndustryFromTitle('Operations Manager').method).toBeNull();
    expect(resolveIndustryFromTitle('Analyst').method).toBeNull();
  });
});

describe('resolveFrozenIndustries — role vs company', () => {
  it('Salesforce at McKesson is Software / SaaS, not Healthcare', () => {
    const r = resolveFrozenIndustries({
      title: 'Lead Salesforce Platform Architect',
      companyName: 'MCKESSON',
      sectorIndustry: '',
    });
    expect(r.frozenIndustries).toEqual(['Software / SaaS']);
    expect(r.frozenIndustries).not.toContain('Healthcare');
    expect(r.method).toBe('role_title');
  });

  it('Ambulatory Surgery sales at McKesson stays Healthcare', () => {
    const r = resolveFrozenIndustries({
      title: 'Regional Director, Ambulatory Surgery Center Sales',
      companyName: 'MCKESSON',
    });
    expect(r.frozenIndustries).toContain('Healthcare');
    expect(r.method).toBe('role_title');
  });

  it('CVS truck driver is Logistics, not Healthcare', () => {
    const r = resolveFrozenIndustries({
      title: 'Truck Driver - CDL Class A | Starting at $35.79+/Hour',
      companyName: 'CvsHealth',
    });
    expect(r.frozenIndustries).toEqual(['Logistics / Supply Chain']);
    expect(r.frozenIndustries).not.toContain('Healthcare');
  });

  it('CVS pharmacy technician stays Healthcare (and may keep Retail)', () => {
    const r = resolveFrozenIndustries({
      title: 'Pharmacy Technician',
      companyName: 'CVS Health',
    });
    expect(r.frozenIndustries).toContain('Healthcare');
  });

  it('Google software engineer keeps Big Tech alongside Software', () => {
    const r = resolveFrozenIndustries({
      title: 'Software Engineer',
      companyName: 'Google',
    });
    expect(r.frozenIndustries).toContain('Software / SaaS');
    expect(r.frozenIndustries).toContain('Big Tech');
  });

  it('sectorIndustry selector still outranks role and company', () => {
    const r = resolveFrozenIndustries({
      title: 'Lead Salesforce Platform Architect',
      companyName: 'MCKESSON',
      sectorIndustry: 'Banking',
      isAggregator: true,
    });
    expect(r.frozenIndustries).toEqual(['Banking']);
    expect(r.method).toBe('scrape_alias');
  });

  it('McKesson HR role with no tech title still uses company Healthcare', () => {
    const r = resolveFrozenIndustries({
      title: 'HR Business Partner',
      companyName: 'MCKESSON',
    });
    expect(r.frozenIndustries).toEqual(['Healthcare']);
    expect(r.method).toBe('company_exact');
  });
});

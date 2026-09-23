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

  it('maps DevSecOps / TPM / ML consultant titles', () => {
    expect(resolveIndustryFromTitle('DevSecOps Engineer').industries).toEqual(['Cybersecurity']);
    expect(resolveIndustryFromTitle('Principal Technical Program Manager').industries).toContain(
      'Software / SaaS'
    );
    expect(resolveIndustryFromTitle('ML/AI Engineer - Consultant').industries).toContain(
      'Software / SaaS'
    );
  });

  it('maps SDE / Systems Engineer / hotel titles', () => {
    expect(resolveIndustryFromTitle('Software Development Engineer').industries).toContain(
      'Software / SaaS'
    );
    expect(resolveIndustryFromTitle('IT Support Specialist').industries).toContain('Software / SaaS');
    expect(resolveIndustryFromTitle('Hotel Engineer').industries).toEqual(['Travel & Hospitality']);
  });

  it('maps Rust / Help Desk / GTM / Mechanical titles', () => {
    expect(resolveIndustryFromTitle('Staff Rust Developer').industries).toContain('Software / SaaS');
    expect(resolveIndustryFromTitle('Help Desk Tier 2').industries).toContain('Software / SaaS');
    expect(resolveIndustryFromTitle('Founding GTM Engineer').industries).toContain('Software / SaaS');
    expect(resolveIndustryFromTitle('Sr Mechanical Engineer').industries).toEqual(['Manufacturing']);
    expect(resolveIndustryFromTitle('Team Lead, Cloud Infrastructure').industries).toContain(
      'Cloud Infrastructure'
    );
  });

  it('maps iOS / Web / Electrical / Counsel titles', () => {
    expect(resolveIndustryFromTitle('iOS Engineer').industries).toContain('Software / SaaS');
    expect(resolveIndustryFromTitle('Web Engineer III').industries).toContain('Software / SaaS');
    expect(resolveIndustryFromTitle('Electrical Engineer').industries).toEqual([
      'Construction & Engineering',
    ]);
    expect(resolveIndustryFromTitle('Counsel, Contracts & Distribution').industries).toEqual([
      'Legal',
    ]);
  });

  it('maps CISO / DevOps / Head of Data titles', () => {
    expect(resolveIndustryFromTitle('Chief Information Security Officer (CISO)').industries).toEqual([
      'Cybersecurity',
    ]);
    expect(resolveIndustryFromTitle('Manager of Platform DevOps').industries).toContain(
      'Software / SaaS'
    );
    expect(resolveIndustryFromTitle('Head of Data Engineering, PRS').industries).toContain(
      'Software / SaaS'
    );
  });

  it('maps Software Engineering manager / BI / Restaurant / Reinsurance', () => {
    expect(resolveIndustryFromTitle('Manager, Software Engineering').industries).toContain(
      'Software / SaaS'
    );
    expect(resolveIndustryFromTitle('Business Intelligence Analyst').industries).toContain(
      'Software / SaaS'
    );
    expect(resolveIndustryFromTitle('Restaurant Operations Manager').industries).toEqual([
      'Food & Beverage',
    ]);
    expect(resolveIndustryFromTitle('Reinsurance Analyst').industries).toEqual(['Insurance']);
  });

  it('maps Category QA residual titles (UiPath / Tax / Plant / IAM)', () => {
    expect(resolveIndustryFromTitle('Senior UiPath Developer').industries).toContain(
      'Software / SaaS'
    );
    expect(resolveIndustryFromTitle('Tax Manager').industries).toEqual(['Financial Services']);
    expect(resolveIndustryFromTitle('Plant Manager - Ready Mix Concrete').industries).toEqual([
      'Manufacturing',
    ]);
    expect(resolveIndustryFromTitle('Manager, Security Incident Response').industries).toEqual([
      'Cybersecurity',
    ]);
    expect(resolveIndustryFromTitle('Lifecycle Marketing Operations Manager').industries).toEqual([
      'Marketing & Advertising',
    ]);
    expect(resolveIndustryFromTitle('Property Underwriter').industries).toEqual(['Insurance']);
  });

  it('maps healthcare / research / GIS residual titles', () => {
    expect(resolveIndustryFromTitle('Radiology Manager').industries).toEqual(['Healthcare']);
    expect(resolveIndustryFromTitle('Senior Research Scientist').industries).toEqual([
      'Scientific Research',
    ]);
    expect(resolveIndustryFromTitle('GIS Analyst').industries).toContain('Software / SaaS');
    expect(resolveIndustryFromTitle('Graduate Engineer (EIT)- Transportation').industries).toEqual([
      'Construction & Engineering',
    ]);
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

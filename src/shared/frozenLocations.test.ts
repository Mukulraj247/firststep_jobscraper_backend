import { describe, expect, it } from 'vitest';
import {
  CITY_POPULATION_DOMINANCE_RATIO,
  LOCATION_RULES_VERSION,
  classifyJobLocation,
  normalizeFrozenStateFilter,
  resolveFrozenLocation,
  stateCodeToLabel,
  stateCodeToName,
} from './frozenLocations';
import { lookupCityCandidates, lookupZipState } from './usCityGazetteer';
import { resolveCompanyHqState } from './companyLocation';

describe('state display labels', () => {
  it('uses short names for long states and full names otherwise', () => {
    expect(stateCodeToLabel('MA')).toBe('Mass.');
    expect(stateCodeToLabel('NC')).toBe('N. Carolina');
    expect(stateCodeToLabel('WV')).toBe('W. Virginia');
    expect(stateCodeToLabel('OH')).toBe('Ohio');
    expect(stateCodeToLabel('DC')).toBe('D.C.');
    expect(stateCodeToLabel('PR')).toBe('Puerto Rico');
    expect(stateCodeToName('MA')).toBe('Massachusetts');
  });

  it('normalizes filter tokens to USPS codes', () => {
    expect(normalizeFrozenStateFilter(['ca', 'Massachusetts', 'N. Carolina'])).toEqual([
      'CA',
      'MA',
      'NC',
    ]);
  });
});

describe('gazetteer', () => {
  it('lists multiple Springfields and does not dominate at 10x', () => {
    const c = lookupCityCandidates('Springfield');
    expect(c.length).toBeGreaterThan(2);
    const top = c[0]!.population;
    const second = c[1]!.population;
    expect(top).toBeLessThan(second * CITY_POPULATION_DOMINANCE_RATIO);
  });

  it('maps ZIP 94105 to CA', () => {
    expect(lookupZipState('94105')).toBe('CA');
  });
});

describe('resolveFrozenLocation', () => {
  it('parses City, ST', () => {
    const r = resolveFrozenLocation({ location: 'San Francisco, CA' });
    expect(r.frozenStates).toEqual(['CA']);
    expect(r.method).toBe('explicit_state');
    expect(r.locationIsUs).toBe(true);
    expect(r.rulesVersion).toBe(LOCATION_RULES_VERSION);
  });

  it('parses full state name', () => {
    const r = resolveFrozenLocation({ location: 'Boston, Massachusetts' });
    expect(r.frozenStates).toEqual(['MA']);
    expect(r.frozenCities[0]?.name).toMatch(/Boston/i);
  });

  it('leaves Springfield ambiguous without company context', () => {
    const r = resolveFrozenLocation({ location: 'Springfield' });
    expect(r.frozenStates).toEqual([]);
    expect(r.method).toBe('ambiguous');
    expect(r.candidates?.length).toBeGreaterThan(1);
  });

  it('resolves Portland via company HQ (Nike → OR)', () => {
    expect(resolveCompanyHqState('Nike')).toBe('OR');
    const r = resolveFrozenLocation({ location: 'Portland', companyName: 'Nike' });
    expect(r.frozenStates).toEqual(['OR']);
    expect(r.method).toBe('company_hq');
  });

  it('resolves Portland via company history', () => {
    const r = resolveFrozenLocation({
      location: 'Portland',
      companyName: 'Unknown Corp',
      companyHistoricalStates: ['OR', 'CA'],
    });
    expect(r.frozenStates).toEqual(['OR']);
    expect(r.method).toBe('company_history');
  });

  it('marks remote-only with no states', () => {
    for (const loc of ['Remote', 'Remote - USA', 'Work from home']) {
      const r = resolveFrozenLocation({ location: loc });
      expect(r.locationIsRemote).toBe(true);
      expect(r.frozenStates).toEqual([]);
      expect(r.locationIsUs).toBe(true);
      expect(r.method).toBe('remote');
    }
  });

  it('unions multi-site states and maps NYC alias', () => {
    const r = resolveFrozenLocation({ location: 'NYC · Austin, TX' });
    expect(r.frozenStates).toEqual(['NY', 'TX']);
  });

  it('flags clear non-US locations', () => {
    const r = resolveFrozenLocation({ location: 'London, UK' });
    expect(r.locationIsUs).toBe(false);
    expect(r.frozenStates).toEqual([]);
    expect(r.method).toBe('non_us');
  });

  it('resolves ZIP to state', () => {
    const r = resolveFrozenLocation({ location: '94105' });
    expect(r.frozenStates).toEqual(['CA']);
    expect(r.method).toBe('zip');
  });

  it('does not invent US for empty location', () => {
    const r = resolveFrozenLocation({ location: '' });
    expect(r.method).toBe('none');
    expect(r.frozenStates).toEqual([]);
  });

  it('handles Guam and San Juan, PR', () => {
    expect(resolveFrozenLocation({ location: 'Guam' }).frozenStates).toEqual(['GU']);
    expect(resolveFrozenLocation({ location: 'San Juan, PR' }).frozenStates).toEqual(['PR']);
  });

  it('unique city Chicago → IL', () => {
    const r = resolveFrozenLocation({ location: 'Chicago' });
    expect(r.frozenStates).toEqual(['IL']);
    expect(r.method).toBe('unique_city');
  });

  it('classifyJobLocation matches resolveFrozenLocation', () => {
    const a = classifyJobLocation({ location: 'Denver, CO' });
    const b = resolveFrozenLocation({ location: 'Denver, CO' });
    expect(a).toEqual(b);
  });
});

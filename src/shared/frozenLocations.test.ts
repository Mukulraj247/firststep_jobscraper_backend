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
  it('lists multiple Springfields and does not dominate at ratio', () => {
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
    // Population dominance may also pick OR; company_hq is the fallback path.
    expect(['company_hq', 'population']).toContain(r.method);
  });

  it('resolves Portland via company history', () => {
    const r = resolveFrozenLocation({
      location: 'Portland',
      companyName: 'Unknown Corp',
      companyHistoricalStates: ['OR', 'CA'],
    });
    expect(r.frozenStates).toEqual(['OR']);
    expect(['company_history', 'population']).toContain(r.method);
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

  it('splits "City or City" multi-site strings', () => {
    const r = resolveFrozenLocation({ location: 'Austin or Sunnyvale' });
    expect(r.frozenStates).toEqual(expect.arrayContaining(['TX', 'CA']));
    expect(r.frozenStates.length).toBeGreaterThanOrEqual(2);
  });

  it('parses Hybrid (City, ST) and City Office forms', () => {
    expect(resolveFrozenLocation({ location: 'Hybrid (Austin, TX)' }).frozenStates).toEqual(['TX']);
    expect(resolveFrozenLocation({ location: 'New York Office' }).frozenStates).toEqual(['NY']);
  });

  it('parses City, State, US and City, ST - neighborhood', () => {
    expect(resolveFrozenLocation({ location: 'Houston, Texas, US' }).frozenStates).toEqual(['TX']);
    expect(resolveFrozenLocation({ location: 'Dallas, TX - Uptown' }).frozenStates).toEqual(['TX']);
    expect(resolveFrozenLocation({ location: 'Olive Branch, Mississippi, US' }).frozenStates).toEqual([
      'MS',
    ]);
  });

  it('parses U.S. - State/City and branch address tails', () => {
    expect(resolveFrozenLocation({ location: 'U.S. - New York' }).frozenStates).toEqual(['NY']);
    expect(
      resolveFrozenLocation({
        location: 'Summerville, SC - Summerville Branch (Chalreston, SC)',
      }).frozenStates
    ).toEqual(['SC']);
  });

  it('marks bare non-US cities as non-US without inventing states', () => {
    for (const loc of ['London', 'Paris', 'Toronto', 'Sydney', 'São Paulo', 'Hyderabad']) {
      const r = resolveFrozenLocation({ location: loc });
      expect(r.locationIsUs).toBe(false);
      expect(r.frozenStates).toEqual([]);
      expect(r.method).toBe('non_us');
    }
  });

  it('parses HQ (City), City-Office, county, and Doha non-US', () => {
    expect(
      resolveFrozenLocation({ location: 'Strella HQ (New York City)' }).frozenStates
    ).toEqual(['NY']);
    expect(
      resolveFrozenLocation({
        location: 'Irving-Irving Corporate Office-3939 West John Carpenter Freeway',
      }).frozenStates
    ).toEqual(['TX']);
    expect(resolveFrozenLocation({ location: 'Citrus County' }).frozenStates).toEqual(['FL']);
    expect(resolveFrozenLocation({ location: 'Doha' }).locationIsUs).toBe(false);
    expect(
      resolveFrozenLocation({ location: 'Charlevoix or Petoskey' }).frozenStates
    ).toContain('MI');
  });

  it('does not mark Brisbane, California as non-US', () => {
    const r = resolveFrozenLocation({ location: 'Brisbane, California' });
    expect(r.locationIsUs).toBe(true);
    expect(r.frozenStates).toEqual(['CA']);
  });

  it('splits comma-separated US city lists', () => {
    const r = resolveFrozenLocation({
      location: 'NYC, Chicago, Seattle, San Francisco',
    });
    expect(r.frozenStates).toEqual(expect.arrayContaining(['NY', 'IL', 'WA', 'CA']));
  });

  it('keeps US states from mixed US + non-US or-lists', () => {
    const r = resolveFrozenLocation({
      location: 'Hyderabad or Austin or Bangalore',
    });
    // Austin TX is unique US; non-US sites contribute no chips
    expect(r.locationIsUs).toBe(true);
    expect(r.frozenStates).toContain('TX');
  });

  it('parses New York-street and City, ST before Workday path', () => {
    expect(
      resolveFrozenLocation({ location: 'New York-161 Ave of the Americas' }).frozenStates
    ).toEqual(['NY']);
    expect(
      resolveFrozenLocation({
        location: 'Whitestown, IN, USA > IN > Lebanon > Route 267',
      }).frozenStates
    ).toEqual(['IN']);
  });

  it('marks Slovenia as non-US and strips trailing or', () => {
    expect(resolveFrozenLocation({ location: 'Ljubljana, Slovenia' }).locationIsUs).toBe(false);
    expect(resolveFrozenLocation({ location: 'Mountain View or' }).frozenStates).toEqual(['CA']);
    expect(resolveFrozenLocation({ location: 'San Mateo' }).frozenStates).toEqual(['CA']);
  });

  it('parses Workday USA > ST > City paths', () => {
    const r = resolveFrozenLocation({ location: 'USA > KY > Brooks > 345 International' });
    expect(r.frozenStates).toEqual(['KY']);
    expect(r.method).not.toBe('none');
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

  it('parses country-first United States, State, City', () => {
    const r = resolveFrozenLocation({
      location: 'United States, Washington, Redmond',
      companyName: 'Microsoft',
    });
    expect(r.frozenStates).toEqual(['WA']);
    expect(r.frozenCities[0]?.name).toMatch(/Redmond/i);
    expect(r.method).toBe('explicit_state');
  });

  it('parses ST-City hyphen (CA-San Diego)', () => {
    const r = resolveFrozenLocation({ location: 'CA-San Diego' });
    expect(r.frozenStates).toEqual(['CA']);
    expect(r.frozenCities[0]?.name).toMatch(/San Diego/i);
  });

  it('treats Hybrid with empty location as remote-US', () => {
    const r = resolveFrozenLocation({ location: '', remoteType: 'Hybrid' });
    expect(r.method).toBe('remote');
    expect(r.locationIsRemote).toBe(true);
    expect(r.locationIsUs).toBe(true);
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

  it('parses Work At Home-StateName', () => {
    const r = resolveFrozenLocation({ location: 'Work At Home-North Carolina' });
    expect(r.frozenStates).toEqual(['NC']);
    expect(r.locationIsRemote).toBe(false); // has state chips; remote flag only when no states
    expect(r.method).toBe('explicit_state');
  });

  it('parses multi Work At Home state list', () => {
    const r = resolveFrozenLocation({
      location: 'Work At Home-New Jersey, Work At Home-New York, Work At Home-Texas',
    });
    expect(r.frozenStates).toEqual(expect.arrayContaining(['NJ', 'NY', 'TX']));
  });

  it('treats Remote (US) and Remote - as remote-US', () => {
    expect(resolveFrozenLocation({ location: 'Remote (US)' }).method).toBe('remote');
    expect(resolveFrozenLocation({ location: 'Remote -' }).method).toBe('remote');
    expect(resolveFrozenLocation({ location: 'Remote (US)' }).locationIsUs).toBe(true);
  });

  it('marks Makati City as non-US', () => {
    const r = resolveFrozenLocation({ location: 'Makati City' });
    expect(r.locationIsUs).toBe(false);
    expect(r.method).toBe('non_us');
  });

  it('resolves Paducah and Fishers city lists', () => {
    expect(resolveFrozenLocation({ location: 'Paducah or Paducah or Paducah' }).frozenStates).toEqual([
      'KY',
    ]);
    expect(resolveFrozenLocation({ location: 'Fishers or Anderson' }).frozenStates).toContain('IN');
  });

  it('resolves Dade City / Land O Lakes FL list', () => {
    const r = resolveFrozenLocation({
      location: "Dade City or Land O' Lakes or New Port Richey",
    });
    expect(r.frozenStates).toEqual(['FL']);
  });

  it('maps Bay Area / West Coast and Oxnard/Port Hueneme', () => {
    expect(
      resolveFrozenLocation({ location: 'US West Coast (Bay Area strongly preferred)' })
        .frozenStates
    ).toEqual(['CA']);
    expect(resolveFrozenLocation({ location: 'Oxnard or Port Hueneme' }).frozenStates).toEqual([
      'CA',
    ]);
  });

  it('marks Leiden / Santa Catarina as non-US', () => {
    expect(resolveFrozenLocation({ location: 'Leiden' }).locationIsUs).toBe(false);
    expect(resolveFrozenLocation({ location: 'Santa Catarina or' }).locationIsUs).toBe(false);
  });

  it('resolves Eglin AFB and Goleta/Santa Barbara', () => {
    expect(resolveFrozenLocation({ location: 'Eglin Air Force Base or Eglin AFB' }).frozenStates).toEqual([
      'FL',
    ]);
    expect(
      resolveFrozenLocation({ location: 'Goleta or Santa Barbara or Santa Maria' }).frozenStates
    ).toEqual(['CA']);
  });

  it('resolves Forest or Lynchburg → VA', () => {
    expect(resolveFrozenLocation({ location: 'Forest or Lynchburg' }).frozenStates).toEqual(['VA']);
  });
});

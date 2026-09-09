import { describe, expect, it } from 'vitest';
import {
  EXPERIENCE_RULES_VERSION,
  FROZEN_EXPERIENCE_LEVELS,
  FROZEN_EXPERIENCE_YEARS,
  bandForYear,
  bandsForYears,
  bandsForYearRange,
  canonicalExperienceLevel,
  extractExperienceYears,
  normalizeExperienceLevelFilter,
  normalizeExperienceYearFilter,
  resolveFrozenExperience,
} from './frozenExperience';

describe('frozen experience taxonomy', () => {
  it('has unique controlled labels', () => {
    expect(FROZEN_EXPERIENCE_LEVELS.length).toBe(5);
    expect(new Set(FROZEN_EXPERIENCE_LEVELS).size).toBe(5);
    expect(FROZEN_EXPERIENCE_YEARS.length).toBe(6);
    expect(new Set(FROZEN_EXPERIENCE_YEARS).size).toBe(6);
  });

  it('canonicalizes seniority badges', () => {
    expect(canonicalExperienceLevel('Entry Level')).toBe('Entry Level');
    expect(canonicalExperienceLevel('Mid Level')).toBe('Mid-Senior Level');
    expect(canonicalExperienceLevel('Senior Level')).toBe('Senior Level');
    expect(canonicalExperienceLevel('Staff')).toBe('Senior Level');
    expect(canonicalExperienceLevel('Internship')).toBe('Entry Level');
    expect(canonicalExperienceLevel('not-a-level')).toBeNull();
  });
});

describe('normalizeExperience filters', () => {
  it('parses comma-separated values in taxonomy order', () => {
    expect(normalizeExperienceLevelFilter('Senior Level,Entry Level')).toEqual([
      'Entry Level',
      'Senior Level',
    ]);
    expect(normalizeExperienceYearFilter('7-10,0-3,unknown')).toEqual(['0-3', '7-10']);
  });
});

describe('bandForYear / bandsForYears', () => {
  it('uses lower-inclusive upper-exclusive bands', () => {
    expect(bandForYear(0)).toBe('0-3');
    expect(bandForYear(2.9)).toBe('0-3');
    expect(bandForYear(3)).toBe('3-5');
    expect(bandForYear(5)).toBe('5-7');
    expect(bandForYear(7)).toBe('7-10');
    expect(bandForYear(10)).toBe('10-15');
    expect(bandForYear(15)).toBe('15+');
  });

  it('maps the highest year to a single band (ignores lower secondary YOE)', () => {
    expect(bandsForYears([7, 8])).toEqual(['7-10']);
    expect(bandsForYears([5, 8])).toEqual(['7-10']);
    expect(bandsForYears([1, 3, 5])).toEqual(['5-7']);
    expect(bandsForYearRange(5, 7)).toEqual(['5-7']);
    expect(bandsForYearRange(5, 8)).toEqual(['7-10']);
  });
});

describe('extractExperienceYears', () => {
  it('extracts single years and ranges with experience context', () => {
    const single = extractExperienceYears('Minimum qualifications: 6 years of experience with cloud.');
    expect(single.years).toContain(6);

    const range = extractExperienceYears('Requires 5-7 years of experience in systems.');
    expect(range.ranges.some(([a, b]) => a === 5 && b === 7)).toBe(true);

    const atLeast = extractExperienceYears('At least 8 years experience building APIs.');
    expect(atLeast.years).toContain(8);

    const months = extractExperienceYears('18 months of experience preferred.');
    expect(months.years.some((y) => y >= 1.4 && y <= 1.6)).toBe(true);
  });

  it('rejects founded / calendar / business years', () => {
    expect(extractExperienceYears('Company founded 10 years ago in 2019.').years).toEqual([]);
    expect(extractExperienceYears('Over the last 3 years we grew 10x.').years).toEqual([]);
    expect(extractExperienceYears('10 years in business.').years).toEqual([]);
  });

  it('rejects age requirements and company-history year spans', () => {
    expect(
      extractExperienceYears('Requirements: At least 18 years of age. High school diploma.').years
    ).toEqual([]);
    expect(
      extractExperienceYears(
        'PayPal has been revolutionizing commerce globally for more than 25 years. Creating innovative experiences.'
      ).years
    ).toEqual([]);
    expect(
      extractExperienceYears(
        "RDSolutions's track record spans nearly 40 years in providing retail data."
      ).years
    ).toEqual([]);
  });

  it('still extracts "N years in/with/as" role requirements', () => {
    expect(extractExperienceYears('Minimum Quals: 5+ years in data engineering.').years).toContain(
      5
    );
    expect(extractExperienceYears('Requires 5+ years as an ISSO or similar.').years).toContain(5);
  });
});

describe('resolveFrozenExperience — transcript Google examples', () => {
  it('1. Customer Engineer Cloud AI — 6 years, no senior → Mid-Senior + 5-7', () => {
    const result = resolveFrozenExperience({
      title: 'Customer Engineer, Cloud AI, Native Google Cloud',
      description: 'Minimum qualifications: 6 years of experience with cloud technologies.',
    });
    expect(result.frozenExperienceLevels).toEqual(['Mid-Senior Level']);
    expect(result.frozenExperienceYears).toEqual(['5-7']);
    expect(result.jobExperience).toBe(6);
    expect(result.rulesVersion).toBe(EXPERIENCE_RULES_VERSION);
  });

  it('2. Software Engineer Search Ads — 1 year → Entry + 0-3', () => {
    const result = resolveFrozenExperience({
      title: 'Software Engineer, Search Ads in AI Experience',
      description: 'Minimum qualifications: 1 year of experience in software development.',
    });
    expect(result.frozenExperienceLevels).toEqual(['Entry Level']);
    expect(result.frozenExperienceYears).toEqual(['0-3']);
  });

  it('untitled IC with 5 years floors to Mid-Senior (not Entry)', () => {
    const result = resolveFrozenExperience({
      title: 'Machine Learning Engineer, Ads Optimization',
      description: 'Minimum qualifications: 5 years of experience in machine learning.',
      minYoe: 5,
    });
    expect(result.frozenExperienceLevels).toEqual(['Mid-Senior Level']);
    expect(result.matchedSignals.some((s) => s.includes('floor_mid_yoe_ge_4'))).toBe(true);
  });

  it('junior title with 5 years → Mid-Senior (no Entry ceiling when YOE is high)', () => {
    const result = resolveFrozenExperience({
      title: 'Junior Software Engineer',
      description: '5 years of experience preferred.',
    });
    expect(result.frozenExperienceLevels).toEqual(['Mid-Senior Level']);
    expect(result.frozenExperienceYears).toEqual(['5-7']);
    expect(result.matchedSignals.some((s) => s.includes('junior_high_yoe_no_entry_ceiling'))).toBe(
      true
    );
  });

  it('junior title with low YOE still stays Entry', () => {
    const result = resolveFrozenExperience({
      title: 'Junior Software Engineer',
      description: '1 year of experience preferred.',
    });
    expect(result.frozenExperienceLevels).toEqual(['Entry Level']);
    expect(result.frozenExperienceYears).toEqual(['0-3']);
  });

  it('3. Optical Architect — 5-6 years → Mid-Senior + single 5-7 band', () => {
    const result = resolveFrozenExperience({
      title: 'Autofocus Optical Architect, Optical Image Stabilization Control Systems',
      description: 'Qualifications: 5-6 years of experience in optical systems.',
      qualifications: ['5-6 years of experience in control systems'],
    });
    expect(result.frozenExperienceLevels).toEqual(['Mid-Senior Level']);
    expect(result.frozenExperienceYears).toEqual(['5-7']);
  });

  it('4. Senior Software Engineer — 5 years → Mid-Senior (not Senior) + 5-7', () => {
    const result = resolveFrozenExperience({
      title: 'Senior Software Engineer',
      description: 'Minimum qualifications: 5 years of experience in software engineering.',
    });
    expect(result.frozenExperienceLevels).toEqual(['Mid-Senior Level']);
    expect(result.frozenExperienceYears).toEqual(['5-7']);
  });

  it('Google AlloyDB-style multi-qual: only the highest YOE band (not 0-3 + 3-5)', () => {
    const result = resolveFrozenExperience({
      title: 'Senior Software Engineer, AlloyDB Semantic Search',
      qualifications: [
        '5 years of experience in software development for core system-level software.',
        '5 years of programming experience in C, C++ or Java.',
        '3 years of experience building and developing large-scale infrastructure.',
        '3 years of experience with distributed computing.',
        '1 year of experience with AI and agentic development.',
      ],
      minYoe: 5,
    });
    expect(result.frozenExperienceYears).toEqual(['5-7']);
    expect(result.frozenExperienceYears).not.toContain('0-3');
    expect(result.frozenExperienceYears).not.toContain('3-5');
    expect(result.jobExperience).toBe(5);
  });

  it('Microsoft-style: 5y quals + 6+ structured → single 5-7 band', () => {
    const result = resolveFrozenExperience({
      title: 'Senior Software Engineer - CoreAI',
      description:
        'Responsibilities include Experience with Machine Learning. 5 years of experience in program or project management. 5 years of experience managing cross-functional or cross-team projects.',
      minYoe: 6,
    });
    expect(result.frozenExperienceYears).toEqual(['5-7']);
    expect(result.frozenExperienceYears.length).toBe(1);
  });
});

describe('resolveFrozenExperience — title families', () => {
  it('director with no years → Leadership, empty years bands', () => {
    const result = resolveFrozenExperience({
      title: 'Director of Engineering',
      description: 'Lead the platform org.',
    });
    expect(result.frozenExperienceLevels).toEqual(['Leadership Level']);
    expect(result.frozenExperienceYears).toEqual([]);
    expect(result.method).toBe('title_only');
  });

  it('senior manager with 1 year demotes to Mid-Senior', () => {
    const result = resolveFrozenExperience({
      title: 'Senior Software Engineering Manager',
      description: 'Requires 1 year of experience managing teams.',
    });
    expect(result.frozenExperienceLevels).toEqual(['Mid-Senior Level']);
    expect(result.matchedSignals.some((s) => s.includes('manager_demoted'))).toBe(true);
  });

  it('engineering manager with 8 years → People Manager', () => {
    const result = resolveFrozenExperience({
      title: 'Engineering Manager',
      description: '8 years of experience leading engineers.',
    });
    expect(result.frozenExperienceLevels).toEqual(['People Manager Level']);
    expect(result.frozenExperienceYears).toEqual(['7-10']);
  });

  it('product manager is IC ladder, not people manager', () => {
    const result = resolveFrozenExperience({
      title: 'Product Manager',
      description: '3 years of experience in product.',
    });
    expect(result.frozenExperienceLevels).not.toContain('People Manager Level');
  });
});

describe('resolveFrozenExperience — badge vs rules', () => {
  it('badge wins for level when rules disagree', () => {
    const result = resolveFrozenExperience({
      title: 'Software Engineer',
      description: '1 year of experience.',
      seniorityLevel: 'Senior Level',
    });
    expect(result.frozenExperienceLevels).toEqual(['Senior Level']);
    expect(result.method).toBe('scrape_badge');
    expect(result.matchedSignals.some((s) => s.startsWith('badge_wins'))).toBe(true);
    expect(result.frozenExperienceYears).toEqual(['0-3']);
  });

  it('badge Entry is overridden when YOE is 4+ (no Entry + 5-7)', () => {
    const result = resolveFrozenExperience({
      title: 'Software Engineer II',
      description: 'Requires 5 years of experience in software development.',
      seniorityLevel: 'Entry Level',
    });
    expect(result.frozenExperienceLevels).toEqual(['Mid-Senior Level']);
    expect(result.frozenExperienceYears).toEqual(['5-7']);
    expect(result.method).not.toBe('scrape_badge');
    expect(result.matchedSignals.some((s) => s.startsWith('badge_entry_overridden_by_yoe'))).toBe(
      true
    );
  });

  it('HC structured YOE sets a single band and method', () => {
    const result = resolveFrozenExperience({
      title: 'Software Engineer',
      description: '',
      minYoe: 5,
      maxYoe: 7,
    });
    expect(result.frozenExperienceYears).toEqual(['5-7']);
    expect(result.jobExperience).toBe(7);
    expect(['hc_structured', 'rules']).toContain(result.method);
  });
});

describe('resolveFrozenExperience — intern / age false positives', () => {
  it('PayPal intern with company-history "25 years" → Entry + 0-3, not 15+', () => {
    const result = resolveFrozenExperience({
      title: 'Software Engineer Intern',
      description:
        'PayPal has been revolutionizing commerce globally for more than 25 years. Creating innovative experiences that make moving money simple. Software Engineer Interns at PayPal develop innovative solutions. Currently pursuing a bachelor’s degree.',
      minYoe: 25,
    });
    expect(result.frozenExperienceLevels).toEqual(['Entry Level']);
    expect(result.frozenExperienceYears).toEqual(['0-3']);
    expect(result.jobExperience).toBe(0);
    expect(result.matchedSignals.some((s) => s.includes('intern_force_entry_0_3'))).toBe(true);
  });

  it('RDSolutions associate: "18 years of age" is not YOE', () => {
    const result = resolveFrozenExperience({
      title: 'Data Scanning Associate',
      description:
        'Field Representative - No Experience Needed. Requirements: At least 18 years of age. High school diploma. Track record spans nearly 40 years in providing retail data.',
    });
    expect(result.frozenExperienceLevels).toEqual(['Entry Level']);
    expect(result.frozenExperienceYears).toEqual([]);
    expect(result.jobExperience).toBe(0);
  });

  it('Junior ISSO requiring 5+ years is Mid-Senior + 5-7, not Entry + 5-7', () => {
    const result = resolveFrozenExperience({
      title: 'Junior Cloud Information System Security Officer',
      description: 'Requires 5+ years as an ISSO or similar.',
    });
    expect(result.frozenExperienceLevels).toEqual(['Mid-Senior Level']);
    expect(result.frozenExperienceYears).toEqual(['5-7']);
  });
});

describe('resolveFrozenExperience — never guess years', () => {
  it('title-only senior emits Mid-Senior without inventing a years band', () => {
    const result = resolveFrozenExperience({
      title: 'Senior Software Engineer',
      description: 'Build great products with Java and Python.',
    });
    expect(result.frozenExperienceLevels).toEqual(['Mid-Senior Level']);
    expect(result.frozenExperienceYears).toEqual([]);
    expect(result.method).toBe('title_only');
  });

  it('returns none when no signals', () => {
    const result = resolveFrozenExperience({
      title: 'Engineer',
      description: 'Work on interesting problems.',
    });
    expect(result.frozenExperienceLevels).toEqual([]);
    expect(result.frozenExperienceYears).toEqual([]);
    expect(result.method).toBe('none');
  });
});

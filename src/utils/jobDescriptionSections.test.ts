import { describe, expect, it } from 'vitest';
import {
  buildJobDetailSections,
  looksLikeRichJobDescription,
  isThinStructuredList,
  resolveCardHighlights,
  splitJobDescriptionSections,
} from './jobDescriptionSections';

const MODOT_JD = `Job Summary - Why you'll love this position

Note for internal applicants: Successful candidates already at rates above the posted salary will be evaluated on an individual basis to determine final salary outcome.

Job Location: Central Office, 1617 Missouri Boulevard, Jefferson City, MO

Why you'll love this position:

The geotechnical engineer coordinates and supervises geotechnical investigations statewide; provides geotechnical engineering expertise, support and design methodology; provides recommendations for correcting geotechnical problems; and performs and supervises geotechnical research. Responsibilities are performed under general supervision.

Responsibilities - What you'll do
Provides geotechnical engineering expertise, support, and design methodology to department personnel and external consultants.
Schedules subsurface and special foundation investigations, including coordinating department personnel and consultants.
Oversees the geotechnical engineering portion of consultant-designed projects for accuracy, completeness, and best design practices.

Qualifications - All you need for success

Minimum Qualifications

Bachelor's Degree: Geological Engineering or Civil Engineering with a Geotechnical emphasis from an ABET-accredited college or university curriculum.
Licenses as a Professional Engineer in the State of Missouri.
Six years of experience in geotechnical engineering.

Special Working Conditions:

Job requires regular, statewide, overnight travel.
Hybrid telework option may be considered. Full-time telework is not available.

Job Details - More reasons to love this position

MoDOT offers an excellent benefits package that includes a defined pension plan, generous amounts of leave and holiday time, and eligibility for health insurance coverage.

Contact Details - If you have questions or require any accommodations to participate in the application or interview process please contact:

cohrmocareers@modot.mo.gov

The State of Missouri is an equal opportunity employer.`;

describe('MoDOT-style job description sections', () => {
  it('splits Job Summary / Responsibilities / Qualifications / Job Details / Contact', () => {
    expect(looksLikeRichJobDescription(MODOT_JD)).toBe(true);
    const sections = splitJobDescriptionSections(MODOT_JD);
    const titles = sections.map((s) => s.title.toLowerCase());
    expect(titles.some((t) => /job\s+summary|why you/.test(t))).toBe(true);
    expect(titles.some((t) => /responsibilit|what you/.test(t))).toBe(true);
    expect(titles.some((t) => /qualification|all you need|minimum/.test(t))).toBe(true);
    expect(titles.some((t) => /job\s+details|more reasons|benefit/.test(t))).toBe(true);
    expect(titles.some((t) => /contact/.test(t))).toBe(true);
    const joined = sections.map((s) => s.body).join('\n');
    expect(joined).toMatch(/geotechnical engineer coordinates/i);
    expect(joined).toMatch(/Professional Engineer/i);
    expect(joined).toMatch(/cohrmocareers@modot\.mo\.gov/i);
  });

  it('prefers full JD over thin HC structured chips in buildJobDetailSections', () => {
    const sections = buildJobDetailSections(MODOT_JD, 'Description', {
      about: 'Publicly traded gold and copper mining company.',
      responsibilities: ['Assessing ground conditions', 'Designing support systems'],
      minimumQualifications: ['2+ years of mining geotechnical experience'],
      skills: ['RocScience Suite', 'Geoslope'],
      benefits: ['401(k) matching'],
      certifications: ['professional engineer (pe)'],
    });
    const titles = sections.map((s) => s.title.toLowerCase());
    const bodies = sections.map((s) => s.body).join('\n');
    // Full MoDOT narrative must appear — not only OceanaGold-style short chips.
    expect(bodies).toMatch(/geotechnical engineer coordinates and supervises/i);
    expect(bodies).toMatch(/Jefferson City/i);
    expect(titles.some((t) => /job\s+summary|why you|responsibilit|qualification|job\s+details|contact/.test(t))).toBe(
      true
    );
    // Company tagline is labeled as company, not "About the job".
    expect(titles.some((t) => t === 'about the company')).toBe(true);
    expect(titles.some((t) => t === 'about the job')).toBe(false);
    // Skills/certs still available as supplements when missing from JD.
    expect(bodies).toMatch(/RocScience Suite|professional engineer/i);
  });

  it('detects thin HC structured lists', () => {
    expect(isThinStructuredList(['Assessing ground conditions', 'Designing support systems'])).toBe(true);
    expect(
      isThinStructuredList([
        "Bachelor's Degree: Geological Engineering or Civil Engineering with a Geotechnical emphasis from an ABET-accredited college or university curriculum.",
        'Licenses as a Professional Engineer in the State of Missouri.',
        'Six years of experience in geotechnical engineering.',
      ])
    ).toBe(false);
  });

  it('resolveCardHighlights uses JD when structured responsibilities are thin', () => {
    const h = resolveCardHighlights(MODOT_JD, {
      about: 'Publicly traded gold company.',
      responsibilities: ['Assessing ground conditions'],
      minimumQualifications: ['2+ years mining'],
    });
    expect(h.about.length).toBeGreaterThan(20);
    expect(h.about).not.toMatch(/Publicly traded gold/i);
    expect(
      h.responsibilities.join(' ').length + h.minimumQualifications.join(' ').length
    ).toBeGreaterThan(40);
  });
});

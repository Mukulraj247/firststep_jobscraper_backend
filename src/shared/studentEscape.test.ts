/**
 * Unit tests for light student-escape heuristics used by Category QA
 * and live enrichment stamping.
 */
import { describe, expect, it } from 'vitest';
import { detectStudentEscape } from './studentEscape';

describe('detectStudentEscape', () => {
  it('flags intern titles', () => {
    const r = detectStudentEscape({ title: 'Software Engineering Intern' });
    expect(r.studentEscape).toBe(true);
    expect(r.matchedSignals).toContain('intern');
  });

  it('flags new-grad titles', () => {
    const r = detectStudentEscape({ title: 'New Grad Software Engineer' });
    expect(r.studentEscape).toBe(true);
    expect(r.matchedSignals).toContain('new_grad');
  });

  it('flags OPT/CPT in description for early-career titles', () => {
    const r = detectStudentEscape({
      title: 'New Grad Software Engineer',
      description: 'We welcome STEM OPT candidates.',
    });
    expect(r.studentEscape).toBe(true);
    expect(r.matchedSignals).toContain('opt_cpt');
  });

  it('does not flag ordinary senior roles', () => {
    const r = detectStudentEscape({
      title: 'Senior Software Engineer',
      description: 'Build systems. 5+ years experience.',
    });
    expect(r.studentEscape).toBe(false);
  });

  it('ignores bare OPT noise in JD without student-visa phrasing', () => {
    const r = detectStudentEscape({
      title: 'Senior Full-Stack Engineer',
      description: 'Optimize queries. Optional: GraphQL experience.',
    });
    expect(r.studentEscape).toBe(false);
  });

  it('ignores JD OPT/CPT blurbs on clearly senior titles', () => {
    const r = detectStudentEscape({
      title: 'Sr. Associate Data Engineer (PySpark, Python & ETL)',
      description: 'STEM OPT candidates are welcome. Optional practical training supported.',
    });
    expect(r.studentEscape).toBe(false);
  });

  it('still flags Software Engineer when JD has STEM OPT and title is not senior', () => {
    const r = detectStudentEscape({
      title: 'Software Engineer',
      description: 'We welcome STEM OPT candidates.',
    });
    // Plain IC engineer + JD visa blurb is too noisy — require title OPT or early-career title.
    expect(r.studentEscape).toBe(false);
  });

  it('flags early-career title when JD has STEM OPT', () => {
    const r = detectStudentEscape({
      title: 'Junior Software Engineer',
      description: 'We welcome STEM OPT candidates.',
    });
    expect(r.studentEscape).toBe(true);
    expect(r.matchedSignals).toContain('opt_cpt');
  });

  it('flags OPT in title even on IC engineer roles', () => {
    const r = detectStudentEscape({
      title: 'Software Engineer - STEM OPT',
      description: 'Build systems.',
    });
    expect(r.studentEscape).toBe(true);
  });

  it('ignores bogus Internship seniority on mid-ladder IC titles', () => {
    const r = detectStudentEscape({
      title: 'Machine Learning Engineer (II-III), Space Edge Deployment',
      seniorityLevel: 'Internship',
    });
    expect(r.studentEscape).toBe(false);
  });

  it('still trusts Internship seniority when title does not contradict', () => {
    const r = detectStudentEscape({
      title: 'Software Engineer',
      seniorityLevel: 'Internship',
    });
    expect(r.studentEscape).toBe(true);
    expect(r.matchedSignals).toContain('intern');
  });
});

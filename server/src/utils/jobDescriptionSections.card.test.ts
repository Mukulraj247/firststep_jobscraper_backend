import { describe, expect, it } from 'vitest';
import { extractCardHighlights } from '../../../src/utils/jobDescriptionSections';

const GOOGLE_JD = `Minimum qualifications • Bachelor's degree or equivalent practical experience. • 5 years of experience programming in C++ or Python. • 3 years of experience testing software products. Preferred qualifications • Master's degree or PhD in Computer Science. • 5 years of experience with data structures. About the job In this role, with your technical expertise you will manage project priorities, deadlines, and deliverables. You will design, develop, test, deploy, maintain, and enhance software solutions.`;

const JPMC_JD = `We have an exciting opportunity for you. As a Software Engineer III at JPMorganChase you will build platforms. Job responsibilities • Executes software solutions, design, development, and technical troubleshooting. • Creates secure and high-quality production code. • Produces architecture and design artifacts. Required qualifications, capabilities, and skills • Formal training or certification on software engineering concepts. • 3+ years applied experience. • Hands-on practical experience in system design. Preferred qualifications, capabilities, and skills • Familiarity with modern front-end technologies. • Exposure to cloud technologies. We also offer a range of benefits and programs to meet employee needs. These benefits include medical, dental, and vision.`;

const CARRIER_JD = `About Carrier Carrier Global Corporation builds climate solutions. Key Responsibilities • Manage projects i.e., follow project processes and provide direction to Project Team • Complete projects per the contractual requirements within budget • Ensure customer satisfaction on assigned projects Qualifications • Bachelor's degree in Engineering • 3 years of experience in HVAC project management`;

describe('extractCardHighlights (cross-company cards)', () => {
  it('extracts Google-style min/preferred quals and about', () => {
    const h = extractCardHighlights(GOOGLE_JD);
    expect(h.minimumQualifications.length).toBeGreaterThanOrEqual(2);
    expect(h.preferredQualifications.length).toBeGreaterThanOrEqual(1);
    expect(h.experienceLabel).toMatch(/years experience/i);
    expect(h.about.length).toBeGreaterThan(20);
  });

  it('extracts JPMC responsibilities and required qualifications', () => {
    const h = extractCardHighlights(JPMC_JD);
    expect(h.responsibilities.length).toBeGreaterThanOrEqual(1);
    expect(h.minimumQualifications.length).toBeGreaterThanOrEqual(1);
    expect(h.preferredQualifications.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts Carrier key responsibilities and quals', () => {
    const h = extractCardHighlights(CARRIER_JD);
    expect(h.responsibilities.length + h.minimumQualifications.length).toBeGreaterThanOrEqual(2);
  });
});

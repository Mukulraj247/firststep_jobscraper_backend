import { describe, expect, it } from 'vitest';
import {
  applySpecialtyTitleOverrides,
  specialtyLacksTitleEvidence,
} from './specialtyTitleOverrides';

describe('applySpecialtyTitleOverrides — correct chips + coverage', () => {
  it('clears non-tech / facilities titles', () => {
    expect(applySpecialtyTitleOverrides('Citizens Teller', ['Software Engineering']).categories).toEqual(
      []
    );
    expect(
      applySpecialtyTitleOverrides('Data Center Facilities Technician', ['Cloud Engineering'])
        .categories
    ).toEqual([]);
    expect(applySpecialtyTitleOverrides('Area Manager II', ['Product Management']).categories).toEqual(
      []
    );
  });

  it('drops invented chips without title evidence', () => {
    expect(
      applySpecialtyTitleOverrides('Software Engineer III, Google Cloud', [
        'Software Engineering',
        'Data Analyst',
      ]).categories
    ).toEqual(['Software Engineering']);
    expect(
      applySpecialtyTitleOverrides('Camera Mechanical Design Engineer', [
        'Embedded Systems',
        'Solution Architecture',
      ]).categories
    ).toEqual([]);
  });

  it('recovers common tech titles that were previously empty', () => {
    expect(
      applySpecialtyTitleOverrides('Senior Software Applications Engineer', []).categories
    ).toContain('Software Engineering');
    expect(
      applySpecialtyTitleOverrides('Director of Software Engineering - Linux OS', []).categories
    ).toEqual(expect.arrayContaining(['Software Engineering']));
    expect(
      applySpecialtyTitleOverrides('Senior Applications Development Engineer', []).categories
    ).toContain('Software Engineering');
    expect(
      applySpecialtyTitleOverrides('Senior AI Research Quantization Engineer', []).categories
    ).toContain('AI Engineer');
    expect(
      applySpecialtyTitleOverrides('CI Infrastructure Engineer', []).categories
    ).toContain('DevOps');
    expect(
      applySpecialtyTitleOverrides('CPU Verification Engineer', []).categories
    ).toContain('QA / Testing');
    expect(
      applySpecialtyTitleOverrides('Senior Hypervisor and RTOS Engineer', []).categories
    ).toContain('Embedded Systems');
    expect(
      applySpecialtyTitleOverrides('Security Platform Technical Lead', []).categories
    ).toContain('Cybersecurity');
    expect(applySpecialtyTitleOverrides('Systems Analyst 1-IT', []).categories).toContain(
      'Data Analyst'
    );
    expect(applySpecialtyTitleOverrides('Principal Architect', []).categories).toContain(
      'Solution Architecture'
    );
    expect(
      applySpecialtyTitleOverrides('SW Developer Intern: Systems Assurance', []).categories
    ).toContain('Software Engineering');
    expect(applySpecialtyTitleOverrides('AI Applications Engineer', []).categories).toContain(
      'AI Engineer'
    );
    expect(
      applySpecialtyTitleOverrides('Google Cloud Security Specialist (GCP exp. required)', [])
        .categories
    ).toEqual(expect.arrayContaining(['Cybersecurity']));
    expect(
      applySpecialtyTitleOverrides('Senior Analytics Engineer - Finance', []).categories
    ).toContain('Data Engineering');
    expect(applySpecialtyTitleOverrides('IoT Engineer', []).categories).toContain(
      'Embedded Systems'
    );
    expect(
      applySpecialtyTitleOverrides('RF Hardware Engineer - Multi-Radio Coexistence', []).categories
    ).toContain('Electrical Engineering');
    expect(
      applySpecialtyTitleOverrides('Oracle EPM/EDM IT Architect', []).categories
    ).toEqual(expect.arrayContaining(['ERP', 'Solution Architecture']));
    expect(
      applySpecialtyTitleOverrides(
        'Flight Software (FSW) Engineer - Platform - HITL Infrastructure',
        []
      ).categories
    ).toContain('Software Engineering');
    expect(applySpecialtyTitleOverrides('AI Acceleration Engineer', []).categories).toContain(
      'AI Engineer'
    );
    expect(
      applySpecialtyTitleOverrides('Senior Architect - Microsoft Exchange Online', []).categories
    ).toContain('Solution Architecture');
    expect(
      applySpecialtyTitleOverrides('Automotive Software Test, Sr.Staff', []).categories
    ).toContain('QA / Testing');
    expect(
      applySpecialtyTitleOverrides('Principal Systems Development Engineer', []).categories
    ).toContain('Software Engineering');
    expect(
      applySpecialtyTitleOverrides('Lead, Infrastructure Architect', []).categories
    ).toEqual(expect.arrayContaining(['DevOps', 'Solution Architecture']));
  });

  it('keeps title precision on ML vs invented AI second chip', () => {
    expect(
      applySpecialtyTitleOverrides('Machine Learning Research Engineer', [
        'Machine Learning Engineer',
        'AI Engineer',
      ]).categories
    ).toEqual(['Machine Learning Engineer']);
  });

  it('specialtyLacksTitleEvidence', () => {
    expect(specialtyLacksTitleEvidence('Software Engineer', 'Software Engineering')).toBe(false);
    expect(specialtyLacksTitleEvidence('Area Manager II', 'Product Management')).toBe(true);
  });
});

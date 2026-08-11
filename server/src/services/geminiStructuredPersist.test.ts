import { describe, expect, it } from 'vitest';
import { StructuredJobSections } from './geminiJobExtractor';

/** Mirrors worker persistResult: only write non-empty structured fields. */
function applyStructuredOnlyIfPresent(
  existing: Partial<StructuredJobSections>,
  incoming?: StructuredJobSections
): Partial<StructuredJobSections> {
  if (!incoming) return { ...existing };
  const out: Partial<StructuredJobSections> = { ...existing };
  if (incoming.about) out.about = incoming.about;
  if (incoming.minimumQualifications?.length) {
    out.minimumQualifications = incoming.minimumQualifications;
  }
  if (incoming.preferredQualifications?.length) {
    out.preferredQualifications = incoming.preferredQualifications;
  }
  if (incoming.responsibilities?.length) out.responsibilities = incoming.responsibilities;
  if (incoming.benefits?.length) out.benefits = incoming.benefits;
  if (incoming.skills?.length) out.skills = incoming.skills;
  return out;
}

describe('structured field only-if-present persist semantics', () => {
  it('does not blank existing fields with empty Gemini arrays', () => {
    const existing: Partial<StructuredJobSections> = {
      about: 'Existing about',
      minimumQualifications: ['Keep me'],
      responsibilities: ['Keep resp'],
      skills: ['TypeScript'],
    };
    const sparse: StructuredJobSections = {
      about: '',
      minimumQualifications: [],
      preferredQualifications: ['Nice to have'],
      responsibilities: [],
      benefits: [],
      skills: [],
    };
    const next = applyStructuredOnlyIfPresent(existing, sparse);
    expect(next.about).toBe('Existing about');
    expect(next.minimumQualifications).toEqual(['Keep me']);
    expect(next.responsibilities).toEqual(['Keep resp']);
    expect(next.skills).toEqual(['TypeScript']);
    expect(next.preferredQualifications).toEqual(['Nice to have']);
  });

  it('writes new non-empty fields', () => {
    const next = applyStructuredOnlyIfPresent(
      {},
      {
        about: 'New about',
        minimumQualifications: ['Degree'],
        preferredQualifications: [],
        responsibilities: ['Ship'],
        benefits: [],
        skills: [],
      }
    );
    expect(next.about).toBe('New about');
    expect(next.minimumQualifications).toEqual(['Degree']);
    expect(next.responsibilities).toEqual(['Ship']);
    expect(next.benefits).toBeUndefined();
  });
});

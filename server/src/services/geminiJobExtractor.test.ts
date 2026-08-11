import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: {
        generateContent: vi.fn(),
      },
    })),
  };
});

import { GoogleGenAI } from '@google/genai';
import {
  composeCanonicalDescription,
  mapGeminiJsonToResult,
  extractJobFieldsWithGemini,
  __resetGeminiClientForTests,
  hashLlmInput,
} from './geminiJobExtractor';

describe('geminiJobExtractor helpers', () => {
  it('mapGeminiJsonToResult leaves missing fields empty (no fabrication)', () => {
    const { fields, structured } = mapGeminiJsonToResult({
      jobTitle: 'Software Engineer',
      companyName: null,
      location: '',
      minimumQualifications: ['BS in CS'],
      responsibilities: null,
      skills: [],
    });
    expect(fields.jobTitle).toBe('Software Engineer');
    expect(fields.companyName).toBe('');
    expect(fields.location).toBe('');
    expect(structured.minimumQualifications).toEqual(['BS in CS']);
    expect(structured.responsibilities).toEqual([]);
    expect(structured.skills).toEqual([]);
    expect(fields.jobDescription).toContain('Minimum qualifications');
    expect(fields.jobDescription).toContain('• BS in CS');
    expect(fields.jobDescription).not.toContain('Responsibilities');
  });

  it('mapGeminiJsonToResult normalizes prose salaryRange to a compact chip', () => {
    const { fields } = mapGeminiJsonToResult({
      jobTitle: 'Data Scientist',
      companyName: 'EY',
      location: 'Austin, TX',
      salaryRange:
        'The base salary range for this job in all geographic locations in the US is $76,600 to $126,300. The base salary range for New York City Metro Area is $91,800 to $143,400.',
    });
    expect(fields.salaryRange).toBe('$76,600 – $126,300');
    expect(fields.salaryRange.length).toBeLessThan(40);
  });

  it('composeCanonicalDescription only includes present sections', () => {
    const desc = composeCanonicalDescription({
      about: 'Build products',
      minimumQualifications: [],
      preferredQualifications: [],
      responsibilities: ['Ship features'],
      benefits: [],
      skills: ['TypeScript'],
    });
    expect(desc).toContain('About the job');
    expect(desc).toContain('Responsibilities');
    expect(desc).toContain('Skills');
    expect(desc).not.toContain('Minimum qualifications');
    expect(desc).not.toContain('Benefits');
  });

  it('hashLlmInput is stable', () => {
    expect(hashLlmInput('abc')).toBe(hashLlmInput('abc'));
    expect(hashLlmInput('abc')).not.toBe(hashLlmInput('abd'));
  });
});

describe('extractJobFieldsWithGemini', () => {
  beforeEach(() => {
    __resetGeminiClientForTests();
    vi.clearAllMocks();
    process.env.GEMINI_ENABLED = 'true';
    process.env.GEMINI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it('returns not configured when key missing', async () => {
    delete process.env.GEMINI_API_KEY;
    __resetGeminiClientForTests();
    const res = await extractJobFieldsWithGemini('some page text', 'https://example.com/job', {
      skipRateLimit: true,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('gemini_not_configured');
  });

  it('parses valid Gemini JSON', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        jobTitle: 'Engineer',
        companyName: 'Acme',
        location: 'Remote',
        about: 'Great role',
        minimumQualifications: ['3 years experience'],
        responsibilities: ['Build APIs'],
        benefits: [],
        skills: ['Node.js'],
      }),
      usageMetadata: { totalTokenCount: 120 },
    });
    (GoogleGenAI as any).mockImplementation(() => ({
      models: { generateContent },
    }));
    __resetGeminiClientForTests();

    const res = await extractJobFieldsWithGemini(
      'Job Title: Engineer\nAcme is hiring...',
      'https://example.com/jobs/1',
      { skipRateLimit: true }
    );
    expect(res.ok).toBe(true);
    expect(res.fields.jobTitle).toBe('Engineer');
    expect(res.structured.minimumQualifications).toEqual(['3 years experience']);
    expect(res.structured.benefits).toEqual([]);
    expect(res.usage.tokens).toBe(120);
    expect(generateContent).toHaveBeenCalledOnce();
  });

  it('handles malformed JSON without fabricating fields', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: 'not-json{{{',
      usageMetadata: { totalTokenCount: 10 },
    });
    (GoogleGenAI as any).mockImplementation(() => ({
      models: { generateContent },
    }));
    __resetGeminiClientForTests();

    const res = await extractJobFieldsWithGemini('page text here', 'https://x.com', {
      skipRateLimit: true,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('invalid_gemini_json');
    expect(res.fields.jobTitle).toBe('');
    expect(res.structured.minimumQualifications).toEqual([]);
  });
});

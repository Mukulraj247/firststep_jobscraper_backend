import axios from 'axios';
import { apiUrl } from '../apiConfig';

export type CategoryQaPhase = 'all' | 'cleared' | 'backfilled' | 'student_review';

/** Active UI sample batch — replaced each time you click Run random sample. */
export const CATEGORY_QA_UI_BATCH_ID = 'cat-qa-ui-sample';

export interface CategoryQaSummary {
  batchId: string;
  total: number;
  byPhase: {
    cleared: number;
    backfilled: number;
    student_review: number;
  };
  completeness: {
    reviewed: number;
    missingSpecialty: number;
    missingIndustry: number;
    missingExperience: number;
    missingLocation: number;
    missingH1bStamp: number;
    pctMissingSpecialty: number;
    pctMissingIndustry: number;
    pctMissingExperience: number;
    pctMissingLocation: number;
    pctMissingH1bStamp: number;
  };
}

export interface CategoryQaItem {
  id: string;
  jobTitle: string;
  companyName: string;
  jobUrl: string;
  status: string;
  categoryQaPhase: string;
  studentEscape: boolean;
  frozenCategories: string[];
  frozenIndustries: string[];
  frozenExperienceLevels: string[];
  frozenExperienceYears: string[];
  frozenStates: string[];
  frozenCities: Array<{ name: string; state: string }>;
  locationIsRemote: boolean;
  locationIsUs: boolean;
  location: string;
  h1bEligible: boolean;
  h1bCompanyScore: string;
  h1bMappingStatus: string;
  h1bFy2026Match: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CategoryQaListResponse {
  batchId: string;
  phase: CategoryQaPhase;
  page: number;
  limit: number;
  total: number;
  items: CategoryQaItem[];
}

export interface CategoryQaRunSampleResult {
  batchId: string;
  selected: number;
  cleared: number;
  backfilled: number;
  students: number;
  elapsedMs: number;
}

export async function getCategoryQaSummary(
  batchId: string = CATEGORY_QA_UI_BATCH_ID,
  signal?: AbortSignal
): Promise<CategoryQaSummary> {
  const response = await axios.get(`${apiUrl}/api/category-qa/summary`, {
    withCredentials: true,
    signal,
    params: { batchId },
  });
  return response.data;
}

export async function listCategoryQa(
  params: { batchId?: string; phase?: CategoryQaPhase; page?: number; limit?: number },
  signal?: AbortSignal
): Promise<CategoryQaListResponse> {
  const response = await axios.get(`${apiUrl}/api/category-qa`, {
    withCredentials: true,
    signal,
    params: {
      batchId: params.batchId || CATEGORY_QA_UI_BATCH_ID,
      phase: params.phase || 'all',
      page: params.page || 1,
      limit: params.limit || 50,
    },
  });
  return response.data;
}

/** Random N: clear categories/H-1B → backfill → land in Category QA. ~1000 can take 10–20+ minutes. */
export async function runCategoryQaSample(
  count = 1000,
  signal?: AbortSignal
): Promise<CategoryQaRunSampleResult> {
  const response = await axios.post(
    `${apiUrl}/api/category-qa/run-sample`,
    { count },
    {
      withCredentials: true,
      signal,
      timeout: 30 * 60_000,
    }
  );
  return response.data;
}

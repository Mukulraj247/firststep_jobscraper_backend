import axios from 'axios';
import { apiUrl } from '../apiConfig';

export interface JobBoardJob {
  id: string;
  createdAt: string;
  data: {
    jobId?: string;
    jobUrl?: string;
    applyUrl?: string;
    jobTitle?: string;
    companyName?: string;
    jobDescription?: string;
    jobCategory?: string;
    date?: string | Date;
    location?: string;
    salaryRange?: string;
    employmentType?: string;
    remoteType?: string;
    jobExperience?: number;
    sectorIndustry?: string;
    f500?: string;
    companyLogoUrl?: string;
    status?: string;
    enrichmentMethod?: string;
    lastEnrichedAt?: string | Date | null;
    about?: string;
    minimumQualifications?: string[];
    preferredQualifications?: string[];
    responsibilities?: string[];
    benefits?: string[];
    skills?: string[];
    certifications?: string[];
    seniorityLevel?: string;
    roleType?: string;
    educationRequirement?: string;
    visaSponsorship?: string;
    frozenCategories?: string[];
    companyEmployeeCount?: number;
    companyFoundedYear?: number;
    companyWebsite?: string;
    aggregatorPostingUrl?: string;
    [key: string]: any;
  };
}

export interface JobBoardFilters {
  categories: string[];
  /** Frozen taxonomy categories that currently have jobs, in taxonomy order. */
  frozenCategories: string[];
  locations: string[];
}

export interface JobBoardListResponse {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  jobs: JobBoardJob[];
  filters: JobBoardFilters;
}

export const listJobs = async (params?: {
  page?: number;
  limit?: number;
  q?: string;
  category?: string;
  /** Frozen taxonomy names; a job matches when it carries any of them. */
  frozenCategories?: string[];
  location?: string;
  workMode?: string;
  jobType?: string;
  added?: string;
  runId?: string;
  source?: string;
}): Promise<JobBoardListResponse> => {
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 20;
  const response = await axios.get(`${apiUrl}/api/jobs`, {
    params: {
      page,
      limit,
      ...(params?.q ? { q: params.q } : {}),
      ...(params?.category ? { category: params.category } : {}),
      ...(params?.frozenCategories?.length
        ? { frozenCategory: params.frozenCategories.join(',') }
        : {}),
      ...(params?.location ? { location: params.location } : {}),
      ...(params?.workMode ? { workMode: params.workMode } : {}),
      ...(params?.jobType ? { jobType: params.jobType } : {}),
      ...(params?.added && params.added !== 'all' ? { added: params.added } : {}),
      ...(params?.runId ? { runId: params.runId } : {}),
      ...(params?.source ? { source: params.source } : {}),
    },
    withCredentials: true,
  });
  const data = response.data || {};
  return {
    jobs: data.jobs || [],
    pagination: data.pagination || { page: 1, limit, total: 0, totalPages: 1 },
    filters: {
      categories: data.filters?.categories || [],
      frozenCategories: data.filters?.frozenCategories || [],
      locations: data.filters?.locations || [],
    },
  };
};

export const getJob = async (id: string): Promise<JobBoardJob> => {
  const response = await axios.get(`${apiUrl}/api/jobs/${id}`, { withCredentials: true });
  return response.data.job;
};

export interface EnrichmentFailureItem {
  id: string;
  title: string;
  company: string;
  jobUrl: string;
  aggregatorPostingUrl: string;
  applyUrl: string;
  status: string;
  attempts: number;
  lastError: string;
  lastEnrichedAt: string | Date | null;
  updatedAt: string | Date | null;
}

export const listEnrichmentFailures = async (params?: {
  page?: number;
  limit?: number;
  q?: string;
}): Promise<{ total: number; page: number; limit: number; items: EnrichmentFailureItem[] }> => {
  const page = params?.page ?? 0;
  const limit = params?.limit ?? 25;
  const response = await axios.get(`${apiUrl}/api/jobs/enrichment-failures`, {
    params: {
      page,
      limit,
      ...(params?.q ? { q: params.q } : {}),
    },
    withCredentials: true,
  });
  const data = response.data || {};
  return {
    total: Number(data.total || 0),
    page: Number(data.page ?? page),
    limit: Number(data.limit ?? limit),
    items: Array.isArray(data.items) ? data.items : [],
  };
};

export const requeueEnrichmentFailure = async (id: string): Promise<void> => {
  await axios.post(`${apiUrl}/api/jobs/enrichment-failures/${id}/requeue`, {}, { withCredentials: true });
};

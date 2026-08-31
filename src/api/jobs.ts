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
    companyEmployeeCount?: number;
    companyFoundedYear?: number;
    companyWebsite?: string;
    aggregatorPostingUrl?: string;
    [key: string]: any;
  };
}

export interface JobBoardFilters {
  categories: string[];
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
    filters: data.filters || { categories: [], locations: [] },
  };
};

export const getJob = async (id: string): Promise<JobBoardJob> => {
  const response = await axios.get(`${apiUrl}/api/jobs/${id}`, { withCredentials: true });
  return response.data.job;
};

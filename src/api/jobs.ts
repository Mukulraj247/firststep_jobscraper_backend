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
    [key: string]: any;
  };
}

export interface JobBoardFilters {
  companies: string[];
  categories: string[];
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
  company?: string;
  category?: string;
}): Promise<JobBoardListResponse> => {
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 20;
  const response = await axios.get(`${apiUrl}/api/jobs`, {
    params: {
      page,
      limit,
      ...(params?.q ? { q: params.q } : {}),
      ...(params?.company ? { company: params.company } : {}),
      ...(params?.category ? { category: params.category } : {}),
    },
    withCredentials: true,
  });
  const data = response.data || {};
  return {
    jobs: data.jobs || [],
    pagination: data.pagination || { page: 1, limit, total: 0, totalPages: 1 },
    filters: data.filters || { companies: [], categories: [] },
  };
};

export const getJob = async (id: string): Promise<JobBoardJob> => {
  const response = await axios.get(`${apiUrl}/api/jobs/${id}`, { withCredentials: true });
  return response.data.job;
};

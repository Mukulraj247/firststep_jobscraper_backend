import axios from 'axios';
import { apiUrl } from '../apiConfig';

export type H1bStats = {
  govEmployers: number;
  brands: number;
  autoApproved: number;
  pendingReview: number;
  approved: number;
  profiles: number;
};

export type H1bEmployerRow = {
  id: string;
  employerNameKey: string;
  employerNameDisplay: string;
  certifiedCount: number;
  totalFilings: number;
  firstFilingYear: number;
  lastFilingYear: number;
  yearsActive: number[];
  topJobTitles: Array<{ title: string; n: number }>;
  topSocCodes: Array<{ code: string; title: string; n: number }>;
  topStates: Array<{ state: string; n: number }>;
  dataAsOf: string | Date | null;
  mapping: {
    brandName: string;
    confidence: number;
    status: string;
    matchMethod: string;
    id: string;
  } | null;
};

export type H1bPendingMapping = {
  id: string;
  govEmployerKey: string;
  govDisplay: string;
  certifiedCount: number;
  brandName: string;
  brandId: string;
  confidence: number;
  matchMethod: string;
  status: string;
};

export async function getH1bStats(signal?: AbortSignal): Promise<H1bStats> {
  const response = await axios.get(`${apiUrl}/api/h1b/stats`, {
    withCredentials: true,
    signal,
  });
  return response.data;
}

export async function searchH1bEmployers(params?: {
  q?: string;
  page?: number;
  limit?: number;
  signal?: AbortSignal;
}): Promise<{
  employers: H1bEmployerRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const response = await axios.get(`${apiUrl}/api/h1b/employers`, {
    params: {
      q: params?.q || undefined,
      page: params?.page ?? 1,
      limit: params?.limit ?? 20,
    },
    withCredentials: true,
    signal: params?.signal,
  });
  return {
    employers: response.data?.employers || [],
    pagination: response.data?.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 },
  };
}

export async function listH1bPendingMappings(params?: {
  page?: number;
  limit?: number;
  signal?: AbortSignal;
}): Promise<{
  mappings: H1bPendingMapping[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const response = await axios.get(`${apiUrl}/api/h1b/mappings/pending`, {
    params: { page: params?.page ?? 1, limit: params?.limit ?? 25 },
    withCredentials: true,
    signal: params?.signal,
  });
  return {
    mappings: response.data?.mappings || [],
    pagination: response.data?.pagination || { page: 1, limit: 25, total: 0, totalPages: 1 },
  };
}

export async function approveH1bMapping(id: string): Promise<void> {
  await axios.post(`${apiUrl}/api/h1b/mappings/${id}/approve`, {}, { withCredentials: true });
}

export async function rejectH1bMapping(id: string, reason?: string): Promise<void> {
  await axios.post(
    `${apiUrl}/api/h1b/mappings/${id}/reject`,
    { reason: reason || '' },
    { withCredentials: true }
  );
}

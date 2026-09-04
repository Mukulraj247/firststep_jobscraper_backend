import axios from 'axios';
import { apiUrl } from '../apiConfig';

export interface EnrichmentMetrics {
  asOf: string;
  queue: {
    queued: number;
    dueNow: number;
    enriching: number;
    futureBackoff: number;
    leaseStuck: number;
  };
  windows: {
    ready1h: number;
    ready6h: number;
    created6h: number;
    queuedCreated6h: number;
  };
  bySourceClass: {
    career: { queued: number; enriching: number; ready6h: number };
    hiring_cafe: { queued: number; enriching: number; ready6h: number };
    other: { queued: number; enriching: number; ready6h: number };
  };
  byMethod6h: Record<string, number>;
  credits: {
    spentToday: number;
    budget: number;
    pausedForScrapeDo: boolean;
  };
  topErrors: Array<{ error: string; n: number }>;
  topQueuedHosts: Array<{ host: string; n: number }>;
  lastPass: {
    claimed: number;
    ready: number;
    ats_hit: number;
    failed: number;
    credits_spent: number;
    budget_paused: boolean;
  };
}

export async function getEnrichmentMetrics(signal?: AbortSignal): Promise<EnrichmentMetrics> {
  const response = await axios.get(`${apiUrl}/api/enrichment/metrics`, {
    withCredentials: true,
    signal,
  });
  return response.data;
}

/**
 * DigitalOcean Droplet metadata + Monitoring API client for Scout-X admin / ops digest.
 * Requires DIGITALOCEAN_TOKEN and DIGITALOCEAN_DROPLET_IDS (comma-separated).
 * Metrics need the DO metrics agent installed on the droplet.
 */
import axios, { AxiosInstance } from 'axios';
import logger from '../logger';

const DO_API = 'https://api.digitalocean.com/v2';

export type MetricsWindow = '1h' | '6h' | '24h';

export type MetricSeriesSummary = {
  latest: number | null;
  avg: number | null;
  max: number | null;
  points: Array<{ t: number; v: number }>;
};

export type DropletComputeSnapshot = {
  id: number;
  name: string;
  status: string;
  region: string | null;
  sizeSlug: string | null;
  vcpus: number | null;
  memoryMb: number | null;
  diskGb: number | null;
  priceMonthlyUsd: number | null;
  createdAt: string | null;
  metrics: {
    window: MetricsWindow;
    start: number;
    end: number;
    cpuPercent: MetricSeriesSummary;
    memoryUsedPercent: MetricSeriesSummary;
    memoryTotalBytes: number | null;
    memoryAvailableBytes: number | null;
    bandwidthInboundMbps: MetricSeriesSummary;
    bandwidthOutboundMbps: MetricSeriesSummary;
    empty: boolean;
    note: string | null;
  };
};

export type DigitalOceanDashboard = {
  configured: boolean;
  generatedAt: string;
  error?: string;
  droplets: DropletComputeSnapshot[];
};

const WINDOW_SECONDS: Record<MetricsWindow, number> = {
  '1h': 3600,
  '6h': 6 * 3600,
  '24h': 24 * 3600,
};

export function isDigitalOceanConfigured(): boolean {
  return !!(
    String(process.env.DIGITALOCEAN_TOKEN || '').trim() &&
    parseDropletIds().length > 0
  );
}

export function parseDropletIds(): number[] {
  const raw = String(process.env.DIGITALOCEAN_DROPLET_IDS || '').trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function parseMetricsWindow(raw?: string | null): MetricsWindow {
  const v = String(raw || '6h').trim().toLowerCase();
  if (v === '1h' || v === '24h' || v === '6h') return v;
  return '6h';
}

function getClient(): AxiosInstance | null {
  const token = String(process.env.DIGITALOCEAN_TOKEN || '').trim();
  if (!token) return null;
  return axios.create({
    baseURL: DO_API,
    timeout: 20_000,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

type PromResult = {
  metric?: Record<string, string>;
  values?: Array<[number | string, string]>;
};

function extractValues(payload: any): PromResult[] {
  const results = payload?.data?.result;
  return Array.isArray(results) ? results : [];
}

function flattenPoints(series: PromResult[]): Array<{ t: number; v: number }> {
  const points: Array<{ t: number; v: number }> = [];
  for (const s of series) {
    const values = s.values || [];
    for (const pair of values) {
      const t = Number(pair[0]);
      const v = Number(pair[1]);
      if (Number.isFinite(t) && Number.isFinite(v)) points.push({ t, v });
    }
  }
  points.sort((a, b) => a.t - b.t);
  return points;
}

function summarize(points: Array<{ t: number; v: number }>, maxPoints = 48): MetricSeriesSummary {
  if (!points.length) {
    return { latest: null, avg: null, max: null, points: [] };
  }
  const vals = points.map((p) => p.v);
  const sum = vals.reduce((a, b) => a + b, 0);
  const step = Math.max(1, Math.ceil(points.length / maxPoints));
  const sampled = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  return {
    latest: vals[vals.length - 1],
    avg: sum / vals.length,
    max: Math.max(...vals),
    points: sampled,
  };
}

/** Align timestamps across CPU modes and compute busy % = 100 * (1 - idle/total). */
function cpuPercentFromModes(series: PromResult[]): Array<{ t: number; v: number }> {
  const byTime = new Map<number, Record<string, number>>();
  for (const s of series) {
    const mode = String(s.metric?.mode || 'unknown').toLowerCase();
    for (const pair of s.values || []) {
      const t = Number(pair[0]);
      const v = Number(pair[1]);
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
      const row = byTime.get(t) || {};
      row[mode] = v;
      byTime.set(t, row);
    }
  }
  const points: Array<{ t: number; v: number }> = [];
  for (const [t, modes] of byTime) {
    const total = Object.values(modes).reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    const idle = modes.idle ?? 0;
    points.push({ t, v: Math.max(0, Math.min(100, (1 - idle / total) * 100)) });
  }
  points.sort((a, b) => a.t - b.t);
  return points;
}

function alignRatio(
  numerators: Array<{ t: number; v: number }>,
  denominators: Array<{ t: number; v: number }>
): Array<{ t: number; v: number }> {
  if (!numerators.length || !denominators.length) return [];
  const denByT = new Map(denominators.map((p) => [p.t, p.v]));
  const points: Array<{ t: number; v: number }> = [];
  for (const n of numerators) {
    let den = denByT.get(n.t);
    if (den == null || den <= 0) {
      // nearest timestamp within 90s
      let best: number | null = null;
      let bestDelta = Infinity;
      for (const d of denominators) {
        const delta = Math.abs(d.t - n.t);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = d.v;
        }
      }
      if (best == null || bestDelta > 90 || best <= 0) continue;
      den = best;
    }
    points.push({ t: n.t, v: Math.max(0, Math.min(100, (1 - n.v / den) * 100)) });
  }
  return points;
}

async function fetchMetric(
  client: AxiosInstance,
  path: string,
  params: Record<string, string | number>
): Promise<PromResult[]> {
  const res = await client.get(path, { params });
  return extractValues(res.data);
}

async function fetchDropletMeta(client: AxiosInstance, id: number) {
  const res = await client.get(`/droplets/${id}`);
  const d = res.data?.droplet;
  if (!d) throw new Error(`Droplet ${id} not found`);
  return {
    id: Number(d.id),
    name: String(d.name || `droplet-${id}`),
    status: String(d.status || 'unknown'),
    region: d.region?.slug || d.region?.name || null,
    sizeSlug: d.size_slug || d.size?.slug || null,
    vcpus: d.vcpus != null ? Number(d.vcpus) : d.size?.vcpus != null ? Number(d.size.vcpus) : null,
    memoryMb: d.memory != null ? Number(d.memory) : d.size?.memory != null ? Number(d.size.memory) : null,
    diskGb: d.disk != null ? Number(d.disk) : d.size?.disk != null ? Number(d.size.disk) : null,
    priceMonthlyUsd:
      d.size?.price_monthly != null
        ? Number(d.size.price_monthly)
        : d.size?.price_monthly === 0
          ? 0
          : null,
    createdAt: d.created_at || null,
  };
}

async function fetchDropletMetrics(
  client: AxiosInstance,
  hostId: number,
  window: MetricsWindow
): Promise<DropletComputeSnapshot['metrics']> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - WINDOW_SECONDS[window];
  const common = { host_id: hostId, start, end };

  const [cpuSeries, memAvail, memTotal, bwIn, bwOut] = await Promise.all([
    fetchMetric(client, '/monitoring/metrics/droplet/cpu', common),
    fetchMetric(client, '/monitoring/metrics/droplet/memory_available', common),
    fetchMetric(client, '/monitoring/metrics/droplet/memory_total', common),
    fetchMetric(client, '/monitoring/metrics/droplet/bandwidth', {
      ...common,
      interface: 'public',
      direction: 'inbound',
    }),
    fetchMetric(client, '/monitoring/metrics/droplet/bandwidth', {
      ...common,
      interface: 'public',
      direction: 'outbound',
    }),
  ]);

  const cpuPoints = cpuPercentFromModes(cpuSeries);
  const availPts = flattenPoints(memAvail);
  const totalPts = flattenPoints(memTotal);
  const memUsedPts = alignRatio(availPts, totalPts);
  const inPts = flattenPoints(bwIn).map((p) => ({
    t: p.t,
    // DO bandwidth is typically bits/s; present as Mbps
    v: p.v / 1_000_000,
  }));
  const outPts = flattenPoints(bwOut).map((p) => ({
    t: p.t,
    v: p.v / 1_000_000,
  }));

  const empty =
    !cpuPoints.length && !memUsedPts.length && !inPts.length && !outPts.length;

  return {
    window,
    start,
    end,
    cpuPercent: summarize(cpuPoints),
    memoryUsedPercent: summarize(memUsedPts),
    memoryTotalBytes: totalPts.length ? totalPts[totalPts.length - 1].v : null,
    memoryAvailableBytes: availPts.length ? availPts[availPts.length - 1].v : null,
    bandwidthInboundMbps: summarize(inPts),
    bandwidthOutboundMbps: summarize(outPts),
    empty,
    note: empty
      ? 'No monitoring samples returned. Confirm the DigitalOcean metrics agent is installed on the droplet and the PAT can read Monitoring.'
      : null,
  };
}

export async function getDigitalOceanDashboard(
  window: MetricsWindow = '6h'
): Promise<DigitalOceanDashboard> {
  const generatedAt = new Date().toISOString();
  if (!isDigitalOceanConfigured()) {
    return {
      configured: false,
      generatedAt,
      error:
        'DigitalOcean is not configured. Set DIGITALOCEAN_TOKEN and DIGITALOCEAN_DROPLET_IDS.',
      droplets: [],
    };
  }

  const client = getClient();
  if (!client) {
    return {
      configured: false,
      generatedAt,
      error: 'DIGITALOCEAN_TOKEN is missing.',
      droplets: [],
    };
  }

  const ids = parseDropletIds();
  const droplets: DropletComputeSnapshot[] = [];

  for (const id of ids) {
    try {
      const meta = await fetchDropletMeta(client, id);
      const metrics = await fetchDropletMetrics(client, id, window);
      droplets.push({ ...meta, metrics });
    } catch (error: any) {
      const msg = error?.response?.data?.message || error?.message || String(error);
      logger.log('error', `DigitalOcean metrics failed for droplet ${id}: ${msg}`);
      droplets.push({
        id,
        name: `droplet-${id}`,
        status: 'error',
        region: null,
        sizeSlug: null,
        vcpus: null,
        memoryMb: null,
        diskGb: null,
        priceMonthlyUsd: null,
        createdAt: null,
        metrics: {
          window,
          start: Math.floor(Date.now() / 1000) - WINDOW_SECONDS[window],
          end: Math.floor(Date.now() / 1000),
          cpuPercent: { latest: null, avg: null, max: null, points: [] },
          memoryUsedPercent: { latest: null, avg: null, max: null, points: [] },
          memoryTotalBytes: null,
          memoryAvailableBytes: null,
          bandwidthInboundMbps: { latest: null, avg: null, max: null, points: [] },
          bandwidthOutboundMbps: { latest: null, avg: null, max: null, points: [] },
          empty: true,
          note: msg,
        },
      });
    }
  }

  return { configured: true, generatedAt, droplets };
}

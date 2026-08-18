/**
 * DigitalOcean Droplet metadata + Monitoring API client for Scout-X admin / ops digest.
 *
 * Env:
 *   DIGITALOCEAN_TOKEN          — Personal Access Token (read)
 *   DIGITALOCEAN_DROPLET_IDS    — Comma-separated droplet IDs, or `auto` / empty to
 *                                 resolve from account (prefer PUBLIC_URL / BACKEND_URL IP)
 *
 * Metrics require the DO metrics agent (`do-agent`) on the Droplet.
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
  publicIpv4: string | null;
  createdAt: string | null;
  metrics: {
    window: MetricsWindow;
    start: number;
    end: number;
    cpuPercent: MetricSeriesSummary;
    memoryUsedPercent: MetricSeriesSummary;
    memoryUsedBytes: number | null;
    memoryTotalBytes: number | null;
    memoryAvailableBytes: number | null;
    diskUsedPercent: MetricSeriesSummary;
    diskUsedBytes: number | null;
    diskTotalBytes: number | null;
    bandwidthInboundMbps: MetricSeriesSummary;
    bandwidthOutboundMbps: MetricSeriesSummary;
    /** Reserved: DO Monitoring Metrics API no longer publishes disk_read (alert type only). */
    diskReadMbps: MetricSeriesSummary;
    /** Reserved: DO Monitoring Metrics API no longer publishes disk_write (alert type only). */
    diskWriteMbps: MetricSeriesSummary;
    load1: MetricSeriesSummary;
    empty: boolean;
    note: string | null;
  };
};

export type DigitalOceanDashboard = {
  configured: boolean;
  generatedAt: string;
  error?: string;
  hint?: string;
  resolvedIds?: number[];
  availableDroplets?: Array<{ id: number; name: string; status: string; publicIpv4: string | null }>;
  droplets: DropletComputeSnapshot[];
};

const WINDOW_SECONDS: Record<MetricsWindow, number> = {
  '1h': 3600,
  '6h': 6 * 3600,
  '24h': 24 * 3600,
};

export function isDigitalOceanConfigured(): boolean {
  return !!String(process.env.DIGITALOCEAN_TOKEN || '').trim();
}

export function parseDropletIds(): number[] {
  const raw = String(process.env.DIGITALOCEAN_DROPLET_IDS || '').trim();
  if (!raw || raw.toLowerCase() === 'auto') return [];
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
    timeout: 25_000,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

function publicIpFromEnv(): string | null {
  for (const key of ['PUBLIC_URL', 'BACKEND_URL', 'VITE_PUBLIC_URL']) {
    const raw = String(process.env[key] || '').trim();
    if (!raw) continue;
    try {
      const host = new URL(raw).hostname;
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export type PromResult = {
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
    for (const pair of s.values || []) {
      const t = Number(pair[0]);
      const v = Number(pair[1]);
      if (Number.isFinite(t) && Number.isFinite(v)) points.push({ t, v });
    }
  }
  points.sort((a, b) => a.t - b.t);
  return points;
}

function summarize(points: Array<{ t: number; v: number }>, maxPoints = 96): MetricSeriesSummary {
  if (!points.length) {
    return { latest: null, avg: null, max: null, points: [] };
  }
  const vals = points.map((p) => p.v);
  const step = Math.max(1, Math.ceil(points.length / maxPoints));
  const sampled = points.filter((_, i) => i % step === 0 || i === points.length - 1);

  // Time-weighted average matches DO Insights "last hour" style summaries better
  // than a plain mean of sparse samples (brief spikes were being under-weighted).
  let weighted = 0;
  let weight = 0;
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].t - points[i - 1].t;
    if (dt <= 0) continue;
    weighted += points[i].v * dt;
    weight += dt;
  }
  const avg = weight > 0 ? weighted / weight : vals[vals.length - 1];

  return {
    latest: vals[vals.length - 1],
    avg,
    max: Math.max(...vals),
    points: sampled,
  };
}

/** Default bucket size for aligning per-mode CPU counter series from do-agent. */
export const CPU_MODE_BUCKET_SEC = 60;

/**
 * DO CPU metrics are cumulative /proc/stat counters (seconds since boot), not
 * instantaneous %. Busy % for an interval = 100 * (1 - Δidle / Δtotal).
 *
 * Modes often arrive on slightly different timestamps. Exact-key grouping then
 * yields incomplete rows and a near-flat under-read vs DO Insights. We:
 *  1) bucket samples (default 60s),
 *  2) forward-fill modes across buckets,
 *  3) require `idle` before emitting a utilization point.
 */
export function cpuPercentFromModes(
  series: PromResult[],
  bucketSec: number = CPU_MODE_BUCKET_SEC
): Array<{ t: number; v: number }> {
  const bucketSize = Math.max(15, Math.floor(bucketSec) || CPU_MODE_BUCKET_SEC);
  const buckets = new Map<number, Record<string, number>>();

  for (const s of series) {
    const mode = String(s.metric?.mode || 'unknown').toLowerCase();
    for (const pair of s.values || []) {
      const t = Number(pair[0]);
      const v = Number(pair[1]);
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
      const b = Math.floor(t / bucketSize) * bucketSize;
      const row = buckets.get(b) || {};
      // Cumulative counters: keep the latest sample inside the bucket.
      if (row[mode] == null || v >= row[mode]) row[mode] = v;
      buckets.set(b, row);
    }
  }

  const times = [...buckets.keys()].sort((a, b) => a - b);
  let filled: Record<string, number> = {};
  const filledBuckets: Array<{ t: number; modes: Record<string, number> }> = [];
  for (const t of times) {
    filled = { ...filled, ...buckets.get(t)! };
    if (filled.idle == null) continue;
    filledBuckets.push({ t, modes: { ...filled } });
  }

  const points: Array<{ t: number; v: number }> = [];
  for (let i = 1; i < filledBuckets.length; i++) {
    const prev = filledBuckets[i - 1].modes;
    const curr = filledBuckets[i].modes;
    const modes = new Set([...Object.keys(prev), ...Object.keys(curr)]);
    let totalDelta = 0;
    let idleDelta = 0;
    let sawRealAdvance = false;
    for (const mode of modes) {
      if (prev[mode] == null || curr[mode] == null) continue;
      const d = curr[mode]! - prev[mode]!;
      if (d < 0) continue; // counter reset / reboot
      if (d > 0) sawRealAdvance = true;
      totalDelta += d;
      // Match DO Insights-style "CPU usage": only pure idle is idle.
      // iowait / irq / steal count as busy (already included via totalDelta).
      if (mode === 'idle') idleDelta += d;
    }
    if (!sawRealAdvance || totalDelta <= 0) continue;
    points.push({
      t: filledBuckets[i].t,
      v: Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)),
    });
  }
  return points;
}

function nearestValue(
  targetT: number,
  series: Array<{ t: number; v: number }>,
  maxDeltaSec = 120
): number | null {
  let best: number | null = null;
  let bestDelta = Infinity;
  for (const p of series) {
    const delta = Math.abs(p.t - targetT);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = p.v;
    }
  }
  if (best == null || bestDelta > maxDeltaSec) return null;
  return best;
}

function usedPercentFromAvailable(
  available: Array<{ t: number; v: number }>,
  total: Array<{ t: number; v: number }>
): Array<{ t: number; v: number }> {
  if (!available.length || !total.length) return [];
  const points: Array<{ t: number; v: number }> = [];
  for (const a of available) {
    const tot = nearestValue(a.t, total);
    if (tot == null || tot <= 0) continue;
    points.push({ t: a.t, v: Math.max(0, Math.min(100, (1 - a.v / tot) * 100)) });
  }
  return points;
}

function usedPercentFromFree(
  free: Array<{ t: number; v: number }>,
  size: Array<{ t: number; v: number }>
): Array<{ t: number; v: number }> {
  return usedPercentFromAvailable(free, size);
}

async function fetchMetricSafe(
  client: AxiosInstance,
  path: string,
  params: Record<string, string | number>
): Promise<PromResult[]> {
  try {
    const res = await client.get(path, { params });
    return extractValues(res.data);
  } catch (error: any) {
    const status = error?.response?.status;
    const msg = error?.response?.data?.message || error?.message;
    // 404 = path gone / not published for this account; empty series is fine.
    const level = status === 404 ? 'debug' : 'warn';
    logger.log(level, `DO metric ${path} failed (${status || '?'}): ${msg}`);
    return [];
  }
}

function dropletPublicIpv4(d: any): string | null {
  const nets = d?.networks?.v4;
  if (!Array.isArray(nets)) return null;
  const pub = nets.find((n: any) => n.type === 'public');
  return pub?.ip_address ? String(pub.ip_address) : null;
}

async function listAccountDroplets(client: AxiosInstance): Promise<
  Array<{ id: number; name: string; status: string; publicIpv4: string | null; raw: any }>
> {
  const res = await client.get('/droplets', { params: { per_page: 200 } });
  const list: any[] = Array.isArray(res.data?.droplets) ? res.data.droplets : [];
  return list.map((d: any) => ({
    id: Number(d.id),
    name: String(d.name || `droplet-${d.id}`),
    status: String(d.status || 'unknown'),
    publicIpv4: dropletPublicIpv4(d),
    raw: d,
  }));
}

async function resolveDropletIds(
  client: AxiosInstance
): Promise<{
  ids: number[];
  available: Array<{ id: number; name: string; status: string; publicIpv4: string | null }>;
  hint?: string;
}> {
  const listed = await listAccountDroplets(client);
  const available = listed.map(({ id, name, status, publicIpv4 }) => ({
    id,
    name,
    status,
    publicIpv4,
  }));
  const configured = parseDropletIds();
  const preferredIp = publicIpFromEnv();

  if (configured.length) {
    const known = new Set(available.map((d) => d.id));
    const missing = configured.filter((id) => !known.has(id));
    if (missing.length) {
      const hint =
        `DIGITALOCEAN_DROPLET_IDS has unknown id(s): ${missing.join(', ')}. ` +
        `Use the full Droplet ID from the DigitalOcean URL (e.g. …/droplets/512345678), ` +
        `not the public IP prefix. Available: ${available
          .map((d) => `${d.name}=${d.id}${d.publicIpv4 ? ` (${d.publicIpv4})` : ''}`)
          .join(', ') || 'none'}. ` +
        `Or set DIGITALOCEAN_DROPLET_IDS=auto`;
      return { ids: configured, available, hint };
    }
    return { ids: configured, available };
  }

  if (preferredIp) {
    const match = available.find((d) => d.publicIpv4 === preferredIp);
    if (match) {
      return {
        ids: [match.id],
        available,
        hint: `Auto-selected droplet ${match.name} (${match.id}) from PUBLIC_URL/BACKEND_URL IP ${preferredIp}.`,
      };
    }
  }

  if (available.length === 1) {
    return {
      ids: [available[0].id],
      available,
      hint: `Auto-selected the only droplet in this account: ${available[0].name} (${available[0].id}).`,
    };
  }

  const scout = available.filter((d) => /scout/i.test(d.name));
  if (scout.length === 1) {
    return {
      ids: [scout[0].id],
      available,
      hint: `Auto-selected droplet by name: ${scout[0].name} (${scout[0].id}).`,
    };
  }

  return {
    ids: [],
    available,
    hint:
      'Set DIGITALOCEAN_DROPLET_IDS to a full Droplet ID (from the Droplet URL), or ensure PUBLIC_URL uses this Droplet IP. ' +
      `Available: ${available.map((d) => `${d.name}=${d.id}${d.publicIpv4 ? ` (${d.publicIpv4})` : ''}`).join(', ') || 'none'}`,
  };
}

function mapDropletMeta(d: any) {
  return {
    id: Number(d.id),
    name: String(d.name || `droplet-${d.id}`),
    status: String(d.status || 'unknown'),
    region: d.region?.slug || d.region?.name || null,
    sizeSlug: d.size_slug || d.size?.slug || null,
    vcpus: d.vcpus != null ? Number(d.vcpus) : d.size?.vcpus != null ? Number(d.size.vcpus) : null,
    memoryMb: d.memory != null ? Number(d.memory) : d.size?.memory != null ? Number(d.size.memory) : null,
    diskGb: d.disk != null ? Number(d.disk) : d.size?.disk != null ? Number(d.size.disk) : null,
    priceMonthlyUsd: d.size?.price_monthly != null ? Number(d.size.price_monthly) : null,
    publicIpv4: dropletPublicIpv4(d),
    createdAt: d.created_at || null,
  };
}

async function fetchDropletMeta(client: AxiosInstance, id: number) {
  const res = await client.get(`/droplets/${id}`);
  const d = res.data?.droplet;
  if (!d) throw new Error(`Droplet ${id} not found`);
  return mapDropletMeta(d);
}

async function fetchDropletMetrics(
  client: AxiosInstance,
  hostId: number,
  window: MetricsWindow
): Promise<DropletComputeSnapshot['metrics']> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - WINDOW_SECONDS[window];
  const common = { host_id: hostId, start, end };

  // Disk I/O: DO still supports alert types `v1/insights/droplet/disk_read|disk_write`,
  // but the Monitoring Metrics API no longer exposes `/metrics/droplet/disk_read|disk_write`
  // (official OpenAPI + godo client omit them; live calls return 404). Keep empty series
  // for API stability; do not call those paths.
  const [
    cpuSeries,
    memAvail,
    memTotal,
    fsFree,
    fsSize,
    bwIn,
    bwOut,
    load1,
  ] = await Promise.all([
    fetchMetricSafe(client, '/monitoring/metrics/droplet/cpu', common),
    fetchMetricSafe(client, '/monitoring/metrics/droplet/memory_available', common),
    fetchMetricSafe(client, '/monitoring/metrics/droplet/memory_total', common),
    fetchMetricSafe(client, '/monitoring/metrics/droplet/filesystem_free', common),
    fetchMetricSafe(client, '/monitoring/metrics/droplet/filesystem_size', common),
    fetchMetricSafe(client, '/monitoring/metrics/droplet/bandwidth', {
      ...common,
      interface: 'public',
      direction: 'inbound',
    }),
    fetchMetricSafe(client, '/monitoring/metrics/droplet/bandwidth', {
      ...common,
      interface: 'public',
      direction: 'outbound',
    }),
    fetchMetricSafe(client, '/monitoring/metrics/droplet/load_1', common),
  ]);

  const cpuPoints = cpuPercentFromModes(cpuSeries);
  const availPts = flattenPoints(memAvail);
  const totalPts = flattenPoints(memTotal);
  const memUsedPts = usedPercentFromAvailable(availPts, totalPts);

  const freePts = flattenPoints(fsFree);
  const sizePts = flattenPoints(fsSize);
  const diskUsedPts = usedPercentFromFree(freePts, sizePts);

  // DO bandwidth API values are already Mbps (not bits/s). Dividing by 1e6 made charts show ~0.
  const inPts = flattenPoints(bwIn);
  const outPts = flattenPoints(bwOut);
  const loadPts = flattenPoints(load1);
  const blankIo: Array<{ t: number; v: number }> = [];

  const empty =
    !cpuPoints.length &&
    !memUsedPts.length &&
    !diskUsedPts.length &&
    !inPts.length &&
    !outPts.length;

  const memTotalLatest = totalPts.length ? totalPts[totalPts.length - 1].v : null;
  const memAvailLatest = availPts.length ? availPts[availPts.length - 1].v : null;
  const diskTotalLatest = sizePts.length ? sizePts[sizePts.length - 1].v : null;
  const diskFreeLatest = freePts.length ? freePts[freePts.length - 1].v : null;

  return {
    window,
    start,
    end,
    cpuPercent: summarize(cpuPoints),
    memoryUsedPercent: summarize(memUsedPts),
    memoryUsedBytes:
      memTotalLatest != null && memAvailLatest != null ? Math.max(0, memTotalLatest - memAvailLatest) : null,
    memoryTotalBytes: memTotalLatest,
    memoryAvailableBytes: memAvailLatest,
    diskUsedPercent: summarize(diskUsedPts),
    diskUsedBytes:
      diskTotalLatest != null && diskFreeLatest != null ? Math.max(0, diskTotalLatest - diskFreeLatest) : null,
    diskTotalBytes: diskTotalLatest,
    bandwidthInboundMbps: summarize(inPts),
    bandwidthOutboundMbps: summarize(outPts),
    diskReadMbps: summarize(blankIo),
    diskWriteMbps: summarize(blankIo),
    load1: summarize(loadPts),
    empty,
    note: empty
      ? 'No monitoring samples yet. Install the DigitalOcean metrics agent on the Droplet (`curl -sSL https://repos.insights.digitalocean.com/install.sh | bash`), wait 2–5 minutes, then Refresh DO.'
      : 'Disk I/O charts are unavailable: DigitalOcean no longer exposes disk_read/disk_write via the Monitoring Metrics API (alert policies only). CPU, memory, disk usage, bandwidth, and load still work.',
  };
}

function emptyMetrics(window: MetricsWindow, note: string): DropletComputeSnapshot['metrics'] {
  const end = Math.floor(Date.now() / 1000);
  const blank = { latest: null, avg: null, max: null, points: [] as Array<{ t: number; v: number }> };
  return {
    window,
    start: end - WINDOW_SECONDS[window],
    end,
    cpuPercent: blank,
    memoryUsedPercent: blank,
    memoryUsedBytes: null,
    memoryTotalBytes: null,
    memoryAvailableBytes: null,
    diskUsedPercent: blank,
    diskUsedBytes: null,
    diskTotalBytes: null,
    bandwidthInboundMbps: blank,
    bandwidthOutboundMbps: blank,
    diskReadMbps: blank,
    diskWriteMbps: blank,
    load1: blank,
    empty: true,
    note,
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
      error: 'DigitalOcean is not configured. Set DIGITALOCEAN_TOKEN (and optionally DIGITALOCEAN_DROPLET_IDS).',
      hint:
        'Create a read Personal Access Token, install do-agent on the Droplet, then set DIGITALOCEAN_DROPLET_IDS to the full numeric Droplet ID (or `auto`).',
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

  let resolved;
  try {
    resolved = await resolveDropletIds(client);
  } catch (error: any) {
    const msg = error?.response?.data?.message || error?.message || String(error);
    return {
      configured: true,
      generatedAt,
      error: `Failed to list Droplets: ${msg}`,
      hint: 'Check that DIGITALOCEAN_TOKEN is valid and has read scope.',
      droplets: [],
    };
  }

  if (!resolved.ids.length) {
    return {
      configured: true,
      generatedAt,
      error: 'No Droplet ID resolved.',
      hint: resolved.hint,
      availableDroplets: resolved.available,
      resolvedIds: [],
      droplets: [],
    };
  }

  const droplets: DropletComputeSnapshot[] = [];

  for (const id of resolved.ids) {
    try {
      const meta = await fetchDropletMeta(client, id);
      const metrics = await fetchDropletMetrics(client, id, window);
      droplets.push({ ...meta, metrics });
    } catch (error: any) {
      const status = error?.response?.status;
      const msg = error?.response?.data?.message || error?.message || String(error);
      logger.log('error', `DigitalOcean metrics failed for droplet ${id}: ${msg}`);

      let note = msg;
      if (status === 404 || /not found/i.test(msg)) {
        note =
          `Droplet ${id} was not found. ` +
          `DIGITALOCEAN_DROPLET_IDS must be the full Droplet ID from the DigitalOcean URL ` +
          `(e.g. https://cloud.digitalocean.com/droplets/512345678), not part of the public IP. ` +
          `Available: ${resolved.available
            .map((d) => `${d.name}=${d.id}${d.publicIpv4 ? ` (${d.publicIpv4})` : ''}`)
            .join(', ') || 'none'}. ` +
          `Or set DIGITALOCEAN_DROPLET_IDS=auto`;
      }

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
        publicIpv4: null,
        createdAt: null,
        metrics: emptyMetrics(window, note),
      });
    }
  }

  return {
    configured: true,
    generatedAt,
    hint: resolved.hint,
    resolvedIds: resolved.ids,
    availableDroplets: resolved.available,
    droplets,
  };
}

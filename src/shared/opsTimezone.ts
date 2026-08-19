/** Ops consoles use a single clock: India Standard Time (no DST). */
export const OPS_TIME_ZONE = 'Asia/Kolkata';

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function startOfIstDay(ymd: string): Date {
  const match = YMD_RE.exec(String(ymd).trim());
  if (!match) {
    throw new Error(`Invalid IST date: ${ymd}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - IST_OFFSET_MS);
}

export function endOfIstDay(ymd: string): Date {
  return new Date(startOfIstDay(ymd).getTime() + DAY_MS - 1);
}

export function formatIstYmd(ms: number): string {
  const shifted = new Date(ms + IST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function lastNIstDayYmds(nowMs: number, days: number): string[] {
  const today = formatIstYmd(nowMs);
  const start = startOfIstDay(today).getTime();
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(formatIstYmd(start - i * DAY_MS));
  }
  return out;
}

export function isIstDateWithinLastDays(
  ymd: string,
  nowMs: number,
  days: number,
): boolean {
  if (!YMD_RE.test(String(ymd).trim())) return false;
  try {
    startOfIstDay(ymd);
  } catch {
    return false;
  }
  const allowed = lastNIstDayYmds(nowMs, days);
  return allowed.includes(ymd);
}

/** Last `pastDays` + today + next `futureDays` IST calendar days (oldest first). */
export function istDayStripAroundToday(
  nowMs: number,
  pastDays = 3,
  futureDays = 3,
): string[] {
  const today = formatIstYmd(nowMs);
  const start = startOfIstDay(today).getTime();
  const out: string[] = [];
  for (let i = -pastDays; i <= futureDays; i += 1) {
    out.push(formatIstYmd(start + i * DAY_MS));
  }
  return out;
}

export function isIstDateOnDayStrip(
  ymd: string,
  nowMs: number,
  pastDays = 3,
  futureDays = 3,
): boolean {
  if (!YMD_RE.test(String(ymd).trim())) return false;
  try {
    startOfIstDay(ymd);
  } catch {
    return false;
  }
  return istDayStripAroundToday(nowMs, pastDays, futureDays).includes(ymd);
}

export function istHourOf(ms: number): number {
  return new Date(ms + IST_OFFSET_MS).getUTCHours();
}

export function istMinuteOf(ms: number): number {
  return new Date(ms + IST_OFFSET_MS).getUTCMinutes();
}

export function floorToIstUnit(ms: number, unitMs: number): number {
  const shifted = ms + IST_OFFSET_MS;
  return Math.floor(shifted / unitMs) * unitMs - IST_OFFSET_MS;
}

export function formatIstClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: OPS_TIME_ZONE,
  });
}

export function formatIstDateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: OPS_TIME_ZONE,
  });
}

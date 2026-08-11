/**
 * Shared schedule option definitions.
 * Used by the web dashboard and Chrome extension (via re-export).
 */

export interface ScheduleOption {
  label: string;
  description: string;
  /** null means scheduling is disabled (Off) */
  cron: string | null;
  icon?: string;
}

export const MIN_AUTOMATION_GAP_MS = 90_000;

const INTERVAL_CRON_TO_MS: Record<string, number> = {
  '*/15 * * * *': 15 * 60 * 1000,
  '*/30 * * * *': 30 * 60 * 1000,
  '0 * * * *': 60 * 60 * 1000,
  '0 */6 * * *': 6 * 60 * 60 * 1000,
  '0 */12 * * *': 12 * 60 * 60 * 1000,
  '0 0 * * *': 24 * 60 * 60 * 1000,
  '0 0 */2 * *': 2 * 24 * 60 * 60 * 1000,
  '0 0 */3 * *': 3 * 24 * 60 * 60 * 1000,
  '0 0 * * 1': 7 * 24 * 60 * 60 * 1000,
  '0 0 1 * *': 30 * 24 * 60 * 60 * 1000,
};

export function intervalMsFromCronClient(cron: string | null | undefined): number | null {
  if (!cron) return null;
  return INTERVAL_CRON_TO_MS[cron.trim().replace(/\s+/g, ' ')] ?? null;
}

/** Preferred local hours for first-run suggestions (matches server). */
export function preferredPhaseHoursForInterval(everyMs: number): number[] {
  if (everyMs === 6 * 60 * 60 * 1000) return [3, 9, 15, 21];
  if (everyMs === 12 * 60 * 60 * 1000) return [3, 15];
  if (everyMs >= 24 * 60 * 60 * 1000) return [3];
  return [];
}

/**
 * Build local preferred first-run slot labels for the schedule UI.
 * Returns ISO strings the client can send as preferredNextRunAt.
 */
export function buildPreferredStartSuggestions(
  cron: string | null | undefined,
  timezone: string = 'UTC',
  count: number = 4
): { iso: string; label: string }[] {
  const everyMs = intervalMsFromCronClient(cron);
  if (!everyMs) return [];
  const hours = preferredPhaseHoursForInterval(everyMs);
  const now = Date.now();
  const results: { iso: string; label: string }[] = [];

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  if (!hours.length) {
    const d = new Date(now + everyMs);
    results.push({
      iso: d.toISOString(),
      label: `First run ~${formatter.format(d)}`,
    });
    return results;
  }

  for (let step = 0; step < 24 * 14 && results.length < count; step++) {
    const probe = new Date(now + step * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      hour: 'numeric',
      hour12: false,
      minute: 'numeric',
    }).formatToParts(probe);
    const hourRaw = parseInt(parts.find((p) => p.type === 'hour')?.value || '-1', 10);
    const hour = hourRaw === 24 ? 0 : hourRaw;
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
    if (!hours.includes(hour)) continue;
    if (minute !== 0) continue;
    if (probe.getTime() <= now) continue;
    results.push({
      iso: probe.toISOString(),
      label: formatter.format(probe),
    });
  }

  if (!results.length) {
    const d = new Date(now + everyMs);
    results.push({
      iso: d.toISOString(),
      label: formatter.format(d),
    });
  }
  return results;
}

export const SCHEDULE_OPTIONS: ScheduleOption[] = [
  {
    label: 'Off',
    description: 'No recurring schedule',
    cron: null,
    icon: '⚡',
  },
  {
    label: 'Every 15 minutes',
    description: 'Runs ~15 minutes after save (90s-spaced), then every 15 minutes',
    cron: '*/15 * * * *',
    icon: '🕐',
  },
  {
    label: 'Every 30 minutes',
    description: 'Runs ~30 minutes after save (90s-spaced), then every 30 minutes',
    cron: '*/30 * * * *',
    icon: '🕐',
  },
  {
    label: 'Every hour',
    description: 'Runs ~1 hour after save (90s-spaced), then every hour',
    cron: '0 * * * *',
    icon: '🕐',
  },
  {
    label: 'Every 6 hours',
    description: 'Suggested phases 3am / 9am / 3pm / 9pm, then every 6 hours',
    cron: '0 */6 * * *',
    icon: '🕐',
  },
  {
    label: 'Every 12 hours',
    description: 'Suggested phases 3am / 3pm, then every 12 hours',
    cron: '0 */12 * * *',
    icon: '🕐',
  },
  {
    label: 'Every day',
    description: 'Suggested first run ~3am local, then every day (spread per robot)',
    cron: '0 0 * * *',
    icon: '📅',
  },
  {
    label: 'Every 2 days',
    description: 'Suggested first run ~3am local, then every 2 days',
    cron: '0 0 */2 * *',
    icon: '📅',
  },
  {
    label: 'Every 3 days',
    description: 'Suggested first run ~3am local, then every 3 days',
    cron: '0 0 */3 * *',
    icon: '📅',
  },
  {
    label: 'Every week',
    description: 'Suggested first run ~3am local, then every week',
    cron: '0 0 * * 1',
    icon: '📆',
  },
  {
    label: 'Every month',
    description: 'Suggested first run ~3am local, then every ~30 days',
    cron: '0 0 1 * *',
    icon: '📆',
  },
];

/**
 * Get a schedule option by its cron expression.
 * Returns undefined if no match (e.g. custom cron).
 */
export function getScheduleOptionByCron(cron: string | null | undefined): ScheduleOption | undefined {
  return SCHEDULE_OPTIONS.find((opt) => opt.cron === (cron ?? null));
}

/**
 * Get a human-readable label for a cron expression.
 */
export function getScheduleLabel(cron: string | null | undefined): string {
  const opt = getScheduleOptionByCron(cron);
  if (opt) return opt.label;
  if (!cron) return 'Off';
  return cron; // fallback: show raw cron
}

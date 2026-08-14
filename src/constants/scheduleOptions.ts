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

/**
 * @deprecated Wall-clock phase suggestions removed — Scout-X assigns a random
 * load-balanced first run server-side.
 */
export function preferredPhaseHoursForInterval(_everyMs: number): number[] {
  return [];
}

/**
 * @deprecated No longer used by ScheduleModal / AutomationConfigPage.
 * Kept so older imports do not break; always returns [].
 */
export function buildPreferredStartSuggestions(
  _cron: string | null | undefined,
  _timezone: string = 'UTC',
  _count: number = 4
): { iso: string; label: string }[] {
  return [];
}

const LOAD_BALANCED =
  'Scout-X assigns a random first run and spaces it ≥90s from other scrapes, then repeats on this interval';

export const SCHEDULE_OPTIONS: ScheduleOption[] = [
  {
    label: 'Off',
    description: 'No recurring schedule',
    cron: null,
    icon: '⚡',
  },
  {
    label: 'Every 15 minutes',
    description: LOAD_BALANCED,
    cron: '*/15 * * * *',
    icon: '🕐',
  },
  {
    label: 'Every 30 minutes',
    description: LOAD_BALANCED,
    cron: '*/30 * * * *',
    icon: '🕐',
  },
  {
    label: 'Every hour',
    description: LOAD_BALANCED,
    cron: '0 * * * *',
    icon: '🕐',
  },
  {
    label: 'Every 6 hours',
    description: LOAD_BALANCED,
    cron: '0 */6 * * *',
    icon: '🕐',
  },
  {
    label: 'Every 12 hours',
    description: LOAD_BALANCED,
    cron: '0 */12 * * *',
    icon: '🕐',
  },
  {
    label: 'Every day',
    description: LOAD_BALANCED,
    cron: '0 0 * * *',
    icon: '📅',
  },
  {
    label: 'Every 2 days',
    description: LOAD_BALANCED,
    cron: '0 0 */2 * *',
    icon: '📅',
  },
  {
    label: 'Every 3 days',
    description: LOAD_BALANCED,
    cron: '0 0 */3 * *',
    icon: '📅',
  },
  {
    label: 'Every week',
    description: LOAD_BALANCED,
    cron: '0 0 * * 1',
    icon: '📆',
  },
  {
    label: 'Every month',
    description: LOAD_BALANCED,
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

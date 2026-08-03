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

export const SCHEDULE_OPTIONS: ScheduleOption[] = [
  {
    label: 'Off',
    description: 'No recurring schedule',
    cron: null,
    icon: '⚡',
  },
  {
    label: 'Every 15 minutes',
    description: 'Runs 15 minutes after save, then every 15 minutes',
    cron: '*/15 * * * *',
    icon: '🕐',
  },
  {
    label: 'Every 30 minutes',
    description: 'Runs 30 minutes after save, then every 30 minutes',
    cron: '*/30 * * * *',
    icon: '🕐',
  },
  {
    label: 'Every hour',
    description: 'Runs 1 hour after save, then every hour',
    cron: '0 * * * *',
    icon: '🕐',
  },
  {
    label: 'Every 6 hours',
    description: 'Runs 6 hours after save, then every 6 hours',
    cron: '0 */6 * * *',
    icon: '🕐',
  },
  {
    label: 'Every 12 hours',
    description: 'Runs 12 hours after save, then every 12 hours',
    cron: '0 */12 * * *',
    icon: '🕐',
  },
  {
    label: 'Every day',
    description: 'Runs once daily at midnight UTC',
    cron: '0 0 * * *',
    icon: '📅',
  },
  {
    label: 'Every 2 days',
    description: 'Runs every other day at midnight',
    cron: '0 0 */2 * *',
    icon: '📅',
  },
  {
    label: 'Every 3 days',
    description: 'Runs every 3 days at midnight',
    cron: '0 0 */3 * *',
    icon: '📅',
  },
  {
    label: 'Every week',
    description: 'Runs every Monday at midnight UTC',
    cron: '0 0 * * 1',
    icon: '📆',
  },
  {
    label: 'Every month',
    description: 'Runs on the 1st of each month',
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

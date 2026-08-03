import React, { useMemo, useState, useEffect } from 'react';
import type { CloudScheduleDraft } from '../../shared/types';
import { SCHEDULE_OPTIONS } from '../../../../src/constants/scheduleOptions';

type PresetCron = string | null | 'custom';

/** Extension UI options = shared presets + custom cron entry. */
export const EXTENSION_SCHEDULE_OPTIONS: ReadonlyArray<{
  label: string;
  description: string;
  cron: PresetCron;
}> = [
  ...SCHEDULE_OPTIONS.map((opt) => ({
    label: opt.label,
    description: opt.description,
    cron: opt.cron as PresetCron,
  })),
  { label: 'Custom cron', description: 'Use a custom 5-field cron expression', cron: 'custom' },
];

export function isValidCron(expr: string): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return false;
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) return false;
  const fieldRe = /^[\d*,/\-]+$/;
  return fields.every((f) => f.length > 0 && fieldRe.test(f));
}

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'America/Mexico_City',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;

export function getTimezoneAbbr(tz: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    });
    const parts = formatter.formatToParts(new Date());
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    return tzPart?.value || tz;
  } catch {
    return tz;
  }
}

/** Derive UI selection + custom cron string from a persisted draft. */
export function draftToPickerState(draft: CloudScheduleDraft): {
  selection: PresetCron;
  customCron: string;
  timezone: string;
} {
  const timezone = draft.timezone || 'UTC';
  if (!draft.enabled || !draft.cron?.trim()) {
    return { selection: null, customCron: '', timezone };
  }
  const c = draft.cron.trim();
  const matchPreset = EXTENSION_SCHEDULE_OPTIONS.find((o) => o.cron === c);
  if (matchPreset && matchPreset.cron !== 'custom' && matchPreset.cron !== null) {
    return { selection: c, customCron: '', timezone };
  }
  return { selection: 'custom', customCron: c, timezone };
}

export function pickerStateToDraft(
  selection: PresetCron,
  customCron: string,
  timezone: string
): CloudScheduleDraft {
  const effectiveCron: string | null =
    selection === null ? null : selection === 'custom' ? customCron.trim() || null : selection;
  return {
    enabled: effectiveCron !== null,
    cron: effectiveCron,
    timezone: timezone || 'UTC',
  };
}

export interface ExtensionScheduleFormProps {
  value: CloudScheduleDraft;
  onChange: (next: CloudScheduleDraft) => void;
  /** Smaller top margin when embedded in modal / settings */
  compact?: boolean;
  /**
   * `modal`: single-column grid + teal accents so the send dialog fits narrow panels
   * without a wide scrollbar overlapping the grid.
   */
  layout?: 'default' | 'modal';
}

/**
 * Controlled schedule presets + timezone. No network calls.
 */
export function ExtensionScheduleForm({ value, onChange, compact, layout = 'default' }: ExtensionScheduleFormProps) {
  const initial = useMemo(() => draftToPickerState(value), [value]);
  const [selection, setSelection] = useState<PresetCron>(initial.selection);
  const [customCron, setCustomCron] = useState(initial.customCron);
  const [timezone, setTimezone] = useState(initial.timezone);

  useEffect(() => {
    const next = draftToPickerState(value);
    setSelection(next.selection);
    setCustomCron(next.customCron);
    setTimezone(next.timezone);
  }, [value.enabled, value.cron, value.timezone]);

  const emit = (sel: PresetCron, custom: string, tz: string) => {
    onChange(pickerStateToDraft(sel, custom, tz));
  };

  const customInvalid =
    selection === 'custom' && customCron.trim().length > 0 && !isValidCron(customCron);

  const isModal = layout === 'modal';
  const accent = (isOff: boolean, isSelected: boolean) =>
    !isSelected ? '#2a2a2a' : isOff ? '#f59e0b' : isModal ? '#22d3ee' : '#ff00c3';
  const accentBg = (isOff: boolean, isSelected: boolean) =>
    !isSelected
      ? '#0f0f0f'
      : isOff
        ? 'rgba(245,158,11,0.12)'
        : isModal
          ? 'rgba(34,211,238,0.12)'
          : 'rgba(255,0,195,0.12)';
  const accentShadow = (isOff: boolean, isSelected: boolean) =>
    isSelected ? `0 0 0 2px ${isOff ? 'rgba(245,158,11,0.2)' : isModal ? 'rgba(34,211,238,0.25)' : 'rgba(255,0,195,0.2)'}` : 'none';
  const accentText = (isOff: boolean, isSelected: boolean) =>
    !isSelected ? '#6b7280' : isOff ? '#f59e0b' : isModal ? '#22d3ee' : '#ff00c3';
  const labelColor = (isOff: boolean, isSelected: boolean) =>
    !isSelected ? '#e5e7eb' : isOff ? '#f59e0b' : isModal ? '#e0f2fe' : '#ff00c3';

  return (
    <div
      style={{
        ...styles.wrapper,
        marginTop: compact ? 4 : 12,
        borderTop: compact ? 'none' : styles.wrapper.borderTop,
        paddingTop: compact ? 4 : 12,
      }}
    >
      <div style={{ ...styles.header, marginBottom: isModal ? 8 : 12 }}>
        <span style={styles.headerIcon}>🗓</span>
        <div>
          <div style={styles.headerTitle}>Cloud schedule (optional)</div>
          <div style={{ ...styles.headerSub, fontSize: isModal ? 10 : 11 }}>
            {isModal
              ? 'Included when you tap Send. Server time zone applies to cron.'
              : 'Applied on Scout-X when you send this automation. Recurring runs use your server clock.'}
          </div>
        </div>
      </div>

      <div style={{ ...styles.grid, ...(isModal ? styles.gridModal : {}) }}>
        {EXTENSION_SCHEDULE_OPTIONS.map((option) => {
          const isSelected = option.cron === selection;
          const isOff = option.cron === null;
          const isCustom = option.cron === 'custom';

          return (
            <button
              key={option.label}
              type="button"
              onClick={() => {
                setSelection(option.cron);
                if (option.cron !== 'custom') setCustomCron('');
                emit(option.cron, option.cron === 'custom' ? customCron : '', timezone);
              }}
              style={{
                ...styles.card,
                ...(isModal ? styles.cardModal : {}),
                borderColor: accent(isOff, isSelected),
                background: accentBg(isOff, isSelected),
                boxShadow: accentShadow(isOff, isSelected),
              }}
            >
              <div
                style={{
                  ...styles.cardIcon,
                  color: accentText(isOff, isSelected),
                }}
              >
                {isOff
                  ? '⚡'
                  : isCustom
                    ? '⌨'
                    : option.label.includes('month') || option.label.includes('week')
                      ? '📆'
                      : option.label.includes('day')
                        ? '📅'
                        : '🕐'}
              </div>
              <div
                style={{
                  ...styles.cardLabel,
                  color: labelColor(isOff, isSelected),
                  fontWeight: isSelected ? 700 : 600,
                }}
              >
                {option.label}
              </div>
              <div style={styles.cardDesc}>{option.description}</div>
            </button>
          );
        })}
      </div>

      {selection === 'custom' && (
        <div style={styles.customRow}>
          <span style={styles.timezoneLabel}>Cron</span>
          <input
            type="text"
            placeholder="e.g. */15 * * * *"
            value={customCron}
            onChange={(e) => {
              const v = e.target.value;
              setCustomCron(v);
              emit('custom', v, timezone);
            }}
            spellCheck={false}
            style={{
              ...styles.timezoneSelect,
              borderColor: customInvalid ? '#ef4444' : '#333',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          />
        </div>
      )}
      {customInvalid && (
        <div style={styles.cronHint}>
          Invalid cron expression — need 5 fields like <code>*/15 * * * *</code>
        </div>
      )}

      {selection !== null && (
        <div style={styles.timezoneRow}>
          <span style={styles.timezoneLabel}>Timezone</span>
          <select
            value={timezone}
            onChange={(e) => {
              const tz = e.target.value;
              setTimezone(tz);
              emit(selection, customCron, tz);
            }}
            style={styles.timezoneSelect}
          >
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {getTimezoneAbbr(tz)} — {tz}
              </option>
            ))}
          </select>
        </div>
      )}

      {selection === 'custom' && customInvalid && (
        <div style={{ ...styles.cronHint, marginTop: 4 }}>Fix the cron expression before sending.</div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    borderTop: '1px solid #1f1f1f',
    paddingTop: 12,
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  headerIcon: {
    fontSize: 20,
    lineHeight: 1,
    flexShrink: 0,
    marginTop: 1,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: '#f9fafb',
    marginBottom: 2,
  },
  headerSub: {
    fontSize: 11,
    color: '#6b7280',
    lineHeight: 1.4,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 6,
    marginBottom: 10,
  },
  gridModal: {
    gridTemplateColumns: '1fr',
    gap: 5,
    paddingRight: 2,
  },
  card: {
    padding: '10px 10px',
    borderRadius: 10,
    border: '2px solid',
    cursor: 'pointer',
    textAlign: 'left' as const,
    transition: 'all 0.15s ease',
    outline: 'none',
  },
  cardModal: {
    padding: '8px 10px',
  },
  cardIcon: {
    fontSize: 13,
    marginBottom: 3,
  },
  cardLabel: {
    fontSize: 12,
    display: 'block',
    lineHeight: 1.2,
    marginBottom: 2,
  },
  cardDesc: {
    fontSize: 10,
    color: '#6b7280',
    lineHeight: 1.3,
  },
  timezoneRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  customRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  cronHint: {
    fontSize: 10,
    color: '#fca5a5',
    marginBottom: 8,
    marginLeft: 2,
  },
  timezoneLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#9ca3af',
    whiteSpace: 'nowrap' as const,
  },
  timezoneSelect: {
    flex: 1,
    background: '#1a1a1a',
    border: '1px solid #333',
    borderRadius: 6,
    color: '#e5e7eb',
    padding: '6px 8px',
    fontSize: 11,
    outline: 'none',
    cursor: 'pointer',
  },
};

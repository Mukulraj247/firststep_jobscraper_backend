import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Button,
  Switch,
  useTheme,
  IconButton,
} from '@mui/material';
import {
  Close as CloseIcon,
  FlashOff,
  Schedule,
} from '@mui/icons-material';
import { CronBuilder, CronBuilderValue } from './CronBuilder';

interface ScheduleModalProps {
  open: boolean;
  automationId: string;
  automationName: string;
  currentCron: string | null | undefined;
  currentTimezone?: string;
  currentEnabled?: boolean;
  currentPaused?: boolean;
  onClose: () => void;
  onSave: (
    automationId: string,
    schedule: {
      enabled: boolean;
      cron: string | null;
      timezone: string;
    }
  ) => Promise<void>;
}

export type ScheduleMode = 'active' | 'paused' | 'disabled';

export interface ScheduleModalState {
  mode: ScheduleMode;
  cronValue: CronBuilderValue | null;
}

interface CurrentSchedule {
  currentCron: string | null | undefined;
  currentTimezone?: string;
  currentEnabled?: boolean;
  currentPaused?: boolean;
}

export function closedScheduleModalState(): ScheduleModalState {
  return { mode: 'disabled', cronValue: null };
}

export function deriveScheduleModalState({
  currentCron,
  currentTimezone,
  currentEnabled,
  currentPaused,
}: CurrentSchedule): ScheduleModalState {
  if (!currentCron) {
    return closedScheduleModalState();
  }

  const isPaused = currentPaused === true || currentEnabled === false;
  return {
    mode: isPaused ? 'paused' : 'active',
    cronValue: {
      cron: currentCron,
      timezone: currentTimezone || 'UTC',
    },
  };
}

export function buildScheduleSavePayload(
  state: ScheduleModalState,
  fallbackTimezone: string = 'UTC',
) {
  return {
    enabled: state.mode === 'active',
    cron: state.cronValue?.cron || null,
    timezone: state.cronValue?.timezone || fallbackTimezone,
  };
}

export const ScheduleModal: React.FC<ScheduleModalProps> = ({
  open,
  automationId,
  automationName,
  currentCron,
  currentTimezone,
  currentEnabled,
  currentPaused,
  onClose,
  onSave,
}) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const [mode, setMode] = useState<ScheduleMode>('disabled');
  const [cronValue, setCronValue] = useState<CronBuilderValue | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Track the original saved cron so toggling on preserves it
  const savedCronRef = React.useRef<CronBuilderValue | null>(null);

  // Sync state from props whenever the modal opens; clear leftovers on close
  useEffect(() => {
    if (open) {
      const initialState = deriveScheduleModalState({
        currentCron,
        currentTimezone,
        currentEnabled,
        currentPaused,
      });
      setMode(initialState.mode);
      setCronValue(initialState.cronValue);
      savedCronRef.current = initialState.cronValue;
      setSaved(false);
    } else {
      const closed = closedScheduleModalState();
      setMode(closed.mode);
      setCronValue(closed.cronValue);
      savedCronRef.current = null;
      setSaved(false);
    }
  }, [
    open,
    currentCron,
    currentTimezone,
    currentEnabled,
    currentPaused,
  ]);

  const handleEnabledToggle = (checked: boolean) => {
    if (!checked) {
      setMode(cronValue?.cron ? 'paused' : 'disabled');
    } else {
      setMode('active');
      // Re-enable: use saved cron if available, otherwise the current cronValue, else default to 15 min
      if (savedCronRef.current) {
        setCronValue(savedCronRef.current);
      } else if (cronValue?.cron) {
        // already has a cron, do nothing — keep current
      } else {
        setCronValue({ cron: '*/15 * * * *', timezone: currentTimezone || 'UTC' });
      }
    }
  };

  const handleCronChange = (value: CronBuilderValue) => {
    setCronValue(value);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(
        automationId,
        buildScheduleSavePayload(
          { mode, cronValue },
          currentTimezone || 'UTC',
        ),
      );
      setSaved(true);
      setTimeout(() => {
        onClose();
        setSaved(false);
      }, 800);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          background: isDark
            ? 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)'
            : 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
          border: `1px solid ${isDark ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.15)'}`,
          boxShadow: isDark
            ? '0 25px 50px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.1)'
            : '0 25px 50px rgba(15,23,42,0.15)',
          overflow: 'hidden',
        },
      }}
    >
      {/* Header */}
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          pb: 1,
          pt: 2.5,
          px: 3,
          borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
        }}
      >
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Schedule sx={{ color: '#6366f1', fontSize: 20 }} />
            <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1 }}>
              Schedule Automation
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
            {automationName}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ mt: -0.5 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ px: 3, py: 2.5 }}>
        {/* Off / On toggle */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 2.5,
            p: 1.5,
            borderRadius: 2,
            background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FlashOff sx={{ fontSize: 18, color: mode === 'active' ? 'text.disabled' : '#f59e0b' }} />
            <Typography variant="body2" fontWeight={600}>
              {mode === 'active'
                ? 'Scheduling enabled'
                : mode === 'paused'
                  ? 'Scheduling paused'
                  : 'Scheduling disabled'}
            </Typography>
          </Box>
          <Switch
            size="small"
            checked={mode === 'active'}
            onChange={(e) => handleEnabledToggle(e.target.checked)}
            sx={{
              '& .MuiSwitch-switchBase.Mui-checked': { color: '#6366f1' },
              '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                backgroundColor: '#6366f1',
              },
            }}
          />
        </Box>

        {/* Cron builder */}
        {mode === 'active' && (
          <>
            <CronBuilder
              key={automationId}
              cron={cronValue?.cron}
              timezone={cronValue?.timezone}
              onChange={handleCronChange}
            />
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" fontWeight={700} mb={0.5}>
                Load-balanced start
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                Scout-X assigns a random first run time and spaces it at least 90 seconds
                from other scrapes so jobs do not pile up at the same instant.
              </Typography>
            </Box>
          </>
        )}

        {mode !== 'active' && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              py: 4,
              color: 'text.disabled',
              gap: 1,
            }}
          >
            <FlashOff sx={{ fontSize: 36, opacity: 0.4 }} />
            <Typography variant="body2" color="text.disabled">
              {mode === 'paused'
                ? 'Recurring runs are paused; the schedule is preserved'
                : 'No recurring schedule will run'}
            </Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions
        sx={{
          px: 3,
          py: 2,
          borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
          gap: 1,
        }}
      >
        <Button variant="outlined" onClick={onClose} disabled={saving} sx={{ borderRadius: 2 }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || (mode === 'active' && !cronValue?.cron)}
          sx={{
            borderRadius: 2,
            minWidth: 140,
            background: saved
              ? 'linear-gradient(135deg, #10b981, #059669)'
              : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            boxShadow: '0 4px 14px rgba(99,102,241,0.4)',
            fontWeight: 700,
            '&:hover': {
              background: saved
                ? 'linear-gradient(135deg, #059669, #047857)'
                : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
            },
          }}
        >
          {saved ? '✓ Saved!' : saving ? 'Saving...' : 'Save Schedule'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

import React from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { AutomationSummary } from '../../api/automation';
import { ScheduleModal } from '../../components/robot/ScheduleModal';
import { TagPicker } from '../../components/automation/TagPicker';
import {
  type CreateAutomationFieldErrors,
  type CreateAutomationFormInput,
  canSubmitCreateAutomationForm,
  buildDeleteConfirmPayload,
} from './automationsPageBehavior';

export type CreateAutomationForm = CreateAutomationFormInput;

export type ScheduleModalState = {
  open: boolean;
  automationId: string;
  automationName: string;
  currentCron: string | null | undefined;
  currentTimezone: string;
  currentEnabled?: boolean;
  currentPaused?: boolean;
};

export function AutomationDialogs({
  isCreateOpen,
  form,
  createTags,
  createFormErrors,
  onFormChange,
  onCreateTagsChange,
  onCloseCreate,
  onCreate,
  creating,
  scheduleModal,
  onCloseSchedule,
  onSaveSchedule,
  deleteTarget,
  onCloseDelete,
  onConfirmDelete,
  deleting,
  stopAllOpen,
  stoppingAll,
  onCloseStopAll,
  onConfirmStopAll,
  resumeAllOpen,
  resumingAll,
  onCloseResumeAll,
  onConfirmResumeAll,
}: {
  isCreateOpen: boolean;
  form: CreateAutomationForm;
  createTags: string[];
  createFormErrors: CreateAutomationFieldErrors;
  onFormChange: (form: CreateAutomationForm) => void;
  onCreateTagsChange: (tags: string[]) => void;
  onCloseCreate: () => void;
  onCreate: () => void;
  creating: boolean;
  scheduleModal: ScheduleModalState;
  onCloseSchedule: () => void;
  onSaveSchedule: (
    automationId: string,
    schedule: {
      enabled: boolean;
      cron: string | null;
      timezone: string;
      preferredNextRunAt?: string | null;
    },
  ) => Promise<void>;
  deleteTarget: AutomationSummary | null;
  onCloseDelete: () => void;
  onConfirmDelete: () => void;
  deleting: boolean;
  stopAllOpen: boolean;
  stoppingAll: boolean;
  onCloseStopAll: () => void;
  onConfirmStopAll: () => void;
  resumeAllOpen: boolean;
  resumingAll: boolean;
  onCloseResumeAll: () => void;
  onConfirmResumeAll: () => void;
}) {
  const deletePayload = deleteTarget ? buildDeleteConfirmPayload(deleteTarget) : null;
  const canCreate = canSubmitCreateAutomationForm(form, creating);

  return (
    <>
      <Dialog
        open={isCreateOpen}
        onClose={() => { if (!creating) onCloseCreate(); }}
        fullWidth
        maxWidth="sm"
        scroll="paper"
        disableRestoreFocus
      >
        <DialogTitle sx={{ pb: 1 }}>Create automation</DialogTitle>
        <DialogContent dividers sx={{ pt: 2 }}>
          <Stack spacing={2}>
            <TextField
              label="Name"
              required
              fullWidth
              size="small"
              value={form.name}
              error={Boolean(createFormErrors.name)}
              helperText={createFormErrors.name || 'Display name for this scraper'}
              onChange={(event) => onFormChange({ ...form, name: event.target.value })}
            />
            <TextField
              label="Company name"
              required
              fullWidth
              size="small"
              value={form.companyName}
              error={Boolean(createFormErrors.companyName)}
              helperText={createFormErrors.companyName || 'Required'}
              onChange={(event) => onFormChange({ ...form, companyName: event.target.value })}
            />
            <TagPicker value={createTags} onChange={onCreateTagsChange} disabled={creating} />
            <TextField
              label="Start URL"
              required
              fullWidth
              size="small"
              value={form.startUrl}
              placeholder="https://careers.example.com/jobs"
              error={Boolean(createFormErrors.startUrl)}
              helperText={createFormErrors.startUrl || 'Page the scraper opens first'}
              onChange={(event) => onFormChange({ ...form, startUrl: event.target.value })}
            />
            <TextField
              label="Webhook URL"
              fullWidth
              size="small"
              value={form.webhookUrl}
              placeholder="https://hooks.example.com/scrape"
              error={Boolean(createFormErrors.webhookUrl)}
              helperText={createFormErrors.webhookUrl || 'Optional — receive rows after each run'}
              onChange={(event) => onFormChange({ ...form, webhookUrl: event.target.value })}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onCloseCreate} disabled={creating}>Cancel</Button>
          <Button
            onClick={onCreate}
            variant="contained"
            disabled={!canCreate}
          >
            {creating ? 'Creating…' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      <ScheduleModal
        open={scheduleModal.open}
        automationId={scheduleModal.automationId}
        automationName={scheduleModal.automationName}
        currentCron={scheduleModal.currentCron}
        currentTimezone={scheduleModal.currentTimezone}
        currentEnabled={scheduleModal.currentEnabled}
        currentPaused={scheduleModal.currentPaused}
        onClose={onCloseSchedule}
        onSave={onSaveSchedule}
      />

      <Dialog open={!!deleteTarget} onClose={() => { if (!deleting) onCloseDelete(); }} fullWidth maxWidth="sm">
        <DialogTitle>{deletePayload?.title || 'Delete automation?'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            This permanently removes <strong>{deletePayload?.automationName}</strong> and everything tied to it:
          </Typography>
          <Typography component="ul" variant="body2" color="text.secondary" sx={{ pl: 2, m: 0 }}>
            <li>Robot / automation record</li>
            <li>All runs and extracted rows in MongoDB</li>
            <li>Agenda queue jobs (scrapes, schedules, execution jobs)</li>
            <li>Stored session state and cloud screenshots for those runs (if Firebase Storage is configured)</li>
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCloseDelete} disabled={deleting}>Cancel</Button>
          <Button onClick={onConfirmDelete} color="error" variant="contained" disabled={deleting}>
            {deletePayload?.confirmLabel || 'Delete everything'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={stopAllOpen} onClose={() => !stoppingAll && onCloseStopAll()} fullWidth maxWidth="sm">
        <DialogTitle>Pause all recurring schedules?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Every automation that currently has an <strong>active</strong> schedule will be paused: Agenda
            schedule-trigger jobs are cancelled, so no new timed runs start. Your cron expressions stay saved in the database so
            you can resume later. This does not delete robots, run history, or extracted rows. Scraper jobs already
            running finish on their own.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCloseStopAll} disabled={stoppingAll}>
            Cancel
          </Button>
          <Button onClick={onConfirmStopAll} color="warning" variant="contained" disabled={stoppingAll}>
            {stoppingAll ? 'Pausing…' : 'Pause all'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={resumeAllOpen} onClose={() => !resumingAll && onCloseResumeAll()} fullWidth maxWidth="sm">
        <DialogTitle>Resume all paused schedules?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Every automation with a saved interval that is <strong>paused</strong> will turn back on: the same
            cron and timezone are re-applied and Agenda triggers are registered again. Already-active schedules
            are left unchanged.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCloseResumeAll} disabled={resumingAll}>
            Cancel
          </Button>
          <Button onClick={onConfirmResumeAll} color="success" variant="contained" disabled={resumingAll}>
            {resumingAll ? 'Resuming…' : 'Resume all'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

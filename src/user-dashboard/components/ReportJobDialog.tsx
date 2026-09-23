import React, { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { FeedJob } from '../types';
import { BODY_FONT, DISPLAY_FONT, STITCH, ghostButtonSx, primaryButtonSx } from '../tokens';

export type JobReportReason = 'incorrect_company' | 'incorrect_category' | 'old_job' | 'other';

const REASON_OPTIONS: { value: JobReportReason; label: string }[] = [
  { value: 'incorrect_company', label: 'Incorrect company' },
  { value: 'incorrect_category', label: 'Incorrect category' },
  { value: 'old_job', label: 'Old job' },
  { value: 'other', label: 'Other / miscellaneous' },
];

type Props = {
  open: boolean;
  job: FeedJob | null;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (payload: { reason: JobReportReason; note: string }) => void;
};

export function ReportJobDialog({ open, job, submitting = false, onClose, onSubmit }: Props) {
  const [reason, setReason] = useState<JobReportReason>('incorrect_company');
  const [note, setNote] = useState('');

  const handleClose = () => {
    if (submitting) return;
    setReason('incorrect_company');
    setNote('');
    onClose();
  };

  const canSubmit = reason !== 'other' || note.trim().length > 0;

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, color: STITCH.primary, pb: 0.5 }}>
        Report this job
      </DialogTitle>
      <DialogContent>
        {job && (
          <Typography sx={{ fontSize: '0.85rem', color: STITCH.muted, fontFamily: BODY_FONT, mb: 1.5 }}>
            {job.title} · {job.company}
          </Typography>
        )}
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: STITCH.onSurface, mb: 1 }}>
          Why are you reporting it?
        </Typography>
        <FormControl component="fieldset" fullWidth>
          <RadioGroup
            value={reason}
            onChange={(e) => setReason(e.target.value as JobReportReason)}
          >
            {REASON_OPTIONS.map((opt) => (
              <FormControlLabel
                key={opt.value}
                value={opt.value}
                control={<Radio size="small" sx={{ color: STITCH.secondary }} />}
                label={opt.label}
                sx={{ '& .MuiFormControlLabel-label': { fontSize: '0.875rem', fontFamily: BODY_FONT } }}
              />
            ))}
          </RadioGroup>
        </FormControl>
        <Stack sx={{ mt: 1.5 }}>
          <TextField
            size="small"
            multiline
            minRows={2}
            fullWidth
            placeholder={reason === 'other' ? 'Tell us what’s wrong…' : 'Optional details'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required={reason === 'other'}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={submitting} sx={ghostButtonSx}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disableElevation
          disabled={!canSubmit || submitting}
          onClick={() => onSubmit({ reason, note: note.trim() })}
          sx={primaryButtonSx}
        >
          {submitting ? 'Sending…' : 'Submit report'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

import React from 'react';
import { Dialog, DialogContent, IconButton } from '@mui/material';
import CloseRounded from '@mui/icons-material/CloseRounded';
import type { FeedJob } from '../types';
import { FeedDetailPane } from './FeedDetailPane';
import { RADIUS, STITCH } from '../tokens';

type Props = {
  open: boolean;
  job: FeedJob | null;
  assigning?: boolean;
  onClose: () => void;
  onSave?: () => void;
  onUnsave?: () => void;
  onAssign?: () => void;
  onReport?: () => void;
};

/** Full job dossier in a modal (replaces inline expand on My Feed). */
export function FeedJobModal({
  open,
  job,
  assigning = false,
  onClose,
  onSave,
  onUnsave,
  onAssign,
  onReport,
}: Props) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      scroll="paper"
      PaperProps={{
        sx: {
          borderRadius: RADIUS.card,
          maxHeight: '92vh',
          bgcolor: STITCH.surfaceLowest,
        },
      }}
    >
      <IconButton
        aria-label="Close"
        onClick={onClose}
        sx={{
          position: 'absolute',
          right: 8,
          top: 8,
          zIndex: 1,
          color: STITCH.muted,
          bgcolor: STITCH.surfaceLow,
          '&:hover': { bgcolor: STITCH.outlineVariant },
        }}
      >
        <CloseRounded />
      </IconButton>
      <DialogContent sx={{ p: 0, pt: 1 }}>
        {job && (
          <FeedDetailPane
            job={job}
            assigning={assigning}
            onSave={onSave}
            onUnsave={onUnsave}
            onAssign={onAssign}
            onReport={onReport}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

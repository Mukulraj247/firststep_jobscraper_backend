import React, { useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  DASHBOARD_TAG_LIMIT,
  isSelectableDashboardTag,
  toggleDashboardTag,
  type DashboardTag,
} from './dashboardPageBehavior';

export function TagFilterModal({
  open,
  tags,
  selected,
  onClose,
  onApply,
}: {
  open: boolean;
  tags: DashboardTag[];
  selected: string[];
  onClose: () => void;
  onApply: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState<string[]>(selected);
  const [query, setQuery] = useState('');

  React.useEffect(() => {
    if (open) {
      setDraft(selected);
      setQuery('');
    }
  }, [open, selected]);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tags
      .filter((tag) => isSelectableDashboardTag(tag))
      .filter((tag) => (q ? tag.label.toLowerCase().includes(q) || tag.tag.toLowerCase().includes(q) : true))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [tags, query]);

  const atLimit = draft.length >= DASHBOARD_TAG_LIMIT;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>View by tags</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Select up to {DASHBOARD_TAG_LIMIT} tags. State and city tags are hidden.
        </Typography>
        <TextField
          size="small"
          fullWidth
          label="Search tags"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          sx={{ mb: 1.5 }}
        />
        <Stack>
          {options.map((tag) => {
            const checked = draft.includes(tag.tag);
            return (
              <FormControlLabel
                key={tag.tag}
                control={
                  <Checkbox
                    checked={checked}
                    disabled={!checked && atLimit}
                    onChange={() => setDraft((current) => toggleDashboardTag(current, tag.tag))}
                  />
                }
                label={`${tag.label}${tag.namespaceLabel ? ` · ${tag.namespaceLabel}` : ''}`}
              />
            );
          })}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto', pl: 1 }}>
          {draft.length}/{DASHBOARD_TAG_LIMIT} selected
        </Typography>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => {
            onApply(draft);
            onClose();
          }}
        >
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}

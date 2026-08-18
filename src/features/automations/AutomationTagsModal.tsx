import React, { useMemo } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { formatTagChipLabel } from '../../components/automation/TagPicker';
import { TAG_CATALOG, parseTag } from '../../constants/tagCatalog';
import { FIRSTSTEP, RADIUS, tint } from '../../components/dashboard/ops/dashboardTokens';

const NAMESPACE_LABELS = Object.fromEntries(TAG_CATALOG.map((ns) => [ns.namespace, ns.label]));

export function groupTagsForDisplay(tags: string[]): Array<{ label: string; tags: string[] }> {
  const groups = new Map<string, string[]>();
  for (const tag of tags) {
    const parsed = parseTag(tag);
    const label = parsed ? NAMESPACE_LABELS[parsed.namespace] || parsed.namespace : 'Other';
    const existing = groups.get(label) || [];
    existing.push(tag);
    groups.set(label, existing);
  }
  return Array.from(groups.entries()).map(([label, groupTags]) => ({ label, tags: groupTags }));
}

export function AutomationTagsModal({
  open,
  onClose,
  automationName,
  tags,
}: {
  open: boolean;
  onClose: () => void;
  automationName: string;
  tags: string[];
}) {
  const groups = useMemo(() => groupTagsForDisplay(tags), [tags]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1, gap: 2 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="overline" sx={{ color: FIRSTSTEP.tealDark, fontWeight: 700, letterSpacing: '0.14em' }}>
            Tags
          </Typography>
          <Typography variant="h6" fontWeight={700} noWrap title={automationName}>
            {automationName}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {tags.length} {tags.length === 1 ? 'tag' : 'tags'}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} aria-label="Close tags">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {tags.length ? (
          <Stack spacing={2.25}>
            {groups.map((group) => (
              <Box key={group.label}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, color: FIRSTSTEP.navy }}>
                  {group.label}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {group.tags.map((tag) => (
                    <Chip
                      key={tag}
                      label={formatTagChipLabel(tag)}
                      size="small"
                      sx={{
                        height: 28,
                        borderRadius: RADIUS.pill,
                        fontWeight: 600,
                        bgcolor: tint(FIRSTSTEP.teal, 0.12),
                        color: FIRSTSTEP.navy,
                        border: `1px solid ${tint(FIRSTSTEP.teal, 0.28)}`,
                      }}
                    />
                  ))}
                </Box>
              </Box>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            This automation has no tags.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

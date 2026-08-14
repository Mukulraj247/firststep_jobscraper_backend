import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import {
  MAX_AUTOMATION_TAGS,
  TAG_CATALOG,
  type TagNamespaceDef,
} from '../../constants/tagCatalog';

export type CatalogOption = {
  tag: string;
  namespace: string;
  namespaceLabel: string;
  value: string;
};

export const ALL_TAG_OPTIONS: CatalogOption[] = TAG_CATALOG.flatMap((ns: TagNamespaceDef) =>
  ns.values.map((value: string) => ({
    tag: `${ns.namespace}:${value}`,
    namespace: ns.namespace,
    namespaceLabel: ns.label,
    value,
  }))
);

type ViewAllTagsModalProps = {
  open: boolean;
  onClose: () => void;
  value: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
};

export const ViewAllTagsModal: React.FC<ViewAllTagsModalProps> = ({
  open,
  onClose,
  value,
  onChange,
  disabled,
}) => {
  const [q, setQ] = useState('');

  const filteredByNs = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const groups: { label: string; options: CatalogOption[] }[] = [];
    for (const ns of TAG_CATALOG) {
      const options = ns.values
        .map((v) => ({
          tag: `${ns.namespace}:${v}`,
          namespace: ns.namespace,
          namespaceLabel: ns.label,
          value: v,
        }))
        .filter((o) => {
          if (!needle) return true;
          return (
            o.value.toLowerCase().includes(needle) ||
            o.namespace.toLowerCase().includes(needle) ||
            o.namespaceLabel.toLowerCase().includes(needle) ||
            o.tag.toLowerCase().includes(needle)
          );
        });
      if (options.length) groups.push({ label: ns.label, options });
    }
    return groups;
  }, [q]);

  const atMax = value.length >= MAX_AUTOMATION_TAGS;

  const toggle = (tag: string) => {
    if (disabled) return;
    if (value.includes(tag)) {
      onChange(value.filter((t) => t !== tag));
      return;
    }
    if (atMax) return;
    onChange([...value, tag]);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}>
        <Box>
          <Typography variant="h6" fontWeight={700}>
            All tags
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Select up to {MAX_AUTOMATION_TAGS} ({value.length}/{MAX_AUTOMATION_TAGS})
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <TextField
          fullWidth
          size="small"
          placeholder="Filter tags…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          sx={{ mb: 2 }}
          autoFocus
        />
        <Box sx={{ maxHeight: 420, overflow: 'auto' }}>
          {filteredByNs.map((group) => (
            <Box key={group.label} sx={{ mb: 2 }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                {group.label}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {group.options.map((o) => {
                  const selected = value.includes(o.tag);
                  return (
                    <Chip
                      key={o.tag}
                      label={o.value}
                      size="small"
                      color={selected ? 'primary' : 'default'}
                      variant={selected ? 'filled' : 'outlined'}
                      onClick={() => toggle(o.tag)}
                      disabled={disabled || (!selected && atMax)}
                      sx={{ cursor: disabled ? 'default' : 'pointer' }}
                    />
                  );
                })}
              </Box>
            </Box>
          ))}
          {!filteredByNs.length && (
            <Typography variant="body2" color="text.secondary">
              No tags match “{q.trim()}”.
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
};

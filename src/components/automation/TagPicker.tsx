import React, { useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  TextField,
} from '@mui/material';
import {
  MAX_AUTOMATION_TAGS,
  parseTag,
} from '../../constants/tagCatalog';
import {
  ALL_TAG_OPTIONS,
  type CatalogOption,
  ViewAllTagsModal,
} from './ViewAllTagsModal';

export interface TagPickerProps {
  value: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
}

const TAG_PLACEHOLDER = 'e.g. fortune 500, Seattle, tech, sponsorship';

export const TagPicker: React.FC<TagPickerProps> = ({ value, onChange, disabled }) => {
  const [inputValue, setInputValue] = useState('');
  const [viewAllOpen, setViewAllOpen] = useState(false);

  const selected = useMemo(
    () => ALL_TAG_OPTIONS.filter((o) => value.includes(o.tag)),
    [value]
  );

  const available = useMemo(() => {
    if (value.length >= MAX_AUTOMATION_TAGS) {
      return ALL_TAG_OPTIONS.filter((o) => value.includes(o.tag));
    }
    return ALL_TAG_OPTIONS;
  }, [value]);

  const filterOptions = (options: CatalogOption[], state: { inputValue: string }) => {
    const needle = state.inputValue.trim().toLowerCase();
    // Do not dump the full catalog on empty focus — require typing.
    if (!needle) return [];
    return options.filter((o) => {
      const hay = `${o.namespace} ${o.namespaceLabel} ${o.value} ${o.tag}`.toLowerCase();
      return hay.includes(needle);
    });
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
        <Autocomplete
          multiple
          disabled={disabled}
          options={available}
          value={selected}
          inputValue={inputValue}
          onInputChange={(_e, v) => setInputValue(v)}
          getOptionLabel={(o) => `${o.namespaceLabel}: ${o.value}`}
          groupBy={(o) => o.namespaceLabel}
          isOptionEqualToValue={(a, b) => a.tag === b.tag}
          filterSelectedOptions
          filterOptions={filterOptions}
          noOptionsText={
            inputValue.trim()
              ? 'No matching tags'
              : 'Start typing to search tags'
          }
          onChange={(_e, options) => {
            const next = options.map((o) => o.tag).slice(0, MAX_AUTOMATION_TAGS);
            onChange(next);
          }}
          sx={{ flex: 1 }}
          renderTags={(tagValue, getTagProps) =>
            tagValue.map((option, index) => {
              const { key, ...tagProps } = getTagProps({ index });
              return (
                <Chip
                  key={key}
                  size="small"
                  label={`${option.namespace}:${option.value}`}
                  {...tagProps}
                />
              );
            })
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label="Tags"
              placeholder={
                value.length >= MAX_AUTOMATION_TAGS
                  ? `Maximum ${MAX_AUTOMATION_TAGS} tags`
                  : TAG_PLACEHOLDER
              }
              helperText={`Up to ${MAX_AUTOMATION_TAGS} catalog tags per automation (${value.length}/${MAX_AUTOMATION_TAGS})`}
            />
          )}
        />
        <Button
          size="small"
          variant="outlined"
          disabled={disabled}
          onClick={() => setViewAllOpen(true)}
          sx={{ mt: 1, whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          View all tags
        </Button>
      </Box>
      <ViewAllTagsModal
        open={viewAllOpen}
        onClose={() => setViewAllOpen(false)}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    </Box>
  );
};

export function formatTagChipLabel(tag: string): string {
  const parsed = parseTag(tag);
  if (!parsed) return tag;
  return `${parsed.namespace}:${parsed.value}`;
}

import React, { useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Chip,
  TextField,
} from '@mui/material';
import {
  MAX_AUTOMATION_TAGS,
  TAG_CATALOG,
  parseTag,
  type TagNamespaceDef,
} from '../../constants/tagCatalog';

export interface TagPickerProps {
  value: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
}

type CatalogOption = {
  tag: string;
  namespace: string;
  namespaceLabel: string;
  value: string;
};

const ALL_OPTIONS: CatalogOption[] = TAG_CATALOG.flatMap((ns: TagNamespaceDef) =>
  ns.values.map((value: string) => ({
    tag: `${ns.namespace}:${value}`,
    namespace: ns.namespace,
    namespaceLabel: ns.label,
    value,
  }))
);

export const TagPicker: React.FC<TagPickerProps> = ({ value, onChange, disabled }) => {
  const [inputValue, setInputValue] = useState('');

  const selected = useMemo(
    () => ALL_OPTIONS.filter((o) => value.includes(o.tag)),
    [value]
  );

  const available = useMemo(() => {
    if (value.length >= MAX_AUTOMATION_TAGS) {
      return ALL_OPTIONS.filter((o) => value.includes(o.tag));
    }
    return ALL_OPTIONS;
  }, [value]);

  return (
    <Box>
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
        onChange={(_e, options) => {
          const next = options.map((o) => o.tag).slice(0, MAX_AUTOMATION_TAGS);
          onChange(next);
        }}
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
                : 'Search roles, industries, company categories…'
            }
            helperText={`Up to ${MAX_AUTOMATION_TAGS} catalog tags per automation (${value.length}/${MAX_AUTOMATION_TAGS})`}
          />
        )}
      />
    </Box>
  );
};

export function formatTagChipLabel(tag: string): string {
  const parsed = parseTag(tag);
  if (!parsed) return tag;
  return `${parsed.namespace}:${parsed.value}`;
}

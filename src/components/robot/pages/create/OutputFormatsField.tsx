import React from 'react';
import {
  Box,
  Checkbox,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  Typography,
} from '@mui/material';
import {
  DEFAULT_OUTPUT_FORMATS,
  OUTPUT_FORMAT_LABELS,
  OUTPUT_FORMAT_OPTIONS,
  OutputFormat,
} from '../../../../constants/outputFormats';

interface OutputFormatsFieldProps {
  value: OutputFormat[];
  onChange: (formats: OutputFormat[]) => void;
  required?: boolean;
  disabled?: boolean;
}

const COST_HINTS: Partial<Record<OutputFormat, string>> = {
  'screenshot-visible': 'Higher compute — use only if you need images.',
  'screenshot-fullpage': 'Highest compute — full-page screenshots are expensive.',
};

export const OutputFormatsField: React.FC<OutputFormatsFieldProps> = ({
  value,
  onChange,
  required = true,
  disabled = false,
}) => {
  const handleChange = (event: SelectChangeEvent<OutputFormat[]>) => {
    const raw = event.target.value;
    const next = (typeof raw === 'string' ? raw.split(',') : raw) as OutputFormat[];
    onChange(next.length ? next : [...DEFAULT_OUTPUT_FORMATS]);
  };

  const showScreenshotHint = value.some((f) => f.startsWith('screenshot'));

  return (
    <Box sx={{ width: '100%', textAlign: 'left' }}>
      <FormControl fullWidth disabled={disabled} required={required}>
        <InputLabel id="output-formats-label">
          Output Formats{required ? ' *' : ''}
        </InputLabel>
        <Select
          labelId="output-formats-label"
          multiple
          value={value}
          label={`Output Formats${required ? ' *' : ''}`}
          onChange={handleChange}
          renderValue={(selected) => {
            const labels = selected.map((v) => OUTPUT_FORMAT_LABELS[v] ?? v);
            return labels.length > 2
              ? `${labels.slice(0, 2).join(', ')}…`
              : labels.join(', ');
          }}
        >
          {OUTPUT_FORMAT_OPTIONS.map((format) => (
            <MenuItem key={format} value={format}>
              <Checkbox checked={value.includes(format)} />
              <Box>
                <Typography variant="body2">{OUTPUT_FORMAT_LABELS[format]}</Typography>
                {COST_HINTS[format] && (
                  <Typography variant="caption" color="text.secondary" display="block">
                    {COST_HINTS[format]}
                  </Typography>
                )}
              </Box>
            </MenuItem>
          ))}
        </Select>
        {showScreenshotHint && (
          <FormHelperText>
            Screenshots use more compute than Markdown/HTML. Prefer text formats when possible.
          </FormHelperText>
        )}
      </FormControl>
    </Box>
  );
};

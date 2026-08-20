import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, CircularProgress, TextField, Typography } from '@mui/material';
import { createScrapeRobot } from '../../../../api/storage';
import { useCacheInvalidation, useGlobalInfoStore } from '../../../../context/globalInfo';
import { DEFAULT_OUTPUT_FORMATS, OutputFormat } from '../../../../constants/outputFormats';
import { OutputFormatsField } from './OutputFormatsField';
import { isValidHttpUrl, normalizeUrl } from './url';

export const ScrapeCreatePanel: React.FC = () => {
  const navigate = useNavigate();
  const { notify } = useGlobalInfoStore();
  const { invalidateRecordings } = useCacheInvalidation();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [outputFormats, setOutputFormats] = useState<OutputFormat[]>([...DEFAULT_OUTPUT_FORMATS]);
  const [isLoading, setIsLoading] = useState(false);

  const canSubmit =
    name.trim().length > 0 && isValidHttpUrl(url) && outputFormats.length > 0 && !isLoading;

  const handleCreate = async () => {
    const normalized = normalizeUrl(url);
    if (!name.trim()) {
      notify('error', 'Please enter a scraper name');
      return;
    }
    if (!isValidHttpUrl(normalized)) {
      notify('error', 'Please enter a valid URL');
      return;
    }
    if (outputFormats.length === 0) {
      notify('error', 'Please select at least one output format');
      return;
    }

    setIsLoading(true);
    try {
      const result = await createScrapeRobot(normalized, name.trim(), outputFormats);
      setIsLoading(false);
      if (result) {
        invalidateRecordings();
        notify('success', `${name.trim()} created successfully!`);
        navigate('/scrapers');
      } else {
        notify('error', 'Failed to create scrape scraper');
      }
    } catch (error: any) {
      setIsLoading(false);
      notify('error', error.message || 'Failed to create scrape scraper');
    }
  };

  return (
    <Box display="flex" flexDirection="column" alignItems="stretch" gap={2}>
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mb: 1 }}>
        Capture Markdown, HTML, or screenshots from a listing or detail page for your pipeline.
      </Typography>
      <TextField
        label="Name"
        placeholder="Example: YC Companies Scraper"
        required
        fullWidth
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <TextField
        label="Website URL"
        placeholder="Example: https://www.ycombinator.com/companies/"
        required
        fullWidth
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onBlur={() => {
          if (url.trim()) setUrl(normalizeUrl(url));
        }}
        error={!!url.trim() && !isValidHttpUrl(url)}
        helperText={url.trim() && !isValidHttpUrl(url) ? 'Enter a valid http(s) URL' : ' '}
      />
      <OutputFormatsField value={outputFormats} onChange={setOutputFormats} />
      <Button
        variant="contained"
        fullWidth
        onClick={handleCreate}
        disabled={!canSubmit}
        sx={{
          bgcolor: '#ff00c3',
          py: 1.4,
          fontSize: '1rem',
          textTransform: 'none',
          borderRadius: 2,
          '&:hover': { bgcolor: '#ff00c3' },
        }}
        startIcon={isLoading ? <CircularProgress size={20} color="inherit" /> : null}
      >
        {isLoading ? 'Creating...' : 'Create scraper'}
      </Button>
    </Box>
  );
};

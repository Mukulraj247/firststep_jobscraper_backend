import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Collapse,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { createCrawlRobot } from '../../../../api/storage';
import { useCacheInvalidation, useGlobalInfoStore } from '../../../../context/globalInfo';
import { DEFAULT_OUTPUT_FORMATS, OutputFormat } from '../../../../constants/outputFormats';
import { OutputFormatsField } from './OutputFormatsField';
import { isValidHttpUrl, normalizeUrl } from './url';

const MAX_CRAWL_PAGES = 200;
const MAX_CRAWL_PAGES_WITH_SCREENSHOT = 25;
const DEFAULT_CRAWL_PAGES = 50;

export const CrawlCreatePanel: React.FC = () => {
  const navigate = useNavigate();
  const { notify } = useGlobalInfoStore();
  const { invalidateRecordings } = useCacheInvalidation();

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [crawlLimit, setCrawlLimit] = useState(DEFAULT_CRAWL_PAGES);
  const [crawlMode, setCrawlMode] = useState<'domain' | 'subdomain' | 'path'>('domain');
  const [crawlMaxDepth, setCrawlMaxDepth] = useState(3);
  const [crawlIncludePaths, setCrawlIncludePaths] = useState('');
  const [crawlExcludePaths, setCrawlExcludePaths] = useState('');
  const [crawlUseSitemap, setCrawlUseSitemap] = useState(true);
  const [crawlFollowLinks, setCrawlFollowLinks] = useState(true);
  const [crawlRespectRobots, setCrawlRespectRobots] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [outputFormats, setOutputFormats] = useState<OutputFormat[]>([...DEFAULT_OUTPUT_FORMATS]);
  const [isLoading, setIsLoading] = useState(false);

  const hasScreenshot = outputFormats.some((f) => f.startsWith('screenshot'));
  const screenshotLimitError =
    hasScreenshot && crawlLimit > MAX_CRAWL_PAGES_WITH_SCREENSHOT
      ? `Screenshot formats require crawl limit ≤ ${MAX_CRAWL_PAGES_WITH_SCREENSHOT}`
      : '';

  const canSubmit =
    name.trim().length > 0 &&
    isValidHttpUrl(url) &&
    outputFormats.length > 0 &&
    !screenshotLimitError &&
    !isLoading;

  const handleCreate = async () => {
    const normalized = normalizeUrl(url);
    if (!name.trim() || !isValidHttpUrl(normalized) || outputFormats.length === 0) {
      notify('error', 'Please fill required fields');
      return;
    }
    if (screenshotLimitError) {
      notify('error', screenshotLimitError);
      return;
    }

    const limit = Math.min(MAX_CRAWL_PAGES, Math.max(1, crawlLimit || DEFAULT_CRAWL_PAGES));
    setIsLoading(true);
    try {
      const result = await createCrawlRobot(
        normalized,
        name.trim(),
        {
          mode: crawlMode,
          limit,
          maxDepth: crawlMaxDepth,
          includePaths: crawlIncludePaths
            ? crawlIncludePaths.split(',').map((p) => p.trim()).filter(Boolean)
            : [],
          excludePaths: crawlExcludePaths
            ? crawlExcludePaths.split(',').map((p) => p.trim()).filter(Boolean)
            : [],
          useSitemap: crawlUseSitemap,
          followLinks: crawlFollowLinks,
          respectRobots: crawlRespectRobots,
        },
        outputFormats
      );
      setIsLoading(false);
      if (result) {
        invalidateRecordings();
        notify('success', `${name.trim()} created successfully!`);
        navigate('/robots');
      } else {
        notify('error', 'Failed to create crawl scraper');
      }
    } catch (error: any) {
      setIsLoading(false);
      notify('error', error.message || 'Failed to create crawl scraper');
    }
  };

  return (
    <Box display="flex" flexDirection="column" alignItems="stretch" gap={2}>
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mb: 1 }}>
        Crawl entire websites and gather data from multiple pages automatically.
      </Typography>
      <TextField
        label="Name"
        placeholder="Example: YC Companies Crawler"
        required
        fullWidth
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <TextField
        label="Starting URL"
        placeholder="https://www.ycombinator.com/companies"
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
      <TextField
        label="Max Pages to Crawl"
        type="number"
        fullWidth
        value={crawlLimit}
        onChange={(e) => setCrawlLimit(parseInt(e.target.value, 10) || 1)}
        helperText={`Default ${DEFAULT_CRAWL_PAGES}. Max ${MAX_CRAWL_PAGES}.`}
        FormHelperTextProps={{ sx: { ml: 0 } }}
        inputProps={{ min: 1, max: MAX_CRAWL_PAGES }}
      />
      <OutputFormatsField value={outputFormats} onChange={setOutputFormats} />
      {screenshotLimitError && (
        <FormHelperText error sx={{ mt: -1 }}>
          {screenshotLimitError}
        </FormHelperText>
      )}
      <Box>
        <Button
          onClick={() => setShowAdvanced(!showAdvanced)}
          sx={{ textTransform: 'none', color: '#ff00c3', px: 0 }}
        >
          {showAdvanced ? 'Hide Advanced Options' : 'Advanced Options'}
        </Button>
      </Box>
      <Collapse in={showAdvanced}>
        <Box display="flex" flexDirection="column" gap={2}>
          <FormControl fullWidth>
            <InputLabel>Crawl Scope</InputLabel>
            <Select
              value={crawlMode}
              label="Crawl Scope"
              onChange={(e) => setCrawlMode(e.target.value as typeof crawlMode)}
            >
              <MenuItem value="domain">Same Domain Only</MenuItem>
              <MenuItem value="subdomain">Include Subdomains</MenuItem>
              <MenuItem value="path">Specific Path Only</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Max Depth"
            type="number"
            fullWidth
            value={crawlMaxDepth}
            onChange={(e) => setCrawlMaxDepth(parseInt(e.target.value, 10) || 3)}
            helperText="How many links deep to follow (default: 3)"
            FormHelperTextProps={{ sx: { ml: 0 } }}
          />
          <TextField
            label="Include Paths"
            placeholder="Example: /products, /blog"
            fullWidth
            value={crawlIncludePaths}
            onChange={(e) => setCrawlIncludePaths(e.target.value)}
            helperText="Only crawl URLs matching these paths (comma-separated)"
            FormHelperTextProps={{ sx: { ml: 0 } }}
          />
          <TextField
            label="Exclude Paths"
            placeholder="Example: /admin, /login"
            fullWidth
            value={crawlExcludePaths}
            onChange={(e) => setCrawlExcludePaths(e.target.value)}
            helperText="Skip URLs matching these paths (comma-separated)"
            FormHelperTextProps={{ sx: { ml: 0 } }}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={crawlUseSitemap}
                onChange={(e) => setCrawlUseSitemap(e.target.checked)}
              />
            }
            label="Use sitemap.xml for URL discovery"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={crawlFollowLinks}
                onChange={(e) => setCrawlFollowLinks(e.target.checked)}
              />
            }
            label="Follow links on pages"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={crawlRespectRobots}
                onChange={(e) => setCrawlRespectRobots(e.target.checked)}
              />
            }
            label="Respect robots.txt"
          />
        </Box>
      </Collapse>
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

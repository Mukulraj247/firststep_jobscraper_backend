import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Card,
  Container,
  IconButton,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { useGlobalInfoStore } from '../../../context/globalInfo';
import { stopRecording } from '../../../api/recording';
import { GenericModal } from '../../ui/GenericModal';
import { ExtractCreatePanel } from './create/ExtractCreatePanel';
import { ScrapeCreatePanel } from './create/ScrapeCreatePanel';
import { CrawlCreatePanel } from './create/CrawlCreatePanel';
import { SearchCreatePanel } from './create/SearchCreatePanel';

type CreateMode = 'extract' | 'scrape' | 'crawl' | 'search';

const MODE_META: Record<CreateMode, { label: string; description: string }> = {
  extract: {
    label: 'Extract',
    description: 'Record clicks on a careers site — no AI',
  },
  scrape: {
    label: 'Scrape',
    description: 'Capture a page as Markdown/HTML',
  },
  crawl: {
    label: 'Crawl',
    description: 'Follow links across many pages',
  },
  search: {
    label: 'Search',
    description: 'Discover URLs from a query',
  },
};

const RobotCreate: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setBrowserId, setRecordingUrl, notify } = useGlobalInfoStore();

  const [mode, setMode] = useState<CreateMode>('extract');
  const [isWarningModalOpen, setWarningModalOpen] = useState(false);
  const [activeBrowserId, setActiveBrowserId] = useState('');
  const [pendingExtractUrl, setPendingExtractUrl] = useState('');

  const handleBrowserConflict = (browserId: string) => {
    setActiveBrowserId(browserId);
    setWarningModalOpen(true);
  };

  const handleDiscardAndCreate = async () => {
    if (activeBrowserId) {
      await stopRecording(activeBrowserId);
      notify('warning', t('browser_recording.notifications.terminated'));
    }

    setWarningModalOpen(false);

    const url =
      pendingExtractUrl ||
      window.sessionStorage.getItem('recordingUrl') ||
      '';

    setBrowserId('new-recording');
    setRecordingUrl(url);
    window.sessionStorage.setItem('browserId', 'new-recording');
    if (url) {
      window.sessionStorage.setItem('recordingUrl', url);
      window.sessionStorage.setItem('initialUrl', url);
    }

    const sessionId = Date.now().toString();
    window.sessionStorage.setItem('recordingSessionId', sessionId);
    window.sessionStorage.setItem(
      'recordingOriginPage',
      window.location.pathname + window.location.search
    );
    window.open(`/recording-setup?session=${sessionId}`, '_blank');
    window.sessionStorage.setItem('nextTabIsRecording', 'true');
    navigate('/robots');
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box display="flex" alignItems="center" mb={2}>
        <IconButton
          onClick={() => navigate('/robots')}
          sx={{
            ml: -1,
            mr: 1,
            color: (theme) => theme.palette.text.primary,
            backgroundColor: 'transparent !important',
          }}
          disableRipple
          aria-label="Go back"
        >
          <ArrowBack />
        </IconButton>
        <Box>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
            {t('recordingtable.create_page_title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Choose how this automation should collect data
          </Typography>
        </Box>
      </Box>

      <ToggleButtonGroup
        exclusive
        fullWidth
        value={mode}
        onChange={(_, next) => {
          if (next) setMode(next);
        }}
        aria-label="Scraper type"
        sx={{
          mb: 2,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
          gap: 1,
          '& .MuiToggleButtonGroup-grouped': {
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '8px !important',
            m: 0,
            textTransform: 'none',
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
            px: 1.5,
            py: 1.25,
          },
        }}
      >
        {(Object.keys(MODE_META) as CreateMode[]).map((key) => (
          <ToggleButton key={key} value={key} aria-label={MODE_META[key].label}>
            <Box textAlign="left">
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {MODE_META[key].label}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'normal' }}>
                {MODE_META[key].description}
              </Typography>
            </Box>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Card variant="outlined" sx={{ p: { xs: 2.5, sm: 4 } }}>
        {mode === 'extract' && (
          <ExtractCreatePanel
            onBrowserConflict={(id, url) => {
              setPendingExtractUrl(url);
              handleBrowserConflict(id);
            }}
          />
        )}
        {mode === 'scrape' && <ScrapeCreatePanel />}
        {mode === 'crawl' && <CrawlCreatePanel />}
        {mode === 'search' && <SearchCreatePanel />}
      </Card>

      <GenericModal
        isOpen={isWarningModalOpen}
        onClose={() => setWarningModalOpen(false)}
        modalStyle={modalStyle}
      >
        <div style={{ padding: '10px' }}>
          <Typography variant="h6" gutterBottom>
            {t('recordingtable.warning_modal.title')}
          </Typography>
          <Typography variant="body1" style={{ marginBottom: '20px' }}>
            {t('recordingtable.warning_modal.message')}
          </Typography>
          <Box display="flex" justifyContent="space-between" mt={2}>
            <Button onClick={handleDiscardAndCreate} variant="contained" color="error">
              {t('recordingtable.warning_modal.discard_and_create')}
            </Button>
            <Button onClick={() => setWarningModalOpen(false)} variant="outlined">
              {t('recordingtable.warning_modal.cancel')}
            </Button>
          </Box>
        </div>
      </GenericModal>
    </Container>
  );
};

export default RobotCreate;

const modalStyle = {
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '30%',
  backgroundColor: 'background.paper',
  p: 4,
  height: 'fit-content',
  display: 'block',
  padding: '20px',
};

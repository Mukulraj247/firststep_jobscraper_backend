import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  Checkbox,
  TextField,
  Typography,
} from '@mui/material';
import { canCreateBrowserInState, getActiveBrowserId } from '../../../../api/recording';
import { useGlobalInfoStore } from '../../../../context/globalInfo';
import { isValidHttpUrl, normalizeUrl } from './url';

interface ExtractCreatePanelProps {
  onBrowserConflict: (activeBrowserId: string, url: string) => void;
}

export const ExtractCreatePanel: React.FC<ExtractCreatePanelProps> = ({
  onBrowserConflict,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setBrowserId, setRecordingUrl, notify } = useGlobalInfoStore();
  const [url, setUrl] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const valid = isValidHttpUrl(url);

  const handleStartRecording = async () => {
    const normalized = normalizeUrl(url);
    if (!isValidHttpUrl(normalized)) {
      notify('error', 'Please enter a valid URL');
      return;
    }

    setIsLoading(true);
    try {
      const canCreateRecording = await canCreateBrowserInState('recording');
      if (!canCreateRecording) {
        const activeBrowser = await getActiveBrowserId();
        if (activeBrowser) {
          onBrowserConflict(activeBrowser, normalized);
        } else {
          notify('warning', t('recordingtable.notifications.browser_limit_warning'));
        }
        setIsLoading(false);
        return;
      }

      setBrowserId('new-recording');
      setRecordingUrl(normalized);

      window.sessionStorage.setItem('browserId', 'new-recording');
      window.sessionStorage.setItem('recordingUrl', normalized);
      window.sessionStorage.setItem('initialUrl', normalized);
      window.sessionStorage.setItem('needsLogin', needsLogin.toString());

      const sessionId = Date.now().toString();
      window.sessionStorage.setItem('recordingSessionId', sessionId);
      window.sessionStorage.setItem(
        'recordingOriginPage',
        window.location.pathname + window.location.search
      );

      window.open(`/recording-setup?session=${sessionId}`, '_blank');
      window.sessionStorage.setItem('nextTabIsRecording', 'true');

      setIsLoading(false);
      navigate('/scrapers');
    } catch (error) {
      console.error('Error starting recording:', error);
      notify('error', 'Failed to start recording. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <Box display="flex" flexDirection="column" alignItems="stretch" gap={2}>
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mb: 1 }}>
        {t('recordingtable.extract_intro')}
      </Typography>
      <TextField
        label={t('recordingtable.extract_url_label')}
        placeholder={t('recordingtable.extract_url_placeholder')}
        variant="outlined"
        fullWidth
        required
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onBlur={() => {
          if (url.trim()) setUrl(normalizeUrl(url));
        }}
        error={!!url.trim() && !valid}
        helperText={url.trim() && !valid ? 'Enter a valid http(s) URL' : ' '}
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={needsLogin}
            onChange={(e) => setNeedsLogin(e.target.checked)}
            color="primary"
          />
        }
        label={t('recordingtable.modal.login_title')}
      />
      <Button
        variant="contained"
        fullWidth
        onClick={handleStartRecording}
        disabled={!valid || isLoading}
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
        {isLoading
          ? t('recordingtable.modal.button_loading')
          : t('recordingtable.modal.button')}
      </Button>
    </Box>
  );
};

import React from 'react';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import { useNavigate, useLocation } from 'react-router-dom';
import { Paper, useTheme, Typography } from "@mui/material";
import { AutoAwesome, Usb, PlayArrow, Dashboard, WorkOutline } from "@mui/icons-material";
import { useTranslation } from 'react-i18next';

interface MainMenuProps {
  value: string;
  handleChangeContent: (newValue: string) => void;
}

export const MainMenu = ({ value = 'robots', handleChangeContent }: MainMenuProps) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const handleChange = (event: React.SyntheticEvent, newValue: string) => {
    navigate(`/${newValue}`);
    handleChangeContent(newValue);
  };

  const handleRobotsClick = () => {
    if (location.pathname !== '/robots') {
      navigate('/robots');
      handleChangeContent('robots');
    }
  };

  const handleJobsClick = () => {
    if (location.pathname !== '/jobs') {
      navigate('/jobs');
      handleChangeContent('jobs');
    }
  };

  const defaultcolor = theme.palette.mode === 'light' ? 'black' : 'white';

  return (
    <Paper
      sx={{
        height: '100%',
        width: '230px',
        backgroundColor: theme.palette.background.paper,
        color: defaultcolor,
        display: 'flex',
        flexDirection: 'column',
      }}
      variant="outlined"
      square
    >
      <Box
        sx={{
          px: 2,
          py: 2,
          minHeight: 72,
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 1.5,
          flexShrink: 0,
        }}
      >
        <Typography
          variant="subtitle1"
          sx={{
            fontWeight: 700,
            letterSpacing: 0.02,
            lineHeight: 1.25,
            fontSize: '1.05rem',
          }}
        >
          {t('navbar.project_name')}
        </Typography>
      </Box>
      <Box sx={{
        width: '100%',
        paddingBottom: '1rem',
        flexGrow: 1,
        overflowY: 'auto'
      }}>
        <Tabs
          value={value}
          onChange={handleChange}
          textColor="primary"
          indicatorColor="primary"
          orientation="vertical"
          sx={{
            alignItems: 'flex-start',
            '& .MuiTabs-indicator': { display: 'none' },
            paddingTop: '0.5rem'
          }}
        >
          <Tab
            value="dashboard"
            label="Dashboard"
            icon={<Dashboard sx={{ fontSize: 20 }} />}
            iconPosition="start"
            disableRipple={true}
            sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: '16px' }}
          />
          <Tab
            value="jobs"
            label={t('mainmenu.jobs')}
            icon={<WorkOutline sx={{ fontSize: 20 }} />}
            iconPosition="start"
            disableRipple={true}
            sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: '16px' }}
            onClick={handleJobsClick}
          />
          <Tab
            value="robots"
            label={t('mainmenu.recordings')}
            icon={<AutoAwesome sx={{ fontSize: 20 }} />}
            iconPosition="start"
            disableRipple={true}
            sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: '16px' }}
            onClick={handleRobotsClick}
          />
          <Tab
            value="runs"
            label={t('mainmenu.runs')}
            icon={<PlayArrow sx={{ fontSize: 20 }} />}
            iconPosition="start"
            disableRipple={true}
            sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: '16px' }}
          />
          <Tab
            value="proxy"
            label={t('mainmenu.proxy')}
            icon={<Usb sx={{ fontSize: 20 }} />}
            iconPosition="start"
            disableRipple={true}
            sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: '16px' }}
          />
        </Tabs>
      </Box>
    </Paper>
  );
};

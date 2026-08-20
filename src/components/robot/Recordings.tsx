import React, { useCallback, useEffect, useState } from 'react';
import { ScrapersPage } from '../../features/scrapers/ScrapersPage';
import { RunSettings, RunSettingsModal } from '../run/RunSettings';
import {
  ScheduleSettings,
  ScheduleSettingsPage,
} from './pages/ScheduleSettingsPage';
import { RobotIntegrationPage } from './pages/RobotIntegrationPage';
import { RobotSettingsPage } from './pages/RobotSettingsPage';
import { RobotEditPage } from './pages/RobotEditPage';
import { RobotDuplicatePage } from './pages/RobotDuplicatePage';
import { useNavigate, useLocation } from 'react-router-dom';
import { useGlobalInfoStore } from '../../context/globalInfo';
import { useTranslation } from 'react-i18next';

interface RecordingsProps {
  handleEditRecording: (id: string, fileName: string) => void;
  handleRunRecording: (settings: RunSettings) => void;
  handleScheduleRecording: (settings: ScheduleSettings) => Promise<boolean>;
  setRecordingInfo: (id: string, name: string) => void;
}

export const Recordings = ({
  handleRunRecording,
  setRecordingInfo,
  handleScheduleRecording,
}: RecordingsProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useState<string[]>([]);
  const { notify } = useGlobalInfoStore();
  const { t } = useTranslation();

  const handleNavigate = useCallback(
    (path: string, id: string, name: string, robotParams: string[]) => {
      setParams(robotParams);
      setRecordingInfo(id, name);
      navigate(path);
    },
    [navigate, setRecordingInfo]
  );

  const handleClose = () => {
    setParams([]);
    setRecordingInfo('', '');
    navigate('/scrapers');
  };

  useEffect(() => {
    const getAndClearCookie = (name: string) => {
      const value = document.cookie
        .split('; ')
        .find((row) => row.startsWith(`${name}=`))
        ?.split('=')[1];

      if (value) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      }

      return value;
    };

    const authStatus = getAndClearCookie('robot_auth_status');
    const airtableAuthStatus = getAndClearCookie('airtable_auth_status');
    const robotId = getAndClearCookie('robot_auth_robotId');

    if (airtableAuthStatus === 'success' && robotId) {
      notify(airtableAuthStatus, t('recordingtable.notifications.auth_success'));
      handleNavigate(`/scrapers/${robotId}/integrate/airtable`, robotId, '', []);
    } else if (authStatus === 'success' && robotId) {
      notify(authStatus, t('recordingtable.notifications.auth_success'));
      handleNavigate(`/scrapers/${robotId}/integrate/googleSheets`, robotId, '', []);
    }
  }, [handleNavigate, notify, t]);

  const getCurrentPageComponent = () => {
    const currentPath = location.pathname;

    if (currentPath.endsWith('/run')) {
      return (
        <RunSettingsModal
          isOpen={true}
          handleClose={handleClose}
          handleStart={handleRunRecording}
          isTask={params.length !== 0}
          params={params}
        />
      );
    }
    if (currentPath.endsWith('/schedule')) {
      return <ScheduleSettingsPage handleStart={handleScheduleRecording} />;
    }
    if (currentPath.includes('/integrate')) {
      return <RobotIntegrationPage handleStart={() => {}} robotPath="robots" />;
    }
    if (currentPath.endsWith('/settings')) {
      return <RobotSettingsPage handleStart={() => {}} />;
    }
    if (currentPath.endsWith('/edit')) {
      return <RobotEditPage handleStart={() => {}} />;
    }
    if (currentPath.endsWith('/duplicate')) {
      return <RobotDuplicatePage handleStart={() => {}} />;
    }
    return null;
  };

  const currentPath = location.pathname;
  const isConfigPage =
    currentPath.includes('/schedule') ||
    currentPath.includes('/integrate') ||
    currentPath.includes('/settings') ||
    currentPath.includes('/edit') ||
    currentPath.includes('/duplicate') ||
    currentPath.includes('/run');

  if (isConfigPage) {
    return getCurrentPageComponent();
  }

  return <ScrapersPage />;
};

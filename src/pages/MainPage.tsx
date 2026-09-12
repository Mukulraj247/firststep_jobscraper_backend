import React, { useCallback, useContext, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from "../components/dashboard/AppShell";
import { Recordings } from "../components/robot/Recordings";
import { RunsPage } from './RunsPage';
import ProxyForm from '../components/proxy/ProxyForm';
import { DashboardPage } from './DashboardPage';
import { AutomationsPage } from './AutomationsPage';
import { FailureDashboardPage } from './FailureDashboardPage';
import { EnrichmentPage } from './EnrichmentPage';
import { H1bPage } from './H1bPage';
import { CommunicationPage } from './CommunicationPage';
import { AggregatorsPage } from './AggregatorsPage';
import { JobBoardPage } from '../components/jobs/JobBoardPage';
import { jobBoardHidesScrollbar, jobBoardScrollSx } from '../features/jobs/jobBoardPageBehavior';
import { useGlobalInfoStore, useCacheInvalidation } from "../context/globalInfo";
import { createAndRunRecording, createRunForStoredRecording, CreateRunResponseWithQueue, interpretStoredRecording, notifyAboutAbort, scheduleStoredRecording } from "../api/storage";
import { io, Socket } from "socket.io-client";
import { stopRecording } from "../api/recording";
import { RunSettings } from "../components/run/RunSettings";
import { ScheduleSettings } from "../components/robot/pages/ScheduleSettingsPage";
import { apiUrl } from "../apiConfig";
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/auth';
import { useSocketStore } from '../context/socket';
import { Box } from '@mui/material';

interface MainPageProps {
  handleEditRecording: (id: string, fileName: string) => void;
  initialContent: string;
}

export interface CreateRunResponse {
  browserId: string;
  runId: string;
  robotMetaId: string;
}

export interface ScheduleRunResponse {
  message: string;
  runId: string;
}

export const MainPage = ({ handleEditRecording, initialContent }: MainPageProps) => {
  const { t } = useTranslation();
  const [content, setContent] = React.useState(initialContent);
  const [sockets, setSockets] = React.useState<Socket[]>([]);
  const [runningRecordingId, setRunningRecordingId] = React.useState('');
  const [runningRecordingName, setRunningRecordingName] = React.useState('');
  const [currentInterpretationLog, setCurrentInterpretationLog] = React.useState('');
  const [ids, setIds] = React.useState<CreateRunResponse>({
    browserId: '',
    runId: '',
    robotMetaId: ''
  });
  const [queuedRuns, setQueuedRuns] = React.useState<Set<string>>(new Set());

  let aborted = false;

  const { notify, setRerenderRuns, setRecordingId } = useGlobalInfoStore();
  const { invalidateRuns, addOptimisticRun } = useCacheInvalidation();
  const navigate  = useNavigate();

  React.useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

  const { state } = useContext(AuthContext);
  const { user } = state;

  const { connectToQueueSocket, disconnectQueueSocket } = useSocketStore();

  // Keep socket handlers stable so we don't reconnect on every queuedRuns / t change.
  const queueHandlersRef = useRef({
    t,
    notify,
    invalidateRuns,
    setRerenderRuns,
    setQueuedRuns,
  });
  queueHandlersRef.current = {
    t,
    notify,
    invalidateRuns,
    setRerenderRuns,
    setQueuedRuns,
  };
  const queuedRunsRef = useRef(queuedRuns);
  queuedRunsRef.current = queuedRuns;

  const abortRunHandler = (runId: string, robotName: string, browserId: string) => {
    notify('info', t('main_page.notifications.abort_initiated', { name: robotName }));

    aborted = true;
    
    notifyAboutAbort(runId).then(async (response) => {
      if (!response.success) {
        notify('error', t('main_page.notifications.abort_failed', { name: robotName }));
        setRerenderRuns(true);
        invalidateRuns();
        return;
      }
      
      if (response.isQueued) {
        setRerenderRuns(true);
        invalidateRuns();

        notify('success', t('main_page.notifications.abort_success', { name: robotName }));
        
        setQueuedRuns(prev => {
          const newSet = new Set(prev);
          newSet.delete(runId);
          return newSet;
        });
        
        return;
      }
      
      const abortSocket = io(`${apiUrl}/${browserId}`, {
        transports: ["websocket", "polling"],
        rejectUnauthorized: false
      });
      
      abortSocket.on('run-aborted', (abortData) => {
        if (abortData.runId === runId) {
          notify('success', t('main_page.notifications.abort_success', { name: abortData.robotName || robotName }));
          setRerenderRuns(true);
          invalidateRuns();
          abortSocket.disconnect();
        }
      });
      
      abortSocket.on('connect_error', (error) => {
        console.log('Abort socket connection error:', error);
        notify('error', t('main_page.notifications.abort_failed', { name: robotName }));
        setRerenderRuns(true);
        invalidateRuns();
        abortSocket.disconnect();
      });
    });
  }

  const setRecordingInfo = (id: string, name: string) => {
    setRunningRecordingId(id);
    setRecordingId(id);
    setRunningRecordingName(name);
  }

  const readyForRunHandler = useCallback((browserId: string, runId: string) => {
    interpretStoredRecording(runId).then(async (interpretation: boolean) => {
      if (!aborted) {
        if (interpretation) {
          // notify('success', t('main_page.notifications.interpretation_success', { name: runningRecordingName }));
        } else {
          notify('success', t('main_page.notifications.interpretation_failed', { name: runningRecordingName }));
          // destroy the created browser
          await stopRecording(browserId);
        }
      }
      setRunningRecordingName('');
      setCurrentInterpretationLog('');
      setRerenderRuns(true);
      invalidateRuns();
    })
  }, [runningRecordingName, aborted, currentInterpretationLog, notify, setRerenderRuns]);

  const debugMessageHandler = useCallback((msg: string) => {
    setCurrentInterpretationLog((prevState) =>
      prevState + '\n' + `[${new Date().toLocaleString()}] ` + msg);
  }, [currentInterpretationLog])

  const handleRunRecording = useCallback((settings: RunSettings) => {
    // Add optimistic run to cache immediately
    const optimisticRun = {
      id: runningRecordingId,
      runId: `temp-${Date.now()}`, // Temporary ID until we get the real one
      status: 'running',
      name: runningRecordingName,
      startedAt: new Date().toISOString(),
      finishedAt: '',
      robotMetaId: runningRecordingId,
      log: 'Starting...',
      isOptimistic: true
    };

    addOptimisticRun(optimisticRun);

    createAndRunRecording(runningRecordingId, settings).then((response: CreateRunResponseWithQueue) => {
      invalidateRuns();
      const { browserId, runId, robotMetaId, queued } = response;

      setIds({ browserId, runId, robotMetaId });
      if (robotMetaId && runId) {
        navigate(`/runs/${robotMetaId}/run/${runId}`);
      } else {
        navigate('/runs');
      }
            
      if (queued) {
        setQueuedRuns(prev => new Set([...prev, runId]));
        notify('info', `Run queued: ${runningRecordingName}`);
      } else {
        const socket = io(`${apiUrl}/${browserId}`, {
          transports: ["websocket", "polling"],
          rejectUnauthorized: false
        });
        
        setSockets(sockets => [...sockets, socket]);
        
        socket.on('debugMessage', debugMessageHandler);
        socket.on('run-completed', (data) => {
          setRerenderRuns(true);
          invalidateRuns();
          
          const robotName = data.robotName;
          
          if (data.status === 'success') {
            notify('success', t('main_page.notifications.interpretation_success', { name: robotName }));
          } else if (data.status === 'anomaly') {
            notify('warning', `${robotName}: run finished with anomaly (${data.anomaly || 'row_drop'})`);
          } else {
            notify('error', t('main_page.notifications.interpretation_failed', { name: robotName }));
          }
        });
        
        socket.on('connect_error', (error) => {
          console.log('error', `Failed to connect to browser ${browserId}: ${error}`);
          notify('error', t('main_page.notifications.connection_failed', { name: runningRecordingName }));
        });

        socket.on('disconnect', (reason) => {
          console.log('warn', `Disconnected from browser ${browserId}: ${reason}`);
        });
        
        if (runId) {
          notify('info', t('main_page.notifications.run_started', { name: runningRecordingName }));
        } else {
          notify('error', t('main_page.notifications.run_start_failed', { name: runningRecordingName }));
        }
      }
      
      setContent('runs');
    }).catch((error: any) => {
      console.error('Error in createAndRunRecording:', error); // ✅ Debug log
    });

    return (socket: Socket) => {
      socket.off('debugMessage', debugMessageHandler);
      socket.off('run-completed');
      socket.off('connect_error');
      socket.off('disconnect');
    }
  }, [runningRecordingName, sockets, ids, debugMessageHandler, user?.id, t, notify, setRerenderRuns, setQueuedRuns, navigate, setContent, setIds, invalidateRuns, addOptimisticRun, runningRecordingId]);

  useEffect(() => {
    return () => {
      queuedRuns.clear();
    };
  }, []);

  const handleScheduleRecording = async (settings: ScheduleSettings) => {
    const { message, runId }: ScheduleRunResponse = await scheduleStoredRecording(runningRecordingId, settings);
    if (message === 'success') {
      notify('success', t('main_page.notifications.schedule_success', { name: runningRecordingName }));
    } else {
      notify('error', t('main_page.notifications.schedule_failed', { name: runningRecordingName }));
    }
    return message === 'success';
  }

  useEffect(() => {
    if (!user?.id) return;

    const handleRunStarted = (startedData: any) => {
      const h = queueHandlersRef.current;
      h.setRerenderRuns(true);
      h.invalidateRuns();
      const robotName = startedData.robotName || 'Unknown Robot';
      h.notify('info', h.t('main_page.notifications.run_started', { name: robotName }));
    };

    const handleRunCompleted = (completionData: any) => {
      const h = queueHandlersRef.current;
      h.setRerenderRuns(true);
      h.invalidateRuns();

      if (queuedRunsRef.current.has(completionData.runId)) {
        h.setQueuedRuns((prev) => {
          const newSet = new Set(prev);
          newSet.delete(completionData.runId);
          return newSet;
        });
      }

      const robotName = completionData.robotName || 'Unknown Robot';

      if (completionData.status === 'success') {
        h.notify('success', h.t('main_page.notifications.interpretation_success', { name: robotName }));
      } else if (completionData.status === 'anomaly') {
        h.notify(
          'warning',
          `${robotName}: run finished with anomaly (${completionData.anomaly || 'row_drop'})`
        );
      } else {
        h.notify('error', h.t('main_page.notifications.interpretation_failed', { name: robotName }));
      }
    };

    const handleRunRecovered = (recoveredData: any) => {
      const h = queueHandlersRef.current;
      h.setRerenderRuns(true);
      h.invalidateRuns();

      if (queuedRunsRef.current.has(recoveredData.runId)) {
        h.setQueuedRuns((prev) => {
          const newSet = new Set(prev);
          newSet.delete(recoveredData.runId);
          return newSet;
        });
      }

      const robotName = recoveredData.robotName || 'Unknown Robot';
      h.notify('error', h.t('main_page.notifications.interpretation_failed', { name: robotName }));
    };

    const handleRunScheduled = (_scheduledData: any) => {
      const h = queueHandlersRef.current;
      h.setRerenderRuns(true);
      h.invalidateRuns();
    };

    connectToQueueSocket(
      user.id,
      handleRunCompleted,
      handleRunStarted,
      handleRunRecovered,
      handleRunScheduled
    );

    return () => {
      console.log('Disconnecting persistent queue socket for user:', user.id);
      disconnectQueueSocket();
    };
  }, [user?.id, connectToQueueSocket, disconnectQueueSocket]);

  // Keep JobBoard mounted after first visit. Auth0/NavBar/socket re-renders of
  // MainPage used to recreate <JobBoardPage /> via the switch — combined with
  // route flaps that looked like a continuous full-grid refresh.
  const [jobsMounted, setJobsMounted] = React.useState(content === 'jobs');
  React.useEffect(() => {
    if (content === 'jobs') setJobsMounted(true);
  }, [content]);

  let body: React.ReactNode = null;
  switch (content) {
    case 'scrapers':
      body = (
        <Recordings
          handleRunRecording={handleRunRecording}
          setRecordingInfo={setRecordingInfo}
          handleScheduleRecording={handleScheduleRecording}
        />
      );
      break;
    case 'jobs':
      // Rendered in the persistent slot below.
      body = null;
      break;
    case 'runs':
      body = (
        <RunsPage
          currentInterpretationLog={currentInterpretationLog}
          abortRunHandler={abortRunHandler}
          runId={ids.runId}
          runningRecordingName={runningRecordingName}
        />
      );
      break;
    case 'failures':
      body = <FailureDashboardPage />;
      break;
    case 'enrichment':
      body = <EnrichmentPage />;
      break;
    case 'h1b':
      body = <H1bPage />;
      break;
    case 'communication':
      body = <CommunicationPage />;
      break;
    case 'aggregators':
      body = <AggregatorsPage />;
      break;
    case 'proxy':
      body = <ProxyForm />;
      break;
    case 'dashboard':
      body = <DashboardPage />;
      break;
    case 'automations':
      body = <AutomationsPage />;
      break;
    default:
      body = null;
  }

  const showJobs = content === 'jobs';

  return (
    <AppShell value={content} handleChangeContent={setContent}>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          display: showJobs ? 'flex' : 'none',
          flexDirection: 'column',
          ...(jobBoardHidesScrollbar() ? jobBoardScrollSx() : { overflow: 'auto' }),
        }}
      >
        {jobsMounted ? <JobBoardPage /> : null}
      </Box>
      {!showJobs ? (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'auto',
          }}
        >
          {body}
        </Box>
      ) : null}
    </AppShell>
  );
}

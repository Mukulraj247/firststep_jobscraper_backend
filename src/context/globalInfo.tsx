import { createContext, useCallback, useContext, useState } from "react";
import { AlertSnackbarProps } from "../components/ui/AlertSnackbar";
import { WhereWhatPair } from "maxun-core";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { listSaasRunGroups, listSaasRuns, type SaasRunsListParams } from "../api/automation";

const createDataCacheClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 5 * 60 * 1000,
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    }
  }
});

const dataCacheKeys = {
  runs: ['cached-runs'] as const,
  runGroups: ['cached-run-groups'] as const,
  recordings: ['cached-recordings'] as const,
} as const;

interface RobotMeta {
    name: string;
    id: string;
    createdAt: string;
    pairs: number;
    updatedAt: string;
    params: any[];
    type?: 'extract' | 'scrape' | 'crawl' | 'search';
    url?: string;
    formats?: ('markdown' | 'html' | 'screenshot-visible' | 'screenshot-fullpage')[];
}

interface RobotWorkflow {
    workflow: WhereWhatPair[];
}

interface ScheduleConfig {
    runEvery: number;
    runEveryUnit: 'MINUTES' | 'HOURS' | 'DAYS' | 'WEEKS' | 'MONTHS';
    startFrom: 'SUNDAY' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY';
    atTimeStart?: string;
    atTimeEnd?: string;
    timezone: string;
    lastRunAt?: Date;
    nextRunAt?: Date;
    cronExpression?: string;
}

export interface RobotSettings {
    id: string;
    userId?: number;
    recording_meta: RobotMeta;
    recording: RobotWorkflow;
    google_sheet_email?: string | null;
    google_sheet_name?: string | null;
    google_sheet_id?: string | null;
    google_access_token?: string | null;
    google_refresh_token?: string | null;
    schedule?: ScheduleConfig | null;
}

interface GlobalInfo {
  browserId: string | null;
  setBrowserId: (newId: string | null) => void;
  lastAction: string;
  setLastAction: (action: string) => void;
  notification: AlertSnackbarProps;
  notify: (severity: 'error' | 'warning' | 'info' | 'success', message: string) => void;
  closeNotify: () => void;
  isLogin: boolean;
  setIsLogin: (isLogin: boolean) => void;
  recordings: string[];
  setRecordings: (recordings: string[]) => void;
  rerenderRuns: boolean;
  setRerenderRuns: (rerenderRuns: boolean) => void;
  rerenderRobots: boolean;
  setRerenderRobots: (rerenderRuns: boolean) => void;
  recordingLength: number;
  setRecordingLength: (recordingLength: number) => void;
  recordingId: string | null;
  setRecordingId: (newId: string | null) => void;
  retrainRobotId: string | null;
  setRetrainRobotId: (newId: string | null) => void;
  recordingName: string;
  setRecordingName: (recordingName: string) => void;
  initialUrl: string;
  setInitialUrl: (initialUrl: string) => void;
  recordingUrl: string;
  setRecordingUrl: (recordingUrl: string) => void;
  currentWorkflowActionsState: {
    hasScrapeListAction: boolean;
    hasScreenshotAction: boolean;
    hasScrapeSchemaAction: boolean;
  };
  setCurrentWorkflowActionsState: (actionsState: {
    hasScrapeListAction: boolean;
    hasScreenshotAction: boolean;
    hasScrapeSchemaAction: boolean;
  }) => void;
  shouldResetInterpretationLog: boolean;
  resetInterpretationLog: () => void;
  currentTextActionId: string;
  setCurrentTextActionId: (actionId: string) => void;
  currentListActionId: string;
  setCurrentListActionId: (actionId: string) => void;
  currentScreenshotActionId: string;
  setCurrentScreenshotActionId: (actionId: string) => void;
  currentTextGroupName: string;
  setCurrentTextGroupName: (name: string) => void;
  isDOMMode: boolean;
  setIsDOMMode: (isDOMMode: boolean) => void;
  updateDOMMode: (isDOMMode: boolean) => void;
};

class GlobalInfoStore implements Partial<GlobalInfo> {
  browserId = null;
  lastAction = '';
  recordingLength = 0;
  notification: AlertSnackbarProps = {
    severity: 'info',
    message: '',
    isOpen: false,
  };
  recordingId = null;
  retrainRobotId = null;
  recordings: string[] = [];
  rerenderRuns = false;
  rerenderRobots = false;
  recordingName = '';
  initialUrl = 'https://';
  recordingUrl = 'https://';
  isLogin = false;
  currentWorkflowActionsState = {
    hasScrapeListAction: false,
    hasScreenshotAction: false,
    hasScrapeSchemaAction: false,
  };
  shouldResetInterpretationLog = false;
  currentTextActionId = '';
  currentListActionId = '';
  currentScreenshotActionId = '';
  currentTextGroupName = 'Text Data';
  isDOMMode = false;
};

const globalInfoStore = new GlobalInfoStore();
const globalInfoContext = createContext<GlobalInfo>(globalInfoStore as GlobalInfo);

export const useGlobalInfoStore = () => useContext(globalInfoContext);

export const useCachedRuns = (params?: {
  page?: number;
  limit?: number;
  robotMetaId?: string | null;
  q?: string;
  date?: string;
  status?: string;
  minJobsAdded?: number;
  maxJobsAdded?: number;
  jobsAddedExact?: number;
  minDurationMs?: number;
  maxDurationMs?: number;
  enabled?: boolean;
}) => {
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 25;
  const robotMetaId = params?.robotMetaId?.trim() || undefined;
  const q = params?.q?.trim() || undefined;
  const date = params?.date?.trim() || undefined;
  const status = params?.status?.trim() || undefined;
  const minJobsAdded = params?.minJobsAdded;
  const maxJobsAdded = params?.maxJobsAdded;
  const jobsAddedExact = params?.jobsAddedExact;
  const minDurationMs = params?.minDurationMs;
  const maxDurationMs = params?.maxDurationMs;
  const enabled = params?.enabled !== false;

  return useQuery({
    queryKey: [
      ...dataCacheKeys.runs,
      page,
      limit,
      robotMetaId || 'all',
      q || '',
      date || '',
      status || '',
      minJobsAdded ?? '',
      maxJobsAdded ?? '',
      jobsAddedExact ?? '',
      minDurationMs ?? '',
      maxDurationMs ?? '',
    ] as const,
    queryFn: async () => {
      const result = await listSaasRuns({
        page,
        limit,
        robotMetaId,
        q,
        date,
        status,
        minJobsAdded,
        maxJobsAdded,
        jobsAddedExact,
        minDurationMs,
        maxDurationMs,
      });
      const runs = (result.runs || []).map((run: any, index: number) => ({
        id: index,
        ...run,
        name: run.name || 'Run',
        duration: run.durationMs ?? run.duration ?? null,
        jobsAddedToBoard:
          typeof run.jobsAddedToBoard === 'number' ? run.jobsAddedToBoard : 0,
        jobsBoardUnique:
          typeof run.jobsBoardUnique === 'number'
            ? run.jobsBoardUnique
            : typeof run.jobsAddedToBoard === 'number'
              ? run.jobsAddedToBoard
              : 0,
        jobsBoardReady: typeof run.jobsBoardReady === 'number' ? run.jobsBoardReady : 0,
        log: typeof run.log === 'string' ? run.log : '',
        serializableOutput: run.serializableOutput || {},
        binaryOutput: run.binaryOutput || {},
        browserId: run.browserId || '',
      }));
      return {
        runs,
        pagination: result.pagination || { page, limit, total: runs.length, totalPages: 1 },
      };
    },
    enabled,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 2,
    refetchOnMount: 'always',
    placeholderData: (previousData) => previousData,
  });
};

export type CachedRunGroupFilters = Omit<SaasRunsListParams, 'page' | 'limit' | 'robotMetaId'> & {
  page?: number;
  limit?: number;
  robotMetaId?: string | null;
  enabled?: boolean;
};

export const useCachedRunGroups = (params?: CachedRunGroupFilters) => {
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 20;
  const robotMetaId = params?.robotMetaId?.trim() || undefined;
  const q = params?.q?.trim() || undefined;
  const date = params?.date?.trim() || undefined;
  const status = params?.status?.trim() || undefined;
  const minJobsAdded = params?.minJobsAdded;
  const maxJobsAdded = params?.maxJobsAdded;
  const jobsAddedExact = params?.jobsAddedExact;
  const minDurationMs = params?.minDurationMs;
  const maxDurationMs = params?.maxDurationMs;
  const enabled = params?.enabled !== false;

  return useQuery({
    queryKey: [
      ...dataCacheKeys.runGroups,
      page,
      limit,
      robotMetaId || 'all',
      q || '',
      date || '',
      status || '',
      minJobsAdded ?? '',
      maxJobsAdded ?? '',
      jobsAddedExact ?? '',
      minDurationMs ?? '',
      maxDurationMs ?? '',
    ] as const,
    queryFn: async () => {
      const result = await listSaasRunGroups({
        page,
        limit,
        robotMetaId,
        q,
        date,
        status,
        minJobsAdded,
        maxJobsAdded,
        jobsAddedExact,
        minDurationMs,
        maxDurationMs,
      });
      return {
        groups: result.groups || [],
        pagination: result.pagination || { page, limit, total: 0, totalPages: 1 },
      };
    },
    enabled,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 2,
    refetchOnMount: 'always',
    placeholderData: (previousData) => previousData,
  });
};

export const useCachedRunsForAutomation = (
  robotMetaId: string | null | undefined,
  params?: CachedRunGroupFilters & { enabled?: boolean }
) => {
  return useCachedRuns({
    ...params,
    robotMetaId,
    enabled: Boolean(robotMetaId) && params?.enabled !== false,
  });
};

export const useCacheInvalidation = () => {
  const queryClient = useQueryClient();

  const invalidateRuns = () => {
    queryClient.invalidateQueries({ queryKey: dataCacheKeys.runs });
    queryClient.invalidateQueries({ queryKey: dataCacheKeys.runGroups });
  };

  const invalidateRecordings = () => {
    queryClient.invalidateQueries({ queryKey: dataCacheKeys.recordings });
  };

  const addOptimisticRun = (newRun: any) => {
    queryClient.setQueriesData({ queryKey: dataCacheKeys.runs }, (oldData: any) => {
      if (!oldData) {
        return {
          runs: [{ id: 0, ...newRun }],
          pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
        };
      }
      if (Array.isArray(oldData)) {
        return [{ id: oldData.length, ...newRun }, ...oldData];
      }
      const runs = Array.isArray(oldData.runs) ? oldData.runs : [];
      return {
        ...oldData,
        runs: [{ id: runs.length, ...newRun }, ...runs],
        pagination: {
          ...oldData.pagination,
          total: (oldData.pagination?.total ?? runs.length) + 1,
        },
      };
    });
  };

  const addOptimisticRobot = (newRobot: any) => {
    queryClient.setQueriesData({ queryKey: dataCacheKeys.recordings }, (oldData: any) => {
      if (!oldData) {
        return { robots: [newRobot], total: 1, page: 1, limit: 10 };
      }
      if (Array.isArray(oldData)) {
        return [newRobot, ...oldData];
      }
      const robots = Array.isArray(oldData.robots) ? oldData.robots : [];
      return {
        ...oldData,
        robots: [newRobot, ...robots],
        total: (oldData.total ?? robots.length) + 1,
      };
    });
  };

  const removeOptimisticRobot = (tempId: string) => {
    queryClient.setQueriesData({ queryKey: dataCacheKeys.recordings }, (oldData: any) => {
      if (!oldData) return { robots: [], total: 0, page: 1, limit: 10 };
      if (Array.isArray(oldData)) {
        return oldData.filter((robot: any) => robot.id !== tempId);
      }
      const robots = (oldData.robots || []).filter((robot: any) => robot.id !== tempId);
      return {
        ...oldData,
        robots,
        total: Math.max(0, (oldData.total ?? robots.length) - 1),
      };
    });
  };

  const invalidateAllCache = () => {
    invalidateRuns();
    invalidateRecordings();
  };

  return {
    invalidateRuns,
    invalidateRecordings,
    addOptimisticRun,
    addOptimisticRobot,
    removeOptimisticRobot,
    invalidateAllCache
  };
};

export const GlobalInfoProvider = ({ children }: { children: JSX.Element }) => {
  const [browserId, setBrowserId] = useState<string | null>(globalInfoStore.browserId);
  const [lastAction, setLastAction] = useState<string>(globalInfoStore.lastAction);
  const [notification, setNotification] = useState<AlertSnackbarProps>(globalInfoStore.notification);
  const [recordings, setRecordings] = useState<string[]>(globalInfoStore.recordings);
  const [rerenderRuns, setRerenderRuns] = useState<boolean>(globalInfoStore.rerenderRuns);
  const [rerenderRobots, setRerenderRobots] = useState<boolean>(globalInfoStore.rerenderRobots);
  const [recordingLength, setRecordingLength] = useState<number>(globalInfoStore.recordingLength);
  const [recordingId, setRecordingId] = useState<string | null>(() => {
    try {
      const stored = sessionStorage.getItem('recordingId');
      return stored ? JSON.parse(stored) : globalInfoStore.recordingId;
    } catch {
      return globalInfoStore.recordingId;
    }
  });

  const setPersistedRecordingId = (newRecordingId: string | null) => {
    setRecordingId(newRecordingId);
    try {
      if (newRecordingId) {
        sessionStorage.setItem('recordingId', JSON.stringify(newRecordingId));
      } else {
        sessionStorage.removeItem('recordingId');
      }
    } catch (error) {
      console.warn('Failed to persist recordingId to sessionStorage:', error);
    }
  };
  const [retrainRobotId, setRetrainRobotId] = useState<string | null>(globalInfoStore.retrainRobotId);
  const [recordingName, setRecordingName] = useState<string>(globalInfoStore.recordingName);
  const [isLogin, setIsLogin] = useState<boolean>(globalInfoStore.isLogin);
  const [initialUrl, setInitialUrl] = useState<string>(globalInfoStore.initialUrl);
  const [recordingUrl, setRecordingUrl] = useState<string>(globalInfoStore.recordingUrl);
  const [currentWorkflowActionsState, setCurrentWorkflowActionsState] = useState(globalInfoStore.currentWorkflowActionsState);
  const [shouldResetInterpretationLog, setShouldResetInterpretationLog] = useState<boolean>(globalInfoStore.shouldResetInterpretationLog);
  const [currentTextActionId, setCurrentTextActionId] = useState<string>('');
  const [currentListActionId, setCurrentListActionId] = useState<string>('');
  const [currentScreenshotActionId, setCurrentScreenshotActionId] = useState<string>('');
  const [currentTextGroupName, setCurrentTextGroupName] = useState<string>('Text Data');
  const [isDOMMode, setIsDOMMode] = useState<boolean>(globalInfoStore.isDOMMode);

  // Must be stable: pages put `notify` in useCallback deps that feed useEffect fetch loops.
  // A new function identity on every toast would re-trigger those effects (429 death spiral).
  const notify = useCallback((severity: 'error' | 'warning' | 'info' | 'success', message: string) => {
    setNotification({ severity, message, isOpen: true });
  }, []);

  const closeNotify = useCallback(() => {
    setNotification(globalInfoStore.notification);
  }, []);

  const setBrowserIdWithValidation = (browserId: string | null) => {
    setBrowserId(browserId);
    if (!browserId) {
      setRecordingLength(0);
    }
  }

  const resetInterpretationLog = () => {
    setShouldResetInterpretationLog(true);
    setTimeout(() => {
      setShouldResetInterpretationLog(false);
    }, 100);
  }

  const updateDOMMode = (mode: boolean) => {
    setIsDOMMode(mode);
  }

  const [dataCacheClient] = useState(() => createDataCacheClient());

  return (
    <QueryClientProvider client={dataCacheClient}>
      <globalInfoContext.Provider
        value={{
        browserId,
        setBrowserId: setBrowserIdWithValidation,
        lastAction,
        setLastAction,
        notification,
        notify,
        closeNotify,
        recordings,
        setRecordings,
        rerenderRuns,
        setRerenderRuns,
        rerenderRobots,
        setRerenderRobots,
        recordingLength,
        setRecordingLength,
        recordingId,
        setRecordingId: setPersistedRecordingId,
        retrainRobotId,
        setRetrainRobotId,
        recordingName,
        setRecordingName,
        initialUrl,
        setInitialUrl,
        recordingUrl,
        setRecordingUrl,
        isLogin,
        setIsLogin,
        currentWorkflowActionsState,
        setCurrentWorkflowActionsState,
        shouldResetInterpretationLog,
        resetInterpretationLog,
        currentTextActionId,
        setCurrentTextActionId,
        currentListActionId,
        setCurrentListActionId,
        currentScreenshotActionId,
        setCurrentScreenshotActionId,
        currentTextGroupName,
        setCurrentTextGroupName,
        isDOMMode,
        setIsDOMMode,
        updateDOMMode,
        }}
      >
        {children}
      </globalInfoContext.Provider>
    </QueryClientProvider>
  );
};

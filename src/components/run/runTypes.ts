export interface Column {
  id: 'runStatus' | 'name' | 'startedAt' | 'finishedAt' | 'duration' | 'jobsAdded' | 'delete' | 'settings';
  label: string;
  minWidth?: number;
  align?: 'right';
  format?: (value: string) => string;
}

export const columns: readonly Column[] = [
  { id: 'runStatus', label: 'Status', minWidth: 64 },
  { id: 'name', label: 'Name', minWidth: 72 },
  { id: 'startedAt', label: 'Started At', minWidth: 72 },
  { id: 'finishedAt', label: 'Finished At', minWidth: 72 },
  { id: 'duration', label: 'Duration', minWidth: 64 },
  { id: 'jobsAdded', label: 'Jobs added', minWidth: 64 },
  { id: 'settings', label: 'Settings', minWidth: 64 },
  { id: 'delete', label: 'Delete', minWidth: 64 },
];

export interface Data {
  id: number;
  status: string;
  name: string;
  startedAt: string;
  finishedAt: string;
  runByUserId?: string;
  runByScheduleId?: string;
  browserId: string;
  runByAPI?: boolean;
  runBySDK?: boolean;
  log: string;
  runId: string;
  robotId: string;
  robotMetaId: string;
  interpreterSettings: Record<string, unknown>;
  serializableOutput: any;
  binaryOutput: any;
  duration?: number | null;
  jobsAddedToBoard?: number;
  jobsBoardUnique?: number;
  jobsBoardReady?: number;
  companyName?: string;
  anomaly?: string | null;
  anomalyMeta?: any;
}

export type SortDirection = 'asc' | 'desc' | 'none';

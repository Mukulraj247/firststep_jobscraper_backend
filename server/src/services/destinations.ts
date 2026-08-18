import { google } from 'googleapis';
import Airtable from 'airtable';
import { Pool } from 'pg';
import type { IRun } from '../models/Run';
import type { IRobot } from '../models/Robot';
import logger from '../logger';
import {
  isUnsafeOutboundUrlError,
} from '../utils/outboundUrlPolicy';
import { requestSafeOutboundUrl } from './safeOutboundHttp';
import type { SafeOutboundHttpOptions } from './safeOutboundHttp';
import { resolveStoredDestinationWebhookSettings } from '../utils/webhookDeliverySettings';
import { neutralizeSpreadsheetCell } from '../utils/spreadsheet';

interface ExtractedRow {
  source: string;
  data: Record<string, any>;
}

type DestinationResult = {
  destination: string;
  status: 'success' | 'failed' | 'skipped';
  message: string;
  meta?: Record<string, any>;
};

const sanitizeTableName = (value: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid table name "${value}"`);
  }
  return value;
};

const getAutomationConfig = (robot: any): Record<string, any> => {
  const meta = robot?.recording_meta || {};
  const storedConfig = meta?.saasConfig;
  if (!storedConfig || typeof storedConfig !== 'object') {
    return {};
  }
  return storedConfig;
};

const toFlatRows = (rows: ExtractedRow[], run: IRun | any) =>
  rows.map((row) => ({
    runId: run.runId,
    automationId: run.robotMetaId,
    source: row.source,
    createdAt: run.finishedAt || new Date().toISOString(),
    ...row.data,
  }));

const appendRunLog = async (run: IRun | any, message: string) => {
  const line = `[${new Date().toISOString()}] ${message}`;
  const currentLog = typeof run.log === 'string' && run.log.length > 0 ? `${run.log}\n${line}` : line;
  run.log = currentLog;
  await run.save();
};

const storeDestinationResults = async (run: IRun | any, results: DestinationResult[]) => {
  run.serializableOutput = {
    ...(run.serializableOutput || {}),
    destinationResults: results,
  };
  await run.save();
};

const WEBHOOK_RESPONSE_MAX_BYTES = 4096;
export async function postJsonWithRetry(
  url: string,
  payload: any,
  options?: {
    attempts?: number;
    retryAttempts?: number;
    delayMs?: number;
    timeoutMs?: number;
    deadlineMs?: number;
    transport?: SafeOutboundHttpOptions['transport'];
    resolve?: SafeOutboundHttpOptions['resolve'];
  }
) {
  const attempts = options?.retryAttempts !== undefined
    ? options.retryAttempts + 1
    : options?.attempts ?? 3;
  const delayMs = options?.delayMs ?? 5000;
  const timeoutMs = options?.timeoutMs ?? 30000;
  const deadlineMs = options?.deadlineMs ?? 120_000;
  const deadlineAt = Date.now() + deadlineMs;
  let lastError: any = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`Webhook delivery deadline exceeded after ${deadlineMs}ms`);
    }
    let responseToCancel: Awaited<ReturnType<typeof requestSafeOutboundUrl>> | undefined;
    let timeoutReject: ((error: Error) => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutReject = reject;
    });
    const attemptTimeoutMs = Math.min(timeoutMs, remainingMs);
    const deadlineLimited = attemptTimeoutMs === remainingMs;
    const timer = setTimeout(() => {
      void responseToCancel?.body.cancel().catch(() => undefined);
      timeoutReject?.(new Error(
        deadlineLimited
          ? `Webhook delivery deadline exceeded after ${deadlineMs}ms`
          : `Webhook request timed out after ${timeoutMs}ms`
      ));
    }, attemptTimeoutMs);
    try {
      const response = await Promise.race([
        requestSafeOutboundUrl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          timeoutMs,
          transport: options?.transport,
          resolve: options?.resolve,
        }),
        timeout,
      ]);
      responseToCancel = response;
      const bodyText = await Promise.race([
        response.text(WEBHOOK_RESPONSE_MAX_BYTES).catch(() => ''),
        timeout,
      ]);
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      return {
        status: response.status,
        bodyText: bodyText.slice(0, 500),
        attempt,
      };
    } catch (error: any) {
      lastError = error;
      if (isUnsafeOutboundUrlError(error)) {
        throw error;
      }
      if (attempt < attempts) {
        const retryDelayMs = delayMs * attempt;
        if (Date.now() + retryDelayMs >= deadlineAt) {
          throw new Error(`Webhook delivery deadline exceeded after ${deadlineMs}ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

async function dispatchWebhookDestination(run: IRun | any, robot: IRobot | any, rows: ExtractedRow[]): Promise<DestinationResult> {
  const config = getAutomationConfig(robot);
  const destinationConfig = config.destinations?.webhook;
  const deliverySettings = resolveStoredDestinationWebhookSettings(destinationConfig);
  const webhookUrl = destinationConfig?.url || config.webhookUrl;

  if (!webhookUrl || destinationConfig?.enabled === false) {
    return { destination: 'webhook', status: 'skipped', message: 'Webhook not configured' };
  }

  const payload = {
    automationId: run.robotMetaId,
    runId: run.runId,
    status: run.status,
    rowsCount: rows.length,
    rowsExtracted:
      typeof run.rowsExtracted === 'number' ? run.rowsExtracted : rows.length,
    baselineRows: run.anomalyMeta?.baseline ?? null,
    anomaly: run.anomaly || null,
    ratio: run.anomalyMeta?.ratio ?? null,
    escalated: Boolean(run.anomalyMeta?.escalated),
    anomalyMeta: run.anomalyMeta || null,
    extractedData: rows.map((row) => row.data),
  };

  const response = await postJsonWithRetry(webhookUrl, payload, {
    retryAttempts: deliverySettings.retryAttempts,
    delayMs: deliverySettings.retryDelaySeconds * 1000,
    timeoutMs: deliverySettings.timeoutSeconds * 1000,
    deadlineMs: 120_000,
  });

  await appendRunLog(run, `Destination webhook succeeded with status ${response.status} on attempt ${response.attempt}`);
  return {
    destination: 'webhook',
    status: 'success',
    message: 'Webhook delivered',
    meta: {
      status: response.status,
      attempt: response.attempt,
      response: response.bodyText,
    },
  };
}

async function dispatchGoogleSheetsDestination(run: IRun | any, robot: IRobot | any, rows: ExtractedRow[]): Promise<DestinationResult> {
  const config = getAutomationConfig(robot);
  const destinationConfig = config.destinations?.googleSheets;
  if (!destinationConfig?.enabled) {
    return { destination: 'googleSheets', status: 'skipped', message: 'Google Sheets disabled' };
  }
  if (!destinationConfig.spreadsheetId) {
    return { destination: 'googleSheets', status: 'failed', message: 'Missing spreadsheetId' };
  }
  if (!robot.google_access_token || !robot.google_refresh_token) {
    return { destination: 'googleSheets', status: 'failed', message: 'Google account not connected' };
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: robot.google_access_token,
    refresh_token: robot.google_refresh_token,
  });

  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  const sheetName = destinationConfig.sheetName || 'Sheet1';
  const flatRows = toFlatRows(rows, run);
  if (flatRows.length === 0) {
    return { destination: 'googleSheets', status: 'skipped', message: 'No rows to append' };
  }

  const headers = Object.keys(flatRows[0]);
  const safeHeaders = headers.map(neutralizeSpreadsheetCell);
  const values = flatRows.map((row) =>
    headers.map((header) => {
      const typedRow = row as Record<string, any>;
      const value =
        typeof typedRow[header] === 'object' ? JSON.stringify(typedRow[header]) : typedRow[header];
      return neutralizeSpreadsheetCell(value);
    })
  );

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: destinationConfig.spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: sheetName },
            },
          },
        ],
      },
    });
  } catch {
    // Sheet likely already exists.
  }

  const existingHeaderResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: destinationConfig.spreadsheetId,
    range: `${sheetName}!1:1`,
  }).catch(() => ({ data: { values: [] } } as any));

  const existingHeaders = existingHeaderResponse.data?.values?.[0] || [];
  const requestValues = existingHeaders.length === 0 ? [safeHeaders, ...values] : values;

  await sheets.spreadsheets.values.append({
    spreadsheetId: destinationConfig.spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: requestValues,
    },
  });

  await appendRunLog(run, `Destination googleSheets appended ${flatRows.length} rows to ${sheetName}`);
  return {
    destination: 'googleSheets',
    status: 'success',
    message: `Appended ${flatRows.length} rows`,
    meta: {
      spreadsheetId: destinationConfig.spreadsheetId,
      sheetName,
    },
  };
}

async function dispatchAirtableDestination(run: IRun | any, robot: IRobot | any, rows: ExtractedRow[]): Promise<DestinationResult> {
  const config = getAutomationConfig(robot);
  const destinationConfig = config.destinations?.airtable;
  if (!destinationConfig?.enabled) {
    return { destination: 'airtable', status: 'skipped', message: 'Airtable disabled' };
  }
  if (!destinationConfig.apiKey || !destinationConfig.baseId || !destinationConfig.tableName) {
    return { destination: 'airtable', status: 'failed', message: 'Missing Airtable credentials or table config' };
  }

  const flatRows = toFlatRows(rows, run);
  if (flatRows.length === 0) {
    return { destination: 'airtable', status: 'skipped', message: 'No rows to push' };
  }

  const airtable = new Airtable({ apiKey: destinationConfig.apiKey }).base(destinationConfig.baseId);
  const batches: any[][] = [];
  for (let i = 0; i < flatRows.length; i += 10) {
    batches.push(flatRows.slice(i, i + 10).map((row) => ({ fields: row })));
  }

  for (const batch of batches) {
    await airtable(destinationConfig.tableName).create(batch);
  }

  await appendRunLog(run, `Destination airtable pushed ${flatRows.length} rows to ${destinationConfig.tableName}`);
  return {
    destination: 'airtable',
    status: 'success',
    message: `Pushed ${flatRows.length} rows`,
    meta: {
      baseId: destinationConfig.baseId,
      tableName: destinationConfig.tableName,
    },
  };
}

async function dispatchDatabaseDestination(run: IRun | any, robot: IRobot | any, rows: ExtractedRow[]): Promise<DestinationResult> {
  const config = getAutomationConfig(robot);
  const destinationConfig = config.destinations?.database;
  if (!destinationConfig?.enabled) {
    return { destination: 'database', status: 'skipped', message: 'External database disabled' };
  }
  if (!destinationConfig.connectionString || !destinationConfig.tableName || !destinationConfig.type) {
    return { destination: 'database', status: 'failed', message: 'Missing external database configuration' };
  }

  const tableName = sanitizeTableName(destinationConfig.tableName);
  const flatRows = toFlatRows(rows, run);
  if (flatRows.length === 0) {
    return { destination: 'database', status: 'skipped', message: 'No rows to insert' };
  }

  if (destinationConfig.type === 'postgres') {
    const pool = new Pool({ connectionString: destinationConfig.connectionString });
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          id SERIAL PRIMARY KEY,
          run_id TEXT NOT NULL,
          automation_id TEXT NOT NULL,
          source TEXT,
          payload JSONB NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      for (const row of flatRows) {
        const { runId, automationId, source, ...payload } = row;
        await pool.query(
          `INSERT INTO ${tableName} (run_id, automation_id, source, payload) VALUES ($1, $2, $3, $4)`,
          [runId, automationId, source || '', payload]
        );
      }
    } finally {
      await pool.end();
    }

    await appendRunLog(run, `Destination postgres inserted ${flatRows.length} rows into ${tableName}`);
    return {
      destination: 'database',
      status: 'success',
      message: `Inserted ${flatRows.length} rows`,
      meta: { type: 'postgres', tableName },
    };
  }

  if (destinationConfig.type === 'mysql') {
    let mysql: any;
    try {
      mysql = require('mysql2/promise');
    } catch {
      throw new Error('mysql2 is required for MySQL destinations');
    }

    const connection = await mysql.createConnection(destinationConfig.connectionString);
    try {
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS \`${tableName}\` (
          id INT AUTO_INCREMENT PRIMARY KEY,
          run_id VARCHAR(255) NOT NULL,
          automation_id VARCHAR(255) NOT NULL,
          source VARCHAR(255),
          payload JSON NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      for (const row of flatRows) {
        const { runId, automationId, source, ...payload } = row;
        await connection.execute(
          `INSERT INTO \`${tableName}\` (run_id, automation_id, source, payload) VALUES (?, ?, ?, ?)`,
          [runId, automationId, source || '', JSON.stringify(payload)]
        );
      }
    } finally {
      await connection.end();
    }

    await appendRunLog(run, `Destination mysql inserted ${flatRows.length} rows into ${tableName}`);
    return {
      destination: 'database',
      status: 'success',
      message: `Inserted ${flatRows.length} rows`,
      meta: { type: 'mysql', tableName },
    };
  }

  return { destination: 'database', status: 'failed', message: `Unsupported database type ${destinationConfig.type}` };
}

export async function dispatchAutomationDestinations(run: IRun | any, robot: IRobot | any, rows: ExtractedRow[]) {
  const config = getAutomationConfig(robot);
  const handlers = [
    dispatchWebhookDestination,
    dispatchGoogleSheetsDestination,
    dispatchAirtableDestination,
    dispatchDatabaseDestination,
  ];

  const results: DestinationResult[] = [];
  for (const handler of handlers) {
    try {
      const result = await handler(run, robot, rows);
      results.push(result);
    } catch (error: any) {
      const failure: DestinationResult = {
        destination: handler.name.replace(/^dispatch|Destination$/g, '').toLowerCase(),
        status: 'failed',
        message: error.message,
      };
      results.push(failure);
      await appendRunLog(run, `Destination failure: ${failure.destination} - ${failure.message}`);
      logger.log('warn', `Destination ${failure.destination} failed for run ${run.runId}: ${failure.message}`);
    }
  }

  if (!config.destinations && !config.webhookUrl) {
    return [];
  }

  await storeDestinationResults(run, results);
  return results;
}

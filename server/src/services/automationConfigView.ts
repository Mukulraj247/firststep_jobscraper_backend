export type PublicDestinationType = 'webhook' | 'airtable' | 'database' | 'none';

type AnyRecord = Record<string, any>;

const isRecord = (value: unknown): value is AnyRecord =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const defined = <T extends AnyRecord>(value: T): Partial<T> =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;

const safeDestinationConfig = (config: AnyRecord) => {
  const destinations = isRecord(config.destinations) ? config.destinations : {};
  return defined({
    webhook: isRecord(destinations.webhook)
      ? defined({
          enabled: destinations.webhook.enabled,
          retryAttempts: destinations.webhook.retryAttempts,
          retryDelaySeconds: destinations.webhook.retryDelaySeconds,
          timeoutSeconds: destinations.webhook.timeoutSeconds,
        })
      : undefined,
    googleSheets: isRecord(destinations.googleSheets)
      ? defined({
          enabled: destinations.googleSheets.enabled,
          spreadsheetId: destinations.googleSheets.spreadsheetId,
          sheetName: destinations.googleSheets.sheetName,
        })
      : undefined,
    airtable: isRecord(destinations.airtable)
      ? defined({
          enabled: destinations.airtable.enabled,
          baseId: destinations.airtable.baseId,
          tableName: destinations.airtable.tableName,
        })
      : undefined,
    database: isRecord(destinations.database)
      ? defined({
          enabled: destinations.database.enabled,
          type: destinations.database.type,
          tableName: destinations.database.tableName,
        })
      : undefined,
  });
};

export const getPublicDestinationType = (config: AnyRecord): PublicDestinationType => {
  const destinations = isRecord(config.destinations) ? config.destinations : {};
  if (destinations.webhook?.enabled || config.webhookUrl) return 'webhook';
  if (destinations.airtable?.enabled) return 'airtable';
  if (destinations.database?.enabled) return 'database';
  return 'none';
};

/**
 * Explicit browser-safe projection. Secret-bearing keys are deliberately never
 * copied: proxy settings, cookies, localStorage, webhook URLs, API keys and
 * database connection strings.
 */
export const toPublicAutomationConfig = (input: unknown): AnyRecord => {
  const config = isRecord(input) ? input : {};
  const destinations = safeDestinationConfig(config);
  return defined({
    schedule: config.schedule,
    performance: config.performance,
    destinations: Object.keys(destinations).length ? destinations : undefined,
    userAgent: config.userAgent,
    userAgentPool: config.userAgentPool,
    headless: config.headless,
    useStealth: config.useStealth,
    reuseSession: config.reuseSession,
    locale: config.locale,
    dataCleanup: config.dataCleanup,
    pagination: config.pagination,
    popups: config.popups,
    captcha: config.captcha,
    listExtraction: config.listExtraction,
    screenshots: config.screenshots,
    columnOverrides: config.columnOverrides,
    databaseTargetColumns: config.databaseTargetColumns,
    rowContext: config.rowContext,
    aggregatorProvider: config.aggregatorProvider,
    enrichHiringCafeDetails: config.enrichHiringCafeDetails,
    webhookConfigured: !!(config.webhookUrl || config.destinations?.webhook?.url),
    proxyConfigured: !!(
      config.browserLocation?.proxyServer ||
      config.browserLocation?.proxyUsername ||
      config.browserLocation?.proxyPassword ||
      (Array.isArray(config.browserLocation?.proxyPool) && config.browserLocation.proxyPool.length)
    ),
    scrapeDoConfigured: !!config.hiringCafeEnrichment?.scrapeDoToken,
    hiringCafeEnrichment: isRecord(config.hiringCafeEnrichment)
      ? defined({
          scrapeDoEnabled: config.hiringCafeEnrichment.scrapeDoEnabled,
          scrapeDoMaxTier: config.hiringCafeEnrichment.scrapeDoMaxTier,
        })
      : undefined,
    destinationType: getPublicDestinationType(config),
  });
};

/** Non-secret snapshot allowed in newly-created Run documents and queue retries. */
export const toOperationalRunConfig = (input: unknown): AnyRecord => {
  const view = toPublicAutomationConfig(input);
  const {
    webhookConfigured: _webhookConfigured,
    proxyConfigured: _proxyConfigured,
    destinationType: _destinationType,
    ...operational
  } = view;
  return operational;
};

const mergeRecords = (base: AnyRecord, override: AnyRecord): AnyRecord => {
  const result: AnyRecord = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] =
      isRecord(value) && isRecord(result[key])
        ? mergeRecords(result[key], value)
        : value;
  }
  return result;
};

const deleteBlank = (record: AnyRecord | undefined, key: string) => {
  if (record && (record[key] === '' || record[key] === null || record[key] === undefined)) {
    delete record[key];
  }
};

/**
 * Public reads mask credentials. A subsequent save therefore sends blank
 * placeholders; preserve stored values unless a non-empty replacement arrives.
 * Set `browserLocation.clearProxy: true` to wipe stored proxy credentials.
 */
export const mergeMaskedAutomationConfig = (
  currentInput: unknown,
  incomingInput: unknown
): AnyRecord => {
  const current = isRecord(currentInput) ? currentInput : {};
  const incoming = isRecord(incomingInput)
    ? JSON.parse(JSON.stringify(incomingInput)) as AnyRecord
    : {};

  const clearProxy =
    isRecord(incoming.browserLocation) && incoming.browserLocation.clearProxy === true;
  if (clearProxy && isRecord(incoming.browserLocation)) {
    delete incoming.browserLocation.clearProxy;
  }

  const clearScrapeDo =
    isRecord(incoming.hiringCafeEnrichment) && incoming.hiringCafeEnrichment.clearScrapeDo === true;
  if (clearScrapeDo && isRecord(incoming.hiringCafeEnrichment)) {
    delete incoming.hiringCafeEnrichment.clearScrapeDo;
  }

  deleteBlank(incoming, 'webhookUrl');
  if (isRecord(incoming.destinations?.webhook)) deleteBlank(incoming.destinations.webhook, 'url');
  if (isRecord(incoming.destinations?.airtable)) deleteBlank(incoming.destinations.airtable, 'apiKey');
  if (isRecord(incoming.destinations?.database)) {
    deleteBlank(incoming.destinations.database, 'connectionString');
  }
  if (isRecord(incoming.browserLocation) && !clearProxy) {
    for (const key of ['proxyServer', 'proxyUsername', 'proxyPassword']) {
      deleteBlank(incoming.browserLocation, key);
    }
    if (Array.isArray(incoming.browserLocation.proxyPool) && incoming.browserLocation.proxyPool.length === 0) {
      delete incoming.browserLocation.proxyPool;
    }
  }
  if (Array.isArray(incoming.cookies) && incoming.cookies.length === 0) delete incoming.cookies;
  if (isRecord(incoming.localStorage) && Object.keys(incoming.localStorage).length === 0) {
    delete incoming.localStorage;
  }
  if (isRecord(incoming.browserLocation) && Object.keys(incoming.browserLocation).length === 0) {
    delete incoming.browserLocation;
  }
  if (isRecord(incoming.hiringCafeEnrichment) && !clearScrapeDo) {
    deleteBlank(incoming.hiringCafeEnrichment, 'scrapeDoToken');
  }
  if (
    isRecord(incoming.hiringCafeEnrichment) &&
    Object.keys(incoming.hiringCafeEnrichment).length === 0
  ) {
    delete incoming.hiringCafeEnrichment;
  }

  const merged = mergeRecords(current, incoming);
  if (clearProxy) {
    if (!isRecord(merged.browserLocation)) {
      merged.browserLocation = {};
    }
    for (const key of [
      'proxyServer',
      'proxyUsername',
      'proxyPassword',
      'proxyPool',
      'needsProxy',
      'needsProxyAt',
      'clearProxy',
    ]) {
      delete merged.browserLocation[key];
    }
    // Keep an empty object so callers that spread prev+incoming overwrite stored secrets.
  }
  if (clearScrapeDo) {
    if (!isRecord(merged.hiringCafeEnrichment)) {
      merged.hiringCafeEnrichment = {};
    }
    delete merged.hiringCafeEnrichment.scrapeDoToken;
    delete merged.hiringCafeEnrichment.clearScrapeDo;
    if (
      !merged.hiringCafeEnrichment.scrapeDoEnabled &&
      merged.hiringCafeEnrichment.scrapeDoMaxTier == null
    ) {
      delete merged.hiringCafeEnrichment;
    }
  }
  return merged;
};

/**
 * Credentials are resolved from the current Robot. Legacy runtime config is
 * accepted only as a fallback for records created before secret-free runs.
 */
export const resolveAutomationExecutionConfig = (
  robot: any,
  runtimeConfig?: unknown
): AnyRecord => {
  const stored = isRecord(robot?.recording_meta?.saasConfig)
    ? robot.recording_meta.saasConfig
    : {};
  const legacy = isRecord(runtimeConfig) ? runtimeConfig : {};
  const secretsAvailableOnRobot = Object.keys(stored).length > 0;
  if (!secretsAvailableOnRobot) return legacy;
  return mergeRecords(
    mergeRecords(legacy, stored),
    toOperationalRunConfig(legacy)
  );
};

/** Minimum length before a value is used as a substring redaction needle.
 * Short identifiers (e.g. proxy username "user") must not blank-substitute log lines. */
const MIN_SECRET_REDACTION_LENGTH = 8;

const isRedactionSecret = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= MIN_SECRET_REDACTION_LENGTH;

const collectSecretValues = (robot?: any, run?: AnyRecord): string[] => {
  const configs = [
    robot?.recording_meta?.saasConfig,
    run?.interpreterSettings?.runtimeConfig,
  ].filter(isRecord);
  const values: unknown[] = [];
  for (const config of configs) {
    // Intentionally omit proxyUsername, proxyServer, and proxyPool hosts —
    // they are identifiers, not credentials, and short usernames over-redact logs.
    values.push(
      config.browserLocation?.proxyPassword,
      config.hiringCafeEnrichment?.scrapeDoToken,
      config.webhookUrl,
      config.destinations?.webhook?.url,
      config.destinations?.airtable?.apiKey,
      config.destinations?.database?.connectionString,
    );
    if (Array.isArray(config.cookies)) {
      for (const cookie of config.cookies) {
        if (isRecord(cookie)) values.push(cookie.value);
      }
    }
    if (isRecord(config.localStorage)) values.push(...Object.values(config.localStorage));
  }
  return [...new Set(values.filter(isRedactionSecret))]
    .sort((a, b) => b.length - a.length);
};

const redactText = (value: unknown, secrets: string[], wholeLine = false): string => {
  const text = typeof value === 'string' ? value : '';
  if (!text || secrets.length === 0) return text;
  if (wholeLine) {
    return text
      .split('\n')
      .map((line) => secrets.some((secret) => line.includes(secret)) ? '[REDACTED]' : line)
      .join('\n');
  }
  return secrets.reduce((result, secret) => result.split(secret).join('[REDACTED]'), text);
};

export const toPublicRunDto = (
  run: any,
  robot?: any,
  options?: { detail?: boolean }
): AnyRecord => {
  const source = isRecord(run) ? run : {};
  const secrets = collectSecretValues(robot, source);
  const dto: AnyRecord = defined({
    id: source.id ?? source._id?.toString?.(),
    runId: source.runId,
    robotMetaId: source.robotMetaId,
    automationId: source.automationId ?? source.robotMetaId,
    scoutId: source.scoutId,
    name: source.name,
    companyName: source.companyName,
    status: source.status,
    startedAt: source.startedAt,
    finishedAt: source.finishedAt,
    duration: source.duration,
    durationMs: source.durationMs,
    browserId: source.browserId,
    queueJobId: source.queueJobId,
    runByUserId: source.runByUserId,
    runByScheduleId: source.runByScheduleId,
    runByAPI: source.runByAPI,
    runBySDK: source.runBySDK,
    retryCount: source.retryCount,
    rowsExtracted: source.rowsExtracted,
    jobsAddedToBoard: source.jobsAddedToBoard,
    jobsBoardConsidered: source.jobsBoardConsidered,
    jobsBoardDeduped: source.jobsBoardDeduped,
    anomaly: source.anomaly,
    anomalyMeta: source.anomalyMeta,
    failureReason: source.failureReason,
    failureReasonSource: source.failureReasonSource,
    failureReasonLabel: source.failureReasonLabel,
    errorMessage: redactText(source.errorMessage, secrets),
  });
  if (options?.detail) {
    dto.serializableOutput = source.serializableOutput || {};
    dto.binaryOutput = source.binaryOutput || {};
    dto.screenshots = source.screenshots || [];
    dto.log = redactText(source.log, secrets, true);
  } else {
    dto.serializableOutput = {};
    dto.binaryOutput = {};
    dto.log = '';
  }
  return dto;
};

import { describe, expect, it } from 'vitest';
import {
  mergeMaskedAutomationConfig,
  resolveAutomationExecutionConfig,
  toOperationalRunConfig,
  toPublicAutomationConfig,
  toPublicRunDto,
} from './automationConfigView';

const secrets = {
  proxyServer: 'https://proxy.example:8443',
  proxyUsername: 'proxy-user',
  proxyPassword: 'proxy-password-secret',
  airtableApiKey: 'airtable-api-secret',
  cookie: 'session-cookie-secret',
  localStorage: 'browser-storage-secret',
  databaseUrl: 'postgres://db-user:db-password@db.example/private',
  webhookUrl: 'https://hooks.example/deliver?token=webhook-secret',
  legacyWebhookUrl: 'https://hooks.example/old?token=legacy-secret',
};

const runtimeConfig = {
  schedule: { enabled: true, cron: '0 * * * *', timezone: 'UTC' },
  browserLocation: {
    proxyServer: 'https://proxy.example:8443',
    proxyUsername: 'proxy-user',
    proxyPassword: secrets.proxyPassword,
  },
  cookies: [{ name: 'session', value: secrets.cookie, domain: 'example.com', path: '/' }],
  localStorage: { auth: secrets.localStorage },
  userAgent: 'Scout-X Test',
  destinations: {
    webhook: {
      enabled: true,
      url: secrets.webhookUrl,
      retryAttempts: 3,
      retryDelaySeconds: 5,
      timeoutSeconds: 20,
    },
    airtable: {
      enabled: true,
      apiKey: secrets.airtableApiKey,
      baseId: 'app-public',
      tableName: 'Jobs',
    },
    database: {
      enabled: true,
      type: 'postgres',
      connectionString: secrets.databaseUrl,
      tableName: 'jobs',
    },
  },
  dataCleanup: { removeDuplicates: true },
};

const robot = {
  recording_meta: {
    id: 'automation-1',
    saasConfig: runtimeConfig,
  },
};

const assertNoSecrets = (value: unknown) => {
  const serialized = JSON.stringify(value);
  for (const secret of Object.values(secrets)) {
    expect(serialized).not.toContain(secret);
  }
};

describe('automationConfigView', () => {
  it('creates an explicit public automation config without secret-bearing fields', () => {
    const view = toPublicAutomationConfig(runtimeConfig);

    expect(view).toMatchInlineSnapshot(`
      {
        "dataCleanup": {
          "removeDuplicates": true,
        },
        "destinationType": "webhook",
        "destinations": {
          "airtable": {
            "baseId": "app-public",
            "enabled": true,
            "tableName": "Jobs",
          },
          "database": {
            "enabled": true,
            "tableName": "jobs",
            "type": "postgres",
          },
          "webhook": {
            "enabled": true,
            "retryAttempts": 3,
            "retryDelaySeconds": 5,
            "timeoutSeconds": 20,
          },
        },
        "proxyConfigured": true,
        "schedule": {
          "cron": "0 * * * *",
          "enabled": true,
          "timezone": "UTC",
        },
        "userAgent": "Scout-X Test",
        "webhookConfigured": true,
      }
    `);
    assertNoSecrets(view);
  });

  it('redacts legacy run fields and secret values from list, failure, and detail DTOs', () => {
    const run = {
      _id: 'mongo-id',
      runId: 'run-1',
      robotMetaId: 'automation-1',
      name: 'Secret test',
      status: 'failed',
      startedAt: '2026-08-17T10:00:00.000Z',
      finishedAt: '2026-08-17T10:00:01.000Z',
      duration: 1000,
      errorMessage: `Webhook failed for ${secrets.webhookUrl}`,
      log: `cookie=${secrets.cookie}\nproxy=${secrets.proxyPassword}\nlegacy=${secrets.legacyWebhookUrl}`,
      interpreterSettings: {
        runtimeConfig: {
          ...runtimeConfig,
          webhookUrl: secrets.legacyWebhookUrl,
        },
      },
      serializableOutput: { scrapeList: { Jobs: [] } },
      binaryOutput: { screenshot: 'base64-image' },
      failureReason: 'destination_error',
      failureReasonSource: 'suggested',
    };

    const list = toPublicRunDto(run, robot, { detail: false });
    const failure = toPublicRunDto(run, robot, { detail: false });
    const detail = toPublicRunDto(run, robot, { detail: true });

    expect(list).not.toHaveProperty('interpreterSettings');
    expect(list.serializableOutput).toEqual({});
    expect(list.binaryOutput).toEqual({});
    expect(detail).not.toHaveProperty('interpreterSettings');
    expect(detail.log).toBe('[REDACTED]\n[REDACTED]\n[REDACTED]');
    expect(detail.errorMessage).toBe('Webhook failed for [REDACTED]');
    expect(detail.serializableOutput).toEqual({ scrapeList: { Jobs: [] } });
    expect(detail.binaryOutput).toEqual({ screenshot: 'base64-image' });
    assertNoSecrets({ list, failure, detail });
  });

  it('does not redact ordinary log URLs just because cookie metadata shares a domain or path', () => {
    const detail = toPublicRunDto(
      { runId: 'run-public-log', log: 'Visited https://public.example.com/jobs' },
      robot,
      { detail: true }
    );
    expect(detail.log).toBe('Visited https://public.example.com/jobs');
  });

  it('does not blank-substitute log lines that only mention a short proxy username', () => {
    const shortUserRobot = {
      recording_meta: {
        id: 'automation-short-user',
        saasConfig: {
          ...runtimeConfig,
          browserLocation: {
            proxyServer: 'https://proxy.example:8443',
            proxyUsername: 'user',
            proxyPassword: secrets.proxyPassword,
          },
        },
      },
    };
    const detail = toPublicRunDto(
      {
        runId: 'run-short-user',
        log: [
          'user clicked submit',
          'Navigating to jobs board for user review',
          `proxy auth failed: ${secrets.proxyPassword}`,
          `airtable key=${secrets.airtableApiKey}`,
          `db=${secrets.databaseUrl}`,
          `cookie=${secrets.cookie}`,
        ].join('\n'),
      },
      shortUserRobot,
      { detail: true }
    );

    expect(detail.log).toContain('user clicked submit');
    expect(detail.log).toContain('Navigating to jobs board for user review');
    expect(detail.log).not.toMatch(/^\[REDACTED\]\n\[REDACTED\]/);
    expect(detail.log.split('\n')[0]).toBe('user clicked submit');
    expect(detail.log.split('\n')[1]).toBe('Navigating to jobs board for user review');
    expect(detail.log).toContain('[REDACTED]');
    expect(detail.log).not.toContain(secrets.proxyPassword);
    expect(detail.log).not.toContain(secrets.airtableApiKey);
    expect(detail.log).not.toContain(secrets.databaseUrl);
    expect(detail.log).not.toContain(secrets.cookie);
  });

  it('stores only operational run config and resolves credentials from the robot at execution', () => {
    const stored = toOperationalRunConfig(runtimeConfig);

    expect(stored).toEqual({
      schedule: runtimeConfig.schedule,
      userAgent: runtimeConfig.userAgent,
      dataCleanup: runtimeConfig.dataCleanup,
      destinations: {
        webhook: {
          enabled: true,
          retryAttempts: 3,
          retryDelaySeconds: 5,
          timeoutSeconds: 20,
        },
        airtable: {
          enabled: true,
          baseId: 'app-public',
          tableName: 'Jobs',
        },
        database: {
          enabled: true,
          type: 'postgres',
          tableName: 'jobs',
        },
      },
    });
    assertNoSecrets(stored);

    const resolved = resolveAutomationExecutionConfig(robot, stored);
    expect(resolved.destinations.airtable.apiKey).toBe(secrets.airtableApiKey);
    expect(resolved.destinations.database.connectionString).toBe(secrets.databaseUrl);
    expect(resolved.destinations.webhook.url).toBe(secrets.webhookUrl);
    expect(resolved.browserLocation.proxyPassword).toBe(secrets.proxyPassword);
    expect(resolved.cookies[0].value).toBe(secrets.cookie);
  });

  it('keeps legacy run credentials only when the current robot has no replacement', () => {
    const legacy = {
      destinations: {
        webhook: { enabled: true, url: secrets.legacyWebhookUrl },
        airtable: { apiKey: 'legacy-airtable-key' },
      },
      browserLocation: { proxyPassword: 'legacy-proxy-password' },
      dataCleanup: { removeDuplicates: false },
    };
    const partiallyMigratedRobot = {
      recording_meta: {
        saasConfig: {
          schedule: { enabled: false },
          destinations: {
            airtable: { apiKey: 'current-airtable-key' },
          },
        },
      },
    };

    const resolved = resolveAutomationExecutionConfig(partiallyMigratedRobot, legacy);
    expect(resolved.destinations.webhook.url).toBe(secrets.legacyWebhookUrl);
    expect(resolved.browserLocation.proxyPassword).toBe('legacy-proxy-password');
    expect(resolved.destinations.airtable.apiKey).toBe('current-airtable-key');
  });

  it('preserves masked credentials on ordinary edits and accepts explicit replacements', () => {
    const preserved = mergeMaskedAutomationConfig(runtimeConfig, {
      destinations: {
        webhook: { enabled: true, url: '' },
        airtable: { enabled: true, apiKey: '', tableName: 'Jobs 2' },
        database: { enabled: true, connectionString: '', tableName: 'jobs_2' },
      },
      browserLocation: { proxyServer: '', proxyUsername: '', proxyPassword: '' },
      cookies: [],
      localStorage: {},
    });

    expect(preserved.destinations.webhook.url).toBe(secrets.webhookUrl);
    expect(preserved.destinations.airtable.apiKey).toBe(secrets.airtableApiKey);
    expect(preserved.destinations.database.connectionString).toBe(secrets.databaseUrl);
    expect(preserved.browserLocation.proxyPassword).toBe(secrets.proxyPassword);
    expect(preserved.cookies[0].value).toBe(secrets.cookie);
    expect(preserved.localStorage.auth).toBe(secrets.localStorage);
    expect(preserved.destinations.database.tableName).toBe('jobs_2');

    const replaced = mergeMaskedAutomationConfig(runtimeConfig, {
      destinations: { airtable: { apiKey: 'replacement-key' } },
    });
    expect(replaced.destinations.airtable.apiKey).toBe('replacement-key');
  });

  it('preserves stored secrets when a public DTO payload is merged onto existing config', () => {
    const incoming = {
      ...toPublicAutomationConfig(runtimeConfig),
      destinations: {
        webhook: { enabled: true, url: '' },
        airtable: { enabled: true, apiKey: '', tableName: 'Jobs 2' },
        database: { enabled: true, connectionString: '', tableName: 'jobs_2' },
      },
      browserLocation: { proxyServer: '', proxyUsername: '', proxyPassword: '' },
      cookies: [],
      localStorage: {},
      webhookUrl: '',
    };

    const preserved = mergeMaskedAutomationConfig(runtimeConfig, incoming);
    expect(preserved.browserLocation.proxyPassword).toBe(secrets.proxyPassword);
    expect(preserved.browserLocation.proxyUsername).toBe(secrets.proxyUsername);
    expect(preserved.browserLocation.proxyServer).toBe(secrets.proxyServer);
    expect(preserved.destinations.webhook.url).toBe(secrets.webhookUrl);
    expect(preserved.destinations.airtable.apiKey).toBe(secrets.airtableApiKey);
    expect(preserved.cookies[0].value).toBe(secrets.cookie);
  });

  it('clears stored proxy credentials when clearProxy is set', () => {
    const cleared = mergeMaskedAutomationConfig(runtimeConfig, {
      browserLocation: { clearProxy: true },
    });
    expect(cleared.browserLocation?.proxyServer).toBeUndefined();
    expect(cleared.browserLocation?.proxyUsername).toBeUndefined();
    expect(cleared.browserLocation?.proxyPassword).toBeUndefined();
    expect(cleared.browserLocation?.needsProxy).toBeUndefined();
    expect(toPublicAutomationConfig(cleared).proxyConfigured).toBe(false);
  });
});

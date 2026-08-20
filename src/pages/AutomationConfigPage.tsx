import React, { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  Link,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import {
  AccessTime,
  CalendarMonth,
  ExpandMore,
  Extension as ExtensionIcon,
  FlashOff,
  Today,
} from '@mui/icons-material';
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { getAutomation, updateAutomationConfig } from '../api/automation';
import { useGlobalInfoStore } from '../context/globalInfo';
import { SCHEDULE_OPTIONS } from '../constants/scheduleOptions';
import { DEFAULT_JOB_DATABASE_TARGET_COLUMNS } from '../constants/defaultJobDatabaseColumns';
import { TagPicker } from '../components/automation/TagPicker';
import {
  configShowsPaginationLimits,
  configShowsRawListExtractionEditor,
  configStartUrlLocked,
  proxySavedChipLabel,
} from '../features/automations/automationsPageBehavior';
import { popReturnNavigateOptions, pushReturnState } from '../features/navigation/inAppReturn';

const DB_TARGET_COL_MAX = 100;
const DB_TARGET_NAME_MAX = 120;
const DB_TARGET_FORBIDDEN = /[,\n\r\t]/;
const PAGE_MAX_WIDTH = 900;

const defaultDestinations = () => ({
  webhook: {
    enabled: false,
    url: '',
    retryAttempts: 3,
    retryDelaySeconds: 5,
    timeoutSeconds: 30,
  },
  googleSheets: {
    enabled: false,
    spreadsheetId: '',
    sheetName: 'Sheet1',
  },
  airtable: {
    enabled: false,
    apiKey: '',
    baseId: '',
    tableName: '',
  },
  database: {
    enabled: false,
    type: 'postgres',
    connectionString: '',
    tableName: 'scraped_rows',
  },
});

function parseDatabaseTargetColumnsInput(text: string): { ok: true; list: string[] } | { ok: false; error: string } {
  const raw = text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const list: string[] = [];
  for (const s of raw) {
    if (s.length > DB_TARGET_NAME_MAX) {
      return { ok: false, error: `Each column name must be at most ${DB_TARGET_NAME_MAX} characters.` };
    }
    if (DB_TARGET_FORBIDDEN.test(s)) {
      return { ok: false, error: 'Names cannot contain commas, tabs, or newlines (use one name per line).' };
    }
    if (seen.has(s)) continue;
    seen.add(s);
    list.push(s);
    if (list.length > DB_TARGET_COL_MAX) {
      return { ok: false, error: `At most ${DB_TARGET_COL_MAX} names.` };
    }
  }
  return { ok: true, list };
}

function truncateSelector(value: string, max = 72): string {
  const s = String(value || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function fieldMapEntries(fields: unknown): Array<{ key: string; value: string }> {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return [];
  return Object.entries(fields as Record<string, unknown>).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value),
  }));
}

function SectionPaper({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5} spacing={1}>
        <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1.05rem' }}>
          {title}
        </Typography>
        {action}
      </Stack>
      <Stack spacing={2}>{children}</Stack>
    </Paper>
  );
}

export type AutomationConfigPageProps = {
  automationId?: string;
  onClose?: () => void;
  embedded?: boolean;
};

export const AutomationConfigPage = ({
  automationId,
  onClose,
  embedded = false,
}: AutomationConfigPageProps = {}) => {
  const { id: routeId = '' } = useParams();
  const id = automationId || routeId;
  const navigate = useNavigate();
  const location = useLocation();
  const { notify } = useGlobalInfoStore();
  const close = () => {
    if (onClose) {
      onClose();
      return;
    }
    const back = popReturnNavigateOptions(location.state, '/automations');
    if (back.href) {
      navigate(back.href, back.state ? { state: back.state } : undefined);
    } else {
      navigate('/automations');
    }
  };
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [startUrl, setStartUrl] = useState('https://');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookConfigured, setWebhookConfigured] = useState(false);
  const [proxyConfigured, setProxyConfigured] = useState(false);
  const [airtableConfigured, setAirtableConfigured] = useState(false);
  const [databaseConfigured, setDatabaseConfigured] = useState(false);
  const [cookiesConfigured, setCookiesConfigured] = useState(false);
  const [localStorageConfigured, setLocalStorageConfigured] = useState(false);
  const [databaseTargetColumnsDraft, setDatabaseTargetColumnsDraft] = useState('');
  const [cookiesDraft, setCookiesDraft] = useState('[]');
  const [localStorageDraft, setLocalStorageDraft] = useState('{}');
  const [fieldsDraft, setFieldsDraft] = useState('{}');
  const [extractionDirty, setExtractionDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastRunTime, setLastRunTime] = useState<string | null>(null);
  const [nextRunAt, setNextRunAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [config, setConfig] = useState<Record<string, any>>({
    schedule: {
      enabled: false,
      cron: '0 * * * *',
    },
    destinations: defaultDestinations(),
    browserLocation: {
      proxyServer: '',
      proxyUsername: '',
      proxyPassword: '',
    },
    userAgent: '',
    cookies: [],
    localStorage: {},
    dataCleanup: {
      removeEmptyRows: true,
      removeDuplicates: true,
    },
    listExtraction: {
      itemSelector: '',
      uniqueKey: '',
      maxItems: 100,
      autoScroll: false,
      scrollDelayMs: 1200,
      maxScrollIterations: 10,
      fields: {},
      pagination: {
        mode: 'none',
        nextButtonSelector: '',
        maxPages: 5,
        startPage: 0,
        pageParam: 'page',
        pageDelayMs: 1200,
      },
      popups: {
        autoDismiss: true,
        acceptDialogs: true,
      },
      captcha: {
        pauseOnDetect: true,
      },
    },
    rowContext: {
      sectorIndustry: '',
      f500: '',
    },
    popups: {
      autoDismiss: true,
      acceptDialogs: true,
    },
    captcha: {
      pauseOnDetect: true,
    },
  });

  const normalizeStartUrl = (value: string) => {
    const trimmedValue = String(value || '').trim();

    if (!trimmedValue) {
      return '';
    }

    const collapsedProtocolValue = trimmedValue.replace(/^(https?:\/\/)+/i, (match) =>
      match.toLowerCase().startsWith('https://') ? 'https://' : 'http://'
    );

    const normalizedCandidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(collapsedProtocolValue)
      ? collapsedProtocolValue
      : `https://${collapsedProtocolValue}`;

    try {
      return new URL(normalizedCandidate).toString();
    } catch {
      return trimmedValue;
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const response = await getAutomation(id);
        const automation = response.automation;
        const saas = automation.config || {};
        setWebhookConfigured(!!(automation.webhookConfigured || saas.webhookConfigured));
        setProxyConfigured(!!(automation.proxyConfigured || saas.proxyConfigured));
        setAirtableConfigured(!!saas.destinations?.airtable?.enabled);
        setDatabaseConfigured(!!saas.destinations?.database?.enabled);
        setCookiesConfigured(false);
        setLocalStorageConfigured(false);
        setName(automation.name || '');
        setCompanyName(automation.companyName || '');
        setTags(Array.isArray(automation.tags) ? automation.tags : []);
        setStartUrl(automation.targetUrl || 'https://');
        const webhook =
          automation.webhookUrl ||
          saas.webhookUrl ||
          saas.destinations?.webhook?.url ||
          '';
        setWebhookUrl(webhook);
        setLastRunTime(automation.lastRunTime || automation.schedule?.lastRunAt || null);
        setNextRunAt(automation.schedule?.nextRunAt || null);

        const mergedDestinations = {
          ...defaultDestinations(),
          ...(saas.destinations || {}),
          webhook: {
            ...defaultDestinations().webhook,
            ...(saas.destinations?.webhook || {}),
            url: saas.destinations?.webhook?.url || webhook,
            enabled: !!saas.destinations?.webhook?.enabled,
          },
        };

        setConfig((current) => ({
          ...current,
          ...saas,
          destinations: mergedDestinations,
          schedule: automation.schedule || saas.schedule || current.schedule,
          browserLocation: {
            ...current.browserLocation,
            ...(saas.browserLocation || {}),
          },
          dataCleanup: {
            ...current.dataCleanup,
            ...(saas.dataCleanup || {}),
          },
          listExtraction: {
            ...current.listExtraction,
            ...(saas.listExtraction || {}),
            fields: saas.listExtraction?.fields || current.listExtraction.fields,
            pagination: {
              ...current.listExtraction.pagination,
              ...(saas.listExtraction?.pagination || {}),
            },
            popups: {
              ...current.listExtraction.popups,
              ...(saas.listExtraction?.popups || saas.popups || {}),
            },
            captcha: {
              ...current.listExtraction.captcha,
              ...(saas.listExtraction?.captcha || saas.captcha || {}),
            },
          },
          rowContext: {
            sectorIndustry: '',
            f500: '',
            ...(saas.rowContext || {}),
          },
          popups: {
            autoDismiss: true,
            acceptDialogs: true,
            ...(saas.popups || saas.listExtraction?.popups || {}),
          },
          captcha: {
            pauseOnDetect: true,
            ...(saas.captcha || saas.listExtraction?.captcha || {}),
          },
        }));

        setCookiesDraft(JSON.stringify(saas.cookies || [], null, 2));
        setLocalStorageDraft(JSON.stringify(saas.localStorage || {}, null, 2));
        setFieldsDraft(JSON.stringify(saas.listExtraction?.fields || {}, null, 2));
        setExtractionDirty(false);

        const fromApi = saas.databaseTargetColumns;
        if (Array.isArray(fromApi)) {
          setDatabaseTargetColumnsDraft(
            fromApi.map((c: unknown) => String(c || '').trim()).filter(Boolean).join('\n')
          );
        } else {
          setDatabaseTargetColumnsDraft(DEFAULT_JOB_DATABASE_TARGET_COLUMNS.join('\n'));
        }
        setLoaded(true);
      } catch (error: any) {
        notify('error', error?.response?.data?.error || 'Failed to load automation config');
      }
    };

    load();
  }, [id]);

  const updateNested = (path: string[], value: any) => {
    setConfig((current) => {
      const next = { ...current };
      let pointer: any = next;
      path.slice(0, -1).forEach((key) => {
        pointer[key] = { ...(pointer[key] || {}) };
        pointer = pointer[key];
      });
      pointer[path[path.length - 1]] = value;
      return next;
    });
  };

  const markExtractionDirty = () => setExtractionDirty(true);

  const hasExtraction = Boolean(String(config.listExtraction?.itemSelector || '').trim());
  const fieldEntries = useMemo(
    () => fieldMapEntries(config.listExtraction?.fields),
    [config.listExtraction?.fields]
  );

  const selectedScheduleLabel = useMemo(() => {
    const cron = config.schedule?.cron || null;
    const match = SCHEDULE_OPTIONS.find((o) => o.cron === cron);
    return match?.label || (cron ? `Custom: ${cron}` : 'Off');
  }, [config.schedule?.cron]);

  const handleSave = async () => {
    if (!companyName.trim()) {
      notify('error', 'Company name is required');
      return;
    }
    const parsedTargets = parseDatabaseTargetColumnsInput(databaseTargetColumnsDraft);
    if (!parsedTargets.ok) {
      notify('error', parsedTargets.error);
      return;
    }

    let cookiesValue: unknown = config.cookies;
    let localStorageValue: unknown = config.localStorage;
    try {
      cookiesValue = JSON.parse(cookiesDraft || '[]');
    } catch {
      notify('error', 'Cookies must be valid JSON (array).');
      return;
    }
    try {
      localStorageValue = JSON.parse(localStorageDraft || '{}');
    } catch {
      notify('error', 'Local Storage must be valid JSON (object).');
      return;
    }

    let listExtractionPayload: Record<string, any> | undefined;
    if (extractionDirty) {
      let fieldsValue = config.listExtraction?.fields || {};
      try {
        fieldsValue = JSON.parse(fieldsDraft || '{}');
      } catch {
        notify('error', 'Field mapping must be valid JSON (object).');
        return;
      }
      listExtractionPayload = {
        ...(config.listExtraction || {}),
        fields: fieldsValue,
        popups: config.popups || config.listExtraction?.popups,
        captcha: config.captcha || config.listExtraction?.captcha,
      };
    }

    const omitBlank = (value: unknown) => (typeof value === 'string' && !value.trim() ? undefined : value);
    const cookiesPayload =
      Array.isArray(cookiesValue) && cookiesValue.length === 0 ? undefined : cookiesValue;
    const localStoragePayload =
      localStorageValue && typeof localStorageValue === 'object' && !Array.isArray(localStorageValue)
        && Object.keys(localStorageValue as Record<string, unknown>).length === 0
        ? undefined
        : localStorageValue;
    const browserLocationPayload = {
      ...(omitBlank(config.browserLocation?.proxyServer)
        ? { proxyServer: config.browserLocation.proxyServer }
        : {}),
      ...(omitBlank(config.browserLocation?.proxyUsername)
        ? { proxyUsername: config.browserLocation.proxyUsername }
        : {}),
      ...(omitBlank(config.browserLocation?.proxyPassword)
        ? { proxyPassword: config.browserLocation.proxyPassword }
        : {}),
    };

    const webhook =
      config.destinations?.webhook?.url || webhookUrl || '';

    // Only send keys this page owns. Omit listExtraction unless Advanced raw edit ran,
    // so extension-authored selectors / previewRows / pools stay intact on the server.
    const configPayload: Record<string, any> = {
      schedule: {
        enabled: !!config.schedule?.enabled,
        cron: config.schedule?.cron || '',
        timezone: config.schedule?.timezone || 'UTC',
      },
      destinations: {
        ...config.destinations,
        webhook: {
          ...(config.destinations?.webhook || {}),
          ...(omitBlank(webhook) ? { url: webhook } : { url: undefined }),
          enabled: !!(
            config.destinations?.webhook?.enabled &&
            (webhook || webhookConfigured)
          ),
        },
        airtable: {
          ...(config.destinations?.airtable || {}),
          ...(omitBlank(config.destinations?.airtable?.apiKey)
            ? { apiKey: config.destinations.airtable.apiKey }
            : { apiKey: undefined }),
        },
        database: {
          ...(config.destinations?.database || {}),
          ...(omitBlank(config.destinations?.database?.connectionString)
            ? { connectionString: config.destinations.database.connectionString }
            : { connectionString: undefined }),
        },
      },
      databaseTargetColumns: parsedTargets.list,
      ...(Object.keys(browserLocationPayload).length ? { browserLocation: browserLocationPayload } : {}),
      dataCleanup: config.dataCleanup || {},
      userAgent: config.userAgent || '',
      ...(cookiesPayload !== undefined ? { cookies: cookiesPayload } : {}),
      ...(localStoragePayload !== undefined ? { localStorage: localStoragePayload } : {}),
      rowContext: {
        sectorIndustry: config.rowContext?.sectorIndustry || '',
        f500: config.rowContext?.f500 || '',
      },
      popups: {
        autoDismiss: !!config.popups?.autoDismiss,
        acceptDialogs: !!config.popups?.acceptDialogs,
      },
      captcha: {
        pauseOnDetect: !!config.captcha?.pauseOnDetect,
      },
      ...(omitBlank(webhook) ? { webhookUrl: webhook } : {}),
    };

    if (listExtractionPayload) {
      configPayload.listExtraction = listExtractionPayload;
    }

    setSaving(true);
    try {
      await updateAutomationConfig(id, {
        name,
        companyName: companyName.trim(),
        tags,
        ...(configStartUrlLocked() ? {} : { startUrl: normalizeStartUrl(startUrl) }),
        ...(webhook.trim() ? { webhookUrl: webhook } : {}),
        config: configPayload,
      });
      notify('success', 'Automation configuration saved');
      close();
    } catch (error: any) {
      notify('error', error?.response?.data?.error || 'Failed to save automation config');
    } finally {
      setSaving(false);
    }
  };

  const headerActions = (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        position: { md: 'sticky' },
        top: { md: 16 },
        zIndex: 2,
        bgcolor: 'background.default',
        py: 0.5,
      }}
    >
      <Button variant="outlined" onClick={close}>
        Cancel
      </Button>
      <Button variant="contained" onClick={handleSave} disabled={saving || !loaded}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </Stack>
  );

  return (
    <Box sx={{
      p: embedded ? 2 : { xs: 2, md: 4 },
      pb: embedded ? 2 : 6,
      maxHeight: embedded ? '80vh' : undefined,
      overflow: embedded ? 'auto' : undefined,
    }}>
      <Box sx={{ maxWidth: PAGE_MAX_WIDTH, mx: 'auto' }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'center' }}
          spacing={2}
          mb={3}
        >
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1 }}>
              Scout-X
            </Typography>
            <Typography variant="h4" fontWeight={700}>
              Automation config
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Saved with this automation and used on every scheduled or manual run.
            </Typography>
          </Box>
          {headerActions}
        </Stack>

        <Stack spacing={2.5}>
          <SectionPaper title="Overview">
            <TextField
              label="Automation Name"
              fullWidth
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <TextField
              label="Company name"
              fullWidth
              required
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              placeholder="e.g. DXC, EY, Google"
              helperText="Required. Shown on the Scout-X dashboard Company column."
            />
            <TagPicker value={tags} onChange={setTags} />
            <TextField
              label="Start URL"
              fullWidth
              value={startUrl}
              InputProps={{ readOnly: configStartUrlLocked() }}
              helperText={
                configStartUrlLocked()
                  ? 'Start URL cannot be changed here — it would break the recorded selectors.'
                  : undefined
              }
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} flexWrap="wrap" useFlexGap>
              <Chip size="small" label={`ID: ${id}`} variant="outlined" />
              {lastRunTime ? (
                <Chip size="small" label={`Last run: ${new Date(lastRunTime).toLocaleString()}`} variant="outlined" />
              ) : (
                <Chip size="small" label="No runs yet" variant="outlined" />
              )}
              {config.schedule?.enabled && nextRunAt ? (
                <Chip
                  size="small"
                  color="primary"
                  variant="outlined"
                  label={`Next run: ${new Date(nextRunAt).toLocaleString()}`}
                />
              ) : null}
            </Stack>
            {!embedded ? (
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
              <Link
                component={RouterLink}
                to={`/automation/${id}/data`}
                state={pushReturnState(location)}
                underline="hover"
              >
                Extracted data
              </Link>
              <Link component={RouterLink} to="/automations" underline="hover">
                Automations
              </Link>
            </Stack>
            ) : null}
          </SectionPaper>

          <SectionPaper
            title="Chrome extension"
            action={
              hasExtraction ? (
                <Chip size="small" color="success" label="Selectors linked" />
              ) : (
                <Chip size="small" color="warning" label="Not configured" />
              )
            }
          >
            <Stack direction="row" spacing={1.5} alignItems="flex-start">
              <ExtensionIcon color="primary" sx={{ mt: 0.25 }} />
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  List selectors come from the Scout-X Chrome extension. Use this page for schedule,
                  destinations, and cleanup — re-pick elements in the extension when the site layout changes.
                </Typography>

                {!hasExtraction ? (
                  <Alert severity="info" sx={{ mb: 1.5 }}>
                    No list extraction yet. Open the extension, pick a list on the target page, then
                    Send to Scout-X for this automation.
                  </Alert>
                ) : (
                  <Stack spacing={1.25} sx={{ mb: 1.5 }}>
                    <Typography variant="body2">
                      <strong>Item selector:</strong> {truncateSelector(config.listExtraction?.itemSelector || '')}
                    </Typography>
                    <Typography variant="body2">
                      <strong>Unique key:</strong> {config.listExtraction?.uniqueKey || '—'}
                      {' · '}
                      <strong>Max items:</strong> {config.listExtraction?.maxItems ?? '—'}
                      {' · '}
                      <strong>Pagination:</strong> {config.listExtraction?.pagination?.mode || 'none'}
                    </Typography>
                    {fieldEntries.length > 0 ? (
                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                          gap: 1,
                        }}
                      >
                        {fieldEntries.map((entry) => (
                          <Box
                            key={entry.key}
                            sx={{
                              border: '1px solid',
                              borderColor: 'divider',
                              borderRadius: 1,
                              px: 1.25,
                              py: 1,
                            }}
                          >
                            <Typography variant="caption" color="text.secondary">
                              {entry.key}
                            </Typography>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                              {truncateSelector(entry.value, 96)}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                    ) : null}
                    {configShowsPaginationLimits() ? (
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 0.5 }}>
                        <TextField
                          label="Max items"
                          type="number"
                          size="small"
                          value={config.listExtraction?.maxItems ?? 100}
                          onChange={(event) => {
                            markExtractionDirty();
                            updateNested(
                              ['listExtraction', 'maxItems'],
                              parseInt(event.target.value || '100', 10)
                            );
                          }}
                          helperText="Stop after this many job URLs"
                        />
                        <TextField
                          label="Max pages"
                          type="number"
                          size="small"
                          value={config.listExtraction?.pagination?.maxPages ?? 10}
                          onChange={(event) => {
                            markExtractionDirty();
                            updateNested(
                              ['listExtraction', 'pagination', 'maxPages'],
                              parseInt(event.target.value || '10', 10)
                            );
                          }}
                          helperText="How many list pages to click through"
                        />
                      </Stack>
                    ) : null}
                  </Stack>
                )}

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => navigate('/dashboard?extension=1')}
                  >
                    Open extension setup
                  </Button>
                </Stack>
              </Box>
            </Stack>
          </SectionPaper>

          <SectionPaper title="Column mapping">
            <Typography variant="body2" color="text.secondary">
              Paste the attribute names your warehouse or API uses (one per line or comma-separated).
              Job-focused defaults are pre-filled until you save. On Extracted Data, &quot;Edit columns&quot;
              uses this list as the mapping dropdown.
            </Typography>
            <TextField
              label="Target columns for mapping"
              fullWidth
              value={databaseTargetColumnsDraft}
              onChange={(event) => setDatabaseTargetColumnsDraft(event.target.value)}
              multiline
              minRows={4}
              placeholder={'posted_date\njob_url\ncompany_name'}
              helperText="Match your warehouse / BigQuery / API field names exactly. Leave empty to type renames manually in Edit columns."
            />
            <Link
              component={RouterLink}
              to={`/automation/${id}/data`}
              state={pushReturnState(location)}
              underline="hover"
            >
              Open Extracted Data → Edit columns
            </Link>
          </SectionPaper>

          <SectionPaper title="Scheduling">
            <FormControlLabel
              control={
                <Switch
                  checked={!!config.schedule?.enabled}
                  onChange={(event) => updateNested(['schedule', 'enabled'], event.target.checked)}
                />
              }
              label={<Typography variant="body2" fontWeight={500}>Enable automatic runs</Typography>}
            />
            {config.schedule?.enabled ? (
              <Typography variant="body2" color="text.secondary">
                Interval: {selectedScheduleLabel}
                {nextRunAt ? ` · Next run ${new Date(nextRunAt).toLocaleString()}` : ''}
              </Typography>
            ) : null}

            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, fontSize: 13 }}>
                Select a run interval:
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr' },
                  gap: 1.25,
                }}
              >
                {SCHEDULE_OPTIONS.map((option) => {
                  const isSelected = option.cron === (config.schedule?.cron || null);
                  const isOff = option.cron === null;

                  return (
                    <Box
                      key={option.label}
                      onClick={() => {
                        updateNested(['schedule', 'cron'], option.cron || '');
                        if (option.cron === null) {
                          updateNested(['schedule', 'enabled'], false);
                        } else {
                          updateNested(['schedule', 'enabled'], true);
                        }
                      }}
                      sx={{
                        p: 1.5,
                        borderRadius: 2,
                        border: '2px solid',
                        borderColor: isSelected
                          ? isOff
                            ? '#f59e0b'
                            : 'primary.main'
                          : 'divider',
                        background: isSelected
                          ? isOff
                            ? 'rgba(245,158,11,0.08)'
                            : 'rgba(99,102,241,0.07)'
                          : 'transparent',
                        cursor: 'pointer',
                        transition: 'all 0.16s ease',
                        boxShadow: isSelected
                          ? `0 0 0 3px ${isOff ? 'rgba(245,158,11,0.15)' : 'rgba(99,102,241,0.15)'}`
                          : 'none',
                        '&:hover': {
                          borderColor: isOff ? '#f59e0b' : 'primary.main',
                          background: isOff
                            ? 'rgba(245,158,11,0.05)'
                            : 'rgba(99,102,241,0.05)',
                          transform: 'translateY(-1px)',
                        },
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.4 }}>
                        <Box
                          sx={{
                            fontSize: 15,
                            color: isSelected ? (isOff ? '#f59e0b' : 'primary.main') : 'text.secondary',
                            display: 'flex',
                          }}
                        >
                          {option.cron === null ? (
                            <FlashOff sx={{ fontSize: 16 }} />
                          ) : option.label.includes('week') || option.label.includes('month') ? (
                            <CalendarMonth sx={{ fontSize: 16 }} />
                          ) : option.label.includes('day') ? (
                            <Today sx={{ fontSize: 16 }} />
                          ) : (
                            <AccessTime sx={{ fontSize: 16 }} />
                          )}
                        </Box>
                        <Typography
                          variant="body2"
                          fontWeight={isSelected ? 700 : 600}
                          sx={{
                            color: isSelected ? (isOff ? '#f59e0b' : 'primary.main') : 'text.primary',
                            fontSize: 12,
                            lineHeight: 1.2,
                          }}
                        >
                          {option.label}
                        </Typography>
                      </Box>
                      <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary', fontSize: 10.5, lineHeight: 1.3, display: 'block' }}
                      >
                        {option.description}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>

              {config.schedule?.cron &&
                !SCHEDULE_OPTIONS.find((o) => o.cron === config.schedule?.cron) && (
                  <Box sx={{ mt: 1.5 }}>
                    <TextField
                      label="Custom Cron Expression"
                      size="small"
                      fullWidth
                      value={config.schedule?.cron || ''}
                      onChange={(event) => updateNested(['schedule', 'cron'], event.target.value)}
                      helperText="Custom expression entered. Select a card above to use a preset."
                    />
                  </Box>
                )}

              {config.schedule?.enabled && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700} mb={0.5}>
                    Load-balanced start
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Scout-X assigns a random first run time and spaces it at least 90 seconds from
                    other scrapes so jobs do not pile up at the same instant.
                  </Typography>
                </Box>
              )}
            </Box>
          </SectionPaper>

          <SectionPaper title="Destinations">
            <Typography variant="body2" color="text.secondary">
              Rows are always stored in Scout-X. Optionally push them to an external destination after each run.
            </Typography>

            <FormControlLabel
              control={
                <Switch
                  checked={!!config.destinations?.webhook?.enabled}
                  onChange={(event) => updateNested(['destinations', 'webhook', 'enabled'], event.target.checked)}
                />
              }
              label="Webhook"
            />
            {config.destinations?.webhook?.enabled ? (
              <Stack spacing={2}>
                <TextField
                  label="Webhook URL"
                  fullWidth
                  value={config.destinations?.webhook?.url || webhookUrl || ''}
                  placeholder={webhookConfigured ? 'Leave blank to keep existing webhook' : ''}
                  helperText={webhookConfigured ? 'A webhook is already configured. Leave blank to keep it.' : undefined}
                  onChange={(event) => {
                    updateNested(['destinations', 'webhook', 'url'], event.target.value);
                    setWebhookUrl(event.target.value);
                  }}
                />
                <TextField
                  label="Retry attempts"
                  type="number"
                  fullWidth
                  value={config.destinations?.webhook?.retryAttempts ?? 3}
                  onChange={(event) =>
                    updateNested(['destinations', 'webhook', 'retryAttempts'], parseInt(event.target.value || '3', 10))
                  }
                />
                <TextField
                  label="Retry delay (seconds)"
                  type="number"
                  fullWidth
                  value={config.destinations?.webhook?.retryDelaySeconds ?? 5}
                  onChange={(event) =>
                    updateNested(
                      ['destinations', 'webhook', 'retryDelaySeconds'],
                      parseInt(event.target.value || '5', 10)
                    )
                  }
                />
                <TextField
                  label="Timeout (seconds)"
                  type="number"
                  fullWidth
                  value={config.destinations?.webhook?.timeoutSeconds ?? 30}
                  onChange={(event) =>
                    updateNested(
                      ['destinations', 'webhook', 'timeoutSeconds'],
                      parseInt(event.target.value || '30', 10)
                    )
                  }
                />
              </Stack>
            ) : null}

            <FormControlLabel
              control={
                <Switch
                  checked={!!config.destinations?.googleSheets?.enabled}
                  onChange={(event) =>
                    updateNested(['destinations', 'googleSheets', 'enabled'], event.target.checked)
                  }
                />
              }
              label="Google Sheets"
            />
            {config.destinations?.googleSheets?.enabled ? (
              <Stack spacing={2}>
                <Alert severity="info">
                  Requires a Google account connection in Scout-X (Robots → Integrations for this automation).
                </Alert>
                <TextField
                  label="Spreadsheet ID"
                  fullWidth
                  value={config.destinations?.googleSheets?.spreadsheetId || ''}
                  onChange={(event) =>
                    updateNested(['destinations', 'googleSheets', 'spreadsheetId'], event.target.value)
                  }
                  helperText="Requires Google connection in Scout-X."
                />
                <TextField
                  label="Sheet Name"
                  fullWidth
                  value={config.destinations?.googleSheets?.sheetName || 'Sheet1'}
                  onChange={(event) =>
                    updateNested(['destinations', 'googleSheets', 'sheetName'], event.target.value)
                  }
                />
              </Stack>
            ) : null}

            <FormControlLabel
              control={
                <Switch
                  checked={!!config.destinations?.airtable?.enabled}
                  onChange={(event) => updateNested(['destinations', 'airtable', 'enabled'], event.target.checked)}
                />
              }
              label="Airtable"
            />
            {config.destinations?.airtable?.enabled ? (
              <Stack spacing={2}>
                <TextField
                  label="Airtable API Key"
                  type="password"
                  fullWidth
                  autoComplete="off"
                  value={config.destinations?.airtable?.apiKey || ''}
                  placeholder={airtableConfigured ? 'Leave blank to keep existing key' : ''}
                  helperText={airtableConfigured ? 'An API key is already stored. Leave blank to keep it.' : undefined}
                  onChange={(event) => updateNested(['destinations', 'airtable', 'apiKey'], event.target.value)}
                />
                <TextField
                  label="Airtable Base ID"
                  fullWidth
                  value={config.destinations?.airtable?.baseId || ''}
                  onChange={(event) => updateNested(['destinations', 'airtable', 'baseId'], event.target.value)}
                />
                <TextField
                  label="Airtable Table Name"
                  fullWidth
                  value={config.destinations?.airtable?.tableName || ''}
                  onChange={(event) => updateNested(['destinations', 'airtable', 'tableName'], event.target.value)}
                />
              </Stack>
            ) : null}

            <FormControlLabel
              control={
                <Switch
                  checked={!!config.destinations?.database?.enabled}
                  onChange={(event) => updateNested(['destinations', 'database', 'enabled'], event.target.checked)}
                />
              }
              label="External database"
            />
            {config.destinations?.database?.enabled ? (
              <Stack spacing={2}>
                <TextField
                  select
                  label="Database type"
                  fullWidth
                  value={config.destinations?.database?.type || 'postgres'}
                  onChange={(event) => updateNested(['destinations', 'database', 'type'], event.target.value)}
                >
                  <MenuItem value="postgres">Postgres</MenuItem>
                  <MenuItem value="mysql">MySQL</MenuItem>
                </TextField>
                <TextField
                  label="Connection string"
                  type="password"
                  fullWidth
                  autoComplete="off"
                  value={config.destinations?.database?.connectionString || ''}
                  placeholder={databaseConfigured ? 'Leave blank to keep existing connection string' : ''}
                  helperText={databaseConfigured ? 'A connection string is already stored. Leave blank to keep it.' : undefined}
                  onChange={(event) =>
                    updateNested(['destinations', 'database', 'connectionString'], event.target.value)
                  }
                />
                <TextField
                  label="Destination table"
                  fullWidth
                  value={config.destinations?.database?.tableName || 'scraped_rows'}
                  onChange={(event) => updateNested(['destinations', 'database', 'tableName'], event.target.value)}
                />
              </Stack>
            ) : null}
          </SectionPaper>

          <SectionPaper title="Data quality">
            <FormControlLabel
              control={
                <Switch
                  checked={!!config.dataCleanup?.removeEmptyRows}
                  onChange={(event) => updateNested(['dataCleanup', 'removeEmptyRows'], event.target.checked)}
                />
              }
              label="Remove empty rows"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={!!config.dataCleanup?.removeDuplicates}
                  onChange={(event) => updateNested(['dataCleanup', 'removeDuplicates'], event.target.checked)}
                />
              }
              label="Remove duplicates"
            />
          </SectionPaper>

          <SectionPaper
            title="Proxy"
            action={
              proxySavedChipLabel(proxyConfigured) ? (
                <Chip size="small" color="success" label={proxySavedChipLabel(proxyConfigured)} />
              ) : undefined
            }
          >
            <Typography variant="body2" color="text.secondary">
              Optional per-automation proxy. Values are not shown again after save (that is
              intentional). If you see the green Saved chip, Decodo is stored — leave the boxes
              empty and click Run. Only fill them again to replace credentials.{' '}
              {!proxyConfigured ? (
                <>
                  If empty, Scout-X falls back to your{' '}
                  <Link component={RouterLink} to="/proxy" underline="hover">
                    account proxy settings
                  </Link>
                  .
                </>
              ) : null}
            </Typography>
            {proxyConfigured ? (
              <Alert severity="success" sx={{ mb: 1 }}>
                Proxy is on this automation. Empty fields after refresh does not mean it was lost.
              </Alert>
            ) : null}
            <TextField
              label="Proxy server"
              fullWidth
              value={config.browserLocation?.proxyServer || ''}
              placeholder={proxyConfigured ? 'Leave blank to keep saved server' : 'http://gate.decodo.com:7000'}
              onChange={(event) => updateNested(['browserLocation', 'proxyServer'], event.target.value)}
            />
            <TextField
              label="Proxy username"
              fullWidth
              value={config.browserLocation?.proxyUsername || ''}
              placeholder={proxyConfigured ? 'Leave blank to keep saved username' : ''}
              onChange={(event) => updateNested(['browserLocation', 'proxyUsername'], event.target.value)}
            />
            <TextField
              label="Proxy password"
              type="password"
              fullWidth
              autoComplete="new-password"
              value={config.browserLocation?.proxyPassword || ''}
              placeholder={proxyConfigured ? 'Leave blank to keep existing password' : ''}
              onChange={(event) => updateNested(['browserLocation', 'proxyPassword'], event.target.value)}
            />
          </SectionPaper>

          <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Typography fontWeight={700}>Advanced</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2.5}>
                <Typography variant="subtitle2" fontWeight={700}>
                  Identity
                </Typography>
                <TextField
                  label="User agent"
                  fullWidth
                  value={config.userAgent || ''}
                  onChange={(event) => updateNested(['userAgent'], event.target.value)}
                />
                <TextField
                  label="Cookies (JSON array)"
                  fullWidth
                  multiline
                  minRows={3}
                  value={cookiesDraft}
                  helperText="Leave as [] to keep stored cookies."
                  onChange={(event) => setCookiesDraft(event.target.value)}
                />
                <TextField
                  label="Local storage (JSON object)"
                  fullWidth
                  multiline
                  minRows={3}
                  value={localStorageDraft}
                  helperText="Leave as {} to keep stored localStorage."
                  onChange={(event) => setLocalStorageDraft(event.target.value)}
                />

                <Typography variant="subtitle2" fontWeight={700}>
                  Row context
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Merged into every extracted row (also settable from the extension).
                </Typography>
                <TextField
                  label="Sector / industry"
                  fullWidth
                  value={config.rowContext?.sectorIndustry || ''}
                  onChange={(event) => updateNested(['rowContext', 'sectorIndustry'], event.target.value)}
                />
                <TextField
                  select
                  label="Fortune 500"
                  fullWidth
                  value={config.rowContext?.f500 || ''}
                  onChange={(event) => updateNested(['rowContext', 'f500'], event.target.value)}
                >
                  <MenuItem value="">Unset</MenuItem>
                  <MenuItem value="yes">Yes</MenuItem>
                  <MenuItem value="no">No</MenuItem>
                </TextField>

                <Typography variant="subtitle2" fontWeight={700}>
                  Overlays &amp; CAPTCHA
                </Typography>
                <FormControlLabel
                  control={
                    <Switch
                      checked={!!config.popups?.autoDismiss}
                      onChange={(event) => updateNested(['popups', 'autoDismiss'], event.target.checked)}
                    />
                  }
                  label="Auto-dismiss popups / overlays"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={!!config.popups?.acceptDialogs}
                      onChange={(event) => updateNested(['popups', 'acceptDialogs'], event.target.checked)}
                    />
                  }
                  label="Accept browser dialogs"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={!!config.captcha?.pauseOnDetect}
                      onChange={(event) => updateNested(['captcha', 'pauseOnDetect'], event.target.checked)}
                    />
                  }
                  label="Pause run when CAPTCHA is detected"
                />

                {configShowsRawListExtractionEditor() ? (
                <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Typography fontWeight={600}>Edit raw list extraction</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={2}>
                      <Alert severity="warning">
                        Saving changes here can be overwritten the next time you Send from the Chrome extension.
                        Prefer re-picking in the extension when possible.
                      </Alert>
                      <TextField
                        label="Item selector"
                        fullWidth
                        value={config.listExtraction?.itemSelector || ''}
                        onChange={(event) => {
                          markExtractionDirty();
                          updateNested(['listExtraction', 'itemSelector'], event.target.value);
                        }}
                        helperText="Example: .container > .item"
                      />
                      <TextField
                        label="Field mapping (JSON object)"
                        fullWidth
                        multiline
                        minRows={6}
                        value={fieldsDraft}
                        onChange={(event) => {
                          markExtractionDirty();
                          setFieldsDraft(event.target.value);
                        }}
                        helperText='Example: {"title":".job-title","location":".location","link":"a@href"}'
                      />
                      <TextField
                        label="Unique key"
                        fullWidth
                        value={config.listExtraction?.uniqueKey || ''}
                        onChange={(event) => {
                          markExtractionDirty();
                          updateNested(['listExtraction', 'uniqueKey'], event.target.value);
                        }}
                      />
                      <TextField
                        label="Max items"
                        type="number"
                        fullWidth
                        value={config.listExtraction?.maxItems ?? 100}
                        onChange={(event) => {
                          markExtractionDirty();
                          updateNested(
                            ['listExtraction', 'maxItems'],
                            parseInt(event.target.value || '100', 10)
                          );
                        }}
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={!!config.listExtraction?.autoScroll}
                            onChange={(event) => {
                              markExtractionDirty();
                              updateNested(['listExtraction', 'autoScroll'], event.target.checked);
                            }}
                          />
                        }
                        label="Auto scroll list pages"
                      />
                      <TextField
                        label="Scroll delay (ms)"
                        type="number"
                        fullWidth
                        value={config.listExtraction?.scrollDelayMs ?? 1200}
                        onChange={(event) => {
                          markExtractionDirty();
                          updateNested(
                            ['listExtraction', 'scrollDelayMs'],
                            parseInt(event.target.value || '1200', 10)
                          );
                        }}
                      />
                      <TextField
                        label="Max scroll iterations"
                        type="number"
                        fullWidth
                        value={config.listExtraction?.maxScrollIterations ?? 10}
                        onChange={(event) => {
                          markExtractionDirty();
                          updateNested(
                            ['listExtraction', 'maxScrollIterations'],
                            parseInt(event.target.value || '10', 10)
                          );
                        }}
                      />
                      <TextField
                        select
                        label="List pagination"
                        fullWidth
                        value={config.listExtraction?.pagination?.mode || 'none'}
                        onChange={(event) => {
                          markExtractionDirty();
                          updateNested(['listExtraction', 'pagination', 'mode'], event.target.value);
                        }}
                      >
                        <MenuItem value="none">None</MenuItem>
                        <MenuItem value="next-button">Next button click</MenuItem>
                        <MenuItem value="infinite-scroll">Infinite scroll</MenuItem>
                        <MenuItem value="page-number-loop">Page number loop</MenuItem>
                      </TextField>
                      <TextField
                        label="Next button selector"
                        fullWidth
                        value={config.listExtraction?.pagination?.nextButtonSelector || ''}
                        onChange={(event) => {
                          markExtractionDirty();
                          updateNested(
                            ['listExtraction', 'pagination', 'nextButtonSelector'],
                            event.target.value
                          );
                        }}
                      />
                      <TextField
                        label="Max pages"
                        type="number"
                        fullWidth
                        value={config.listExtraction?.pagination?.maxPages ?? 5}
                        onChange={(event) => {
                          markExtractionDirty();
                          updateNested(
                            ['listExtraction', 'pagination', 'maxPages'],
                            parseInt(event.target.value || '5', 10)
                          );
                        }}
                      />
                      <TextField
                        label="Start page"
                        type="number"
                        fullWidth
                        value={config.listExtraction?.pagination?.startPage ?? 0}
                        onChange={(event) => {
                          markExtractionDirty();
                          updateNested(
                            ['listExtraction', 'pagination', 'startPage'],
                            parseInt(event.target.value || '0', 10)
                          );
                        }}
                      />
                      <TextField
                        label="Page query param"
                        fullWidth
                        value={config.listExtraction?.pagination?.pageParam || 'page'}
                        onChange={(event) => {
                          markExtractionDirty();
                          updateNested(['listExtraction', 'pagination', 'pageParam'], event.target.value);
                        }}
                      />
                    </Stack>
                  </AccordionDetails>
                </Accordion>
                ) : null}
              </Stack>
            </AccordionDetails>
          </Accordion>

          <Stack direction="row" justifyContent="flex-end" spacing={1} pt={1}>
            <Button variant="outlined" onClick={close}>
              Cancel
            </Button>
            <Button variant="contained" onClick={handleSave} disabled={saving || !loaded}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
};

import React, { useState, useEffect } from 'react';
import scoutLogo from './scoutx-logo.png';
import { useExtensionState, useSendMessage } from './hooks/useExtensionState';
import { MSG } from '../shared/messages';
import { ToolSelector } from './components/ToolSelector';
import { ListExtractorTool } from './components/list/ListExtractorTool';
import { TableExtractorTool } from './components/table/TableExtractorTool';
import { TextExtractorTool } from './components/text/TextExtractorTool';
import type { ToolType } from '../shared/types';
import { configScheduleFromDraft } from '../shared/types';
import { ExtensionScheduleForm, EXTENSION_SCHEDULE_OPTIONS, isValidCron } from './components/ExtensionScheduleForm';

export function App() {
  const { state, loading } = useExtensionState();
  const sendMessage = useSendMessage();
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [backendUrlDraft, setBackendUrlDraft] = useState('');
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [scheduleApplyOk, setScheduleApplyOk] = useState(false);

  useEffect(() => {
    if (!loading) {
      setBackendUrlDraft(state.backendUrl);
      setApiKeyDraft(state.apiKey);
    }
  }, [loading, state.backendUrl, state.apiKey]);

  const handleToolSelect = async (tool: ToolType) => {
    try {
      setError(null);
      await sendMessage(MSG.SET_TOOL, { tool });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set tool');
    }
  };

  const handleBack = async () => {
    try {
      await sendMessage(MSG.RESET_STATE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset');
    }
  };

  const handleApplyScheduleNow = async () => {
    const id = state.list.savedAutomation?.id;
    if (!id) return;
    const sched = configScheduleFromDraft(state.list.cloudScheduleDraft);
    if (sched.enabled && sched.cron) {
      const isPreset = EXTENSION_SCHEDULE_OPTIONS.some(
        (o) => typeof o.cron === 'string' && o.cron === sched.cron
      );
      if (!isPreset && !isValidCron(sched.cron)) {
        setError('Fix the custom cron expression before applying.');
        return;
      }
    }
    try {
      setError(null);
      await sendMessage(MSG.SET_SCHEDULE, {
        automationId: id,
        schedule: configScheduleFromDraft(state.list.cloudScheduleDraft),
      });
      setScheduleApplyOk(true);
      setTimeout(() => setScheduleApplyOk(false), 2000);
      await sendMessage(MSG.GET_AUTOMATION_STATUS, { automationId: id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply schedule');
    }
  };

  const handleSaveSettings = async () => {
    try {
      setError(null);
      const url = backendUrlDraft.trim();
      if (!url) {
        setError('API base URL is required (e.g. https://firststep-jobscraper-backend.onrender.com/api)');
        return;
      }
      await sendMessage(MSG.SET_EXTENSION_SETTINGS, {
        backendUrl: url,
        apiKey: apiKeyDraft,
      });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    }
  };

  if (loading) {
    return <div style={styles.loading}>Loading...</div>;
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        {state.activeTool !== 'none' && (
          <button onClick={handleBack} style={styles.backBtn}>
            ←
          </button>
        )}
        <div style={styles.logo}>
          <img src={scoutLogo} alt="" style={styles.logoImg} />
          <div>
            <div style={styles.logoTitle}>Scout-X Scrapper</div>
            <div style={styles.logoSub}>List · table · page extraction</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSettingsOpen((o) => !o)}
          style={styles.gearBtn}
          title="Connection settings"
          aria-expanded={settingsOpen}
        >
          ⚙
        </button>
      </div>

      {settingsOpen && (
        <div style={styles.settingsPanel}>
          <div style={styles.settingsTitle}>Connection</div>
          <label style={styles.settingsLabel}>
            API base URL
            <input
              style={styles.settingsInput}
              value={backendUrlDraft}
              onChange={(e) => setBackendUrlDraft(e.target.value)}
              placeholder="https://firststep-jobscraper-backend.onrender.com/api"
              autoComplete="off"
            />
          </label>
          <p style={styles.settingsHint}>
            Same URL as your Scout-X dashboard API (include <code style={styles.inlineCode}>/api</code>).
          </p>
          <label style={styles.settingsLabel}>
            API key (optional)
            <input
              style={styles.settingsInput}
              type="password"
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              placeholder="From Dashboard → API key"
              autoComplete="off"
            />
          </label>
          <p style={styles.settingsHint}>
            Recommended for the extension. Leave empty only if you rely on being logged in on the same host.
          </p>
          <button type="button" onClick={handleSaveSettings} style={styles.settingsSaveBtn}>
            {settingsSaved ? 'Saved' : 'Save connection'}
          </button>

          {state.activeTool === 'list' && (
            <>
              <div style={{ ...styles.settingsTitle, marginTop: 18 }}>List · cloud schedule</div>
              <p style={styles.settingsHint}>
                Optional recurring runs on Scout-X. Same draft as in the list tool; applied when you send or via the
                button below.
              </p>
              <ExtensionScheduleForm
                compact
                value={state.list.cloudScheduleDraft}
                onChange={async (d) => {
                  try {
                    setError(null);
                    await sendMessage(MSG.UPDATE_CLOUD_SCHEDULE_DRAFT, { draft: d });
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Failed to update schedule');
                  }
                }}
              />
              {state.list.savedAutomation?.id ? (
                <button type="button" onClick={() => void handleApplyScheduleNow()} style={styles.settingsSecondaryBtn}>
                  {scheduleApplyOk ? 'Applied' : 'Apply schedule to server now'}
                </button>
              ) : (
                <p style={{ ...styles.settingsHint, marginBottom: 0 }}>
                  Save an automation from the list tool first to push schedule changes immediately.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={styles.error}>
          {error}
          <button onClick={() => setError(null)} style={styles.errorClose}>×</button>
        </div>
      )}

      {/* Content */}
      <div style={styles.content}>
        {state.activeTool === 'none' && (
          <ToolSelector onSelect={handleToolSelect} />
        )}

        {state.activeTool === 'list' && (
          <ListExtractorTool state={state.list} sendMessage={sendMessage} />
        )}

        {state.activeTool === 'table' && (
          <TableExtractorTool state={state.table} sendMessage={sendMessage} />
        )}

        {state.activeTool === 'text' && (
          <TextExtractorTool state={state.text} sendMessage={sendMessage} />
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(165deg, #061a22 0%, #0a1620 42%, #0c1118 100%)',
    color: '#e7ecf1',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    color: '#94a3b8',
    fontSize: 14,
    letterSpacing: '0.02em',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    borderBottom: '1px solid rgba(14, 116, 144, 0.35)',
    background: 'rgba(2, 51, 69, 0.55)',
    backdropFilter: 'blur(10px)',
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: '#9ca3af',
    fontSize: 20,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 6,
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  logoImg: {
    width: 40,
    height: 40,
    borderRadius: 10,
    objectFit: 'contain',
    flexShrink: 0,
    boxShadow: '0 0 0 1px rgba(34, 211, 238, 0.25)',
    background: 'rgba(0,0,0,0.25)',
  },
  logoTitle: {
    fontWeight: 700,
    fontSize: 15,
    color: '#f8fafc',
    letterSpacing: '0.02em',
  },
  logoSub: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  gearBtn: {
    marginLeft: 'auto',
    background: 'rgba(15, 23, 42, 0.85)',
    border: '1px solid rgba(34, 211, 238, 0.35)',
    borderRadius: 10,
    color: '#e2e8f0',
    fontSize: 18,
    cursor: 'pointer',
    padding: '6px 10px',
    lineHeight: 1,
  },
  settingsPanel: {
    padding: '14px 16px',
    borderBottom: '1px solid rgba(14, 116, 144, 0.25)',
    background: 'rgba(6, 26, 34, 0.92)',
  },
  settingsTitle: {
    fontWeight: 600,
    fontSize: 13,
    marginBottom: 10,
    color: '#f9fafb',
  },
  settingsLabel: {
    display: 'block',
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 8,
  },
  settingsInput: {
    display: 'block',
    width: '100%',
    marginTop: 4,
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid rgba(51, 65, 85, 0.9)',
    background: 'rgba(15, 23, 42, 0.75)',
    color: '#e2e8f0',
    fontSize: 12,
    boxSizing: 'border-box',
  },
  settingsHint: {
    fontSize: 11,
    color: '#6b7280',
    margin: '0 0 10px',
    lineHeight: 1.4,
  },
  inlineCode: {
    background: '#1f1f1f',
    padding: '1px 4px',
    borderRadius: 4,
    fontSize: 11,
  },
  settingsSaveBtn: {
    marginTop: 6,
    padding: '9px 16px',
    borderRadius: 10,
    border: 'none',
    background: 'linear-gradient(135deg, #0e7490 0%, #0369a1 100%)',
    color: '#fff',
    fontWeight: 600,
    fontSize: 12,
    cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(14, 116, 144, 0.35)',
  },
  settingsSecondaryBtn: {
    marginTop: 10,
    padding: '9px 16px',
    borderRadius: 10,
    border: '1px solid rgba(167, 139, 250, 0.45)',
    background: 'rgba(88, 28, 135, 0.35)',
    color: '#e9d5ff',
    fontWeight: 600,
    fontSize: 12,
    cursor: 'pointer',
  },
  error: {
    margin: '8px 16px',
    padding: '8px 12px',
    background: '#7f1d1d',
    borderRadius: 8,
    fontSize: 12,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorClose: {
    background: 'none',
    border: 'none',
    color: '#fca5a5',
    fontSize: 16,
    cursor: 'pointer',
  },
  content: {
    padding: '16px 16px 24px',
  },
};

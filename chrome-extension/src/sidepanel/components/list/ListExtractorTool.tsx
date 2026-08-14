import React, { useState, useCallback, useEffect } from 'react';
import { MSG } from '../../../shared/messages';
import type { ListExtractionState, FieldConfig, SemanticType, PaginationConfig, CloudScheduleDraft, RowContextDraft } from '../../../shared/types';
import { configScheduleFromDraft } from '../../../shared/types';
import { ExtensionScheduleForm, EXTENSION_SCHEDULE_OPTIONS, isValidCron } from '../ExtensionScheduleForm';
import { ExtensionSchedulePicker } from '../ExtensionSchedulePicker';
import { ExtensionTagPicker } from '../ExtensionTagPicker';

interface Props {
  state: ListExtractionState;
  sendMessage: (type: string, payload?: any) => Promise<any>;
}

const SEMANTIC_TYPES: SemanticType[] = [
  'title', 'company', 'description', 'price', 'date',
  'location', 'url', 'image', 'rating', 'category', 'unknown',
  'companyUrl', 'employmentType', 'qualifications', 'responsibilities',
  'skills', 'benefits', 'experience', 'education', 'industry', 'remote', 'currency',
];

const ATTRIBUTE_OPTIONS = [
  { value: 'innerText', label: 'Text' },
  { value: 'href', label: 'Link (href)' },
  { value: 'src', label: 'Image (src)' },
  { value: 'innerHTML', label: 'HTML' },
  { value: 'fixed', label: 'Fixed Value' },
];

const SEMANTIC_ICONS: Record<SemanticType, string> = {
  title: 'T', company: 'C', description: 'D', price: '$', date: '📅',
  location: '📍', url: '🔗', image: '🖼', rating: '★', category: '#', unknown: '?',
  companyUrl: '🌐', employmentType: '⏰', qualifications: '🎓', responsibilities: '📋',
  skills: '🔧', benefits: '🎁', experience: '💼', education: '🎓', industry: '🏢',
  remote: '🏠', currency: '💰',
};

const SAVE_TO_BACKEND_TIMEOUT_MS = 90_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `${label} (${Math.round(ms / 1000)}s). Check API base URL, API key, network, and that the server is running.`
        )
      );
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }) as Promise<T>;
}

function scheduleSummaryText(draft: ListExtractionState['cloudScheduleDraft']): string {
  const s = configScheduleFromDraft(draft);
  if (!s.enabled || !s.cron) return 'Cloud schedule: Off (recurring runs only after you turn one on below)';
  const label =
    EXTENSION_SCHEDULE_OPTIONS.find((o) => typeof o.cron === 'string' && o.cron === s.cron)?.label ||
    `Custom ${s.cron}`;
  return `Cloud schedule: ${label} · ${s.timezone}`;
}

const TYPE_COLORS: Record<SemanticType, { bg: string; text: string }> = {
  title:    { bg: '#3b82f622', text: '#93c5fd' },
  company:   { bg: '#8b5cf622', text: '#c4b5fd' },
  description: { bg: '#6b728022', text: '#9ca3af' },
  price:    { bg: '#22c55e22', text: '#4ade80' },
  date:     { bg: '#f59e0b22', text: '#fbbf24' },
  location: { bg: '#06b6d422', text: '#22d3ee' },
  url:      { bg: '#6366f122', text: '#a5b4fc' },
  image:    { bg: '#ec489922', text: '#f472b6' },
  rating:   { bg: '#eab30822', text: '#facc15' },
  category: { bg: '#14b8a622', text: '#2dd4bf' },
  unknown:  { bg: '#6b728022', text: '#9ca3af' },
  companyUrl: { bg: '#6366f122', text: '#a5b4fc' },
  employmentType: { bg: '#f59e0b22', text: '#fbbf24' },
  qualifications: { bg: '#8b5cf622', text: '#c4b5fd' },
  responsibilities: { bg: '#3b82f622', text: '#93c5fd' },
  skills: { bg: '#14b8a622', text: '#2dd4bf' },
  benefits: { bg: '#22c55e22', text: '#4ade80' },
  experience: { bg: '#f59e0b22', text: '#fbbf24' },
  education: { bg: '#8b5cf622', text: '#c4b5fd' },
  industry: { bg: '#6b728022', text: '#9ca3af' },
  remote: { bg: '#06b6d422', text: '#22d3ee' },
  currency: { bg: '#22c55e22', text: '#4ade80' },
};

export function ListExtractorTool({ state, sendMessage }: Props) {
  const [error, setError] = useState<string | null>(null);
  const persistedAutomationId = state.savedAutomation?.id || null;
  const [localAutomationId, setLocalAutomationId] = useState<string | null>(null);
  const savedBackendAutomationId = persistedAutomationId || localAutomationId;
  const [showAddField, setShowAddField] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editedFields, setEditedFields] = useState<Record<string, FieldConfig>>({});
  const [newField, setNewField] = useState<FieldConfig>({
    selector: '',
    attribute: 'innerText',
    label: '',
    semanticType: 'unknown',
  });

  const [editPagination, setEditPagination] = useState(false);
  const [editPaginationData, setEditPaginationData] = useState<PaginationConfig | null>(null);

  const [showSendToMaxunModal, setShowSendToMaxunModal] = useState(false);
  const [sendToMaxunName, setSendToMaxunName] = useState('');
  const [sendToMaxunScoutId, setSendToMaxunScoutId] = useState('');
  const [sendToMaxunCompany, setSendToMaxunCompany] = useState('');
  const [sendToMaxunTags, setSendToMaxunTags] = useState<string[]>([]);
  const [sendToMaxunError, setSendToMaxunError] = useState<string | null>(null);
  const [sendToMaxunSubmitting, setSendToMaxunSubmitting] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<{
    id: string;
    scoutId?: string | null;
    name?: string;
    targetUrl?: string;
  } | null>(null);

  const getFields = useCallback(() => {
    return editingField ? editedFields : state.fields;
  }, [state.fields, editedFields, editingField]);

  const handleStartSelection = async () => {
    try {
      setError(null);
      await sendMessage(MSG.START_LIST_MODE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start selection');
    }
  };

  const handleStopSelection = async () => {
    try {
      await sendMessage(MSG.STOP_SELECTION);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop');
    }
  };

  const handleStartExtraction = async () => {
    try {
      setError(null);
      await sendMessage(MSG.RUN_EXTRACTION);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed');
    }
  };

  const handleCancelExtraction = async () => {
    try {
      await sendMessage(MSG.CANCEL_EXTRACTION);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel');
    }
  };

  const handleOpenDataTable = async () => {
    try {
      await sendMessage(MSG.OPEN_DATA_TABLE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open data table');
    }
  };

  const handleExportCSV = async () => {
    try {
      const csv = rowsToCSV(state.extractedRows);
      await sendMessage(MSG.EXPORT_CSV, { data: csv, filename: 'scoutx-export.csv' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const handleExportJSON = async () => {
    try {
      const json = JSON.stringify(state.extractedRows, null, 2);
      await sendMessage(MSG.EXPORT_JSON, { data: json, filename: 'scoutx-export.json' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const makeUniqueAutomationName = useCallback(() => {
    return `Scout-X scrape (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`;
  }, []);

  const handleScheduleDraftChange = async (next: CloudScheduleDraft) => {
    try {
      setError(null);
      await sendMessage(MSG.UPDATE_CLOUD_SCHEDULE_DRAFT, { draft: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update schedule draft');
    }
  };

  const openSendToMaxunModal = useCallback(() => {
    const savedName = state.savedAutomation?.name?.trim();
    setSendToMaxunName(
      savedBackendAutomationId && savedName ? savedName : makeUniqueAutomationName()
    );
    setSendToMaxunScoutId(
      (state.savedAutomation?.scoutId || '').toString().trim().toUpperCase()
    );
    setSendToMaxunCompany((state.savedAutomation?.companyName || '').toString());
    setPendingUpdate(null);
    setSendToMaxunError(null);
    setShowSendToMaxunModal(true);
  }, [
    savedBackendAutomationId,
    state.savedAutomation?.name,
    state.savedAutomation?.scoutId,
    state.savedAutomation?.companyName,
    makeUniqueAutomationName,
  ]);

  const finishSaveSuccess = (response: any) => {
    setShowSendToMaxunModal(false);
    setPendingUpdate(null);
    const automationId =
      response?.automationId ||
      response?.result?.automation?.id ||
      response?.result?.id ||
      response?.automation?.id ||
      null;
    if (automationId) {
      setLocalAutomationId(automationId);
      void sendMessage(MSG.GET_AUTOMATION_STATUS, { automationId }).catch(() => undefined);
    }
  };

  const performSave = async (opts: {
    automationId?: string;
    scoutId?: string;
    elementsOnly?: boolean;
  }) => {
    const trimmed = sendToMaxunName.trim();
    const fieldsToSave = editingField ? editedFields : state.fields;
    const response = await withTimeout(
      sendMessage(MSG.SAVE_TO_BACKEND, {
        automationId: opts.automationId,
        scoutId: opts.scoutId || undefined,
        automationName: trimmed,
        companyName: sendToMaxunCompany.trim(),
        tags: sendToMaxunTags,
        listSelector: state.listSelector,
        fields: fieldsToSave,
        pagination: state.pagination,
        previewRows: state.previewRows,
        previewUrl: state.previewUrl,
        rowContext: state.rowContext,
        elementsOnly: opts.elementsOnly === true,
      }),
      SAVE_TO_BACKEND_TIMEOUT_MS,
      'Save to Scout-X'
    );
    finishSaveSuccess(response);
  };

  const handleSaveToBackend = async () => {
    const trimmed = sendToMaxunName.trim();
    if (!trimmed) {
      setSendToMaxunError('Enter a name for this automation.');
      return;
    }
    if (!sendToMaxunCompany.trim()) {
      setSendToMaxunError('Company name is required.');
      return;
    }
    if (trimmed.length > 200) {
      setSendToMaxunError('Use 200 characters or fewer.');
      return;
    }
    const scoutDraft = sendToMaxunScoutId.trim().toUpperCase();
    if (scoutDraft && !/^SX\d{2}[A-Z]{2}\d{2}$/.test(scoutDraft)) {
      setSendToMaxunError('Scout-X ID must look like SX12AB34 (SX + 2 digits + 2 letters + 2 digits).');
      return;
    }
    try {
      setSendToMaxunSubmitting(true);
      setSendToMaxunError(null);
      setError(null);
      const sched = configScheduleFromDraft(state.cloudScheduleDraft);
      if (sched.enabled && sched.cron) {
        const isPreset = EXTENSION_SCHEDULE_OPTIONS.some(
          (o) => typeof o.cron === 'string' && o.cron === sched.cron
        );
        if (!isPreset && !isValidCron(sched.cron)) {
          setSendToMaxunError('Fix the custom cron expression before sending.');
          setSendToMaxunSubmitting(false);
          return;
        }
      }

      // Already bound to a backend robot in this session → normal full update.
      if (savedBackendAutomationId && !scoutDraft) {
        await performSave({ automationId: savedBackendAutomationId });
        return;
      }

      // Typed Scout-X ID: update that robot (elements only) or create with reuse after delete.
      if (scoutDraft) {
        const lookup = await sendMessage(MSG.LOOKUP_AUTOMATION, { scoutId: scoutDraft });
        const found = lookup?.result?.found && lookup?.result?.automation;
        if (found) {
          setPendingUpdate({
            id: lookup.result.automation.id,
            scoutId: lookup.result.automation.scoutId || scoutDraft,
            name: lookup.result.automation.name,
            targetUrl: lookup.result.automation.targetUrl,
          });
          setSendToMaxunSubmitting(false);
          return;
        }
        await performSave({ scoutId: scoutDraft });
        return;
      }

      // No ID: check exact target URL for duplicates before create.
      const previewUrl = state.previewUrl;
      if (previewUrl && /^https?:\/\//i.test(previewUrl)) {
        const lookup = await sendMessage(MSG.LOOKUP_AUTOMATION, { url: previewUrl });
        const found = lookup?.result?.found && lookup?.result?.automation;
        if (found) {
          const auto = lookup.result.automation;
          setSendToMaxunScoutId((auto.scoutId || '').toString().toUpperCase());
          setPendingUpdate({
            id: auto.id,
            scoutId: auto.scoutId,
            name: auto.name,
            targetUrl: auto.targetUrl,
          });
          setSendToMaxunSubmitting(false);
          return;
        }
      }

      await performSave({});
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      const code = (err as any)?.code;
      const automation = (err as any)?.automation;
      if (
        (code === 'DUPLICATE_TARGET_URL' || code === 'SCOUT_ID_EXISTS') &&
        automation?.id
      ) {
        setSendToMaxunScoutId((automation.scoutId || '').toString().toUpperCase());
        setPendingUpdate({
          id: automation.id,
          scoutId: automation.scoutId,
          name: automation.name,
          targetUrl: automation.targetUrl,
        });
        setSendToMaxunError(null);
      } else {
        setSendToMaxunError(msg);
      }
    } finally {
      setSendToMaxunSubmitting(false);
    }
  };

  const handleConfirmUpdate = async () => {
    if (!pendingUpdate?.id) return;
    try {
      setSendToMaxunSubmitting(true);
      setSendToMaxunError(null);
      await performSave({
        automationId: pendingUpdate.id,
        scoutId: pendingUpdate.scoutId || sendToMaxunScoutId.trim().toUpperCase() || undefined,
        elementsOnly: true,
      });
    } catch (err) {
      setSendToMaxunError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSendToMaxunSubmitting(false);
    }
  };

  const handleRunNow = async () => {
    if (!savedBackendAutomationId) return;
    try {
      setError(null);
      await sendMessage(MSG.RUN_AUTOMATION_NOW, { automationId: savedBackendAutomationId });
      // Give the backend a beat, then refresh status
      setTimeout(() => {
        sendMessage(MSG.GET_AUTOMATION_STATUS, { automationId: savedBackendAutomationId }).catch(() => undefined);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger run');
    }
  };

  const handleStatusRefresh = useCallback(async () => {
    if (!savedBackendAutomationId) return;
    try {
      await sendMessage(MSG.GET_AUTOMATION_STATUS, { automationId: savedBackendAutomationId });
    } catch {
      /* non-fatal */
    }
  }, [savedBackendAutomationId, sendMessage]);

  useEffect(() => {
    if (!savedBackendAutomationId) return;
    handleStatusRefresh();
  }, [savedBackendAutomationId, handleStatusRefresh]);

  const handleUpdateFields = async (fields: Record<string, FieldConfig>) => {
    try {
      await sendMessage(MSG.UPDATE_FIELDS, { fields });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update fields');
    }
  };

  const handleUpdatePagination = async (pagination: PaginationConfig) => {
    try {
      await sendMessage(MSG.UPDATE_PAGINATION, { pagination });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update pagination');
    }
  };

  const handleRowContextChange = async (patch: Partial<RowContextDraft>) => {
    try {
      const cur = state.rowContext || { sectorIndustry: '', f500: false };
      await sendMessage(MSG.UPDATE_ROW_CONTEXT, { rowContext: { ...cur, ...patch } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update metadata');
    }
  };

  const startEditPagination = () => {
    setEditPaginationData({ ...state.pagination });
    setEditPagination(true);
  };

  const savePagination = async () => {
    if (editPaginationData) {
      await handleUpdatePagination(editPaginationData);
    }
    setEditPagination(false);
    setEditPaginationData(null);
  };

  const cancelPaginationEdit = () => {
    setEditPagination(false);
    setEditPaginationData(null);
  };

  const updatePagField = <K extends keyof PaginationConfig>(key: K, value: PaginationConfig[K]) => {
    if (!editPaginationData) return;
    setEditPaginationData({ ...editPaginationData, [key]: value });
  };

  const handlePickElement = async (callback: (selector: string) => void) => {
    try {
      const response = await sendMessage(MSG.PICK_ELEMENT);
      if (response?.selector) {
        callback(response.selector);
      }
    } catch {
      // silently fail — pick mode cancelled or page reload
    }
  };

  const startEditing = (fieldName: string) => {
    setEditingField(fieldName);
    setEditedFields({ ...state.fields });
  };

  const cancelEditing = () => {
    setEditingField(null);
    setEditedFields({});
  };

  const saveEditing = async () => {
    await handleUpdateFields(editedFields);
    setEditingField(null);
    setEditedFields({});
  };

  const updateEditedField = (name: string, patch: Partial<FieldConfig>) => {
    const updated = { ...editedFields };
    updated[name] = { ...updated[name], ...patch };
    setEditedFields(updated);
  };

  const deleteField = async (name: string) => {
    const updated = { ...editedFields };
    delete updated[name];
    setEditedFields(updated);
    await handleUpdateFields(updated);
  };

  const addField = async () => {
    if (!newField.label.trim() || !newField.selector.trim()) {
      setError('Field name and selector are required');
      return;
    }
    const existing = editingField ? editedFields : state.fields;
    const updated = { ...existing, [newField.label.trim()]: { ...newField, label: newField.label.trim() } };
    await handleUpdateFields(updated);
    setEditedFields(updated);
    setEditingField('new');
    setNewField({ selector: '', attribute: 'innerText', label: '', semanticType: 'unknown' });
    setShowAddField(false);
  };

  const previewRows = state.previewRows;

  return (
    <div>
      <h2 style={styles.heading}>List Extractor</h2>

      {error && <div style={styles.error}>{error}</div>}

      {/* Step 1: Select List */}
      {(state.phase === 'idle' || state.phase === 'selecting') && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Select List</h3>
          <p style={styles.desc}>
            Click <strong>two example items</strong> in the list you want to extract.
            The extension will find all similar items automatically.
          </p>
          {state.phase === 'idle' ? (
            <button onClick={handleStartSelection} style={styles.primaryBtn}>
              Select List
            </button>
          ) : (
            <div>
              <div style={styles.statusBadge}>
                Click the first item, then click a second similar item
              </div>
              <button onClick={handleStopSelection} style={styles.secondaryBtn}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Configure Fields */}
      {state.phase === 'configuring' && (
        <div>
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>List Detected</h3>
            <div style={styles.pill}>{state.itemCount} items found</div>
            <div style={styles.selectorPreview}>
              <label style={styles.label}>Selector</label>
              <code style={styles.code}>{state.listSelector}</code>
            </div>
          </div>

          {/* Field Editor */}
          <div style={{ ...styles.card, marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ ...styles.cardTitle, marginBottom: 0 }}>Fields</h3>
              <div style={{ display: 'flex', gap: 6 }}>
                {editingField ? (
                  <>
                    <button onClick={saveEditing} style={styles.saveBtn}>Save</button>
                    <button onClick={cancelEditing} style={styles.cancelBtn}>Cancel</button>
                  </>
                ) : (
                  <button onClick={() => { startEditing('bulk'); setEditedFields({ ...state.fields }); }} style={styles.editBtn}>
                    Edit
                  </button>
                )}
                <button onClick={() => setShowAddField(true)} style={styles.addBtn}>
                  + Add Field
                </button>
              </div>
            </div>

            {Object.keys(getFields()).length === 0 ? (
              <div style={styles.muted}>No fields detected. Click "Edit" then "Add Field" to define one.</div>
            ) : (
              <div style={styles.fieldList}>
                {Object.entries(getFields()).map(([key, field]) => (
                  <EditableFieldRow
                    key={key}
                    name={key}
                    field={field}
                    isEditing={editingField !== null}
                    onUpdate={(patch) => {
                      const updated = { ...editedFields, [key]: { ...field, ...patch } };
                      setEditedFields(updated);
                    }}
                    onDelete={() => deleteField(key)}
                  />
                ))}
              </div>
            )}

            {editingField && (
              <button onClick={saveEditing} style={{ ...styles.primaryBtn, marginTop: 8, width: '100%' }}>
                Save Changes
              </button>
            )}
          </div>

          {/* Add Field Modal */}
          {showAddField && (
            <div style={styles.modalOverlay} onClick={() => setShowAddField(false)}>
              <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                <h3 style={styles.modalTitle}>Add Custom Field</h3>

                <label style={styles.label}>Field Name *</label>
                <input
                  style={styles.input}
                  placeholder="e.g. price, title, image"
                  value={newField.label}
                  onChange={(e) => setNewField({ ...newField, label: e.target.value })}
                />

                <label style={styles.label}>Selector *</label>
                <input
                  style={styles.input}
                  placeholder="e.g. .price, [data-testid=amount], h2"
                  value={newField.selector}
                  onChange={(e) => setNewField({ ...newField, selector: e.target.value })}
                />

                <label style={styles.label}>Extract As</label>
                <select
                  style={styles.select}
                  value={newField.attribute}
                  onChange={(e) => setNewField({ ...newField, attribute: e.target.value })}
                >
                  {ATTRIBUTE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>

                <label style={styles.label}>Semantic Type</label>
                <select
                  style={styles.select}
                  value={newField.semanticType}
                  onChange={(e) => setNewField({ ...newField, semanticType: e.target.value as SemanticType })}
                >
                  {SEMANTIC_TYPES.map((t) => (
                    <option key={t} value={t}>{SEMANTIC_ICONS[t]} {t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button onClick={addField} style={styles.saveBtn}>Add Field</button>
                  <button onClick={() => setShowAddField(false)} style={styles.cancelBtn}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {/* Job Metadata (sectorIndustry + f500) */}
          <div style={{ ...styles.card, marginTop: 8 }}>
            <h3 style={styles.cardTitle}>Job Metadata</h3>
            <p style={{ ...styles.muted, fontSize: 11, marginBottom: 10 }}>
              These fields are saved with the automation and applied to every extracted row.
              They are not scraped from the page.
            </p>
            <label style={styles.label}>Sector / Industry</label>
            <input
              style={styles.input}
              placeholder="e.g. Healthcare, Banking, Technology"
              value={state.rowContext?.sectorIndustry ?? ''}
              onChange={(e) => handleRowContextChange({ sectorIndustry: e.target.value })}
            />
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '4px 0' }}
              onClick={() => handleRowContextChange({ f500: !(state.rowContext?.f500 ?? false) })}
            >
              <div
                style={{
                  width: 36,
                  height: 20,
                  borderRadius: 10,
                  background: state.rowContext?.f500 ? '#0e7490' : '#333',
                  position: 'relative',
                  transition: 'background 0.2s',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: '#fff',
                    position: 'absolute',
                    top: 2,
                    left: state.rowContext?.f500 ? 18 : 2,
                    transition: 'left 0.2s',
                  }}
                />
              </div>
              <span style={{ fontSize: 12, color: '#d1d5db', fontWeight: 600 }}>
                Fortune 500 (F500)
              </span>
            </div>
          </div>

          {/* Pagination & Auto-Scroll */}
          <div style={{ ...styles.card, marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ ...styles.cardTitle, marginBottom: 0 }}>Pagination & Auto-Scroll</h3>
              {editPagination ? (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={savePagination} style={styles.saveBtn}>Save</button>
                  <button onClick={cancelPaginationEdit} style={styles.cancelBtn}>Cancel</button>
                </div>
              ) : (
                <button onClick={startEditPagination} style={styles.editBtn}>Configure</button>
              )}
            </div>

            {editPagination && editPaginationData ? (
              <PaginationEditor
                pagination={editPaginationData}
                onChange={updatePagField}
                onPickElement={(callback) => handlePickElement(callback)}
              />
            ) : (
              <PaginationSummary pagination={state.pagination} />
            )}
          </div>

          {/* Preview */}
          {previewRows.length > 0 && (
            <div style={{ ...styles.card, marginTop: 8 }}>
              <h3 style={styles.cardTitle}>Preview ({previewRows.length} rows)</h3>
              {state.previewUrl ? (
                <p style={{ fontSize: 12, color: '#5f6368', margin: '0 0 8px', lineHeight: 1.4 }}>
                  Scheduled runs will open:{' '}
                  <code style={{ wordBreak: 'break-all' }}>{state.previewUrl}</code>
                  {!/[?#]/.test(state.previewUrl) ? (
                    <> Filters that don’t change the URL may not apply on scheduled runs.</>
                  ) : null}
                </p>
              ) : (
                <p style={{ fontSize: 12, color: '#5f6368', margin: '0 0 8px', lineHeight: 1.4 }}>
                  Filters that don’t change the page URL may not apply on scheduled runs.
                </p>
              )}
              <div style={styles.previewTable}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      {Object.keys(previewRows[0]).map((h) => (
                        <th key={h} style={styles.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((v, j) => (
                          <td key={j} style={{ ...styles.td, color: !v ? '#374151' : undefined }}>
                            {!v ? <span style={{ opacity: 0.3 }}>(empty)</span> : truncate(v, 40)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {previewRows.some(row => Object.values(row).every(v => !v)) && (
                <div style={styles.warnBox}>
                  Some fields return empty values — try editing the selectors
                </div>
              )}
            </div>
          )}

          <div style={{ ...styles.card, marginTop: 8 }}>
            <ExtensionScheduleForm
              value={state.cloudScheduleDraft}
              onChange={(d) => void handleScheduleDraftChange(d)}
            />
          </div>

          <button onClick={handleStartExtraction} style={{ ...styles.primaryBtn, marginTop: 12, width: '100%' }}>
            Start Extraction
          </button>
        </div>
      )}

      {/* Step 3: Extraction in progress */}
      {state.phase === 'extracting' && (
        (state.pagination.type === 'scrollDown' || state.pagination.type === 'scrollUp') ? (
          <AutoScrollProgressPanel
            state={state}
            onStop={handleCancelExtraction}
          />
        ) : (
          <div style={styles.card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={styles.spinner} />
              <h3 style={{ ...styles.cardTitle, marginBottom: 0 }}>
                Extracting page {state.currentPage} of {state.maxPages}
              </h3>
            </div>

            {state.progressMessage && (
              <div style={styles.progressMessage}>{state.progressMessage}</div>
            )}

            <div style={styles.progressBar}>
              <div
                style={{
                  ...styles.progressFill,
                  width: `${Math.min(100, (state.currentPage / Math.max(1, state.maxPages)) * 100)}%`,
                }}
              />
            </div>

            <div style={styles.statsGrid}>
              <div style={styles.statBox}>
                <div style={styles.statValue}>{state.currentPage}</div>
                <div style={styles.statLabel}>Current Page</div>
              </div>
              <div style={styles.statBox}>
                <div style={styles.statValue}>{state.maxPages}</div>
                <div style={styles.statLabel}>Max Pages</div>
              </div>
              <div style={styles.statBox}>
                <div style={{ ...styles.statValue, color: '#4ade80' }}>
                  {state.extractedRows.length}
                </div>
                <div style={styles.statLabel}>Items Collected</div>
              </div>
            </div>

            <p style={{ ...styles.muted, marginTop: 10, marginBottom: 0, fontSize: 11 }}>
              Please leave this tab open. The extension is navigating between pages automatically.
            </p>

            <button onClick={handleCancelExtraction} style={{ ...styles.secondaryBtn, marginTop: 10, width: '100%' }}>
              Cancel Extraction
            </button>
          </div>
        )
      )}

      {/* Step 4: Results */}
      {state.phase === 'complete' && (
        <div>
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Extraction Complete</h3>
            <div style={styles.pill}>{state.extractedRows.length} items extracted</div>
          </div>

          <div style={{ ...styles.card, marginTop: 8 }}>
            <h3 style={styles.cardTitle}>Actions</h3>
            <div style={{ ...styles.muted, fontSize: 11, marginBottom: 10 }}>{scheduleSummaryText(state.cloudScheduleDraft)}</div>
            <div style={styles.btnGrid}>
              <button onClick={handleOpenDataTable} style={styles.primaryBtn}>
                View Full Data
              </button>
              <button onClick={openSendToMaxunModal} style={styles.accentBtn}>
                Send to Scout-X
              </button>
              <button onClick={handleExportCSV} style={styles.secondaryBtn}>
                Export CSV
              </button>
              <button onClick={handleExportJSON} style={styles.secondaryBtn}>
                Export JSON
              </button>
            </div>
          </div>

          {showSendToMaxunModal && (
            <div
              style={styles.modalOverlay}
              onClick={() => !sendToMaxunSubmitting && setShowSendToMaxunModal(false)}
            >
              <div style={styles.sendModalShell} onClick={(e) => e.stopPropagation()}>
                <div style={styles.sendModalHeader}>
                  <h3 style={{ ...styles.modalTitle, marginBottom: 8 }}>Send to Scout-X</h3>
                  <p style={{ ...styles.muted, marginTop: 0, marginBottom: 10, lineHeight: 1.45, fontSize: 12 }}>
                    Each automation needs a <strong>unique name</strong> on your server. Target URLs must be unique
                    (exact match). Optional Scout-X ID lets you update an existing scrape after a layout change.
                  </p>
                  <label style={styles.label}>Automation name</label>
                  <input
                    style={{ ...styles.input, marginBottom: 8 }}
                    value={sendToMaxunName}
                    onChange={(e) => setSendToMaxunName(e.target.value)}
                    disabled={sendToMaxunSubmitting || !!pendingUpdate}
                    maxLength={200}
                    autoFocus
                    placeholder="e.g. Amazon Jobs — Bangalore"
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <button
                      type="button"
                      onClick={() => setSendToMaxunName(makeUniqueAutomationName())}
                      disabled={sendToMaxunSubmitting || !!pendingUpdate}
                      style={styles.linkBtn}
                    >
                      Suggest unique name
                    </button>
                    <span style={{ fontSize: 10, color: '#6b7280' }}>{sendToMaxunName.length}/200</span>
                  </div>
                  <label style={styles.label}>Company name (required)</label>
                  <input
                    style={{ ...styles.input, marginBottom: 8 }}
                    value={sendToMaxunCompany}
                    onChange={(e) => setSendToMaxunCompany(e.target.value)}
                    disabled={sendToMaxunSubmitting}
                    maxLength={120}
                    placeholder="e.g. EY"
                    required
                  />
                  <ExtensionTagPicker
                    value={sendToMaxunTags}
                    onChange={setSendToMaxunTags}
                    disabled={sendToMaxunSubmitting}
                  />
                  <label style={styles.label}>Scout-X ID (optional)</label>
                  <input
                    style={{ ...styles.input, marginBottom: 8, fontFamily: 'ui-monospace, monospace' }}
                    value={sendToMaxunScoutId}
                    onChange={(e) => setSendToMaxunScoutId(e.target.value.toUpperCase())}
                    disabled={sendToMaxunSubmitting || !!pendingUpdate}
                    maxLength={8}
                    placeholder="SX12AB34"
                  />
                  {pendingUpdate && (
                    <div
                      style={{
                        ...styles.error,
                        background: '#fff7ed',
                        border: '1px solid #fdba74',
                        color: '#9a3412',
                        marginBottom: 8,
                      }}
                    >
                      Automation already exists
                      {pendingUpdate.scoutId ? ` (${pendingUpdate.scoutId})` : ''}
                      {pendingUpdate.name ? `: ${pendingUpdate.name}` : ''}.
                      Update selectors (and apply tags/company if set) while keeping schedule and history?
                    </div>
                  )}
                  {sendToMaxunError && (
                    <div style={{ ...styles.error, marginBottom: 0 }}>{sendToMaxunError}</div>
                  )}
                </div>
                {!pendingUpdate && (
                  <div className="scoutx-modal-scroll" style={styles.sendModalScroll}>
                    <ExtensionScheduleForm
                      compact
                      layout="modal"
                      value={state.cloudScheduleDraft}
                      onChange={(d) => void handleScheduleDraftChange(d)}
                    />
                  </div>
                )}
                <div style={styles.sendModalFooter}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {pendingUpdate ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleConfirmUpdate()}
                          disabled={sendToMaxunSubmitting}
                          style={{ ...styles.primaryBtn, flex: 1, marginBottom: 0 }}
                        >
                          {sendToMaxunSubmitting ? 'Updating…' : 'Yes, update'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingUpdate(null)}
                          disabled={sendToMaxunSubmitting}
                          style={{ ...styles.secondaryBtn, flex: 1, marginBottom: 0 }}
                        >
                          Back
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleSaveToBackend()}
                          disabled={sendToMaxunSubmitting}
                          style={{ ...styles.primaryBtn, flex: 1, marginBottom: 0 }}
                        >
                          {sendToMaxunSubmitting ? 'Sending…' : 'Send'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSendToMaxunSubmitting(false);
                            setPendingUpdate(null);
                            setShowSendToMaxunModal(false);
                          }}
                          style={{ ...styles.secondaryBtn, flex: 1, marginBottom: 0 }}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {savedBackendAutomationId && (
            <div style={{ ...styles.card, marginTop: 8 }}>
              <AutomationStatusPanel
                saved={state.savedAutomation}
                onRefresh={handleStatusRefresh}
                onRunNow={handleRunNow}
              />
              <ExtensionSchedulePicker
                automationId={savedBackendAutomationId}
                sendMessage={sendMessage}
                value={state.cloudScheduleDraft}
                onDraftChange={handleScheduleDraftChange}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface AutomationStatusPanelProps {
  saved?: ListExtractionState['savedAutomation'];
  onRefresh: () => void | Promise<void>;
  onRunNow: () => void | Promise<void>;
}

function AutomationStatusPanel({ saved, onRefresh, onRunNow }: AutomationStatusPanelProps) {
  if (!saved) {
    return (
      <div style={statusStyles.wrap}>
        <div style={statusStyles.title}>Automation saved</div>
        <div style={statusStyles.sub}>Fetching status…</div>
      </div>
    );
  }

  const { lastRunStatus, lastRunTime, nextRunAt, scheduleEnabled, schedulePaused, cron, timezone } = saved;

  return (
    <div style={statusStyles.wrap}>
      <div style={statusStyles.headerRow}>
        <div>
          <div style={statusStyles.title}>Automation status</div>
          <div style={statusStyles.sub}>
            Saved on Scout-X · updates to this robot will overwrite, not duplicate.
          </div>
        </div>
        <button type="button" style={statusStyles.refreshBtn} onClick={() => onRefresh()}>
          ↻ Refresh
        </button>
      </div>

      <div style={statusStyles.grid}>
        <div style={statusStyles.cell}>
          <div style={statusStyles.cellLabel}>Last run</div>
          <div style={statusStyles.cellValue}>{formatRunTime(lastRunTime) || '—'}</div>
          {lastRunStatus && (
            <div style={{ ...statusStyles.pill, ...runStatusStyle(lastRunStatus) }}>{lastRunStatus}</div>
          )}
        </div>
        <div style={statusStyles.cell}>
          <div style={statusStyles.cellLabel}>Next run</div>
          <div style={statusStyles.cellValue}>
            {schedulePaused && cron
              ? 'Paused'
              : scheduleEnabled && nextRunAt
                ? formatRunTime(nextRunAt)
                : scheduleEnabled
                  ? '—'
                  : 'Not scheduled'}
          </div>
          {(scheduleEnabled || schedulePaused) && cron && (
            <div style={statusStyles.cronChip}>
              {cron}
              {timezone ? ` · ${timezone}` : ''}
              {schedulePaused ? ' · paused' : ''}
            </div>
          )}
        </div>
      </div>

      <button type="button" style={statusStyles.runBtn} onClick={() => onRunNow()}>
        Run now
      </button>
    </div>
  );
}

function formatRunTime(value?: string | null): string {
  if (!value) return '';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleString();
  } catch {
    return value;
  }
}

function runStatusStyle(status: string): React.CSSProperties {
  const s = status.toLowerCase();
  if (s === 'success' || s === 'completed') return { background: 'rgba(34,197,94,0.15)', color: '#4ade80' };
  if (s === 'failed' || s === 'error') return { background: 'rgba(239,68,68,0.15)', color: '#fca5a5' };
  if (s === 'running' || s === 'queued') return { background: 'rgba(59,130,246,0.15)', color: '#93c5fd' };
  return { background: 'rgba(107,114,128,0.15)', color: '#d1d5db' };
}

const statusStyles: Record<string, React.CSSProperties> = {
  wrap: {
    marginBottom: 4,
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 10,
  },
  title: {
    fontSize: 13,
    fontWeight: 700,
    color: '#f9fafb',
    marginBottom: 2,
  },
  sub: {
    fontSize: 11,
    color: '#6b7280',
    lineHeight: 1.4,
  },
  refreshBtn: {
    background: '#1a1a1a',
    border: '1px solid #2a2a2a',
    color: '#9ca3af',
    padding: '4px 8px',
    fontSize: 10,
    borderRadius: 6,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    marginBottom: 10,
  },
  cell: {
    padding: '8px 10px',
    borderRadius: 8,
    background: '#0f0f0f',
    border: '1px solid #1f1f1f',
  },
  cellLabel: {
    fontSize: 10,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  cellValue: {
    fontSize: 12,
    color: '#e5e7eb',
    fontWeight: 600,
    marginBottom: 4,
  },
  pill: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 12,
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'capitalize',
  },
  cronChip: {
    display: 'inline-block',
    marginTop: 2,
    padding: '2px 6px',
    borderRadius: 4,
    background: '#1a1a1a',
    color: '#9ca3af',
    fontSize: 10,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  runBtn: {
    width: '100%',
    padding: '8px 12px',
    background: '#1f2937',
    border: '1px solid #374151',
    color: '#e5e7eb',
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    marginBottom: 10,
  },
};

interface AutoScrollProgressPanelProps {
  state: ListExtractionState;
  onStop: () => void;
}

/**
 * Extracting-phase panel shown for `scrollDown` / `scrollUp` modes. Unlike the
 * paged progress card it has no Page X/Y bar (auto-scroll is unlimited) and
 * features a large, unmistakable Stop & Save button as the only exit path.
 */
function AutoScrollProgressPanel({ state, onStop }: AutoScrollProgressPanelProps) {
  const steps = state.scrollSteps ?? state.currentPage ?? 0;
  const endReached = !!state.scrollEndReached;
  const loading = !!state.scrollLoading;

  let statusLabel: string;
  let statusColor: string;
  if (loading) {
    statusLabel = 'Loading more…';
    statusColor = '#60a5fa';
  } else if (endReached) {
    statusLabel = 'End reached — press Stop to finish';
    statusColor = '#fbbf24';
  } else {
    statusLabel = 'Scrolling…';
    statusColor = '#4ade80';
  }

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={styles.spinner} />
        <h3 style={{ ...styles.cardTitle, marginBottom: 0 }}>Auto-scrolling…</h3>
      </div>

      <div style={{ ...styles.progressMessage, color: statusColor }}>
        {state.progressMessage || statusLabel}
      </div>

      <div style={styles.statsGrid}>
        <div style={styles.statBox}>
          <div style={{ ...styles.statValue, color: '#4ade80' }}>
            {state.extractedRows.length}
          </div>
          <div style={styles.statLabel}>Items Collected</div>
        </div>
        <div style={styles.statBox}>
          <div style={styles.statValue}>{steps}</div>
          <div style={styles.statLabel}>Scroll Steps</div>
        </div>
        <div style={styles.statBox}>
          <div style={{ ...styles.statValue, color: statusColor }}>
            {loading ? '⟳' : endReached ? '■' : '▼'}
          </div>
          <div style={styles.statLabel}>Status</div>
        </div>
      </div>

      <p style={{ ...styles.muted, marginTop: 10, marginBottom: 10, fontSize: 11 }}>
        {endReached
          ? 'The end of the page has been reached. The extension will keep watching for late-loading items. Press Stop & Save when you are done.'
          : 'Auto-scroll is running. Leave this tab visible — items are being collected as the page loads more.'}
      </p>

      <button onClick={onStop} style={styles.stopBtn}>
        ■ Stop & Save
      </button>
    </div>
  );
}

interface EditableFieldRowProps {
  name: string;
  field: FieldConfig;
  isEditing: boolean;
  onUpdate: (patch: Partial<FieldConfig>) => void;
  onDelete: () => void;
}

function EditableFieldRow({ name, field, isEditing, onUpdate, onDelete }: EditableFieldRowProps) {
  const colors = TYPE_COLORS[field.semanticType] || TYPE_COLORS.unknown;

  return (
    <div style={fieldStyles.row}>
      {isEditing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              style={{ ...fieldStyles.nameInput }}
              value={name}
              onChange={(e) => onUpdate({ label: e.target.value })}
              title="Field name"
            />
            <select
              style={{ ...fieldStyles.typeSelect, background: colors.bg, color: colors.text }}
              value={field.semanticType}
              onChange={(e) => onUpdate({ semanticType: e.target.value as SemanticType })}
            >
              {SEMANTIC_TYPES.map((t) => (
                <option key={t} value={t}>{SEMANTIC_ICONS[t]} {t}</option>
              ))}
            </select>
            <button onClick={onDelete} style={fieldStyles.deleteBtn} title="Delete field">✕</button>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              style={{ ...fieldStyles.selectorInput }}
              value={field.selector}
              onChange={(e) => onUpdate({ selector: e.target.value })}
              placeholder="CSS selector..."
              title="CSS selector"
            />
            <select
              style={fieldStyles.attrSelect}
              value={field.attribute}
              onChange={(e) => onUpdate({ attribute: e.target.value })}
              title="What to extract"
            >
              {ATTRIBUTE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <>
          <div style={{ ...fieldStyles.badge, background: colors.bg, color: colors.text }}>
            {SEMANTIC_ICONS[field.semanticType]}
          </div>
          <div style={fieldStyles.name}>{name}</div>
          <code style={fieldStyles.selector}>{truncate(field.selector, 25)}</code>
        </>
      )}
    </div>
  );
}

function truncate(text: string, max: number): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

// ─── Pagination Editor ────────────────────────────────────────────────────────

type PagType = '' | 'clickNext' | 'clickLoadMore' | 'scrollDown' | 'scrollUp' | 'pageNumber';

const PAG_TYPE_OPTIONS: { value: PagType; label: string; icon: string }[] = [
  { value: '', label: 'None', icon: '✕' },
  { value: 'clickNext', label: 'Click Next', icon: '→' },
  { value: 'clickLoadMore', label: 'Load More', icon: '↓' },
  { value: 'scrollDown', label: 'Scroll Down', icon: '▼' },
  { value: 'scrollUp', label: 'Scroll Up', icon: '▲' },
  { value: 'pageNumber', label: 'URL Pattern', icon: '#' },
];

interface PaginationEditorProps {
  pagination: PaginationConfig;
  onChange: <K extends keyof PaginationConfig>(key: K, value: PaginationConfig[K]) => void;
  onPickElement: (callback: (selector: string) => void) => void;
}

function PaginationEditor({ pagination, onChange, onPickElement }: PaginationEditorProps) {
  const isScroll = pagination.type === 'scrollDown' || pagination.type === 'scrollUp';
  const [showScrollAdvanced, setShowScrollAdvanced] = React.useState(
    !!(pagination.maxPages && pagination.maxPages > 0)
  );

  return (
    <div style={pagStyles.section}>
      {/* Page Navigation Type */}
      <div style={pagStyles.group}>
        <label style={styles.label}>Navigation Type</label>
        <div style={{ ...pagStyles.typeGrid, gridTemplateColumns: '1fr 1fr 1fr' }}>
          {PAG_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChange('type', opt.value)}
              style={{
                ...pagStyles.typeBtn,
                ...(pagination.type === opt.value ? pagStyles.typeBtnActive : {}),
              }}
            >
              <span style={pagStyles.typeIcon}>{opt.icon}</span>
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Click-based: selector */}
      {(pagination.type === 'clickNext' || pagination.type === 'clickLoadMore') && (
        <div style={pagStyles.group}>
          <label style={styles.label}>Button Selector</label>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              style={{ ...styles.input, flex: 1, marginBottom: 0 }}
              placeholder="e.g. .next-btn, [aria-label=Next], a.next"
              value={pagination.selector || ''}
              onChange={(e) => onChange('selector', e.target.value)}
            />
            <button
              onClick={() => onPickElement((sel) => onChange('selector', sel))}
              style={pagStyles.pickBtn}
              title="Click to enter pick mode, then click the element on the page"
            >
              🎯 Pick
            </button>
          </div>
        </div>
      )}

      {/* Page number loop: URL param config */}
      {pagination.type === 'pageNumber' && (
        <div style={pagStyles.group}>
          <label style={styles.label}>URL Parameter</label>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              style={{ ...styles.input, flex: 1, marginBottom: 0 }}
              placeholder="e.g. page, p, pg (the URL param that changes)"
              value={pagination.pageParam || ''}
              onChange={(e) => onChange('pageParam', e.target.value)}
            />
            <button
              onClick={async () => {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab?.url) return;
                try {
                  const url = new URL(tab.url);
                  const PAGINATION_PARAMS = ['pg', 'page', 'p', 'start', 'offset', 'pageNum', 'pn'];
                  for (const param of PAGINATION_PARAMS) {
                    if (url.searchParams.has(param)) {
                      onChange('pageParam', param);
                      const val = url.searchParams.get(param);
                      const parsed = parseInt(val || '1', 10);
                      onChange('startPage', isNaN(parsed) ? 1 : parsed);
                      break;
                    }
                  }
                } catch { /* ignore invalid URLs */ }
              }}
              style={pagStyles.detectBtn}
              title="Read the current URL to auto-detect pagination parameter"
            >
              🔍 Detect from URL
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ ...styles.label, marginBottom: 2 }}>Start Page</label>
              <input
                type="number"
                min="1"
                max="100"
                style={{ ...styles.input, marginBottom: 0 }}
                value={pagination.startPage ?? 1}
                onChange={(e) => onChange('startPage', parseInt(e.target.value) || 1)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ ...styles.label, marginBottom: 2 }}>Max Pages</label>
              <input
                type="number"
                min="1"
                max="1000"
                style={{ ...styles.input, marginBottom: 0 }}
                value={pagination.maxPages || 10}
                onChange={(e) => onChange('maxPages', parseInt(e.target.value) || 10)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ ...styles.label, marginBottom: 2 }}>Delay (ms)</label>
              <input
                type="number"
                min="500"
                max="10000"
                step="100"
                style={{ ...styles.input, marginBottom: 0 }}
                value={pagination.pageDelayMs || 1500}
                onChange={(e) => onChange('pageDelayMs', parseInt(e.target.value) || 1500)}
              />
            </div>
          </div>
          <p style={pagStyles.hint}>
            The URL will be modified by adding or incrementing the parameter on each page.
            Example: if the param is "page", pages become ?page=2, ?page=3, etc.
          </p>
        </div>
      )}

      {/* Scroll options */}
      {isScroll && (
        <div style={pagStyles.group}>
          <label style={styles.label}>Scroll Behavior</label>

          <div style={pagStyles.infoBox}>
            <strong style={{ color: '#93c5fd' }}>Auto-scroll is unlimited.</strong>{' '}
            <span style={{ color: '#9ca3af' }}>
              The page will keep scrolling and extracting items until you press{' '}
              <strong>Stop</strong>. When the end of the page is reached, the
              session idles and keeps watching for late-loading items.
            </span>
          </div>

          <div style={pagStyles.row}>
            <span style={pagStyles.rowLabel}>Delay (ms)</span>
            <input
              type="number"
              min="500"
              max="10000"
              step="100"
              style={{ ...styles.input, width: 80, marginBottom: 0 }}
              value={pagination.pageDelayMs || 1500}
              onChange={(e) => onChange('pageDelayMs', parseInt(e.target.value) || 1500)}
            />
          </div>
          <p style={pagStyles.hint}>
            How long to wait after each scroll for content to load.
          </p>

          <button
            type="button"
            onClick={() => {
              const next = !showScrollAdvanced;
              setShowScrollAdvanced(next);
              if (!next) onChange('maxPages', 0); // unlimited when closed
            }}
            style={pagStyles.advancedToggle}
          >
            {showScrollAdvanced ? '▾' : '▸'} Advanced
          </button>

          {showScrollAdvanced && (
            <div style={pagStyles.advancedBox}>
              <div style={pagStyles.row}>
                <span style={pagStyles.rowLabel}>Max Scrolls</span>
                <input
                  type="number"
                  min="0"
                  max="10000"
                  placeholder="Unlimited"
                  style={{ ...styles.input, width: 100, marginBottom: 0 }}
                  value={pagination.maxPages || ''}
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value);
                    onChange('maxPages', isNaN(parsed) ? 0 : Math.max(0, parsed));
                  }}
                />
              </div>
              <p style={pagStyles.hint}>
                Optional runaway safety cap. Leave blank for unlimited.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Click-based: max pages & delay */}
      {(pagination.type === 'clickNext' || pagination.type === 'clickLoadMore') && (
        <div style={pagStyles.group}>
          <label style={styles.label}>Limits</label>
          <div style={pagStyles.scrollOptions}>
            <div style={pagStyles.row}>
              <span style={pagStyles.rowLabel}>Max Pages</span>
              <input
                type="number"
                min="1"
                max="1000"
                style={{ ...styles.input, width: 80, marginBottom: 0 }}
                value={pagination.maxPages || 10}
                onChange={(e) => onChange('maxPages', parseInt(e.target.value) || 10)}
              />
            </div>
            <div style={pagStyles.row}>
              <span style={pagStyles.rowLabel}>Delay (ms)</span>
              <input
                type="number"
                min="500"
                max="10000"
                step="100"
                style={{ ...styles.input, width: 80, marginBottom: 0 }}
                value={pagination.pageDelayMs || 1500}
                onChange={(e) => onChange('pageDelayMs', parseInt(e.target.value) || 1500)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PaginationSummary({ pagination }: { pagination: PaginationConfig }) {
  const typeLabels: Record<string, string> = {
    '': 'None',
    clickNext: 'Click Next Button',
    clickLoadMore: 'Load More Button',
    scrollDown: 'Scroll Down',
    scrollUp: 'Scroll Up',
    pageNumber: 'URL Pattern',
  };

  return (
    <div>
      {pagination.type === '' ? (
        <div style={pagStyles.emptyState}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>No pagination configured.</span>
          <span style={{ fontSize: 11, color: '#4b5563', marginTop: 2 }}>Click "Configure" to add page navigation or auto-scroll.</span>
        </div>
      ) : (
        <div>
          <div style={pagStyles.summaryGrid}>
            <SummaryRow label="Type" value={typeLabels[pagination.type] || pagination.type} />
            {pagination.selector && (
              <SummaryRow label="Selector" value={pagination.selector} mono />
            )}
            {pagination.pageParam && (
              <>
                <SummaryRow label="URL Param" value={pagination.pageParam} mono />
                <SummaryRow label="Start Page" value={String(pagination.startPage ?? 1)} />
              </>
            )}
            <SummaryRow label="Max Pages" value={String(pagination.maxPages || '—')} />
            <SummaryRow label="Delay" value={pagination.pageDelayMs ? `${pagination.pageDelayMs}ms` : '—'} />
            <SummaryRow label="Confidence" value={pagination.confidence || '—'} />
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={pagStyles.summaryRow}>
      <span style={pagStyles.summaryLabel}>{label}</span>
      <span style={{ ...pagStyles.summaryValue, ...(mono ? styles.code : {}), fontSize: mono ? 11 : 12 }}>
        {value}
      </span>
    </div>
  );
}

const pagStyles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 12 },
  group: { display: 'flex', flexDirection: 'column', gap: 4 },
  typeGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 },
  typeBtn: {
    padding: '8px 10px', background: '#0a0a0a', border: '1px solid #2a2a2a',
    borderRadius: 8, color: '#9ca3af', fontSize: 11, fontWeight: 600, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 4,
  },
  typeBtnActive: {
    background: 'rgba(14, 116, 144, 0.2)', border: '1px solid #22d3ee', color: '#67e8f9',
  },
  typeIcon: { fontSize: 13 },
  pickBtn: {
    padding: '5px 10px', background: '#1e3a5f', color: '#60a5fa',
    border: '1px solid #2563eb', borderRadius: 6, fontSize: 11, fontWeight: 600,
    cursor: 'pointer', marginTop: 2,
  },
  detectBtn: {
    padding: '5px 10px', background: '#064e3b', color: '#34d399',
    border: '1px solid #059669', borderRadius: 6, fontSize: 11, fontWeight: 600,
    cursor: 'pointer', marginTop: 2, whiteSpace: 'nowrap' as const,
  },
  scrollOptions: { display: 'flex', flexDirection: 'column', gap: 6 },
  row: { display: 'flex', alignItems: 'center', gap: 10 },
  rowLabel: { fontSize: 12, color: '#9ca3af', minWidth: 90 },
  hint: { fontSize: 11, color: '#4b5563', margin: 0 },
  emptyState: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '16px 0', gap: 2,
  },
  summaryGrid: { display: 'flex', flexDirection: 'column', gap: 4 },
  summaryRow: { display: 'flex', alignItems: 'baseline', gap: 8 },
  summaryLabel: { fontSize: 11, color: '#6b7280', minWidth: 80, textTransform: 'uppercase' as const },
  summaryValue: { color: '#d1d5db', fontWeight: 500 },
  infoBox: {
    padding: '8px 10px', background: '#0f172a', border: '1px solid #1e293b',
    borderRadius: 6, fontSize: 11, color: '#93c5fd', lineHeight: 1.5,
    marginBottom: 8,
  },
  advancedToggle: {
    background: 'transparent', border: 'none', color: '#9ca3af',
    fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: '4px 0',
    textAlign: 'left' as const, marginTop: 4,
  },
  advancedBox: {
    padding: '8px 10px', background: '#0a0a0a', border: '1px dashed #2a2a2a',
    borderRadius: 6, marginTop: 4, display: 'flex', flexDirection: 'column' as const, gap: 4,
  },
};

function rowsToCSV(rows: Record<string, string>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => `"${(row[h] || '').replace(/"/g, '""')}"`).join(','));
  }
  return lines.join('\n');
}

const styles: Record<string, React.CSSProperties> = {
  heading: { fontSize: 16, fontWeight: 700, marginBottom: 12, color: '#f9fafb' },
  card: {
    padding: 14, background: '#151515', border: '1px solid #2a2a2a',
    borderRadius: 12, marginBottom: 0,
  },
  cardTitle: { fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#f9fafb' },
  desc: { fontSize: 12, color: '#6b7280', lineHeight: 1.5, marginBottom: 12 },
  primaryBtn: {
    padding: '10px 16px', background: 'linear-gradient(135deg, #0e7490 0%, #0369a1 100%)', color: '#fff', border: 'none',
    borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: 'pointer', width: 'auto',
    boxShadow: '0 4px 14px rgba(14, 116, 144, 0.35)',
  },
  secondaryBtn: {
    padding: '8px 14px', background: '#1f1f1f', color: '#d1d5db', border: '1px solid #333',
    borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: 'pointer',
  },
  accentBtn: {
    padding: '8px 14px', background: 'rgba(14, 116, 144, 0.2)', color: '#e0f2fe', border: '1px solid rgba(34, 211, 238, 0.55)',
    borderRadius: 10, fontWeight: 600, fontSize: 12, cursor: 'pointer',
  },
  linkBtn: {
    background: 'none', border: 'none', color: '#60a5fa', fontSize: 11, fontWeight: 600,
    cursor: 'pointer', padding: 0, textDecoration: 'underline',
  },
  editBtn: {
    padding: '4px 10px', background: '#1f1f1f', color: '#60a5fa',
    border: '1px solid #2563eb', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
  },
  addBtn: {
    padding: '4px 10px', background: '#22c55e22', color: '#4ade80',
    border: '1px solid #16a34a', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
  },
  saveBtn: {
    padding: '4px 10px', background: '#22c55e', color: '#fff',
    border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
  },
  cancelBtn: {
    padding: '4px 10px', background: '#374151', color: '#d1d5db',
    border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
  },
  btnGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  pill: {
    display: 'inline-block', padding: '4px 10px', background: '#facc1522',
    color: '#facc15', borderRadius: 999, fontSize: 12, fontWeight: 700,
  },
  statusBadge: {
    padding: '8px 12px', background: '#1e293b', borderRadius: 8,
    fontSize: 12, color: '#93c5fd', marginBottom: 8, textAlign: 'center' as const,
  },
  label: { fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 4, display: 'block' },
  selectorPreview: { marginTop: 8 },
  code: {
    display: 'block', padding: '6px 8px', background: '#0a0a0a',
    borderRadius: 6, fontSize: 11, fontFamily: 'monospace',
    color: '#a78bfa', marginTop: 4, wordBreak: 'break-all' as const,
  },
  muted: { fontSize: 12, color: '#6b7280' },
  error: {
    padding: '8px 12px', background: '#7f1d1d', borderRadius: 8,
    fontSize: 12, marginBottom: 12,
  },
  warnBox: {
    padding: '6px 10px', background: '#78350f22', border: '1px solid #78350f',
    borderRadius: 6, fontSize: 11, color: '#f59e0b', marginTop: 6,
  },
  previewTable: { overflowX: 'auto' as const, borderRadius: 8, border: '1px solid #2a2a2a' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 11 },
  th: {
    padding: '6px 8px', textAlign: 'left' as const, background: '#1a1a1a',
    color: '#9ca3af', fontWeight: 600, borderBottom: '1px solid #2a2a2a',
    whiteSpace: 'nowrap' as const,
  },
  td: {
    padding: '6px 8px', borderBottom: '1px solid #1a1a1a',
    color: '#d1d5db', maxWidth: 150, overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  progressBar: {
    width: '100%', height: 6, background: '#1a1a1a',
    borderRadius: 3, overflow: 'hidden', marginBottom: 10,
  },
  progressFill: {
    height: '100%', background: 'linear-gradient(90deg, #0e7490, #22d3ee)', borderRadius: 3,
    transition: 'width 0.3s ease',
  },
  progressMessage: {
    padding: '8px 10px', background: '#0f172a', border: '1px solid #1e293b',
    borderRadius: 6, fontSize: 12, color: '#93c5fd', marginBottom: 10,
    fontFamily: 'monospace',
  },
  statsGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 4,
  },
  statBox: {
    padding: '8px 6px', background: '#0a0a0a', border: '1px solid #1f1f1f',
    borderRadius: 6, textAlign: 'center' as const,
  },
  statValue: {
    fontSize: 18, fontWeight: 700, color: '#f9fafb', lineHeight: 1,
  },
  statLabel: {
    fontSize: 10, color: '#6b7280', marginTop: 4, textTransform: 'uppercase' as const,
    letterSpacing: '0.04em', fontWeight: 600,
  },
  spinner: {
    display: 'inline-block', width: 16, height: 16,
    border: '2px solid #2a2a2a', borderTopColor: '#22d3ee',
    borderRadius: '50%',
    animation: 'maxun_spin 0.8s linear infinite',
  },
  stopBtn: {
    width: '100%', padding: '12px 16px', marginTop: 4,
    background: 'linear-gradient(90deg, #dc2626, #ef4444)', color: '#fff',
    border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700,
    cursor: 'pointer', letterSpacing: '0.02em',
    boxShadow: '0 2px 8px rgba(220, 38, 38, 0.35)',
  },
  fieldList: { display: 'flex', flexDirection: 'column', gap: 2 },
  modalOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9999,
  },
  modal: {
    background: '#1a1a1a', border: '1px solid #333', borderRadius: 12,
    padding: 20, width: 320, maxHeight: '80vh', overflowY: 'auto',
  },
  sendModalShell: {
    background: '#111827',
    border: '1px solid rgba(34, 211, 238, 0.28)',
    borderRadius: 14,
    width: 'min(calc(100vw - 20px), 400px)',
    maxWidth: 400,
    maxHeight: 'min(88vh, 680px)',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    boxShadow: '0 24px 48px rgba(0,0,0,0.55)',
  },
  sendModalHeader: {
    padding: '14px 16px 10px',
    flexShrink: 0,
    borderBottom: '1px solid rgba(30, 41, 59, 0.95)',
  },
  sendModalScroll: {
    flex: '1 1 auto',
    minHeight: 0,
    padding: '8px 12px 10px 16px',
  },
  sendModalFooter: {
    padding: '12px 16px 14px',
    flexShrink: 0,
    borderTop: '1px solid rgba(30, 41, 59, 0.95)',
    background: 'rgba(15, 23, 42, 0.72)',
  },
  modalTitle: { fontSize: 15, fontWeight: 700, color: '#f9fafb', marginBottom: 12 },
  input: {
    width: '100%', padding: '7px 10px', background: '#0a0a0a', border: '1px solid #333',
    borderRadius: 6, color: '#e5e7eb', fontSize: 12, marginBottom: 10,
    boxSizing: 'border-box',
  },
  select: {
    width: '100%', padding: '7px 10px', background: '#0a0a0a', border: '1px solid #333',
    borderRadius: 6, color: '#e5e7eb', fontSize: 12, marginBottom: 10,
    boxSizing: 'border-box',
  },
};

const fieldStyles: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 0', borderBottom: '1px solid #1a1a1a',
  },
  badge: {
    padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 700,
    minWidth: 20, textAlign: 'center',
  },
  name: { fontSize: 13, fontWeight: 600, color: '#e5e7eb', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  selector: { fontSize: 10, color: '#6b7280', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 },
  nameInput: {
    flex: 1, padding: '3px 6px', background: '#0a0a0a', border: '1px solid #333',
    borderRadius: 4, color: '#e5e7eb', fontSize: 12,
  },
  typeSelect: {
    padding: '3px 6px', border: 'none', borderRadius: 4,
    fontSize: 10, fontWeight: 700, cursor: 'pointer', maxWidth: 90,
  },
  selectorInput: {
    flex: 1, padding: '3px 6px', background: '#0a0a0a', border: '1px solid #333',
    borderRadius: 4, color: '#a78bfa', fontSize: 10, fontFamily: 'monospace',
  },
  attrSelect: {
    padding: '3px 6px', background: '#0a0a0a', border: '1px solid #333',
    borderRadius: 4, color: '#d1d5db', fontSize: 10,
  },
  deleteBtn: {
    padding: '2px 6px', background: '#7f1d1d', color: '#fca5a5',
    border: 'none', borderRadius: 4, fontSize: 10, cursor: 'pointer',
  },
};

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import Link from '@mui/material/Link';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import TuneIcon from '@mui/icons-material/Tune';
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ColumnOverride,
  ColumnOverridesMap,
  getAutomationData,
  RowContextFields,
  updateAutomationColumns,
} from '../api/automation';
import { useGlobalInfoStore } from '../context/globalInfo';
import { escapeCsvSpreadsheetCell } from '../utils/spreadsheet';
import {
  FIRSTSTEP,
  RADIUS,
  heroGlassGhostButtonSx,
  heroGlassPrimaryButtonSx,
  tint,
} from '../components/dashboard/ops/dashboardTokens';
import { formatRunJobAddedAt } from '../features/jobs/jobBoardPageBehavior';
import { popReturnNavigateOptions, pushReturnState } from '../features/navigation/inAppReturn';
import {
  dataColumnLabel,
  dataColumnMinWidthPx,
  extractedDataTableHeaderCellSx,
  extractedDataTableMinWidthPx,
  extractedDataTableRowHoverSx,
  extractedDataTableScrollSx,
  formatExtractedCellDisplay,
  formatSourceLabel,
  isTitleColumn,
} from '../features/automations/automationDataPageBehavior';
import { paginationControlSx } from '../features/automations/automationsPageBehavior';

const normalizeRowContext = (
  rc?: RowContextFields | null
): { sectorIndustry: string; f500: '' | 'yes' | 'no' } => ({
  sectorIndustry: typeof rc?.sectorIndustry === 'string' ? rc.sectorIndustry : '',
  f500: rc?.f500 === 'yes' || rc?.f500 === 'no' ? rc.f500 : '',
});

const downloadBlob = (content: string, filename: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

interface DraftEntry {
  rename: string;
  clear: boolean;
  omit: boolean;
}

const emptyDraftEntry = (): DraftEntry => ({
  rename: '',
  clear: false,
  omit: false,
});

const buildDraftFromOverrides = (
  columns: string[],
  overrides: ColumnOverridesMap
): Record<string, DraftEntry> => {
  const draft: Record<string, DraftEntry> = {};
  columns.forEach((column) => {
    const override = overrides[column];
    draft[column] = {
      rename: override?.rename || '',
      clear: !!override?.clear,
      omit: !!override?.omit,
    };
  });
  return draft;
};

const draftToOverrides = (draft: Record<string, DraftEntry>): ColumnOverridesMap => {
  const result: ColumnOverridesMap = {};
  Object.entries(draft).forEach(([original, entry]) => {
    if (entry.omit) {
      const trimmedRename = entry.rename.trim();
      const value: ColumnOverride = { omit: true };
      if (trimmedRename && trimmedRename !== original) {
        value.rename = trimmedRename;
      }
      result[original] = value;
      return;
    }
    const trimmedRename = entry.rename.trim();
    const isRename = !!trimmedRename && trimmedRename !== original;
    if (!isRename && !entry.clear) return;
    const value: ColumnOverride = {};
    if (isRename) value.rename = trimmedRename;
    if (entry.clear) value.clear = true;
    result[original] = value;
  });
  return result;
};

const validateDraft = (
  draft: Record<string, DraftEntry>,
  databaseTargetColumns: string[]
): string | null => {
  const strictTargets = databaseTargetColumns.length > 0;
  const seen = new Map<string, string>();
  for (const [original, entry] of Object.entries(draft)) {
    if (entry.omit) {
      const trimmed = entry.rename.trim();
      if (trimmed.length > 120) {
        return `"${trimmed}" is longer than 120 characters`;
      }
      if (trimmed && /[,\n\r\t]/.test(trimmed)) {
        return `"${trimmed}" cannot contain commas, tabs, or newlines`;
      }
      if (strictTargets && trimmed && !databaseTargetColumns.includes(trimmed)) {
        return `Legacy column name "${trimmed}" must be one of your configured database column names, or leave empty.`;
      }
      continue;
    }
    const trimmed = entry.rename.trim();
    if (trimmed.length === 0 && !entry.clear) {
      seen.set(original, original);
      continue;
    }
    if (trimmed.length > 120) {
      return `"${trimmed}" is longer than 120 characters`;
    }
    if (trimmed && /[,\n\r\t]/.test(trimmed)) {
      return `"${trimmed}" cannot contain commas, tabs, or newlines`;
    }
    if (strictTargets && trimmed && !databaseTargetColumns.includes(trimmed)) {
      return `Pick a database column from the list, or add "${trimmed}" under Scraper Configuration → Database column names.`;
    }
    const target = trimmed || original;
    const prior = seen.get(target);
    if (prior && prior !== original) {
      return `Two columns cannot map to the same name "${target}"`;
    }
    seen.set(target, original);
  }
  return null;
};

export const AutomationDataPage = ({
  automationId,
  onClose,
  embedded = false,
}: {
  automationId?: string;
  onClose?: () => void;
  embedded?: boolean;
} = {}) => {
  const { id: routeId = '' } = useParams();
  const id = automationId || routeId;
  const navigate = useNavigate();
  const location = useLocation();
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
  const { notify } = useGlobalInfoStore();
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(25);
  const [rows, setRows] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [overrides, setOverrides] = useState<ColumnOverridesMap>({});
  const [databaseTargetColumns, setDatabaseTargetColumns] = useState<string[]>([]);
  const [rowContext, setRowContext] = useState<{ sectorIndustry: string; f500: '' | 'yes' | 'no' }>({
    sectorIndustry: '',
    f500: '',
  });

  const [editOpen, setEditOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [draft, setDraft] = useState<Record<string, DraftEntry>>({});
  const [editRowContext, setEditRowContext] = useState<{ sectorIndustry: string; f500: '' | 'yes' | 'no' }>({
    sectorIndustry: '',
    f500: '',
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * Original (pre-override) column names that the user can edit. We derive
   * this from the data shown in the table — same source as `columns` — so the
   * dialog never shows columns the user can't see in the table.
   *
   * For each visible (post-override) column, find its source key in the override
   * map (target === column) and use that. Otherwise the column itself is the
   * original. Saved override keys are unioned in so cleared/renamed columns
   * always have a row in the dialog even if they're not in the visible page.
   */
  const editableColumns = useMemo(() => {
    const result = new Set<string>();
    columns.forEach((column) => {
      const renameSource = Object.entries(overrides).find(([, value]) => value.rename === column);
      result.add(renameSource ? renameSource[0] : column);
    });
    Object.keys(overrides).forEach((key) => result.add(key));
    return Array.from(result).sort((a, b) => a.localeCompare(b));
  }, [columns, overrides]);

  /** Drop columns that are empty on every row of the current page (keeps grid narrower). */
  const visibleColumns = useMemo(() => {
    if (!rows.length) return columns;
    return columns.filter((column) =>
      rows.some((row) => {
        const value = row.data?.[column];
        if (value == null) return false;
        if (typeof value === 'string') return value.trim().length > 0;
        if (typeof value === 'boolean') return true;
        if (typeof value === 'number') return true;
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'object') return Object.keys(value).length > 0;
        return String(value).length > 0;
      })
    );
  }, [columns, rows]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const response = await getAutomationData(id, page + 1, limit);
      setRows(response.rows);
      setColumns(response.columns);
      setTotal(response.pagination.total);
      setOverrides(response.overrides || {});
      setRowContext(normalizeRowContext(response.rowContext));
      setDatabaseTargetColumns(response.databaseTargetColumns || []);
    } catch (error: any) {
      notify('error', error?.response?.data?.error || 'Failed to load automation data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id, page, limit]);

  const flatRows = useMemo(
    () => rows.map((row) => ({ runId: row.runId, source: row.source, createdAt: row.createdAt, ...row.data })),
    [rows]
  );

  const exportJson = () => {
    const payload = flatRows.map((row) => {
      const entry: Record<string, unknown> = {
        runId: row.runId,
        source: row.source,
        createdAt: row.createdAt,
      };
      columns.forEach((col) => {
        entry[col] = row[col];
      });
      return entry;
    });
    downloadBlob(JSON.stringify(payload, null, 2), `automation-${id}-data.json`, 'application/json');
  };

  const exportCsv = () => {
    const csvColumns = ['runId', 'source', 'createdAt', ...columns];
    const content = [
      csvColumns.map(escapeCsvSpreadsheetCell).join(','),
      ...flatRows.map((row) =>
        csvColumns
          .map((column) => escapeCsvSpreadsheetCell(row[column] ?? ''))
          .join(',')
      ),
    ].join('\n');
    downloadBlob(content, `automation-${id}-data.csv`, 'text/csv;charset=utf-8;');
  };

  const overrideForVisible = (column: string): { rename?: string; clear?: boolean; original?: string } | null => {
    // The visible `column` is the post-override name. Walk the map to find a
    // matching rename target so we can render "renamed from X".
    const entry = overrides[column];
    if (entry && !entry.rename) {
      return { ...entry, original: column };
    }
    const renameMatch = Object.entries(overrides).find(([, value]) => value.rename === column);
    if (renameMatch) {
      return { ...renameMatch[1], original: renameMatch[0] };
    }
    if (entry) {
      return { ...entry, original: column };
    }
    return null;
  };

  const openEdit = () => {
    setEditError(null);
    setDraft(buildDraftFromOverrides(editableColumns, overrides));
    setEditRowContext({ ...rowContext });
    setEditOpen(true);
  };

  const closeEdit = () => {
    if (savingEdit) return;
    setEditOpen(false);
    setEditError(null);
  };

  const updateDraft = (column: string, patch: Partial<DraftEntry>) => {
    setDraft((current) => ({
      ...current,
      [column]: { ...emptyDraftEntry(), ...current[column], ...patch },
    }));
    setEditError(null);
  };

  const resetColumn = (column: string) => {
    updateDraft(column, emptyDraftEntry());
  };

  const saveEdit = async () => {
    const validationError = validateDraft(draft, databaseTargetColumns);
    if (validationError) {
      setEditError(validationError);
      return;
    }
    setSavingEdit(true);
    try {
      const payload = draftToOverrides(draft);
      await updateAutomationColumns(id, {
        overrides: payload,
        rowContext: {
          sectorIndustry: editRowContext.sectorIndustry,
          f500: editRowContext.f500,
        },
      });
      notify(
        'success',
        'Column settings saved. Removed columns disappear from this view and are not stored on new runs.'
      );
      setEditOpen(false);
      await loadData();
    } catch (error: any) {
      const message = error?.response?.data?.error || 'Failed to save column overrides';
      setEditError(message);
    } finally {
      setSavingEdit(false);
    }
  };

  const activeOverrideCount = Object.keys(overrides).length;
  const rowNoun = total === 1 ? 'row' : 'rows';

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: embedded ? 1 : undefined,
        width: '100%',
        height: embedded ? '100%' : '100vh',
        minHeight: embedded ? 0 : '100vh',
        bgcolor: FIRSTSTEP.white,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          px: { xs: 2, md: 3 },
          py: { xs: 2, md: 2.5 },
          borderBottom: `1px solid ${FIRSTSTEP.border}`,
          background: `linear-gradient(135deg, ${FIRSTSTEP.white} 0%, ${FIRSTSTEP.surfaceAlt} 100%)`,
          flexShrink: 0,
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'center' }}
          spacing={2}
        >
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 0.5 }}>
              <Typography
                sx={{
                  fontWeight: 800,
                  fontSize: { xs: '1.35rem', md: '1.6rem' },
                  letterSpacing: '-0.03em',
                  color: FIRSTSTEP.navyDeep,
                }}
              >
                Extracted data
              </Typography>
              <Box
                sx={{
                  px: 1.25,
                  py: 0.35,
                  borderRadius: RADIUS.pill,
                  bgcolor: 'rgba(79, 179, 169, 0.12)',
                  border: `1px solid ${tint(FIRSTSTEP.teal, 0.28)}`,
                }}
              >
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: FIRSTSTEP.tealDeep }}>
                  {isLoading ? 'Loading' : `${total} ${rowNoun}`}
                </Typography>
              </Box>
            </Stack>
            <Typography variant="body2" sx={{ color: FIRSTSTEP.textMuted, maxWidth: 560 }}>
              Jobs this scraper collected. Use the scrollbar at the bottom to see columns on the right.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              variant="outlined"
              startIcon={<TuneIcon />}
              onClick={openEdit}
              disabled={isLoading}
              sx={heroGlassGhostButtonSx}
            >
              Edit columns{activeOverrideCount > 0 ? ` (${activeOverrideCount})` : ''}
            </Button>
            <Tooltip title="Exports the current page only">
              <span>
                <Button
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                  onClick={exportCsv}
                  disabled={isLoading || !rows.length}
                  sx={heroGlassGhostButtonSx}
                >
                  CSV
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="Exports the current page only">
              <span>
                <Button
                  variant="contained"
                  onClick={exportJson}
                  disabled={isLoading || !rows.length}
                  sx={heroGlassPrimaryButtonSx}
                >
                  JSON
                </Button>
              </span>
            </Tooltip>
            <IconButton
              aria-label="Close extracted data"
              onClick={close}
              sx={{
                color: FIRSTSTEP.navy,
                border: `1px solid ${FIRSTSTEP.border}`,
                bgcolor: FIRSTSTEP.white,
                width: 40,
                height: 40,
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>
      </Box>

      <TableContainer sx={extractedDataTableScrollSx()}>
        {isLoading ? (
          <Stack alignItems="center" justifyContent="center" sx={{ py: 10 }} spacing={1.5}>
            <CircularProgress size={28} sx={{ color: FIRSTSTEP.teal }} />
            <Typography color="text.secondary">Loading extracted rows…</Typography>
          </Stack>
        ) : (
          <Table stickyHeader size="small" sx={{ minWidth: extractedDataTableMinWidthPx(visibleColumns.length) }}>
            <TableHead>
              <TableRow>
                <TableCell sx={extractedDataTableHeaderCellSx()}>Run</TableCell>
                <TableCell sx={extractedDataTableHeaderCellSx()}>Source</TableCell>
                <TableCell sx={extractedDataTableHeaderCellSx()}>Created</TableCell>
                {visibleColumns.map((column) => {
                  const meta = overrideForVisible(column);
                  const headerLabel = dataColumnLabel(column);
                  return (
                    <TableCell
                      key={column}
                      sx={{
                        ...extractedDataTableHeaderCellSx(),
                        minWidth: dataColumnMinWidthPx(column),
                      }}
                    >
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <span>{headerLabel}</span>
                        {meta?.rename && meta.original && meta.original !== column ? (
                          <Tooltip title={`Renamed from ${meta.original}`}>
                            <Chip size="small" variant="outlined" label={`from ${meta.original}`} sx={{ height: 20, fontSize: '0.65rem' }} />
                          </Tooltip>
                        ) : null}
                        {meta?.clear ? (
                          <Tooltip title="Values for this column will be empty on every new run">
                            <Chip size="small" color="warning" variant="outlined" label="cleared" sx={{ height: 20, fontSize: '0.65rem' }} />
                          </Tooltip>
                        ) : null}
                      </Stack>
                    </TableCell>
                  );
                })}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} sx={extractedDataTableRowHoverSx()}>
                  <TableCell sx={{ whiteSpace: 'nowrap', px: 1.5, py: 1.25, verticalAlign: 'top' }}>
                    <Button
                      size="small"
                      onClick={() => navigate(`/run/${row.runId}`, { state: pushReturnState(location) })}
                      sx={{
                        fontWeight: 700,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        color: FIRSTSTEP.tealDark,
                        minWidth: 0,
                        px: 0.75,
                      }}
                    >
                      {String(row.runId || '').slice(0, 8)}
                    </Button>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 140, px: 1.5, py: 1.25, verticalAlign: 'top' }}>
                    <Tooltip title={String(row.source || '')}>
                      <Typography
                        variant="body2"
                        sx={{
                          color: FIRSTSTEP.navy,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontWeight: 600,
                        }}
                      >
                        {formatSourceLabel(String(row.source || ''))}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', px: 1.5, py: 1.25, verticalAlign: 'top' }}>
                    <Typography variant="body2" sx={{ color: FIRSTSTEP.textMuted, fontWeight: 600 }}>
                      {formatRunJobAddedAt(row.createdAt) || '—'}
                    </Typography>
                  </TableCell>
                  {visibleColumns.map((column) => {
                    const cell = formatExtractedCellDisplay(column, row.data?.[column]);
                    const titleCol = isTitleColumn(column);
                    return (
                      <TableCell
                        key={column}
                        sx={{
                          minWidth: dataColumnMinWidthPx(column),
                          maxWidth: titleCol ? 420 : 280,
                          px: 1.5,
                          py: 1.25,
                          verticalAlign: 'top',
                          whiteSpace: titleCol ? 'normal' : 'nowrap',
                          overflow: titleCol ? 'visible' : 'hidden',
                          textOverflow: titleCol ? 'clip' : 'ellipsis',
                        }}
                      >
                        <Tooltip title={cell.title || ''}>
                          {cell.kind === 'url' && cell.href ? (
                            <Link
                              href={cell.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              underline="hover"
                              sx={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 0.5,
                                fontWeight: 700,
                                color: FIRSTSTEP.tealDark,
                              }}
                            >
                              Open
                              <OpenInNewIcon sx={{ fontSize: 14 }} />
                            </Link>
                          ) : cell.kind === 'f500' ? (
                            <Chip
                              size="small"
                              label={cell.text}
                              sx={{
                                height: 22,
                                fontWeight: 700,
                                bgcolor: cell.text === 'Yes' ? 'rgba(16, 185, 129, 0.12)' : FIRSTSTEP.surfaceAlt,
                                color: cell.text === 'Yes' ? FIRSTSTEP.successDeep : FIRSTSTEP.textMuted,
                              }}
                            />
                          ) : (
                            <Typography
                              variant="body2"
                              sx={{
                                color: FIRSTSTEP.navy,
                                fontWeight: titleCol ? 600 : 500,
                                lineHeight: 1.4,
                              }}
                            >
                              {cell.text}
                            </Typography>
                          )}
                        </Tooltip>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              {!rows.length ? (
                <TableRow>
                  <TableCell colSpan={Math.max(3, visibleColumns.length + 3)}>
                    <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
                      No extracted rows yet for this automation.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        )}
      </TableContainer>

      <Box
        sx={{
          px: { xs: 1, md: 2 },
          borderTop: `1px solid ${FIRSTSTEP.border}`,
          flexShrink: 0,
          bgcolor: FIRSTSTEP.surfaceAlt,
        }}
      >
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, nextPage) => setPage(nextPage)}
          rowsPerPage={limit}
          onRowsPerPageChange={(event) => {
            setLimit(parseInt(event.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[10, 25, 50, 100]}
          sx={paginationControlSx(false)}
        />
      </Box>

      <Dialog open={editOpen} onClose={closeEdit} fullWidth maxWidth="md">
        <DialogTitle>Edit columns</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Map each scraped field to a name your warehouse expects. &quot;Clear values&quot; keeps the column but
            saves empty cells on new runs. &quot;Remove column&quot; drops the field entirely (storage, exports, and
            integrations). If you remove a column that was previously renamed, pick the old stored name from the list
            (or leave empty) so legacy rows stay consistent.
          </Typography>

          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Application context (added to every row)
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
            Use this to tag runs (for example healthcare vs banking). Values appear as columns{' '}
            <strong>sectorIndustry</strong> and <strong>f500</strong> in the table, exports, and JSON. Leave unset for
            empty strings.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
            <TextField
              label="Sector / industry"
              placeholder="e.g. Healthcare, Banking"
              value={editRowContext.sectorIndustry}
              onChange={(event) =>
                setEditRowContext((prev) => ({ ...prev, sectorIndustry: event.target.value }))
              }
              disabled={savingEdit}
              fullWidth
              size="small"
            />
            <FormControl size="small" sx={{ minWidth: 200 }} disabled={savingEdit}>
              <InputLabel id="edit-f500-label">Fortune 500 (F500)</InputLabel>
              <Select
                labelId="edit-f500-label"
                label="Fortune 500 (F500)"
                value={editRowContext.f500}
                onChange={(event) =>
                  setEditRowContext((prev) => ({
                    ...prev,
                    f500: event.target.value as '' | 'yes' | 'no',
                  }))
                }
              >
                <MenuItem value="">
                  <em>Not set</em>
                </MenuItem>
                <MenuItem value="yes">Yes</MenuItem>
                <MenuItem value="no">No</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          <Divider sx={{ my: 2 }} />

          {editableColumns.length > 0 && databaseTargetColumns.length === 0 ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              Add your database column names under{' '}
              <Link component={RouterLink} to={`/automation/${id}/config`} state={pushReturnState(location)}>
                Scraper Configuration → Database column names
              </Link>{' '}
              to map with a dropdown instead of typing free text.
            </Alert>
          ) : null}

          {editableColumns.length === 0 ? (
            <Alert severity="info">
              No columns to edit yet. Run the automation at least once (and load a page that has data) so columns appear here.
            </Alert>
          ) : (
            <Stack spacing={1.5}>
              {editError ? <Alert severity="error">{editError}</Alert> : null}
              {editableColumns.map((column) => {
                const entry = draft[column] || emptyDraftEntry();
                const hasOverride =
                  !!entry.omit ||
                  !!entry.clear ||
                  (entry.rename.trim().length > 0 && entry.rename.trim() !== column);
                const renameTrim = entry.rename.trim();
                const useTargetDropdown = databaseTargetColumns.length > 0;
                const orphanLegacy =
                  useTargetDropdown && renameTrim && !databaseTargetColumns.includes(renameTrim)
                    ? renameTrim
                    : '';
                const selectValue =
                  !renameTrim || renameTrim === column ? '' : renameTrim;
                return (
                  <Stack
                    key={column}
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    alignItems={{ xs: 'stretch', sm: 'center' }}
                    sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
                  >
                    <Box sx={{ minWidth: 180 }}>
                      <Typography variant="overline" color="text.secondary">Original</Typography>
                      <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-all' }}>
                        {column}
                      </Typography>
                    </Box>
                    {useTargetDropdown ? (
                      <FormControl size="small" sx={{ flex: 1, minWidth: 200 }} disabled={savingEdit}>
                        <InputLabel id={`map-${column}`}>
                          {entry.omit ? 'Legacy stored name (optional)' : 'Map to database column'}
                        </InputLabel>
                        <Select
                          labelId={`map-${column}`}
                          label={entry.omit ? 'Legacy stored name (optional)' : 'Map to database column'}
                          value={selectValue}
                          onChange={(event) => {
                            const v = String(event.target.value);
                            updateDraft(column, { rename: v });
                          }}
                        >
                          <MenuItem value="">
                            <em>{entry.omit ? 'None (drop original key only)' : `Keep original (${column})`}</em>
                          </MenuItem>
                          {orphanLegacy ? (
                            <MenuItem value={orphanLegacy}>
                              {orphanLegacy} (current mapping — add to config or pick another)
                            </MenuItem>
                          ) : null}
                          {databaseTargetColumns.map((name) => (
                            <MenuItem key={name} value={name}>
                              {name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    ) : (
                      <TextField
                        size="small"
                        label="Rename to"
                        placeholder={column}
                        value={entry.rename}
                        onChange={(event) => updateDraft(column, { rename: event.target.value })}
                        sx={{ flex: 1, minWidth: 200 }}
                        disabled={savingEdit}
                        helperText={entry.omit ? 'Optional: previous target name strips legacy rows' : undefined}
                      />
                    )}
                    <Tooltip title="Keep the column but save empty values on every new run (not for removed columns)">
                      <Stack direction="row" alignItems="center">
                        <Checkbox
                          checked={entry.clear}
                          onChange={(event) =>
                            updateDraft(column, event.target.checked ? { clear: true, omit: false } : { clear: false })
                          }
                          disabled={savingEdit || entry.omit}
                        />
                        <Typography variant="body2">Clear values on next run</Typography>
                      </Stack>
                    </Tooltip>
                    <Tooltip title="Do not store or export this field (integrations and exports too)">
                      <Stack direction="row" alignItems="center">
                        <Checkbox
                          checked={entry.omit}
                          onChange={(event) =>
                            updateDraft(column, event.target.checked ? { omit: true, clear: false } : { omit: false })
                          }
                          disabled={savingEdit}
                        />
                        <Typography variant="body2">Remove column</Typography>
                      </Stack>
                    </Tooltip>
                    <Tooltip title="Reset to original">
                      <span>
                        <IconButton
                          onClick={() => resetColumn(column)}
                          disabled={savingEdit || !hasOverride}
                          size="small"
                        >
                          <RestartAltIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                );
              })}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEdit} disabled={savingEdit}>Cancel</Button>
          <Button onClick={saveEdit} variant="contained" disabled={savingEdit}>
            {savingEdit ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

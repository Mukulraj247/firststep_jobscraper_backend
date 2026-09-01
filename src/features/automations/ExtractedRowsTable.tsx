import React from 'react';
import {
  Chip,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { FIRSTSTEP } from '../../components/dashboard/ops/dashboardTokens';
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
} from './automationDataPageBehavior';

export type ExtractedRowRecord = {
  id: string;
  source?: string;
  data?: Record<string, unknown>;
};

type ExtractedRowsTableProps = {
  rows: ExtractedRowRecord[];
  columns: string[];
  showSource?: boolean;
  maxHeight?: number | string;
};

export const ExtractedRowsTable: React.FC<ExtractedRowsTableProps> = ({
  rows,
  columns,
  showSource = true,
  maxHeight = 520,
}) => {
  const tableMinWidth = extractedDataTableMinWidthPx(columns.length + (showSource ? 1 : 0));

  return (
    <TableContainer sx={{ ...extractedDataTableScrollSx(), maxHeight }}>
      <Table
        size="small"
        stickyHeader
        sx={{
          minWidth: tableMinWidth,
          tableLayout: 'auto',
        }}
      >
        <TableHead>
          <TableRow>
            {showSource ? (
              <TableCell sx={{ ...extractedDataTableHeaderCellSx(), minWidth: 120 }}>
                Source
              </TableCell>
            ) : null}
            {columns.map((column) => (
              <TableCell
                key={column}
                sx={{
                  ...extractedDataTableHeaderCellSx(),
                  minWidth: dataColumnMinWidthPx(column),
                }}
              >
                {dataColumnLabel(column)}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} sx={extractedDataTableRowHoverSx()}>
              {showSource ? (
                <TableCell sx={{ px: 1.5, py: 1.25, verticalAlign: 'top', minWidth: 120 }}>
                  <Tooltip title={String(row.source || '')}>
                    <Typography
                      variant="body2"
                      sx={{
                        color: FIRSTSTEP.navy,
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 160,
                      }}
                    >
                      {formatSourceLabel(String(row.source || ''))}
                    </Typography>
                  </Tooltip>
                </TableCell>
              ) : null}
              {columns.map((column) => {
                const cell = formatExtractedCellDisplay(column, row.data?.[column]);
                const titleCol = isTitleColumn(column);
                return (
                  <TableCell
                    key={column}
                    sx={{
                      minWidth: dataColumnMinWidthPx(column),
                      maxWidth: titleCol ? 420 : 300,
                      px: 1.5,
                      py: 1.25,
                      verticalAlign: 'top',
                      whiteSpace: titleCol ? 'normal' : 'nowrap',
                      overflow: titleCol ? 'visible' : 'hidden',
                      textOverflow: titleCol ? 'clip' : 'ellipsis',
                    }}
                  >
                    <Tooltip title={cell.title || ''} placement="top-start">
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
                            bgcolor:
                              cell.text === 'Yes'
                                ? 'rgba(16, 185, 129, 0.12)'
                                : FIRSTSTEP.surfaceAlt,
                            color:
                              cell.text === 'Yes' ? FIRSTSTEP.successDeep : FIRSTSTEP.textMuted,
                          }}
                        />
                      ) : (
                        <Typography
                          variant="body2"
                          sx={{
                            color: cell.text ? FIRSTSTEP.navy : FIRSTSTEP.textMuted,
                            fontWeight: titleCol ? 600 : 500,
                            lineHeight: 1.45,
                            fontStyle: cell.text ? 'normal' : 'italic',
                          }}
                        >
                          {cell.text || '—'}
                        </Typography>
                      )}
                    </Tooltip>
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export const ExtractedRowsTableSummary: React.FC<{
  rowCount: number;
  columnCount: number;
  showAllColumns: boolean;
  onToggleColumns: () => void;
}> = ({ rowCount, columnCount, showAllColumns, onToggleColumns }) => (
  <Stack
    direction={{ xs: 'column', sm: 'row' }}
    justifyContent="space-between"
    alignItems={{ xs: 'flex-start', sm: 'center' }}
    spacing={1}
    mb={2}
  >
    <Typography variant="body2" color="text.secondary">
      {rowCount} {rowCount === 1 ? 'row' : 'rows'}
      {columnCount > 0 ? ` · ${columnCount} columns` : ''}
      {!showAllColumns ? ' (key fields)' : ''}
    </Typography>
    <Typography
      component="button"
      type="button"
      onClick={onToggleColumns}
      sx={{
        border: 0,
        background: 'none',
        cursor: 'pointer',
        color: FIRSTSTEP.tealDark,
        fontWeight: 700,
        fontSize: '0.875rem',
        p: 0,
        '&:hover': { textDecoration: 'underline' },
      }}
    >
      {showAllColumns ? 'Show key columns only' : 'Show all columns'}
    </Typography>
  </Stack>
);

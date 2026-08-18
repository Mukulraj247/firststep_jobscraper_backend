export const neutralizeSpreadsheetCell = (value: unknown): unknown =>
  typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

export const escapeCsvSpreadsheetCell = (value: unknown): string =>
  `"${String(neutralizeSpreadsheetCell(value) ?? '').replace(/"/g, '""')}"`;

export const neutralizeSpreadsheetCell = (value: unknown): unknown =>
  typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

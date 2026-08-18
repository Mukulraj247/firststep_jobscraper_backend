import { describe, expect, it } from 'vitest';
import { neutralizeSpreadsheetCell } from './spreadsheet';

describe('neutralizeSpreadsheetCell', () => {
  it.each(['=1+1', '+SUM(A1:A2)', '-2+3', '@cmd', '\tformula', '\rformula'])(
    'prefixes a dangerous leading character in %j',
    (value) => {
      expect(neutralizeSpreadsheetCell(value)).toBe(`'${value}`);
    }
  );

  it.each(['safe', '  =not-leading', "'=already-literal", '', '123'])(
    'leaves safe string %j unchanged',
    (value) => {
      expect(neutralizeSpreadsheetCell(value)).toBe(value);
    }
  );

  it('leaves non-string cell values unchanged', () => {
    expect(neutralizeSpreadsheetCell(42)).toBe(42);
    expect(neutralizeSpreadsheetCell(null)).toBeNull();
  });
});

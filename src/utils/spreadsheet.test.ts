import { describe, expect, it } from 'vitest';
import { escapeCsvSpreadsheetCell } from './spreadsheet';

describe('escapeCsvSpreadsheetCell', () => {
  it('neutralizes formulas before CSV quote escaping', () => {
    expect(escapeCsvSpreadsheetCell('=HYPERLINK("https://evil.example")')).toBe(
      '"\'=HYPERLINK(""https://evil.example"")"'
    );
  });

  it('neutralizes tab and carriage-return prefixes', () => {
    expect(escapeCsvSpreadsheetCell('\tcmd')).toBe('"\'\tcmd"');
    expect(escapeCsvSpreadsheetCell('\rcmd')).toBe('"\'\rcmd"');
  });

  it('keeps safe values CSV escaped', () => {
    expect(escapeCsvSpreadsheetCell('safe "value"')).toBe('"safe ""value"""');
  });
});

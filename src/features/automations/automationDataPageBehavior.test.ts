import { describe, expect, it } from 'vitest';
import {
  dataColumnLabel,
  dataColumnMinWidthPx,
  extractedDataDialogPaperSx,
  extractedDataTableScrollSx,
  formatExtractedCellDisplay,
  formatSourceLabel,
} from './automationDataPageBehavior';

describe('extracted data presentation', () => {
  it('humanizes camelCase column names', () => {
    expect(dataColumnLabel('jobTitle')).toBe('Title');
    expect(dataColumnLabel('jobUrl')).toBe('URL');
    expect(dataColumnLabel('sectorIndustry')).toBe('Sector / industry');
    expect(dataColumnLabel('customFieldName')).toBe('Custom Field Name');
  });

  it('shows Open instead of a truncated URL', () => {
    const cell = formatExtractedCellDisplay(
      'jobUrl',
      'https://jobs.nvidia.com/en/jobs/staff-technical-program-manager-12345',
    );
    expect(cell.kind).toBe('url');
    expect(cell.text).toBe('Open');
    expect(cell.href).toContain('nvidia.com');
    expect(cell.title).toContain('https://');
  });

  it('keeps job titles intact so the table can wrap them', () => {
    const title = 'Staff Technical Program Manager, GPU Systems Architecture';
    const cell = formatExtractedCellDisplay('jobTitle', title);
    expect(cell.text).toBe(title);
    expect(cell.kind).toBe('text');
  });

  it('strips scrapeList prefixes from the source column', () => {
    expect(formatSourceLabel('scrapeList:Confidential')).toBe('Confidential');
  });

  it('gives titles a wider column than URLs', () => {
    expect(dataColumnMinWidthPx('jobTitle')).toBeGreaterThan(dataColumnMinWidthPx('jobUrl'));
  });

  it('sizes the modal as a tall sheet, not a cramped default dialog', () => {
    const paper = extractedDataDialogPaperSx();
    expect(paper.height).toEqual({ xs: '100%', md: '88vh' });
    expect(paper.maxWidth).toBe(1320);
  });

  it('keeps a visible horizontal scrollbar so right-side columns are reachable', () => {
    const scroll = extractedDataTableScrollSx();
    expect(scroll.overflowX).toBe('scroll');
    expect(scroll.scrollbarWidth).toBe('auto');
    expect(scroll['&::-webkit-scrollbar']).toMatchObject({ display: 'block', height: 12 });
  });

  it('formats ISO date cells instead of clipping the raw timestamp', () => {
    const cell = formatExtractedCellDisplay('date', '2026-08-19T07:59:18.000Z');
    expect(cell.text).toBe('19 Aug 2026, 1:29 PM IST');
    expect(cell.text).not.toContain('T07:59');
  });
});

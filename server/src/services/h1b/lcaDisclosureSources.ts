/**
 * Known DOL OFLC LCA disclosure download URLs.
 * Prefer annual Q4 (cumulative) for closed fiscal years; latest quarter for current FY.
 * Base: https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/
 */
const DOL_BASE = 'https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs';

export type LcaSourceFile = {
  fiscalYear: number;
  label: string;
  url: string;
  /** Prefer Q4 / full-year files when available. */
  preferred: boolean;
};

/**
 * Seven-year window: FY2019–FY2025 full + FY2026 latest (partial).
 * Callers can filter by year.
 */
export const LCA_DISCLOSURE_SOURCES: LcaSourceFile[] = [
  {
    fiscalYear: 2019,
    label: 'FY2019',
    url: `${DOL_BASE}/H-1B_Disclosure_Data_FY2019.xlsx`,
    preferred: true,
  },
  {
    fiscalYear: 2020,
    label: 'FY2020_Q4',
    url: `${DOL_BASE}/LCA_Disclosure_Data_FY2020_Q4.xlsx`,
    preferred: true,
  },
  {
    fiscalYear: 2021,
    label: 'FY2021_Q4',
    url: `${DOL_BASE}/LCA_Disclosure_Data_FY2021_Q4.xlsx`,
    preferred: true,
  },
  {
    fiscalYear: 2022,
    label: 'FY2022_Q4',
    url: `${DOL_BASE}/LCA_Disclosure_Data_FY2022_Q4.xlsx`,
    preferred: true,
  },
  {
    fiscalYear: 2023,
    label: 'FY2023_Q4',
    url: `${DOL_BASE}/LCA_Disclosure_Data_FY2023_Q4.xlsx`,
    preferred: true,
  },
  {
    fiscalYear: 2024,
    label: 'FY2024_Q4',
    url: `${DOL_BASE}/LCA_Disclosure_Data_FY2024_Q4.xlsx`,
    preferred: true,
  },
  {
    fiscalYear: 2025,
    label: 'FY2025_Q4',
    url: `${DOL_BASE}/LCA_Disclosure_Data_FY2025_Q4.xlsx`,
    preferred: true,
  },
  {
    fiscalYear: 2026,
    label: 'FY2026_Q3',
    // DOL media path (label has a historical typo "Dislclosure"; file is Disclosure)
    url: 'https://www.dol.gov/media/LCA_Disclosure_Data_FY2026_Q3.xlsx',
    preferred: true,
  },
];

export function pickLcaSources(opts?: { fromYear?: number; toYear?: number }): LcaSourceFile[] {
  const from = opts?.fromYear ?? 2019;
  const to = opts?.toYear ?? 2026;
  return LCA_DISCLOSURE_SOURCES.filter(
    (s) => s.preferred && s.fiscalYear >= from && s.fiscalYear <= to
  );
}

import React from 'react';
import { Chip, type ChipProps } from '@mui/material';
import { alpha } from '@mui/material/styles';

/** Colors aligned with job-tagger lab UI (CategoryBadge.jsx). Must cover FROZEN_JOB_CATEGORIES. */
export const CATEGORY_COLORS: Record<string, string> = {
  'Software Engineering': '#3b82f6',
  'Frontend Development': '#22c55e',
  'Backend Development': '#6366f1',
  'Full Stack Development': '#8b5cf6',
  'Mobile Application Development': '#ec4899',
  DevOps: '#f59e0b',
  'Site Reliability Engineering': '#ef4444',
  'Cloud Engineering': '#06b6d4',
  'Platform Engineering': '#14b8a6',
  'Data Engineering': '#a855f7',
  'Data Analyst': '#f97316',
  'Data Science': '#10b981',
  'Machine Learning Engineer': '#d946ef',
  'AI Engineer': '#6366f1',
  'QA / Testing': '#eab308',
  Cybersecurity: '#dc2626',
  'Network Engineering': '#0284c7',
  'Product Management': '#7c3aed',
  'Project Management': '#059669',
  'UI/UX Design': '#db2777',
  'Technical Support': '#65a30d',
  SAP: '#0891b2',
  Salesforce: '#9333ea',
  ERP: '#4d7c0f',
  'Blockchain / Web3': '#c2410c',
  'Embedded Systems': '#475569',
  'Electrical Engineering': '#ca8a04',
  'Game Development': '#be123c',
  'System Administration': '#0369a1',
  'Solution Architecture': '#4f46e5',
};

export interface FrozenCategoryBadgeProps {
  name: string;
  /** When provided the badge becomes removable (used by the board filter). */
  onDelete?: ChipProps['onDelete'];
}

export const FrozenCategoryBadge: React.FC<FrozenCategoryBadgeProps> = ({ name, onDelete }) => {
  const bg = CATEGORY_COLORS[name] || '#6b7280';
  return (
    <Chip
      label={name}
      size="small"
      onDelete={onDelete}
      sx={{
        height: 22,
        fontSize: '0.68rem',
        fontWeight: 700,
        letterSpacing: '-0.01em',
        color: '#fff',
        bgcolor: bg,
        border: `1px solid ${alpha('#fff', 0.12)}`,
        '& .MuiChip-label': { px: 0.85 },
        // Default delete icon is near-invisible on these saturated fills.
        '& .MuiChip-deleteIcon': {
          color: alpha('#fff', 0.75),
          fontSize: 15,
          '&:hover': { color: '#fff' },
        },
      }}
    />
  );
};

/**
 * Display guard only. The stored count is capped server-side by JOB_TAGGER_MAX_BADGES;
 * raise this too if that env var goes above 2, otherwise extra badges are hidden.
 */
export const MAX_VISIBLE_FROZEN_CATEGORIES = 2;

export function frozenCategoriesFromJob(
  data: Record<string, unknown>,
  limit: number = MAX_VISIBLE_FROZEN_CATEGORIES
): string[] {
  const raw = data.frozenCategories;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

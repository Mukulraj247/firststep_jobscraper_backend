import { WorkflowFile } from "maxun-core";

export const emptyWorkflow: WorkflowFile = { workflow: [] };

/**
 * Suggested warehouse/API field names for job-listing extractions.
 * Used as the initial "Database column names" draft when none are saved yet.
 */
export const DEFAULT_JOB_DATABASE_TARGET_COLUMNS: readonly string[] = [
  'posted_date',
  'job_title',
  'job_url',
  'company_name',
  'location',
  'job_description',
  'job_category',
  'employment_type',
  'salary_range',
  'remote_type',
  'application_url',
  'listing_source',
];

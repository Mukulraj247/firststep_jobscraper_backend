import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Link,
  Paper,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  Pagination,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CATEGORY_QA_UI_BATCH_ID,
  CategoryQaPhase,
  getCategoryQaSummary,
  listCategoryQa,
  runCategoryQaSample,
} from '../api/categoryQa';
import { cardSx, FIRSTSTEP } from '../components/dashboard/ops/dashboardTokens';

const BATCH_ID = CATEGORY_QA_UI_BATCH_ID;
const SAMPLE_COUNT = 1000;

function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Paper elevation={0} sx={{ ...cardSx(), p: 2, minWidth: 120, flex: 1 }}>
      <Typography variant="overline" sx={{ color: FIRSTSTEP.textMuted, letterSpacing: 1 }}>
        {label}
      </Typography>
      <Typography variant="h5" sx={{ fontWeight: 700, mt: 0.5 }}>
        {value}
      </Typography>
      {hint ? (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      ) : null}
    </Paper>
  );
}

function PillRow({
  labels,
  color,
}: {
  labels: string[];
  color?: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';
}) {
  if (!labels.length) {
    return (
      <Typography variant="caption" color="text.secondary">
        —
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
      {labels.map((label) => (
        <Chip key={label} size="small" label={label} color={color || 'default'} variant="outlined" />
      ))}
    </Stack>
  );
}

function locLabel(item: {
  frozenStates: string[];
  locationIsRemote: boolean;
  locationIsUs: boolean;
  location: string;
}): string {
  if (item.locationIsRemote) return 'Remote';
  if (item.frozenStates?.length) return item.frozenStates.join(', ');
  if (item.locationIsUs === false) return 'Non-US';
  return item.location || '—';
}

function h1bLabel(item: {
  h1bEligible: boolean;
  h1bCompanyScore: string;
  h1bMappingStatus: string;
}): string {
  if (!item.h1bEligible) return 'n/a';
  return `${item.h1bCompanyScore}/${item.h1bMappingStatus}`;
}

export function CategoryQaPage() {
  const queryClient = useQueryClient();
  const [phase, setPhase] = React.useState<CategoryQaPhase>('all');
  const [page, setPage] = React.useState(1);
  const [lastRunMsg, setLastRunMsg] = React.useState<string | null>(null);

  const summaryQuery = useQuery({
    queryKey: ['category-qa-summary', BATCH_ID],
    queryFn: ({ signal }) => getCategoryQaSummary(BATCH_ID, signal),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const listQuery = useQuery({
    queryKey: ['category-qa-list', BATCH_ID, phase, page],
    queryFn: ({ signal }) =>
      listCategoryQa({ batchId: BATCH_ID, phase, page, limit: 40 }, signal),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const runSample = useMutation({
    mutationFn: () => runCategoryQaSample(SAMPLE_COUNT),
    onSuccess: async (result) => {
      setLastRunMsg(
        `Sample ready: ${result.backfilled} backfilled (${result.students} student review) in ${Math.round(result.elapsedMs / 1000)}s. Review the Backfilled tab.`
      );
      setPhase('backfilled');
      setPage(1);
      await queryClient.invalidateQueries({ queryKey: ['category-qa-summary', BATCH_ID] });
      await queryClient.invalidateQueries({ queryKey: ['category-qa-list', BATCH_ID] });
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.error ||
        err?.message ||
        'Sample run failed. Is the job-tagger running on :8000?';
      setLastRunMsg(msg);
    },
  });

  const summary = summaryQuery.data;
  const list = listQuery.data;
  const totalPages = Math.max(1, Math.ceil((list?.total || 0) / (list?.limit || 40)));
  const running = runSample.isPending;

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1400, mx: 'auto' }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        alignItems={{ md: 'flex-start' }}
        justifyContent="space-between"
        sx={{ mb: 2.5 }}
      >
        <Stack spacing={0.5}>
          <Typography variant="overline" sx={{ color: FIRSTSTEP.textMuted, letterSpacing: 1.2 }}>
            Scout-X · local testing
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Category QA
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Click the button to randomly pick {SAMPLE_COUNT} job-board listings, clear specialty /
            industry / experience / location / H-1B, backfill them, and review here — no terminal.
          </Typography>
        </Stack>
        <Button
          variant="contained"
          size="large"
          disabled={running}
          onClick={() => {
            setLastRunMsg(null);
            runSample.mutate();
          }}
          sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          {running ? `Running sample…` : `Run random ${SAMPLE_COUNT} sample`}
        </Button>
      </Stack>

      {running ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Clearing and backfilling {SAMPLE_COUNT} random jobs. Keep job-tagger on port 8000. This
          usually takes 10–20+ minutes — leave this tab open.
          <LinearProgress sx={{ mt: 1.5, borderRadius: 1 }} />
        </Alert>
      ) : null}

      {lastRunMsg && !running ? (
        <Alert
          severity={runSample.isError ? 'error' : 'success'}
          sx={{ mb: 2 }}
          onClose={() => setLastRunMsg(null)}
        >
          {lastRunMsg}
        </Alert>
      ) : null}

      {summaryQuery.isFetching || listQuery.isFetching ? (
        <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />
      ) : null}
      {summaryQuery.isError || listQuery.isError ? (
        <Typography color="error" sx={{ mb: 2 }}>
          Failed to load Category QA data.
        </Typography>
      ) : null}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }} useFlexGap flexWrap="wrap">
        <Kpi label="Sample total" value={summary?.total ?? '—'} hint={BATCH_ID} />
        <Kpi label="Cleared" value={summary?.byPhase.cleared ?? '—'} />
        <Kpi label="Backfilled" value={summary?.byPhase.backfilled ?? '—'} />
        <Kpi label="Student review" value={summary?.byPhase.student_review ?? '—'} />
      </Stack>

      <Paper elevation={0} sx={{ ...cardSx(), p: 2, mb: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          Backfilled completeness (% missing)
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap flexWrap="wrap">
          <Kpi
            label="Specialty"
            value={`${summary?.completeness.pctMissingSpecialty ?? '—'}%`}
            hint={`${summary?.completeness.missingSpecialty ?? 0} / ${summary?.completeness.reviewed ?? 0}`}
          />
          <Kpi
            label="Industry"
            value={`${summary?.completeness.pctMissingIndustry ?? '—'}%`}
            hint={`${summary?.completeness.missingIndustry ?? 0} missing`}
          />
          <Kpi
            label="Experience"
            value={`${summary?.completeness.pctMissingExperience ?? '—'}%`}
            hint={`${summary?.completeness.missingExperience ?? 0} missing`}
          />
          <Kpi
            label="Location"
            value={`${summary?.completeness.pctMissingLocation ?? '—'}%`}
            hint={`${summary?.completeness.missingLocation ?? 0} missing`}
          />
          <Kpi
            label="H-1B stamp"
            value={`${summary?.completeness.pctMissingH1bStamp ?? '—'}%`}
            hint={`${summary?.completeness.missingH1bStamp ?? 0} unknown/none`}
          />
        </Stack>
      </Paper>

      <Tabs
        value={phase}
        onChange={(_e, next: CategoryQaPhase) => {
          setPhase(next);
          setPage(1);
        }}
        sx={{ mb: 1.5 }}
      >
        <Tab value="all" label={`All (${summary?.total ?? 0})`} />
        <Tab value="cleared" label={`Cleared (${summary?.byPhase.cleared ?? 0})`} />
        <Tab value="backfilled" label={`Backfilled (${summary?.byPhase.backfilled ?? 0})`} />
        <Tab
          value="student_review"
          label={`Student review (${summary?.byPhase.student_review ?? 0})`}
        />
      </Tabs>

      <Paper elevation={0} sx={{ ...cardSx(), overflow: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Job</TableCell>
              <TableCell>Specialty</TableCell>
              <TableCell>Industry</TableCell>
              <TableCell>Experience</TableCell>
              <TableCell>Location</TableCell>
              <TableCell>H-1B</TableCell>
              <TableCell>Phase</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(list?.items || []).map((item) => (
              <TableRow key={item.id} hover>
                <TableCell sx={{ minWidth: 220, maxWidth: 280 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {item.jobTitle || 'Untitled'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {item.companyName || '—'}
                  </Typography>
                  {item.jobUrl ? (
                    <Link href={item.jobUrl} target="_blank" rel="noopener noreferrer" variant="caption">
                      Open posting
                    </Link>
                  ) : null}
                  {item.studentEscape ? (
                    <Chip size="small" label="Student escape" color="warning" sx={{ mt: 0.5 }} />
                  ) : null}
                </TableCell>
                <TableCell>
                  <PillRow labels={item.frozenCategories} color="primary" />
                </TableCell>
                <TableCell>
                  <PillRow labels={item.frozenIndustries} color="secondary" />
                </TableCell>
                <TableCell>
                  <PillRow
                    labels={[...item.frozenExperienceLevels, ...item.frozenExperienceYears]}
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="caption">{locLabel(item)}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="caption">{h1bLabel(item)}</Typography>
                  {item.h1bFy2026Match ? (
                    <Chip size="small" label="FY26" sx={{ ml: 0.5 }} />
                  ) : null}
                </TableCell>
                <TableCell>
                  <Chip size="small" label={item.categoryQaPhase || '—'} variant="outlined" />
                </TableCell>
              </TableRow>
            ))}
            {!listQuery.isLoading && !(list?.items || []).length ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    No sample yet. Click <strong>Run random {SAMPLE_COUNT} sample</strong> above.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Paper>

      <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
        <Pagination
          count={totalPages}
          page={page}
          onChange={(_e, next) => setPage(next)}
          color="primary"
          size="small"
        />
      </Stack>
    </Box>
  );
}

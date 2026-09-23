import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Grid,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBack from '@mui/icons-material/ArrowBack';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import { Link } from 'react-router-dom';
import { GlassHero } from '../components/GlassHero';
import { useRequirePortalAuth } from '../hooks/usePortalAuth.tsx';
import { listRequests, submitClusterRequest } from '../api/portalApi';
import type { ClusterRequest } from '../types';
import { FROZEN_INDUSTRIES } from '../../shared/frozenIndustries';
import { FROZEN_JOB_CATEGORIES } from '../../shared/frozenJobCategories';
import { FROZEN_EXPERIENCE_LEVELS } from '../../shared/frozenExperience';
import { FROZEN_US_STATES } from '../../shared/frozenLocations';
import {
  DISPLAY_FONT,
  RADIUS,
  STITCH,
  accentButtonSx,
  ghostButtonSx,
  panelSx,
  primaryButtonSx,
  tint,
} from '../tokens';

const STEPS = ['Request type', 'Filters & criteria', 'Review & submit'];
const MAX_URLS = 10;

const fieldSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: RADIUS.control,
    bgcolor: STITCH.surfaceLowest,
    '& fieldset': { borderColor: STITCH.outlineVariant },
    '&:hover fieldset': { borderColor: tint(STITCH.secondary, 0.5) },
    '&.Mui-focused fieldset': { borderColor: STITCH.secondary },
  },
} as const;

function toggleInList(list: string[], value: string) {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

/** Normalize pasted career URLs: trim, add https:// when bare host, drop junk. */
export function normalizeCareerUrl(raw: string): string | null {
  let value = String(raw || '').trim();
  if (!value) return null;
  // Strip wrapping quotes / angle brackets from paste
  value = value.replace(/^["'<\[]+|["'>\]]+$/g, '').trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) {
    // Reject strings that clearly are not host-like
    if (!/^[a-z0-9.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(value) && !/^www\./i.test(value)) {
      return null;
    }
    value = `https://${value}`;
  }
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname || !u.hostname.includes('.')) return null;
    return u.toString().replace(/\/$/, '') === `${u.protocol}//${u.host}`
      ? `${u.protocol}//${u.host}/`
      : u.toString();
  } catch {
    return null;
  }
}

export function parseUrls(raw: string): {
  urls: string[];
  invalid: string[];
  overLimit: boolean;
} {
  const tokens = raw
    .split(/[\n,]+/)
    .map((u) => u.trim())
    .filter(Boolean);
  const urls: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const normalized = normalizeCareerUrl(token);
    if (!normalized) {
      invalid.push(token);
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(normalized);
  }
  const overLimit = urls.length > MAX_URLS;
  return { urls: urls.slice(0, MAX_URLS), invalid, overLimit };
}

export function RequestNewPage() {
  const { loading } = useRequirePortalAuth();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [existing, setExisting] = useState<ClusterRequest[]>([]);
  const [requestType, setRequestType] = useState<'predefined' | 'custom_urls'>('predefined');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [industries, setIndustries] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [experienceLevels, setExperienceLevels] = useState<string[]>([]);
  const [expMin, setExpMin] = useState('');
  const [expMax, setExpMax] = useState('');
  const [urlText, setUrlText] = useState('');
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptedContinue, setAttemptedContinue] = useState(false);

  const parsed = useMemo(() => parseUrls(urlText), [urlText]);
  const urls = parsed.urls;

  useEffect(() => {
    if (loading) return;
    listRequests().then(setExisting).catch(() => setExisting([]));
  }, [loading]);

  if (loading) return null;

  const missingStep1: string[] = [];
  if (step === 1) {
    if (!title.trim()) missingStep1.push('Cluster name');
    if (requestType === 'predefined') {
      if (industries.length === 0 && roles.length === 0 && locations.length === 0) {
        missingStep1.push('At least one industry, role, or location');
      }
    } else {
      if (urls.length === 0) missingStep1.push('At least one career page URL');
      if (roles.length === 0) missingStep1.push('At least one job title');
    }
  }

  const canNext =
    step === 0
      ? true
      : step === 1
        ? missingStep1.length === 0 && !(requestType === 'custom_urls' && parsed.invalid.length > 0)
        : true;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await submitClusterRequest({
        type: requestType,
        title:
          title.trim() ||
          (requestType === 'custom_urls' ? 'Custom company cluster' : 'Custom cluster'),
        industries,
        locations,
        roles,
        experienceLevels,
        experienceMin: Number(expMin) || undefined,
        experienceMax: Number(expMax) || undefined,
        urls: requestType === 'custom_urls' ? urls : undefined,
        notes: notes || undefined,
      });
      setDone(true);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Box sx={{ maxWidth: 520, mx: 'auto', textAlign: 'center', py: { xs: 5, md: 8 } }}>
        <Box
          aria-hidden
          sx={{
            width: 64,
            height: 64,
            mx: 'auto',
            mb: 2.5,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            bgcolor: tint(STITCH.success, 0.15),
            color: STITCH.success,
          }}
        >
          <CheckCircleOutline sx={{ fontSize: 34 }} />
        </Box>
        <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: '1.4rem', color: STITCH.primary }}>
          Request submitted
        </Typography>
        <Typography sx={{ mt: 1, color: STITCH.muted }}>
          Our team will configure and publish this cluster. It will appear on your dashboard when ready.
        </Typography>
        <Stack direction="row" spacing={1.5} justifyContent="center" sx={{ mt: 3 }}>
          <Button component={Link} to="/user/requests" variant="contained" disableElevation sx={primaryButtonSx}>
            View my requests
          </Button>
          <Button component={Link} to="/user/clusters" sx={ghostButtonSx}>
            Browse clusters
          </Button>
        </Stack>
      </Box>
    );
  }

  const titleError = attemptedContinue && step === 1 && !title.trim();
  const urlsError =
    attemptedContinue && step === 1 && requestType === 'custom_urls' && urls.length === 0;
  const rolesError =
    attemptedContinue &&
    step === 1 &&
    requestType === 'custom_urls' &&
    roles.length === 0;

  return (
    <Box>
      <Button
        component={Link}
        to="/user/requests"
        startIcon={<ArrowBack sx={{ fontSize: 17 }} />}
        sx={{ mb: 1.5, textTransform: 'none', fontWeight: 600, color: STITCH.muted }}
      >
        Back to requests
      </Button>

      <GlassHero dense>
        <Typography
          component="h1"
          sx={{
            fontFamily: DISPLAY_FONT,
            fontWeight: 700,
            fontSize: { xs: '1.5rem', md: '1.85rem' },
            color: STITCH.primaryContainer,
          }}
        >
          Request a cluster
        </Typography>
        <Typography sx={{ mt: 0.75, color: STITCH.muted, maxWidth: 560 }}>
          Pick from our predefined taxonomies, or send up to 10 company career URLs for a custom cluster.
        </Typography>
      </GlassHero>

      <Box sx={{ ...panelSx, p: { xs: 2, md: 3 }, mb: 2 }}>
        <Stepper activeStep={step} alternativeLabel sx={{ mb: 3 }}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {step === 0 && (
          <Stack spacing={2}>
            <Typography sx={{ fontWeight: 700, color: STITCH.primary }}>How do you want to define it?</Typography>
            {(
              [
                [
                  'predefined',
                  'Predefined filters',
                  'Industries, roles, locations, and experience from our backend taxonomies',
                ],
                [
                  'custom_urls',
                  'Custom company URLs',
                  'Paste up to 10 career page URLs — we configure scrapers for you',
                ],
              ] as const
            ).map(([value, heading, hint]) => {
              const on = requestType === value;
              return (
                <Box
                  key={value}
                  onClick={() => setRequestType(value)}
                  sx={{
                    p: 2,
                    borderRadius: RADIUS.card,
                    cursor: 'pointer',
                    bgcolor: on ? tint(STITCH.secondary, 0.08) : STITCH.surfaceLowest,
                    boxShadow: on
                      ? `inset 0 0 0 2px ${STITCH.secondary}`
                      : `inset 0 0 0 1px ${STITCH.outlineVariant}`,
                  }}
                >
                  <Typography sx={{ fontWeight: 700 }}>{heading}</Typography>
                  <Typography sx={{ fontSize: '0.8125rem', color: STITCH.muted }}>{hint}</Typography>
                </Box>
              );
            })}
            {existing.length > 0 && (
              <Typography sx={{ fontSize: '0.8125rem', color: STITCH.muted }}>
                You already have {existing.length} open request{existing.length === 1 ? '' : 's'}.
              </Typography>
            )}
          </Stack>
        )}

        {step === 1 && (
          <Stack spacing={2.5}>
            <TextField
              label="Cluster name"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              fullWidth
              required
              error={titleError}
              helperText={titleError ? 'Required to continue' : undefined}
              sx={fieldSx}
              placeholder={
                requestType === 'custom_urls'
                  ? 'e.g. Indian IT majors — Software Engineer'
                  : 'e.g. Banking + New Jersey'
              }
            />

            {requestType === 'custom_urls' && (
              <>
                <Alert severity="info" sx={{ borderRadius: RADIUS.card }}>
                  ScoutX can scrape <strong>99.8%</strong> of company career sites. A few employers block automation
                  based on privacy settings — we will tell you if that applies after review.
                  <Button size="small" onClick={() => setCoverageOpen(true)} sx={{ ml: 1, textTransform: 'none' }}>
                    Learn more
                  </Button>
                </Alert>
                <TextField
                  label="Company career page URLs (up to 10)"
                  value={urlText}
                  onChange={(e) => setUrlText(e.target.value)}
                  fullWidth
                  multiline
                  minRows={4}
                  required
                  error={urlsError || parsed.invalid.length > 0}
                  sx={fieldSx}
                  helperText={
                    urlsError
                      ? 'Paste at least one career page URL to continue'
                      : `${urls.length}/${MAX_URLS} URLs — paste comma-separated or one per line. Bare domains are fine (we add https://).`
                  }
                  placeholder={
                    'https://careers.tcs.com\nhttps://careers.wipro.com\nhttps://www.infosys.com/careers'
                  }
                />
                {parsed.overLimit && (
                  <Alert severity="warning" sx={{ borderRadius: RADIUS.card }}>
                    Only the first {MAX_URLS} URLs will be submitted.
                  </Alert>
                )}
                {parsed.invalid.length > 0 && (
                  <Stack direction="row" flexWrap="wrap" gap={0.75}>
                    {parsed.invalid.map((u) => (
                      <Chip
                        key={u}
                        label={`Invalid: ${u}`}
                        size="small"
                        color="error"
                        variant="outlined"
                        sx={{ borderRadius: RADIUS.pill, maxWidth: '100%' }}
                      />
                    ))}
                  </Stack>
                )}
                {urls.length > 0 && (
                  <Stack direction="row" flexWrap="wrap" gap={0.75}>
                    {urls.map((u) => (
                      <Chip
                        key={u}
                        label={u}
                        size="small"
                        sx={{
                          borderRadius: RADIUS.pill,
                          bgcolor: STITCH.secondaryContainer,
                          maxWidth: '100%',
                        }}
                      />
                    ))}
                  </Stack>
                )}
              </>
            )}

            {requestType === 'predefined' && (
              <>
                <Box>
                  <Typography sx={{ fontWeight: 700, mb: 1, fontSize: '0.85rem' }}>Industries</Typography>
                  <Stack direction="row" flexWrap="wrap" gap={0.75}>
                    {FROZEN_INDUSTRIES.slice(0, 24).map((name) => (
                      <Chip
                        key={name}
                        label={name}
                        onClick={() => setIndustries((list) => toggleInList(list, name))}
                        sx={{
                          borderRadius: RADIUS.pill,
                          fontWeight: industries.includes(name) ? 700 : 500,
                          bgcolor: industries.includes(name) ? STITCH.secondaryContainer : STITCH.surfaceLow,
                        }}
                      />
                    ))}
                  </Stack>
                </Box>
                <Box>
                  <Typography sx={{ fontWeight: 700, mb: 1, fontSize: '0.85rem' }}>
                    Target locations (US states)
                  </Typography>
                  <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ maxHeight: 140, overflow: 'auto' }}>
                    {FROZEN_US_STATES.map((s) => (
                      <Chip
                        key={s.code}
                        label={s.shortName || s.name}
                        onClick={() => setLocations((list) => toggleInList(list, s.code))}
                        sx={{
                          borderRadius: RADIUS.pill,
                          fontWeight: locations.includes(s.code) ? 700 : 500,
                          bgcolor: locations.includes(s.code) ? STITCH.secondaryContainer : STITCH.surfaceLow,
                        }}
                      />
                    ))}
                  </Stack>
                </Box>
              </>
            )}

            <Box>
              <Typography
                sx={{
                  fontWeight: 700,
                  mb: 1,
                  fontSize: '0.85rem',
                  color: rolesError ? STITCH.error : undefined,
                }}
              >
                {requestType === 'custom_urls' ? 'Titles you want *' : 'Roles / specialties'}
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={0.75}>
                {FROZEN_JOB_CATEGORIES.map((name) => (
                  <Chip
                    key={name}
                    label={name}
                    onClick={() => setRoles((list) => toggleInList(list, name))}
                    sx={{
                      borderRadius: RADIUS.pill,
                      fontWeight: roles.includes(name) ? 700 : 500,
                      bgcolor: roles.includes(name) ? STITCH.secondaryContainer : STITCH.surfaceLow,
                      ...(rolesError
                        ? { boxShadow: `inset 0 0 0 1px ${tint(STITCH.error, 0.5)}` }
                        : {}),
                    }}
                  />
                ))}
              </Stack>
              {rolesError && (
                <Typography sx={{ mt: 0.75, fontSize: '0.75rem', color: STITCH.error }}>
                  Select at least one job title to continue
                </Typography>
              )}
            </Box>

            <Box>
              <Typography sx={{ fontWeight: 700, mb: 1, fontSize: '0.85rem' }}>Experience level</Typography>
              <Stack direction="row" flexWrap="wrap" gap={0.75}>
                {FROZEN_EXPERIENCE_LEVELS.map((name) => (
                  <Chip
                    key={name}
                    label={name}
                    onClick={() => setExperienceLevels((list) => toggleInList(list, name))}
                    sx={{
                      borderRadius: RADIUS.pill,
                      fontWeight: experienceLevels.includes(name) ? 700 : 500,
                      bgcolor: experienceLevels.includes(name) ? STITCH.secondaryContainer : STITCH.surfaceLow,
                    }}
                  />
                ))}
              </Stack>
            </Box>

            <Grid container spacing={2}>
              <Grid item xs={6}>
                <TextField
                  label="Min years (optional)"
                  value={expMin}
                  onChange={(e) => setExpMin(e.target.value)}
                  fullWidth
                  sx={fieldSx}
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  label="Max years (optional)"
                  value={expMax}
                  onChange={(e) => setExpMax(e.target.value)}
                  fullWidth
                  sx={fieldSx}
                />
              </Grid>
            </Grid>

            <TextField
              label="Notes for our team"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              fullWidth
              multiline
              minRows={2}
              sx={fieldSx}
            />
          </Stack>
        )}

        {step === 2 && (
          <Stack spacing={1.5}>
            <Typography sx={{ fontWeight: 700, color: STITCH.primary }}>Review</Typography>
            <Divider />
            {[
              ['Type', requestType === 'custom_urls' ? 'Custom company URLs' : 'Predefined filters'],
              ['Name', title],
              ['Industries', industries.join(', ') || '—'],
              ['Locations', locations.join(', ') || '—'],
              ['Roles', roles.join(', ') || '—'],
              ['Experience', experienceLevels.join(', ') || '—'],
              ['YOE', `${expMin || '—'} – ${expMax || '—'}`],
              ['URLs', requestType === 'custom_urls' ? `${urls.length} career page(s)` : '—'],
            ].map(([k, v]) => (
              <Stack key={k} direction="row" justifyContent="space-between" spacing={2}>
                <Typography sx={{ color: STITCH.muted, fontSize: '0.85rem' }}>{k}</Typography>
                <Typography sx={{ fontWeight: 600, fontSize: '0.85rem', textAlign: 'right' }}>{v}</Typography>
              </Stack>
            ))}
            {requestType === 'custom_urls' &&
              urls.map((u) => (
                <Typography key={u} sx={{ fontSize: '0.75rem', color: STITCH.muted, wordBreak: 'break-all' }}>
                  {u}
                </Typography>
              ))}
            {error && (
              <Alert severity="error" sx={{ borderRadius: RADIUS.card }}>
                {error}
              </Alert>
            )}
          </Stack>
        )}

        <Stack spacing={1} sx={{ mt: 3 }}>
          {step === 1 && !canNext && attemptedContinue && missingStep1.length > 0 && (
            <Typography sx={{ fontSize: '0.8125rem', color: STITCH.error, textAlign: 'right' }}>
              Still needed: {missingStep1.join(' · ')}
            </Typography>
          )}
          <Stack direction="row" justifyContent="space-between">
            <Button disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))} sx={ghostButtonSx}>
              Back
            </Button>
            {step < 2 ? (
              <Button
                variant="contained"
                disableElevation
                onClick={() => {
                  if (step === 1 && !canNext) {
                    setAttemptedContinue(true);
                    return;
                  }
                  setAttemptedContinue(false);
                  setStep((s) => s + 1);
                }}
                sx={primaryButtonSx}
              >
                Continue
              </Button>
            ) : (
              <Button
                variant="contained"
                disableElevation
                disabled={submitting}
                onClick={submit}
                sx={accentButtonSx}
              >
                {submitting ? 'Submitting…' : 'Submit request'}
              </Button>
            )}
          </Stack>
        </Stack>
      </Box>

      <Dialog open={coverageOpen} onClose={() => setCoverageOpen(false)}>
        <DialogTitle>Company coverage</DialogTitle>
        <DialogContent>
          <DialogContentText>
            ScoutX scrapes public company career portals. Based on our configuration and the employer&apos;s privacy /
            bot protections, a small fraction of sites may not be reachable. We successfully cover approximately{' '}
            <strong>99.8%</strong> of companies. If a URL cannot be scraped, our team will note that when fulfilling
            your request.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCoverageOpen(false)} sx={primaryButtonSx}>
            Got it
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

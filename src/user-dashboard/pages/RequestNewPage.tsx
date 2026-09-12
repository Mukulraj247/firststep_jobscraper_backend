import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
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
import { Link, useNavigate } from 'react-router-dom';
import { GlassHero } from '../components/GlassHero';
import { useRequirePortalAuth } from '../hooks/usePortalAuth';
import { listRequests, submitClusterRequest } from '../mock/mockApi';
import type { ClusterRequest } from '../types';
import {
  BODY_FONT,
  DISPLAY_FONT,
  RADIUS,
  STITCH,
  accentButtonSx,
  ghostButtonSx,
  panelSx,
  primaryButtonSx,
  tint,
} from '../tokens';

const STEPS = ['Intent & Domain Scope', 'Target Filters & Criteria', 'Review & Dispatch'];

const ROLE_OPTIONS = [
  'Software Engineer',
  'Quant Developer',
  'Data Scientist',
  'Product Manager',
  'Analyst',
  'Site Reliability',
];

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

export function RequestNewPage() {
  const { loading } = useRequirePortalAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [existing, setExisting] = useState<ClusterRequest[]>([]);
  const [title, setTitle] = useState('Banking + New Jersey');
  const [notes, setNotes] = useState('Prefer H-1B sponsorship-friendly employers.');
  const [industryTags, setIndustryTags] = useState(['Banking', 'Finance']);
  const [locationTags, setLocationTags] = useState(['New Jersey', 'Jersey City']);
  const [roleTags, setRoleTags] = useState(['Software Engineer', 'Analyst']);
  const [expMin, setExpMin] = useState('0');
  const [expMax, setExpMax] = useState('3');
  const [speed, setSpeed] = useState<'2h' | '1h'>('2h');
  const [industryDraft, setIndustryDraft] = useState('');
  const [locationDraft, setLocationDraft] = useState('');

  useEffect(() => {
    if (loading) return;
    listRequests().then(setExisting);
  }, [loading]);

  if (loading) return null;

  const submit = async () => {
    setSubmitting(true);
    await submitClusterRequest({
      title,
      industries: industryTags,
      locations: locationTags,
      roles: roleTags,
      experienceMin: Number(expMin) || undefined,
      experienceMax: Number(expMax) || undefined,
      notes: notes || undefined,
    });
    setSubmitting(false);
    setDone(true);
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
        <Typography sx={{ color: STITCH.muted, mt: 1 }}>
          Our team will scope <strong>{title}</strong> and build the cluster. You&apos;ll see status changes on your
          requests page.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="center" sx={{ mt: 3 }}>
          <Button variant="contained" disableElevation onClick={() => navigate('/user/requests')} sx={primaryButtonSx}>
            View my requests
          </Button>
          <Button component={Link} to="/user/clusters" variant="outlined" sx={ghostButtonSx}>
            Browse clusters
          </Button>
        </Stack>
      </Box>
    );
  }

  const SpecPanel = (
    <Box sx={{ ...panelSx, p: 2.5, position: { md: 'sticky' }, top: { md: 88 } }}>
      <Typography
        sx={{
          fontSize: '0.68rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: STITCH.muted,
          mb: 1.5,
        }}
      >
        Cluster Specification
      </Typography>
      <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, color: STITCH.primary, mb: 1 }}>{title || 'Untitled cluster'}</Typography>
      <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mb: 2 }}>
        <Chip
          label={`${expMin}–${expMax} YOE`}
          size="small"
          sx={{ fontWeight: 700, bgcolor: STITCH.secondaryContainer, color: STITCH.onSecondaryContainer }}
        />
        <Chip label="H-1B Verified" size="small" sx={{ fontWeight: 700, bgcolor: STITCH.surfaceContainer, color: STITCH.onSurface }} />
        <Chip
          label={speed === '1h' ? '1h Fast track' : '2h Standard'}
          size="small"
          sx={{ fontWeight: 700, bgcolor: STITCH.primaryContainer, color: STITCH.onPrimary }}
        />
      </Stack>
      <Stack spacing={0.75} sx={{ mb: 2 }}>
        {[
          'Daily ATS parsing',
          'LinkedIn enrichment',
          'Curator QA before publish',
          'Portal + feed delivery',
        ].map((item) => (
          <Stack key={item} direction="row" spacing={0.75} alignItems="center">
            <CheckCircleOutline sx={{ fontSize: 16, color: STITCH.secondary }} />
            <Typography sx={{ fontSize: '0.8rem', color: STITCH.onSurface }}>{item}</Typography>
          </Stack>
        ))}
      </Stack>
      <Button
        fullWidth
        variant="contained"
        disableElevation
        disabled={submitting || step < 2}
        onClick={submit}
        sx={{ ...accentButtonSx, py: 1.25 }}
      >
        {submitting ? 'Submitting…' : 'Submit Custom Request (Demo)'}
      </Button>
      <Box sx={{ mt: 2, p: 1.5, borderRadius: RADIUS.control, bgcolor: STITCH.surfaceLow }}>
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: STITCH.muted }}>Assigned curator</Typography>
        <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: STITCH.onSurface, mt: 0.35 }}>
          Financial Tech Lead · 24–48h SLA
        </Typography>
      </Box>
    </Box>
  );

  return (
    <Box>
      <Button
        component={Link}
        to="/user/requests"
        startIcon={<ArrowBack sx={{ fontSize: 17 }} />}
        sx={{ mb: 1.5, textTransform: 'none', fontWeight: 600, color: STITCH.muted, '&:hover': { color: STITCH.primary } }}
      >
        My requests
      </Button>

      <GlassHero dense>
        <Typography
          sx={{
            fontSize: '0.68rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: STITCH.primaryContainer,
            fontFamily: BODY_FONT,
            mb: 1,
          }}
        >
          Custom cluster builder
        </Typography>
        <Typography
          component="h1"
          sx={{
            fontFamily: DISPLAY_FONT,
            fontWeight: 700,
            letterSpacing: '-0.03em',
            fontSize: { xs: '1.5rem', md: '2rem' },
            lineHeight: 1.15,
            color: STITCH.primaryContainer,
          }}
        >
          Create Custom Role Cluster
        </Typography>
        <Typography sx={{ mt: 0.75, color: STITCH.muted, maxWidth: 640 }}>
          Describe the niche you want. Our curators build and maintain the filters — typically live in 24–48 hours.
        </Typography>
      </GlassHero>

      <Grid container spacing={2.5} alignItems="flex-start">
        <Grid item xs={12} md={8}>
          <Box sx={{ ...panelSx, p: { xs: 2, md: 3 } }}>
            <Stepper
              activeStep={step}
              alternativeLabel
              sx={{
                mb: 3.5,
                '& .MuiStepLabel-label': { fontSize: '0.75rem', fontWeight: 600, color: STITCH.muted },
                '& .MuiStepLabel-label.Mui-active': { color: STITCH.primary },
                '& .MuiStepLabel-label.Mui-completed': { color: STITCH.secondary },
                '& .MuiStepIcon-root.Mui-active': { color: STITCH.secondary },
                '& .MuiStepIcon-root.Mui-completed': { color: STITCH.secondary },
              }}
            >
              {STEPS.map((label) => (
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>

            {step === 0 && (
              <Stack spacing={2}>
                <TextField
                  label="Cluster label"
                  helperText="A short name you'll recognise in subscriptions"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  fullWidth
                  sx={fieldSx}
                />
                <Box>
                  <Typography sx={{ fontWeight: 600, mb: 1, fontSize: '0.875rem' }}>Target industries</Typography>
                  <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mb: 1 }}>
                    {industryTags.map((tag) => (
                      <Chip
                        key={tag}
                        label={tag}
                        onDelete={() => setIndustryTags((t) => t.filter((x) => x !== tag))}
                        sx={{ bgcolor: STITCH.secondaryContainer, color: STITCH.onSecondaryContainer, fontWeight: 600 }}
                      />
                    ))}
                  </Stack>
                  <TextField
                    size="small"
                    placeholder="Add industry and press Enter"
                    value={industryDraft}
                    onChange={(e) => setIndustryDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && industryDraft.trim()) {
                        e.preventDefault();
                        setIndustryTags((t) => [...t, industryDraft.trim()]);
                        setIndustryDraft('');
                      }
                    }}
                    fullWidth
                    sx={fieldSx}
                  />
                </Box>
                <Box>
                  <Typography sx={{ fontWeight: 600, mb: 1, fontSize: '0.875rem' }}>Target locations</Typography>
                  <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mb: 1 }}>
                    {locationTags.map((tag) => (
                      <Chip
                        key={tag}
                        label={tag}
                        onDelete={() => setLocationTags((t) => t.filter((x) => x !== tag))}
                        sx={{ bgcolor: STITCH.surfaceContainer, fontWeight: 600 }}
                      />
                    ))}
                  </Stack>
                  <TextField
                    size="small"
                    placeholder="Add location and press Enter"
                    value={locationDraft}
                    onChange={(e) => setLocationDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && locationDraft.trim()) {
                        e.preventDefault();
                        setLocationTags((t) => [...t, locationDraft.trim()]);
                        setLocationDraft('');
                      }
                    }}
                    fullWidth
                    sx={fieldSx}
                  />
                </Box>
              </Stack>
            )}

            {step === 1 && (
              <Stack spacing={2.5}>
                <Box>
                  <Typography sx={{ fontWeight: 600, mb: 1, fontSize: '0.875rem' }}>Tracked roles</Typography>
                  <Grid container spacing={1}>
                    {ROLE_OPTIONS.map((role) => {
                      const on = roleTags.includes(role);
                      return (
                        <Grid item xs={6} sm={4} key={role}>
                          <Box
                            onClick={() => setRoleTags((t) => toggleInList(t, role))}
                            sx={{
                              p: 1.5,
                              borderRadius: RADIUS.card,
                              cursor: 'pointer',
                              textAlign: 'center',
                              fontWeight: 600,
                              fontSize: '0.8rem',
                              bgcolor: on ? tint(STITCH.secondary, 0.1) : STITCH.surfaceLowest,
                              boxShadow: on
                                ? `inset 0 0 0 2px ${STITCH.secondary}`
                                : `inset 0 0 0 1px ${STITCH.outlineVariant}`,
                              color: STITCH.onSurface,
                            }}
                          >
                            {role}
                          </Box>
                        </Grid>
                      );
                    })}
                  </Grid>
                </Box>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="Min experience (years)"
                    value={expMin}
                    onChange={(e) => setExpMin(e.target.value)}
                    type="number"
                    fullWidth
                    sx={fieldSx}
                  />
                  <TextField
                    label="Max experience (years)"
                    value={expMax}
                    onChange={(e) => setExpMax(e.target.value)}
                    type="number"
                    fullWidth
                    sx={fieldSx}
                  />
                </Stack>
                <TextField
                  label="Custom notes / visa rules"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  multiline
                  rows={3}
                  fullWidth
                  sx={fieldSx}
                />
                <Box>
                  <Typography sx={{ fontWeight: 600, mb: 1, fontSize: '0.875rem' }}>Delivery speed</Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                    {(
                      [
                        ['2h', '2 hours (Standard)'],
                        ['1h', '1 hour (Fast track)'],
                      ] as const
                    ).map(([value, label]) => {
                      const on = speed === value;
                      return (
                        <Box
                          key={value}
                          onClick={() => setSpeed(value)}
                          sx={{
                            flex: 1,
                            p: 2,
                            borderRadius: RADIUS.card,
                            cursor: 'pointer',
                            bgcolor: on ? tint(STITCH.secondary, 0.1) : STITCH.surfaceLowest,
                            boxShadow: on
                              ? `inset 0 0 0 2px ${STITCH.secondary}`
                              : `inset 0 0 0 1px ${STITCH.outlineVariant}`,
                          }}
                        >
                          <Typography sx={{ fontWeight: 700 }}>{label}</Typography>
                        </Box>
                      );
                    })}
                  </Stack>
                </Box>
              </Stack>
            )}

            {step === 2 && (
              <Box sx={{ borderRadius: RADIUS.card, bgcolor: STITCH.surfaceLow, p: { xs: 2, md: 2.5 } }}>
                <Typography sx={{ fontWeight: 700, color: STITCH.primary, mb: 1.5 }}>Review & dispatch</Typography>
                <Stack divider={<Divider flexItem />} spacing={1.25}>
                  {[
                    ['Cluster label', title],
                    ['Industries', industryTags.join(', ') || '—'],
                    ['Locations', locationTags.join(', ') || '—'],
                    ['Roles', roleTags.join(', ') || '—'],
                    ['Experience', `${expMin}–${expMax} years`],
                    ['Speed', speed === '1h' ? '1-hour fast track' : '2-hour standard'],
                    ...(notes ? [['Notes', notes]] : []),
                  ].map(([label, value]) => (
                    <Stack key={label as string} direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.25, sm: 2 }} sx={{ pt: 1.25 }}>
                      <Typography variant="body2" sx={{ color: STITCH.muted, minWidth: 140, fontWeight: 600 }}>
                        {label}
                      </Typography>
                      <Typography variant="body2" sx={{ color: STITCH.onSurface }}>
                        {value}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              </Box>
            )}

            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 3 }}>
              <Button
                disabled={step === 0}
                onClick={() => setStep((s) => s - 1)}
                sx={{ textTransform: 'none', fontWeight: 600, color: STITCH.primary }}
              >
                Back
              </Button>
              {step < 2 ? (
                <Button variant="contained" disableElevation onClick={() => setStep((s) => s + 1)} sx={primaryButtonSx}>
                  Continue
                </Button>
              ) : (
                <Button variant="contained" disableElevation disabled={submitting} onClick={submit} sx={accentButtonSx}>
                  {submitting ? 'Submitting…' : 'Submit Custom Request (Demo)'}
                </Button>
              )}
            </Stack>
          </Box>
        </Grid>
        <Grid item xs={12} md={4}>
          {SpecPanel}
        </Grid>
      </Grid>

      {existing.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 600, fontSize: '1.15rem', mb: 1.5 }}>
            My Existing Requests
          </Typography>
          <Grid container spacing={1.5}>
            {existing.slice(0, 3).map((req) => (
              <Grid item xs={12} sm={4} key={req.id}>
                <Box sx={{ ...panelSx, p: 2 }}>
                  <Typography sx={{ fontWeight: 700, color: STITCH.primary }}>{req.title}</Typography>
                  <Typography sx={{ fontSize: '0.75rem', color: STITCH.muted, mt: 0.5, textTransform: 'capitalize' }}>
                    {req.status.replace('_', ' ')}
                  </Typography>
                </Box>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}
    </Box>
  );
}

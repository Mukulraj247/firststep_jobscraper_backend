import React, { useEffect, useState } from 'react';
import { Avatar, Box, Button, Chip, Divider, Grid, Stack, Switch, Typography } from '@mui/material';
import BookmarkBorder from '@mui/icons-material/BookmarkBorder';
import EditNoteOutlined from '@mui/icons-material/EditNoteOutlined';
import LogoutOutlined from '@mui/icons-material/LogoutOutlined';
import SubscriptionsOutlined from '@mui/icons-material/SubscriptionsOutlined';
import { Link } from 'react-router-dom';
import { DemoPersonaSwitcher } from '../components/DemoPersonaSwitcher';
import { PageHeader } from '../components/PageHeader';
import { PanelSkeleton } from '../components/Skeletons';
import { usePortalAuth, useRequirePortalAuth } from '../hooks/usePortalAuth';
import { listRequests, listSaved, listSubscriptions } from '../mock/mockApi';
import type { PersonaKey } from '../mock/mockPersonas';
import { initialsOf } from '../utils/format';
import { FIRSTSTEP, RADIUS, ghostButtonSx, panelSx, tint } from '../tokens';

type Counts = { subs: number; saved: number; requests: number };

const PREFERENCES = [
  { key: 'digest', label: 'Email digest', hint: 'A daily summary of new roles across your clusters' },
  { key: 'sms', label: 'SMS alerts', hint: 'Text me when a high-priority match appears' },
  { key: 'weekly', label: 'Weekly recap', hint: 'Applications, saves, and cluster activity' },
];

function SettingsCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Box sx={{ ...panelSx, p: { xs: 2, md: 2.5 } }}>
      <Typography sx={{ fontWeight: 700, color: FIRSTSTEP.navyDeep, fontSize: '0.98rem' }}>{title}</Typography>
      {description && (
        <Typography variant="body2" sx={{ color: FIRSTSTEP.textMuted, mt: 0.5 }}>
          {description}
        </Typography>
      )}
      <Box sx={{ mt: 2 }}>{children}</Box>
    </Box>
  );
}

export function ProfilePage() {
  const { user, loading, logout, switchDemoPersona, authMode } = usePortalAuth();
  useRequirePortalAuth();
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    if (loading || !user) return;
    Promise.all([listSubscriptions(), listSaved(), listRequests()]).then(([subs, saved, reqs]) =>
      setCounts({
        subs: subs.filter((s) => s.status === 'active').length,
        saved: saved.length,
        requests: reqs.filter((r) => r.status !== 'published').length,
      }),
    );
  }, [loading, user]);

  if (loading || !user) return null;

  const persona = (user.persona === 'marcus' ? 'marcus' : 'priya') as PersonaKey;

  const summary = [
    { label: 'Active subscriptions', value: counts?.subs ?? 0, icon: SubscriptionsOutlined, to: '/user/subscriptions' },
    { label: 'Saved jobs', value: counts?.saved ?? 0, icon: BookmarkBorder, to: '/user/saved' },
    { label: 'Open requests', value: counts?.requests ?? 0, icon: EditNoteOutlined, to: '/user/requests' },
  ];

  return (
    <Box>
      <PageHeader
        eyebrow="Account"
        title="Profile & settings"
        subtitle="Manage how ScoutText reaches you and review what's active on your account."
      />

      <Grid container spacing={{ xs: 2, md: 3 }}>
        <Grid item xs={12} md={7}>
          <Stack spacing={2}>
            <Box sx={{ ...panelSx, p: { xs: 2, md: 2.5 } }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                <Avatar
                  sx={{
                    width: 64,
                    height: 64,
                    fontSize: '1.4rem',
                    fontWeight: 700,
                    background: `linear-gradient(135deg, ${FIRSTSTEP.navy} 0%, ${FIRSTSTEP.tealDark} 100%)`,
                    color: FIRSTSTEP.white,
                  }}
                >
                  {initialsOf(user.name)}
                </Avatar>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: '1.25rem', color: FIRSTSTEP.navyDeep }}>
                    {user.name}
                  </Typography>
                  <Typography variant="body2" sx={{ color: FIRSTSTEP.textMuted }}>
                    {user.email}
                  </Typography>
                  {(user.firstStepPlan?.subscriptionType || user.firstStepRole) && (
                    <Typography variant="caption" sx={{ display: 'block', color: FIRSTSTEP.textMuted, mt: 0.5 }}>
                      First Step: {user.firstStepPlan?.subscriptionType || '—'}
                      {user.firstStepRole ? ` · role ${user.firstStepRole}` : ''}
                    </Typography>
                  )}
                  <Chip
                    label="ScoutText member"
                    size="small"
                    sx={{
                      mt: 1,
                      height: 22,
                      borderRadius: RADIUS.pill,
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      bgcolor: tint(FIRSTSTEP.teal, 0.14),
                      color: FIRSTSTEP.tealDark,
                    }}
                  />
                </Box>
              </Stack>
            </Box>

            <SettingsCard
              title="Notification preferences"
              description="Delivery channels are coming soon — your feed keeps refreshing in the meantime."
            >
              <Stack divider={<Divider flexItem />}>
                {PREFERENCES.map((pref) => (
                  <Stack
                    key={pref.key}
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
                    spacing={2}
                    sx={{ py: 1.25 }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: FIRSTSTEP.navyDeep }}>
                        {pref.label}
                      </Typography>
                      <Typography variant="caption" sx={{ color: FIRSTSTEP.textMuted }}>
                        {pref.hint}
                      </Typography>
                    </Box>
                    <Switch disabled inputProps={{ 'aria-label': pref.label }} />
                  </Stack>
                ))}
              </Stack>
            </SettingsCard>

            {authMode === 'mock' && (
              <DemoPersonaSwitcher
                value={persona}
                onChange={async (p) => {
                  await switchDemoPersona(p);
                  window.location.reload();
                }}
              />
            )}
          </Stack>
        </Grid>

        <Grid item xs={12} md={5}>
          <Stack spacing={2}>
            <SettingsCard title="Account summary">
              {counts === null ? (
                <PanelSkeleton height={148} />
              ) : (
                <Stack spacing={1}>
                  {summary.map(({ label, value, icon: Icon, to }) => (
                    <Stack
                      key={label}
                      component={Link}
                      to={to}
                      direction="row"
                      alignItems="center"
                      spacing={1.5}
                      sx={{
                        p: 1.25,
                        borderRadius: RADIUS.control,
                        textDecoration: 'none',
                        bgcolor: FIRSTSTEP.surface,
                        '&:hover': { bgcolor: tint(FIRSTSTEP.teal, 0.08) },
                      }}
                    >
                      <Box
                        aria-hidden
                        sx={{
                          width: 32,
                          height: 32,
                          flexShrink: 0,
                          borderRadius: RADIUS.control,
                          display: 'grid',
                          placeItems: 'center',
                          bgcolor: tint(FIRSTSTEP.teal, 0.14),
                          color: FIRSTSTEP.tealDark,
                        }}
                      >
                        <Icon sx={{ fontSize: 17 }} />
                      </Box>
                      <Typography variant="body2" sx={{ flex: 1, color: FIRSTSTEP.navy, fontWeight: 500 }}>
                        {label}
                      </Typography>
                      <Typography sx={{ fontWeight: 700, color: FIRSTSTEP.navyDeep }}>{value}</Typography>
                    </Stack>
                  ))}
                </Stack>
              )}
            </SettingsCard>

            <SettingsCard title="Session" description="This prototype uses a mock session stored in your browser.">
              <Button
                variant="outlined"
                onClick={logout}
                startIcon={<LogoutOutlined sx={{ fontSize: 18 }} />}
                sx={{ ...ghostButtonSx, color: FIRSTSTEP.danger, '&:hover': { borderColor: FIRSTSTEP.danger, bgcolor: tint(FIRSTSTEP.danger, 0.06) } }}
              >
                Log out
              </Button>
            </SettingsCard>
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
}

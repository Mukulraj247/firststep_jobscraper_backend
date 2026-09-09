import type { ClusterRequest, ClusterSubscription, PortalUser } from '../types';

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 60 * 60 * 1000).toISOString();
const daysAgo = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000).toISOString();

export const PERSONA_PRIYA: PortalUser = {
  id: 'user-priya',
  name: 'Priya Sharma',
  email: 'priya@university.edu',
  persona: 'priya',
};

export const PERSONA_MARCUS: PortalUser = {
  id: 'user-marcus',
  name: 'Marcus Chen',
  email: 'marcus.chen@email.com',
  persona: 'marcus',
};

export const PRIYA_SUBSCRIPTIONS: ClusterSubscription[] = [
  {
    id: 'sub-priya-faang',
    clusterId: 'cluster-faang',
    clusterName: 'FAANG Software',
    planId: 'plan-standard',
    frequency: '2h',
    status: 'active',
    subscribedAt: daysAgo(14),
    nextRefreshAt: hoursAgo(-1.5),
  },
];

export const MARCUS_SUBSCRIPTIONS: ClusterSubscription[] = [
  {
    id: 'sub-marcus-google',
    clusterId: 'cluster-google',
    clusterName: 'Google Careers',
    planId: 'plan-pro',
    frequency: '1h',
    status: 'active',
    subscribedAt: daysAgo(30),
    nextRefreshAt: hoursAgo(-0.5),
  },
  {
    id: 'sub-marcus-consulting',
    clusterId: 'cluster-consulting-nyc',
    clusterName: 'Consulting NYC',
    planId: 'plan-standard',
    frequency: '24h',
    status: 'active',
    subscribedAt: daysAgo(7),
    nextRefreshAt: hoursAgo(-20),
  },
];

export const PRIYA_REQUESTS: ClusterRequest[] = [
  {
    id: 'req-priya-banking-nj',
    title: 'Banking + New Jersey',
    industries: ['Banking', 'Finance'],
    locations: ['New Jersey', 'Jersey City', 'Newark'],
    roles: ['Analyst', 'Software Developer'],
    experienceMin: 0,
    experienceMax: 3,
    notes: 'Prefer roles with training programs for new grads.',
    status: 'submitted',
    submittedAt: daysAgo(3),
  },
];

export const MARCUS_REQUESTS: ClusterRequest[] = [];

export const PRIYA_SAVED = ['job-003', 'job-012', 'job-021'];
export const MARCUS_SAVED = ['job-001', 'job-005', 'job-008', 'job-015'];

export type PersonaKey = 'priya' | 'marcus';

export function getPersonaDefaults(persona: PersonaKey) {
  if (persona === 'marcus') {
    return {
      user: PERSONA_MARCUS,
      subscriptions: MARCUS_SUBSCRIPTIONS,
      savedJobIds: MARCUS_SAVED,
      requests: MARCUS_REQUESTS,
    };
  }
  return {
    user: PERSONA_PRIYA,
    subscriptions: PRIYA_SUBSCRIPTIONS,
    savedJobIds: PRIYA_SAVED,
    requests: PRIYA_REQUESTS,
  };
}

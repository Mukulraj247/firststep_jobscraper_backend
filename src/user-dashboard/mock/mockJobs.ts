import type { FeedJob } from '../types';

const now = Date.now();
const mins = (m: number) => new Date(now - m * 60 * 1000).toISOString();
const hours = (h: number) => new Date(now - h * 60 * 60 * 1000).toISOString();

const COMPANIES = [
  { name: 'Google', domain: 'google.com', clusterId: 'cluster-google', clusterName: 'Google Careers' },
  { name: 'Meta', domain: 'meta.com', clusterId: 'cluster-meta', clusterName: 'Meta Careers' },
  { name: 'Amazon', domain: 'amazon.com', clusterId: 'cluster-faang', clusterName: 'FAANG Software' },
  { name: 'Apple', domain: 'apple.com', clusterId: 'cluster-faang', clusterName: 'FAANG Software' },
  { name: 'Netflix', domain: 'netflix.com', clusterId: 'cluster-faang', clusterName: 'FAANG Software' },
  { name: 'JPMorgan Chase', domain: 'jpmorganchase.com', clusterId: 'cluster-banking-nj', clusterName: 'Banking NJ' },
  { name: 'Goldman Sachs', domain: 'goldmansachs.com', clusterId: 'cluster-banking-nj', clusterName: 'Banking NJ' },
  { name: 'McKinsey & Company', domain: 'mckinsey.com', clusterId: 'cluster-consulting-nyc', clusterName: 'Consulting NYC' },
  { name: 'BCG', domain: 'bcg.com', clusterId: 'cluster-consulting-nyc', clusterName: 'Consulting NYC' },
  { name: 'MD Anderson', domain: 'mdanderson.org', clusterId: 'cluster-healthcare-tx', clusterName: 'Healthcare Texas' },
  { name: 'Stripe', domain: 'stripe.com', clusterId: 'cluster-startup-remote', clusterName: 'Startup Remote' },
  { name: 'Databricks', domain: 'databricks.com', clusterId: 'cluster-data-science', clusterName: 'Data Science & ML' },
  { name: 'CrowdStrike', domain: 'crowdstrike.com', clusterId: 'cluster-cybersecurity', clusterName: 'Cybersecurity' },
];

const TITLES = [
  'Software Engineer',
  'Senior Software Engineer',
  'Staff Software Engineer',
  'Product Manager',
  'Data Scientist',
  'Machine Learning Engineer',
  'Security Engineer',
  'Financial Analyst',
  'Management Consultant',
  'Frontend Engineer',
  'Backend Engineer',
  'Full Stack Developer',
  'DevOps Engineer',
  'Cloud Architect',
  'UX Designer',
];

const LOCATIONS = [
  'Mountain View, CA',
  'New York, NY',
  'Jersey City, NJ',
  'Austin, TX',
  'Seattle, WA',
  'Remote — US',
  'Menlo Park, CA',
  'Houston, TX',
  'Chicago, IL',
  'Boston, MA',
];

const WORK_MODES: Array<'Remote' | 'Hybrid' | 'Onsite'> = ['Remote', 'Hybrid', 'Onsite'];
const JOB_TYPES = ['Full time', 'Contract', 'Internship'];

function buildJob(index: number): FeedJob {
  const co = COMPANIES[index % COMPANIES.length];
  const title = TITLES[index % TITLES.length];
  const location = LOCATIONS[index % LOCATIONS.length];
  const workMode = WORK_MODES[index % WORK_MODES.length];
  const ageMinutes = (index % 48) * 15 + 5;
  const h1bEligible = index % 3 !== 0;
  const h1bFy2026Match = h1bEligible && index % 4 === 0;

  return {
    id: `job-${String(index + 1).padStart(3, '0')}`,
    clusterId: co.clusterId,
    clusterName: co.clusterName,
    title: index % 7 === 0 ? `${title} II` : title,
    company: co.name,
    location,
    jobType: JOB_TYPES[index % JOB_TYPES.length],
    workMode,
    experience: index % 5 === 0 ? '0–2 years' : index % 5 === 1 ? '3–5 years' : '5+ years',
    salary: index % 2 === 0 ? '$140k–$180k' : '$120k–$160k',
    postedAt: ageMinutes < 60 ? mins(ageMinutes) : hours(Math.floor(ageMinutes / 60)),
    lastSeenAt: mins(Math.max(5, ageMinutes - 10)),
    applyUrl: `https://careers.example.com/${co.domain}/job-${index + 1}`,
    description: `## About the role\n\nJoin ${co.name} as a ${title}. You'll work on impactful products serving millions of users.\n\n## Requirements\n\n- Strong fundamentals in software engineering\n- Experience with modern web stacks\n- Excellent communication skills\n\n## Benefits\n\n- Competitive compensation\n- Health, dental, vision\n- Flexible work arrangements`,
    logoUrl: `https://www.google.com/s2/favicons?domain=${co.domain}&sz=128`,
    sectorIndustry: index % 2 === 0 ? 'Technology' : 'Finance',
    h1bEligible,
    h1bFy2026Match,
    saved: false,
  };
}

export const MOCK_JOBS: FeedJob[] = Array.from({ length: 55 }, (_, i) => buildJob(i));

export const getJobById = (id: string): FeedJob | undefined =>
  MOCK_JOBS.find((j) => j.id === id);

export const getJobsForCluster = (clusterId: string): FeedJob[] =>
  MOCK_JOBS.filter((j) => j.clusterId === clusterId);

/** Priya's saved job ids */
export const PRIYA_SAVED_IDS = ['job-003', 'job-012', 'job-021'];

/** Jobs with strong H-1B signals for Marcus demo */
export const MARCUS_H1B_JOB_IDS = MOCK_JOBS.filter((j) => j.h1bEligible && j.h1bFy2026Match).slice(0, 8).map((j) => j.id);

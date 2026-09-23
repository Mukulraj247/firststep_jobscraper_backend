/**
 * Seed curated ScoutX clusters for the portal catalog.
 *
 * Usage:
 *   npx ts-node --project server/tsconfig.json server/src/scripts/seedCuratedClusters.ts
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import mongoose from 'mongoose';
import Cluster from '../models/Cluster';
import { countJobsForCluster, distinctCompaniesForCluster } from '../services/clusterFeed';

const SEEDS = [
  {
    slug: 'faang-software',
    name: 'FAANG Software',
    description:
      'Software engineering roles across FAANG and adjacent big-tech employers.',
    kind: 'curated' as const,
    companyLogos: ['google.com', 'meta.com', 'amazon.com', 'apple.com', 'netflix.com'],
    filtersSummary: ['Software Engineering', 'Big Tech', 'US'],
    filter: {
      frozenIndustries: ['Big Tech', 'Software / SaaS'],
      frozenCategories: ['Software Engineering', 'Full Stack Development', 'Backend Development'],
      frozenExperienceLevels: [],
      frozenExperienceYears: [],
      frozenStates: [],
      excludeStudentEscape: true,
    },
  },
  {
    slug: 'banking-nj',
    name: 'Banking NJ',
    description: 'Finance and technology roles at banks and fintech firms in New Jersey and NYC metro.',
    kind: 'curated' as const,
    companyLogos: ['jpmorganchase.com', 'goldmansachs.com', 'citigroup.com'],
    filtersSummary: ['Banking', 'New Jersey', 'Finance'],
    filter: {
      frozenIndustries: ['Banking', 'Financial Services', 'FinTech'],
      frozenCategories: ['Software Engineering', 'Data Analyst'],
      frozenExperienceLevels: [],
      frozenExperienceYears: [],
      frozenStates: ['NJ', 'NY'],
      excludeStudentEscape: true,
    },
  },
  {
    slug: 'data-science',
    name: 'Data Science & ML',
    description: 'Data scientist, ML engineer, and analytics roles at tech and enterprise employers.',
    kind: 'curated' as const,
    filtersSummary: ['Data Science', 'ML', 'US'],
    filter: {
      frozenIndustries: [],
      frozenCategories: ['Data Science', 'Machine Learning Engineer', 'AI Engineer', 'Data Analyst'],
      frozenExperienceLevels: [],
      frozenExperienceYears: [],
      frozenStates: [],
      excludeStudentEscape: true,
    },
  },
  {
    slug: 'cybersecurity',
    name: 'Cybersecurity',
    description: 'Security engineer, analyst, and GRC roles with H-1B-friendly employers highlighted.',
    kind: 'curated' as const,
    filtersSummary: ['Cybersecurity', 'US', 'H-1B signals'],
    filter: {
      frozenIndustries: ['Cybersecurity'],
      frozenCategories: ['Cybersecurity'],
      frozenExperienceLevels: [],
      frozenExperienceYears: [],
      frozenStates: [],
      h1bSponsorFriendly: true,
      excludeStudentEscape: true,
    },
  },
  {
    slug: 'startup-remote',
    name: 'Startup Remote',
    description: 'Early-stage startup roles with remote-first or hybrid policies across the US.',
    kind: 'curated' as const,
    filtersSummary: ['Software', 'Remote', 'Startup'],
    filter: {
      frozenIndustries: ['Software / SaaS', 'FinTech'],
      frozenCategories: ['Software Engineering', 'Full Stack Development'],
      frozenExperienceLevels: [],
      frozenExperienceYears: [],
      frozenStates: [],
      locationIsRemote: true,
      excludeStudentEscape: true,
    },
  },
  {
    slug: 'healthcare-texas',
    name: 'Healthcare Texas',
    description: 'Clinical, admin, and health-tech roles across Texas hospital systems and insurers.',
    kind: 'curated' as const,
    filtersSummary: ['Healthcare', 'Texas'],
    filter: {
      frozenIndustries: ['Healthcare', 'HealthTech / Digital Health'],
      frozenCategories: [],
      frozenExperienceLevels: [],
      frozenExperienceYears: [],
      frozenStates: ['TX'],
      excludeStudentEscape: true,
    },
  },
  {
    slug: 'consulting-nyc',
    name: 'Consulting NYC',
    description: 'Strategy and management consulting roles in New York City — MBB, Big Four, and boutiques.',
    kind: 'curated' as const,
    companyLogos: ['mckinsey.com', 'bcg.com', 'bain.com'],
    filtersSummary: ['Consulting', 'NY'],
    filter: {
      frozenIndustries: ['Consulting'],
      frozenCategories: [],
      frozenExperienceLevels: [],
      frozenExperienceYears: [],
      frozenStates: ['NY'],
      excludeStudentEscape: true,
    },
  },
  {
    slug: 'google-careers',
    name: 'Google Careers',
    description: 'Software, product, and cloud roles from Google and Alphabet companies.',
    kind: 'curated' as const,
    companyLogos: ['google.com', 'youtube.com', 'waymo.com'],
    filtersSummary: ['Software', 'Google', 'Big Tech'],
    filter: {
      frozenIndustries: ['Big Tech'],
      frozenCategories: ['Software Engineering', 'Cloud Engineering', 'Product Management'],
      frozenExperienceLevels: [],
      frozenExperienceYears: [],
      frozenStates: [],
      companyNames: ['Google', 'Alphabet', 'YouTube', 'Waymo'],
      excludeStudentEscape: true,
    },
  },
  {
    slug: 'meta-careers',
    name: 'Meta Careers',
    description: 'Engineering, design, and research openings at Meta across US hubs and remote-friendly teams.',
    kind: 'curated' as const,
    companyLogos: ['meta.com', 'instagram.com'],
    filtersSummary: ['Software', 'Meta', 'Big Tech'],
    filter: {
      frozenIndustries: ['Big Tech'],
      frozenCategories: ['Software Engineering', 'Frontend Development', 'UI/UX Design'],
      frozenExperienceLevels: [],
      frozenExperienceYears: [],
      frozenStates: [],
      companyNames: ['Meta', 'Facebook', 'Instagram'],
      excludeStudentEscape: true,
    },
  },
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI required');
  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DATABASE || process.env.DB_NAME || undefined,
  });

  let upserted = 0;
  for (const seed of SEEDS) {
    const doc = await Cluster.findOneAndUpdate(
      { slug: seed.slug },
      {
        $set: {
          ...seed,
          status: 'published',
          publishedAt: new Date(),
          sourceBinding: { mode: 'filter', sources: [], companyNames: [], robotMetaIds: [] },
          createdBy: 'seed',
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, new: true }
    );
    try {
      doc.jobCountPreview = await countJobsForCluster(doc);
      doc.companyNamesPreview = await distinctCompaniesForCluster(doc);
      await doc.save();
    } catch {
      /* best-effort */
    }
    upserted += 1;
    console.log(`seeded ${seed.slug} (preview=${doc.jobCountPreview})`);
  }

  console.log(`Done. Upserted ${upserted} clusters.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Re-fetch Google Careers pages to fill location / employment / experience.
 * Also derives experience from existing descriptions for all companies.
 *
 *   npx ts-node --project server/tsconfig.json server/src/scripts/enrichCardFieldsFromSources.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { fetchAtsJob } from '../services/atsAdapters';
import { deriveFieldsFromDescription, normalizeJobDescription } from '../services/jobPageParser';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const uri = process.env.DB_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('DB_URL missing');
  await mongoose.connect(uri);
  const board = mongoose.connection.collection('maxun_job_board');

  // 1) Derive experience / employment / remote from stored descriptions (all companies)
  const ready = await board
    .find({ status: { $in: ['ready', 'partial'] } })
    .project({ jobDescription: 1, jobExperience: 1, employmentType: 1, remoteType: 1 })
    .toArray();

  let derived = 0;
  for (const row of ready) {
    const d = deriveFieldsFromDescription(String(row.jobDescription || ''));
    const $set: Record<string, any> = {};
    if (!(row.jobExperience > 0) && d.jobExperience > 0) $set.jobExperience = d.jobExperience;
    if (!String(row.employmentType || '').trim() && d.employmentType) $set.employmentType = d.employmentType;
    if (!String(row.remoteType || '').trim() && d.remoteType) $set.remoteType = d.remoteType;
    if (Object.keys($set).length) {
      await board.updateOne({ _id: row._id }, { $set });
      derived += 1;
    }
  }

  // 2) Re-fetch Google jobs missing location (cap for safety)
  const googleMissingLoc = await board
    .find({
      status: 'ready',
      jobUrl: { $regex: 'google\\.com/about/careers', $options: 'i' },
      $or: [{ location: { $exists: false } }, { location: null }, { location: '' }],
    })
    .project({ jobUrl: 1, jobTitle: 1 })
    .limit(80)
    .toArray();

  let locUpdated = 0;
  let failed = 0;
  for (const row of googleMissingLoc) {
    try {
      const ats = await fetchAtsJob(String(row.jobUrl));
      if (!ats?.fields) {
        failed += 1;
        await sleep(400);
        continue;
      }
      const $set: Record<string, any> = {};
      if (ats.fields.location) $set.location = ats.fields.location;
      if (ats.fields.employmentType) $set.employmentType = ats.fields.employmentType;
      if (ats.fields.remoteType) $set.remoteType = ats.fields.remoteType;
      if (ats.fields.jobCategory) $set.jobCategory = ats.fields.jobCategory;
      if (ats.fields.jobDescription) {
        const desc = normalizeJobDescription(ats.fields.jobDescription);
        if (desc.length > 200) {
          $set.jobDescription = desc;
          const d = deriveFieldsFromDescription(desc);
          if (d.jobExperience > 0) $set.jobExperience = d.jobExperience;
        }
      }
      if (
        ats.fields.jobTitle &&
        !/^(job details?|jobs search|careers?)$/i.test(ats.fields.jobTitle)
      ) {
        $set.jobTitle = ats.fields.jobTitle;
      }
      if (Object.keys($set).length) {
        await board.updateOne({ _id: row._id }, { $set });
        locUpdated += 1;
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
    await sleep(350);
  }

  const withLoc = await board.countDocuments({
    companyName: 'Google',
    status: 'ready',
    location: { $nin: [null, ''] },
  });
  const withExp = await board.countDocuments({
    status: 'ready',
    jobExperience: { $gt: 0 },
  });

  console.log(JSON.stringify({ derived, locUpdated, failed, googleWithLoc: withLoc, readyWithExp: withExp }, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

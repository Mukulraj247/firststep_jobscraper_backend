/**
 * One-shot: fix Google board rows with generic titles and missing logos.
 *   npx ts-node --project server/tsconfig.json server/src/scripts/repairGoogleTitlesAndLogos.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const GOOGLE_LOGO = 'https://www.google.com/s2/favicons?domain=google.com&sz=128';

function titleFromSlug(jobUrl: string): string {
  const m = String(jobUrl || '').match(/\/jobs\/results\/\d+-([^/?#]+)/i);
  if (!m?.[1]) return '';
  return m[1]
    .split('-')
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

async function main() {
  const uri = process.env.DB_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('DB_URL missing');
  await mongoose.connect(uri);
  const board = mongoose.connection.collection('maxun_job_board');

  const rows = await board
    .find({ jobUrl: { $regex: 'google\\.com/about/careers', $options: 'i' } })
    .project({ jobUrl: 1, jobTitle: 1, companyLogoUrl: 1, listSnapshot: 1, jobId: 1 })
    .toArray();

  let titles = 0;
  let logos = 0;
  let jobIds = 0;

  for (const row of rows) {
    const $set: Record<string, any> = {};
    const title = String(row.jobTitle || '');
    if (/^(job details?|untitled(?: role)?|careers?)$/i.test(title.trim()) || !title.trim()) {
      const next =
        titleFromSlug(row.jobUrl) ||
        String(row.listSnapshot?.jobTitle || '').replace(/^(job details?)$/i, '') ||
        '';
      if (next) {
        $set.jobTitle = next;
        titles += 1;
      }
    }
    if (!String(row.companyLogoUrl || '').trim()) {
      $set.companyLogoUrl = GOOGLE_LOGO;
      logos += 1;
    }
    if (!String(row.jobId || '').trim()) {
      const id = String(row.jobUrl || '').match(/\/jobs\/results\/(\d+)/i)?.[1];
      if (id) {
        $set.jobId = id;
        jobIds += 1;
      }
    }
    if (Object.keys($set).length) {
      await board.updateOne({ _id: row._id }, { $set });
    }
  }

  // Brand logos for other common companies missing logos
  const brandLogos: Record<string, string> = {
    'JPMorgan Chase': 'https://www.google.com/s2/favicons?domain=jpmorganchase.com&sz=128',
    Toyota: 'https://www.google.com/s2/favicons?domain=toyota.com&sz=128',
    Ford: 'https://www.google.com/s2/favicons?domain=ford.com&sz=128',
    Meta: 'https://www.google.com/s2/favicons?domain=meta.com&sz=128',
    'Sia Partners': 'https://www.google.com/s2/favicons?domain=sia-partners.com&sz=128',
  };
  let otherLogos = 0;
  for (const [company, logo] of Object.entries(brandLogos)) {
    const r = await board.updateMany(
      {
        companyName: company,
        $or: [{ companyLogoUrl: { $exists: false } }, { companyLogoUrl: null }, { companyLogoUrl: '' }],
      },
      { $set: { companyLogoUrl: logo } }
    );
    otherLogos += r.modifiedCount;
  }

  console.log(JSON.stringify({ titles, logos, jobIds, otherLogos, googleRows: rows.length }, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

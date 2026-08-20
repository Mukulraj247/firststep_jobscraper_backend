require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing');

  await mongoose.connect(uri);
  const col = mongoose.connection.collection('maxun_job_board');

  const filter = {
    $or: [
      { source: 'hiring_cafe' },
      { jobUrl: /hiring\.?cafe/i },
      { applyUrl: /hiring\.?cafe/i },
    ],
  };

  const before = await col.countDocuments(filter);
  console.log(`Found ${before} Hiring Cafe-related job board listing(s)`);

  if (before === 0) {
    await mongoose.disconnect();
    return;
  }

  const result = await col.deleteMany(filter);
  console.log(`Deleted ${result.deletedCount} listing(s)`);

  const remaining = await col.countDocuments(filter);
  console.log(`Remaining Hiring Cafe listings: ${remaining}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

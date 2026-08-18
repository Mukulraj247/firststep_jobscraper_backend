/** Find robot vs agendaJobs mismatches (>1s). */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const robots = await db.collection('maxun_robots').find({
    $or: [{ 'schedule.enabled': true }, { 'recording_meta.saasConfig.schedule.enabled': true }],
  }).project({ 'recording_meta.id': 1, 'recording_meta.name': 1, 'schedule.nextRunAt': 1 }).toArray();
  const jobs = await db.collection('agendaJobs').find({ name: 'schedule-triggers' })
    .project({ 'data.automationId': 1, nextRunAt: 1 }).toArray();
  const jobByAuto = new Map(jobs.map((j) => [j.data?.automationId, j]));
  for (const r of robots) {
    const id = r.recording_meta?.id;
    const j = jobByAuto.get(id);
    if (!j) continue;
    const dbMs = new Date(r.schedule.nextRunAt).getTime();
    const agMs = new Date(j.nextRunAt).getTime();
    if (Math.abs(dbMs - agMs) > 1000) {
      console.log(JSON.stringify({
        name: r.recording_meta?.name,
        id,
        dbNext: r.schedule.nextRunAt,
        agendaNext: j.nextRunAt,
        diffSec: Math.round((agMs - dbMs) / 1000),
      }));
    }
  }
  await mongoose.disconnect();
})();

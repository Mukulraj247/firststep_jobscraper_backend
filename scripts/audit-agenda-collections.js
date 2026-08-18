/** Quick audit: compare robot nextRunAt vs Agenda job nextRunAt per collection. */
require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;
const collections = ['agendaJobs', 'agendaJobs_local'];

(async () => {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const robots = await db
    .collection('maxun_robots')
    .find({
      $or: [
        { 'schedule.enabled': true },
        { 'recording_meta.saasConfig.schedule.enabled': true },
      ],
    })
    .project({
      'recording_meta.id': 1,
      'recording_meta.name': 1,
      'schedule.nextRunAt': 1,
    })
    .toArray();

  for (const collName of collections) {
    const jobs = await db
      .collection(collName)
      .find({ name: 'schedule-triggers' })
      .project({ 'data.automationId': 1, nextRunAt: 1 })
      .toArray();
    const jobByAuto = new Map(jobs.map((j) => [j.data?.automationId, j.nextRunAt]));

    let missing = 0;
    let mismatched = 0;
    let matched = 0;
    for (const r of robots) {
      const id = r.recording_meta?.id;
      const dbNext = r.schedule?.nextRunAt ? new Date(r.schedule.nextRunAt).getTime() : null;
      const agendaJob = jobByAuto.get(id);
      if (!agendaJob) {
        missing += 1;
        continue;
      }
      const agendaNext = new Date(agendaJob).getTime();
      if (dbNext != null && Math.abs(dbNext - agendaNext) > 1000) mismatched += 1;
      else matched += 1;
    }
    console.log(JSON.stringify({ collection: collName, scheduleJobs: jobs.length, matched, mismatched, missing }));
  }
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

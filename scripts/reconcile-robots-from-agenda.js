/**
 * Reconcile robot.schedule timestamps from production agendaJobs when Agenda
 * has already fired but DB nextRunAt is stale (common during live scheduler).
 */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const robots = await db.collection('maxun_robots').find({
    $or: [{ 'schedule.enabled': true }, { 'recording_meta.saasConfig.schedule.enabled': true }],
  }).toArray();
  const jobs = await db.collection('agendaJobs').find({ name: 'schedule-triggers' }).toArray();
  const jobByAuto = new Map(jobs.map((j) => [j.data?.automationId, j]));

  let fixed = 0;
  for (const robot of robots) {
    const id = robot.recording_meta?.id;
    const job = jobByAuto.get(id);
    if (!job?.nextRunAt) continue;

    const dbNext = robot.schedule?.nextRunAt ? new Date(robot.schedule.nextRunAt).getTime() : NaN;
    const agNext = new Date(job.nextRunAt).getTime();
    if (Number.isNaN(dbNext) || Math.abs(dbNext - agNext) <= 1000) continue;

    const lastRunAt = job.lastFinishedAt || job.lastRunAt || robot.schedule?.lastRunAt;
    await db.collection('maxun_robots').updateOne(
      { _id: robot._id },
      {
        $set: {
          'schedule.nextRunAt': new Date(job.nextRunAt),
          'schedule.lastRunAt': lastRunAt ? new Date(lastRunAt) : robot.schedule?.lastRunAt,
          'recording_meta.saasConfig.schedule.nextRunAt': new Date(job.nextRunAt),
          'recording_meta.saasConfig.schedule.lastRunAt': lastRunAt
            ? new Date(lastRunAt)
            : robot.schedule?.lastRunAt,
        },
      }
    );
    console.log(`Fixed ${robot.recording_meta?.name}: dbNext -> ${job.nextRunAt}`);
    fixed += 1;
  }
  console.log(JSON.stringify({ fixed }));
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

import mongoose, { Schema } from 'mongoose';

const JobIdCounterSchema = new Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  {
    collection: 'maxun_jobid_counters',
    versionKey: false,
  }
);

const JobIdCounter =
  mongoose.models.JobIdCounter || mongoose.model('JobIdCounter', JobIdCounterSchema);

export default JobIdCounter;

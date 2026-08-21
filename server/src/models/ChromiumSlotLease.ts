import mongoose, { Document, Schema } from 'mongoose';

export type ChromiumSlotKind = 'scraper' | 'aggregator';

export interface ChromiumSlotHolder {
  holderId: string;
  kind: ChromiumSlotKind;
  leaseUntil: Date;
  runId?: string;
}

export interface IChromiumSlotLease extends Document<string> {
  mode: 'shared' | 'exclusive';
  holders: ChromiumSlotHolder[];
  updatedAt: Date;
}

const HolderSchema = new Schema(
  {
    holderId: { type: String, required: true },
    kind: { type: String, enum: ['scraper', 'aggregator'], required: true },
    leaseUntil: { type: Date, required: true },
    runId: { type: String, required: false },
  },
  { _id: false }
);

const ChromiumSlotLeaseSchema: Schema = new Schema(
  {
    _id: { type: String, required: true },
    mode: { type: String, enum: ['shared', 'exclusive'], default: 'shared' },
    holders: { type: [HolderSchema], default: [] },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    collection: 'maxun_chromium_slot_leases',
  }
);

const ChromiumSlotLease =
  mongoose.models.ChromiumSlotLease ||
  mongoose.model<IChromiumSlotLease>('ChromiumSlotLease', ChromiumSlotLeaseSchema);

export default ChromiumSlotLease;

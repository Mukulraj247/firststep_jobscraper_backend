import mongoose, { Document, Schema } from 'mongoose';

export interface IExtractedData extends Document {
  runId: mongoose.Types.ObjectId | string;
  robotMetaId: string;
  source: string;
  data: Record<string, any>;
  createdAt: Date;
}

const ExtractedDataSchema: Schema = new Schema(
  {
    runId: {
      type: Schema.Types.Mixed, // allows string or ObjectId 
      required: true,
    },
    robotMetaId: {
      type: String,
      required: true,
    },
    source: {
      type: String,
      required: true,
      default: 'scrapeList',
    },
    data: {
      type: Schema.Types.Mixed,
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'maxun_extracteddata'
  }
);

ExtractedDataSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
  },
});

ExtractedDataSchema.index({ robotMetaId: 1, createdAt: 1 }, { name: 'extracted_data_robot_meta_created_at_idx' });
ExtractedDataSchema.index({ runId: 1, createdAt: 1 }, { name: 'extracted_data_run_created_at_idx' });
ExtractedDataSchema.index({ 'data.status': 1, createdAt: 1 }, { name: 'extracted_data_status_created_at_idx' });
ExtractedDataSchema.index(
  { 'data.jobId': 1 },
  {
    unique: true,
    name: 'extracted_data_job_id_uidx',
    partialFilterExpression: { 'data.jobId': { $type: 'string', $gt: '' } },
  }
);

const ExtractedData = mongoose.models.ExtractedData || mongoose.model<IExtractedData>('ExtractedData', ExtractedDataSchema);

export default ExtractedData;

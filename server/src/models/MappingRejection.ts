import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IMappingRejection extends Document {
  govEmployerKey: string;
  brandId?: Types.ObjectId | null;
  brandName?: string;
  reason: string;
  rejectedBy: string;
  createdAt: Date;
}

const MappingRejectionSchema = new Schema<IMappingRejection>(
  {
    govEmployerKey: { type: String, required: true, index: true },
    brandId: { type: Schema.Types.ObjectId, ref: 'CompanyBrand', default: null },
    brandName: { type: String, default: '' },
    reason: { type: String, default: '' },
    rejectedBy: { type: String, default: '' },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'h1b_mapping_rejections',
  }
);

const MappingRejection =
  mongoose.models.MappingRejection ||
  mongoose.model<IMappingRejection>('MappingRejection', MappingRejectionSchema);

export default MappingRejection;

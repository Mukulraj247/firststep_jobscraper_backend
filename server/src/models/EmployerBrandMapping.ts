import mongoose, { Document, Schema, Types } from 'mongoose';

export type EmployerBrandMappingStatus =
  | 'auto_approved'
  | 'pending_review'
  | 'approved'
  | 'rejected';

export type EmployerBrandMatchMethod =
  | 'exact_alias'
  | 'exact_name'
  | 'fuzzy'
  | 'token'
  | 'board_name'
  | 'subsidiary'
  | 'admin';

export interface IEmployerBrandMapping extends Document {
  govEmployerId: Types.ObjectId;
  govEmployerKey: string;
  brandId: Types.ObjectId;
  brandName: string;
  confidence: number;
  matchMethod: EmployerBrandMatchMethod;
  status: EmployerBrandMappingStatus;
  reviewedBy?: string;
  reviewedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const EmployerBrandMappingSchema = new Schema<IEmployerBrandMapping>(
  {
    govEmployerId: { type: Schema.Types.ObjectId, ref: 'GovEmployer', required: true },
    govEmployerKey: { type: String, required: true, index: true },
    brandId: { type: Schema.Types.ObjectId, ref: 'CompanyBrand', required: true, index: true },
    brandName: { type: String, default: '' },
    confidence: { type: Number, default: 0 },
    matchMethod: {
      type: String,
      enum: ['exact_alias', 'exact_name', 'fuzzy', 'token', 'board_name', 'subsidiary', 'admin'],
      default: 'exact_name',
    },
    status: {
      type: String,
      enum: ['auto_approved', 'pending_review', 'approved', 'rejected'],
      default: 'pending_review',
      index: true,
    },
    reviewedBy: { type: String, default: '' },
    reviewedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'h1b_employer_brand_mappings',
  }
);

EmployerBrandMappingSchema.index({ govEmployerKey: 1, brandId: 1 }, { unique: true });

const EmployerBrandMapping =
  mongoose.models.EmployerBrandMapping ||
  mongoose.model<IEmployerBrandMapping>('EmployerBrandMapping', EmployerBrandMappingSchema);

export default EmployerBrandMapping;

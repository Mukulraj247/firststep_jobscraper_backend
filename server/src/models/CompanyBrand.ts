import mongoose, { Document, Schema } from 'mongoose';

export interface ICompanyBrand extends Document {
  brandName: string;
  brandNameNormalized: string;
  brandNameKey: string;
  aliases: string[];
  aliasKeys: string[];
  source: 'seed' | 'auto' | 'admin';
  createdAt: Date;
  updatedAt: Date;
}

const CompanyBrandSchema = new Schema<ICompanyBrand>(
  {
    brandName: { type: String, required: true },
    brandNameNormalized: { type: String, required: true, index: true },
    brandNameKey: { type: String, required: true, unique: true },
    aliases: { type: [String], default: [] },
    aliasKeys: { type: [String], default: [], index: true },
    source: { type: String, enum: ['seed', 'auto', 'admin'], default: 'seed' },
  },
  {
    timestamps: true,
    collection: 'h1b_company_brands',
  }
);

const CompanyBrand =
  mongoose.models.CompanyBrand ||
  mongoose.model<ICompanyBrand>('CompanyBrand', CompanyBrandSchema);

export default CompanyBrand;

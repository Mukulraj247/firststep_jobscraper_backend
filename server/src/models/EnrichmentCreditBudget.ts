import mongoose, { Document, Schema } from 'mongoose';

/** Daily scrape.do credit counter for the enrichment worker budget. */
export interface IEnrichmentCreditBudget extends Document {
  creditsSpent: number;
  updatedAt: Date;
}

const EnrichmentCreditBudgetSchema: Schema = new Schema(
  {
    _id: { type: String, required: true },
    creditsSpent: { type: Number, default: 0 },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    collection: 'maxun_enrichment_credit_budget',
  }
);

const EnrichmentCreditBudget =
  mongoose.models.EnrichmentCreditBudget ||
  mongoose.model<IEnrichmentCreditBudget>('EnrichmentCreditBudget', EnrichmentCreditBudgetSchema);

export default EnrichmentCreditBudget;

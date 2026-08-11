import mongoose, { Document, Schema } from 'mongoose';

/** Daily Gemini / LLM call + token counter for the enrichment worker budget. */
export interface ILlmUsageBudget extends Document {
  calls: number;
  tokens: number;
  updatedAt: Date;
}

const LlmUsageBudgetSchema: Schema = new Schema(
  {
    _id: { type: String, required: true },
    calls: { type: Number, default: 0 },
    tokens: { type: Number, default: 0 },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    collection: 'maxun_llm_usage_budget',
  }
);

const LlmUsageBudget =
  mongoose.models.LlmUsageBudget ||
  mongoose.model<ILlmUsageBudget>('LlmUsageBudget', LlmUsageBudgetSchema);

export default LlmUsageBudget;

function budgetDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export async function getLlmUsageToday(): Promise<{ calls: number; tokens: number }> {
  const doc = await LlmUsageBudget.findById(budgetDayKey()).lean();
  return { calls: doc?.calls || 0, tokens: doc?.tokens || 0 };
}

export async function addLlmUsage(calls: number, tokens: number): Promise<{ calls: number; tokens: number }> {
  if (calls <= 0 && tokens <= 0) return getLlmUsageToday();
  const updated = await LlmUsageBudget.findByIdAndUpdate(
    budgetDayKey(),
    {
      $inc: { calls: Math.max(0, calls), tokens: Math.max(0, tokens) },
      $setOnInsert: { _id: budgetDayKey() },
    },
    { upsert: true, new: true }
  ).lean();
  return { calls: updated?.calls || calls, tokens: updated?.tokens || tokens };
}

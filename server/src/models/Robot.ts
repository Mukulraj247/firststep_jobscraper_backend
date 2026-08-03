import mongoose, { Document, Schema } from 'mongoose';

export interface IRobot extends Document {
  userId: mongoose.Types.ObjectId | string | number;
  recording_meta: any;
  recording: any;
  google_sheet_email?: string | null;
  google_sheet_name?: string | null;
  google_sheet_id?: string | null;
  google_access_token?: string | null;
  google_refresh_token?: string | null;
  airtable_base_id?: string | null;
  airtable_base_name?: string | null;
  airtable_table_name?: string | null;
  airtable_table_id?: string | null;
  airtable_access_token?: string | null;
  airtable_refresh_token?: string | null;
  schedule?: any | null;
  webhooks?: any[] | null;
}

const RobotSchema: Schema = new Schema(
  {
    userId: {
      type: Schema.Types.Mixed,
      required: true,
    },
    recording_meta: {
      type: Schema.Types.Mixed,
      required: true,
    },
    recording: {
      type: Schema.Types.Mixed,
      required: true,
    },
    google_sheet_email: { type: String, default: null },
    google_sheet_name: { type: String, default: null },
    google_sheet_id: { type: String, default: null },
    google_access_token: { type: String, default: null },
    google_refresh_token: { type: String, default: null },
    
    airtable_base_id: { type: String, default: null },
    airtable_base_name: { type: String, default: null },
    airtable_table_name: { type: String, default: null },
    airtable_table_id: { type: String, default: null },
    airtable_access_token: { type: String, default: null },
    airtable_refresh_token: { type: String, default: null },
    
    schedule: { type: Schema.Types.Mixed, default: null },
    webhooks: { type: [Schema.Types.Mixed], default: null },
  },
  {
    timestamps: false,
    collection: 'maxun_robots'
  }
);

RobotSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
  },
});

RobotSchema.index(
  { userId: 1, 'recording_meta.name': 1 },
  { unique: true, name: 'robot_user_name_unique' }
);

RobotSchema.index({ 'recording_meta.id': 1 }, { name: 'robot_recording_meta_id' });

const Robot = mongoose.models.Robot || mongoose.model<IRobot>('Robot', RobotSchema);

export default Robot;

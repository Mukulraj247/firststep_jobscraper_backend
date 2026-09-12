import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  email: string;
  password?: string;
  /** Auth0 subject (`auth0|…`). Linked to existing row only — never used as ownerId. */
  auth0Sub?: string | null;
  api_key_name?: string | null;
  api_key?: string | null;
  api_key_created_at?: Date | null;
  proxy_url?: string | null;
  proxy_username?: string | null;
  proxy_password?: string | null;
}

const UserSchema: Schema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      match: [/.+\@.+\..+/, 'Please fill a valid email address'],
    },
    password: {
      type: String,
      required: true,
    },
    auth0Sub: {
      type: String,
      default: null,
      sparse: true,
      unique: true,
    },
    api_key_name: {
      type: String,
      default: 'Maxun API Key',
    },
    api_key: {
      type: String,
      default: null,
    },
    api_key_created_at: {
      type: Date,
      default: null,
    },
    proxy_url: {
      type: String,
      default: null,
    },
    proxy_username: {
      type: String,
      default: null,
    },
    proxy_password: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true, // Automatically manages createdAt and updatedAt
    collection: 'maxun_users'
  }
);

// To ensure consistent JSON mapping if an ID getter is required
UserSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.password;
  },
});

const User = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);

export default User;

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { applyConfiguredDnsServers } from '../utils/dnsConfig';
import Run from '../models/Run';
import Robot from '../models/Robot';
import ExtractedData from '../models/ExtractedData';
import JobIdCounter from '../models/JobIdCounter';
import ChromiumSlotLease from '../models/ChromiumSlotLease';
import JobBoardListing from '../models/JobBoardListing';

dotenv.config();
applyConfiguredDnsServers();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/maxun';

/** Cap per-process pool so N PM2 workers cannot exhaust Atlas connection limits. */
const MONGODB_MAX_POOL_SIZE = Math.max(
  1,
  parseInt(process.env.MONGODB_MAX_POOL_SIZE || '10', 10) || 10
);

export const connectDB = async () => {
    try {
        await mongoose.connect(MONGODB_URI, {
            maxPoolSize: MONGODB_MAX_POOL_SIZE,
        });
        console.log(`MongoDB connected successfully (maxPoolSize=${MONGODB_MAX_POOL_SIZE})`);
    } catch (error) {
        console.error('Unable to connect to MongoDB:', error);
    }
};

/** Ensures Mongoose-defined indexes exist (replaces legacy Sequelize migrations on PostgreSQL). */
export const syncDB = async () => {
    try {
        await Run.syncIndexes();
        await Robot.syncIndexes();
        await ExtractedData.syncIndexes();
        await JobIdCounter.syncIndexes();
        await ChromiumSlotLease.syncIndexes();
        await JobBoardListing.syncIndexes();
        console.log('MongoDB indexes synced.');
    } catch (err) {
        console.error('MongoDB index sync failed:', err);
        throw err;
    }
};

export default mongoose;

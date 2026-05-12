import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { setServers as setDnsServers } from 'dns';
import Run from '../models/Run';
import Robot from '../models/Robot';
import ExtractedData from '../models/ExtractedData';
import JobIdCounter from '../models/JobIdCounter';

setDnsServers(['8.8.8.8', '1.1.1.1']);

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/maxun';

export const connectDB = async () => {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('MongoDB connected successfully');
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
        console.log('MongoDB indexes synced.');
    } catch (err) {
        console.error('MongoDB index sync failed:', err);
        throw err;
    }
};

export default mongoose;

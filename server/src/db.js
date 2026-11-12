import mongoose from 'mongoose';
import { config } from './config.js';

// Events that happen AFTER the first connect (network drop, Atlas failover).
// Registered once, at import time.
mongoose.connection.on('connected', () => console.log('MongoDB connected'));
mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected'));
mongoose.connection.on('error', (err) => {
  // name + message only: some driver errors echo connection details.
  console.error(`MongoDB error: ${err.name}: ${err.message}`);
});

export async function connectDB() {
  try {
    await mongoose.connect(config.mongodbUri, {
      // Give up finding a server after 10s instead of the 30s default,
      // so a wrong URI or a blocked IP fails fast at startup.
      serverSelectionTimeoutMS: 10_000,
    });
  } catch (err) {
    console.error(`MongoDB connection failed: ${err.name}: ${err.message}`);
    throw err; // let index.js decide to exit
  }
}

export async function disconnectDB() {
  await mongoose.connection.close();
}

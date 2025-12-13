import dotenv from 'dotenv';
import { logger } from '../../utils/logger.js';
import { randomUUID } from 'crypto';

dotenv.config();

const requiredEnvVars = ['SENTINEL_1', 'SENTINEL_2', 'SENTINEL_3'] as const;

function validateEnv(): void {
  const missing: string[] = [];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }

  if (missing.length > 0) {
    logger.error({ missing }, 'Missing required environment variables');
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

validateEnv();

// Generate unique instance ID if not provided
const instanceId = process.env.INSTANCE_ID || `instance_${randomUUID().slice(0, 8)}`;
console.log('redis master name', process.env.REDIS_MASTER_NAME);
export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  wsPort: parseInt(process.env.WS_PORT || '8080', 10),
  
  // Unique identifier for this server instance
  instanceId,
  
  sentinel: {
    hosts: [
      { host: process.env.SENTINEL_1!, port: parseInt(process.env.SENTINEL_1_PORT || '26379', 10) },
      { host: process.env.SENTINEL_2!, port: parseInt(process.env.SENTINEL_2_PORT || '26380', 10) },
      { host: process.env.SENTINEL_3!, port: parseInt(process.env.SENTINEL_3_PORT || '26381', 10) },
    ],
    masterName: process.env.REDIS_MASTER_NAME || 'kasagi-master',
    password: process.env.REDIS_PASSWORD,
  },

  // Snapshot configuration
  snapshotInterval: parseInt(process.env.SNAPSHOT_INTERVAL || '100', 10), // ticks

  logLevel: process.env.LOG_LEVEL || 'info',
} as const;

export type Config = typeof config;
export default config;

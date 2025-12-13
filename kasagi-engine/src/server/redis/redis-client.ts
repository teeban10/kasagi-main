import { Redis } from 'ioredis';
import { config } from '../config/env.js';
import { logger } from '../../utils/logger.js';

const redisLogger = logger.child({ module: 'redis-client', instanceId: config.instanceId });

// NAT mapping for local development
// When running outside Docker, Sentinel returns Docker-internal hostnames
// which need to be mapped to localhost with correct port mappings
const localNatMap: Record<string, { host: string; port: number }> = {
  'redis-master:6379': { host: '127.0.0.1', port: 6380 },
  'redis-replica-1:6379': { host: '127.0.0.1', port: 6381 },
  'redis-replica-2:6379': { host: '127.0.0.1', port: 6382 },
};

export const redisClient = new Redis({
  sentinels: [...config.sentinel.hosts],
  name: config.sentinel.masterName,
  password: config.sentinel.password,
  
  // Enable natMap only in development (when running outside Docker)
  ...(config.nodeEnv === 'development' && { natMap: localNatMap }),
  
  // Auto-reconnect settings for failover
  retryStrategy(times: number): number {
    const delay = Math.min(times * 100, 3000);
    redisLogger.warn({ attempt: times, delay }, 'Reconnecting to Redis...');
    return delay;
  },
  
  reconnectOnError(err: Error): boolean {
    const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
    const shouldReconnect = targetErrors.some((e) => err.message.includes(e));
    if (shouldReconnect) {
      redisLogger.warn({ error: err.message }, 'Reconnecting due to error');
    }
    return shouldReconnect;
  },
  
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
});

// Connection event handlers
redisClient.on('connect', () => {
  redisLogger.info('Connecting to Redis Sentinel cluster...');
});

redisClient.on('ready', () => {
  redisLogger.info('Redis connection ready');
});

redisClient.on('error', (err: Error) => {
  redisLogger.error({ error: err.message }, 'Redis connection error');
});

redisClient.on('close', () => {
  redisLogger.warn('Redis connection closed');
});

redisClient.on('reconnecting', (delay: number) => {
  redisLogger.info({ delay }, 'Redis reconnecting...');
});

redisClient.on('end', () => {
  redisLogger.warn('Redis connection ended');
});

redisClient.on('+failover', () => {
  redisLogger.info('Redis failover started');
});

redisClient.on('-failover', () => {
  redisLogger.info('Redis failover ended');
});

// ============================================================================
// Pub/Sub Helpers
// ============================================================================

/**
 * Publish a delta to a room channel.
 * Uses base64 encoding for safe string transmission.
 */
export async function publishDelta(roomId: string, encodedDeltaBase64: string): Promise<number> {
  const channel = `room:${roomId}:channel`;
  
  try {
    const subscriberCount = await redisClient.publish(channel, encodedDeltaBase64);
    redisLogger.info({ roomId, channel, subscriberCount }, 'Delta published to Redis');
    return subscriberCount;
  } catch (err) {
    redisLogger.error({ error: (err as Error).message, roomId }, 'Failed to publish delta');
    throw err;
  }
}

// ============================================================================
// Snapshot Helpers
// ============================================================================

/**
 * Save a room snapshot to Redis.
 */
export async function saveRoomSnapshot(
  roomId: string,
  data: string,
  seq: number,
  tick: number
): Promise<void> {
  const key = `room:${roomId}:snapshot`;
  
  try {
    await redisClient.hset(key, {
      data,
      seq: seq.toString(),
      tick: tick.toString(),
      timestamp: Date.now().toString(),
      instanceId: config.instanceId,
    });
    redisLogger.info({ roomId, seq, tick }, 'Snapshot saved to Redis');
  } catch (err) {
    redisLogger.error({ error: (err as Error).message, roomId }, 'Failed to save snapshot');
    throw err;
  }
}

/**
 * Load a room snapshot from Redis.
 */
export async function loadRoomSnapshot(roomId: string): Promise<{
  data: string;
  seq: number;
  tick: number;
  timestamp: number;
} | null> {
  const key = `room:${roomId}:snapshot`;
  
  try {
    const snapshot = await redisClient.hgetall(key);
    
    if (!snapshot || !snapshot.data) {
      redisLogger.debug({ roomId }, 'No snapshot found');
      return null;
    }

    redisLogger.info({ roomId, seq: snapshot.seq, tick: snapshot.tick }, 'Snapshot loaded from Redis');
    
    return {
      data: snapshot.data,
      seq: parseInt(snapshot.seq, 10),
      tick: parseInt(snapshot.tick, 10),
      timestamp: parseInt(snapshot.timestamp, 10),
    };
  } catch (err) {
    redisLogger.error({ error: (err as Error).message, roomId }, 'Failed to load snapshot');
    return null;
  }
}

/**
 * Delete a room snapshot from Redis.
 */
export async function deleteRoomSnapshot(roomId: string): Promise<void> {
  const key = `room:${roomId}:snapshot`;
  
  try {
    await redisClient.del(key);
    redisLogger.debug({ roomId }, 'Snapshot deleted from Redis');
  } catch (err) {
    redisLogger.error({ error: (err as Error).message, roomId }, 'Failed to delete snapshot');
  }
}

export default redisClient;

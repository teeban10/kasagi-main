import { Redis } from 'ioredis';
import { config } from '../config/env.js';
import { logger } from '../../utils/logger.js';
import { decodeDeltaFromBase64, type FullDelta } from '../rooms/delta-engine.js';
import { getOrCreateRoom } from '../rooms/room-manager.js';

const subLogger = logger.child({ module: 'redis-subscriber', instanceId: config.instanceId });

// NAT mapping for local development
// When running outside Docker, Sentinel returns Docker-internal hostnames
// which need to be mapped to localhost with correct port mappings
const localNatMap: Record<string, { host: string; port: number }> = {
  'redis-master:6379': { host: '127.0.0.1', port: 6380 },
  'redis-replica-1:6379': { host: '127.0.0.1', port: 6381 },
  'redis-replica-2:6379': { host: '127.0.0.1', port: 6382 },
};

// Create a separate Redis instance for Pub/Sub
export const redisSubscriber = new Redis({
  sentinels: [...config.sentinel.hosts],
  name: config.sentinel.masterName,
  password: config.sentinel.password,

  // Enable natMap only in development (when running outside Docker)
  ...(config.nodeEnv === 'development' && { natMap: localNatMap }),

  retryStrategy(times: number): number {
    const delay = Math.min(times * 100, 3000);
    subLogger.warn({ attempt: times, delay }, 'Subscriber reconnecting to Redis...');
    return delay;
  },

  reconnectOnError(err: Error): boolean {
    const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
    return targetErrors.some((e) => err.message.includes(e));
  },

  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
});

// Connection event handlers
redisSubscriber.on('connect', () => {
  subLogger.info('Subscriber connecting to Redis Sentinel cluster...');
});

redisSubscriber.on('ready', () => {
  subLogger.info('Subscriber Redis connection ready');
  initializeSubscriptions();
});

redisSubscriber.on('error', (err: Error) => {
  subLogger.error({ error: err.message }, 'Subscriber Redis connection error');
});

redisSubscriber.on('close', () => {
  subLogger.warn('Subscriber Redis connection closed');
});

redisSubscriber.on('reconnecting', (delay: number) => {
  subLogger.info({ delay }, 'Subscriber Redis reconnecting...');
});

// Pattern subscription handler
redisSubscriber.on('pmessage', async (pattern: string, channel: string, message: string) => {
  subLogger.debug({ pattern, channel }, 'Received message on pattern subscription');

  try {
    // Decode base64 → MessagePack → delta object
    const delta: FullDelta = decodeDeltaFromBase64(message);

    // Skip if this delta came from our own instance
    if (delta.instanceId === config.instanceId) {
      subLogger.debug({ roomId: delta.roomId, seq: delta.seq }, 'Ignoring own delta');
      return;
    }

    // Extract roomId from channel (format: room:{roomId}:channel)
    const roomIdMatch = channel.match(/^room:([^:]+):channel$/);
    if (!roomIdMatch) {
      subLogger.warn({ channel }, 'Unknown channel format');
      return;
    }

    const roomId = roomIdMatch[1];

    // Validate roomId matches delta
    if (roomId !== delta.roomId) {
      subLogger.warn({ channel, deltaRoomId: delta.roomId }, 'Room ID mismatch');
      return;
    }

    subLogger.info(
      { 
        roomId, 
        fromInstance: delta.instanceId, 
        seq: delta.seq, 
        tick: delta.tick 
      },
      'Received remote delta'
    );

    // Get or create the room and apply the remote delta
    const room = await getOrCreateRoom(roomId);
    const applied = room.applyRemoteDelta(delta);

    if (applied) {
      subLogger.info(
        { roomId, seq: delta.seq, fromInstance: delta.instanceId },
        'Remote delta applied successfully'
      );
    }
  } catch (err) {
    subLogger.error(
      { error: (err as Error).message, channel },
      'Failed to process remote delta'
    );
  }
});

// Subscription event logging
redisSubscriber.on('psubscribe', (pattern: string, count: number) => {
  subLogger.info({ pattern, activeSubscriptions: count }, 'Subscribed to pattern');
});

redisSubscriber.on('punsubscribe', (pattern: string, count: number) => {
  subLogger.info({ pattern, activeSubscriptions: count }, 'Unsubscribed from pattern');
});

/**
 * Initialize pattern subscriptions after connection is ready.
 */
async function initializeSubscriptions(): Promise<void> {
  try {
    // Subscribe to all room channels using pattern matching
    await redisSubscriber.psubscribe('room:*:channel');
    subLogger.info('Initialized room channel subscriptions');
  } catch (err) {
    subLogger.error({ error: (err as Error).message }, 'Failed to initialize subscriptions');
  }
}

/**
 * Subscribe to a specific room channel (for explicit subscriptions).
 */
export async function subscribeToRoom(roomId: string): Promise<void> {
  const channel = `room:${roomId}:channel`;
  subLogger.debug({ roomId, channel }, 'Room covered by pattern subscription');
}

/**
 * Unsubscribe from a specific room channel.
 */
export async function unsubscribeFromRoom(roomId: string): Promise<void> {
  const channel = `room:${roomId}:channel`;
  subLogger.debug({ roomId, channel }, 'Room cleanup (pattern subscription continues)');
}

/**
 * Gracefully shutdown the subscriber.
 */
export async function shutdownSubscriber(): Promise<void> {
  subLogger.info('Shutting down Redis subscriber...');
  await redisSubscriber.punsubscribe();
  await redisSubscriber.quit();
  subLogger.info('Redis subscriber shutdown complete');
}

export default redisSubscriber;

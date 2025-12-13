import { config } from './config/env.js';
import { logger } from '../utils/logger.js';
import { redisClient } from './redis/redis-client.js';
import { redisSubscriber } from './redis/redis-subscriber.js';
import { startWsServer, stopWsServer } from './websocket/ws-server.js';
import { saveAllSnapshots } from './rooms/room-manager.js';

const mainLogger = logger.child({ module: 'main', instanceId: config.instanceId });

async function bootstrap(): Promise<void> {
  mainLogger.info(
    { env: config.nodeEnv, instanceId: config.instanceId },
    'Starting KasagiEngine...'
  );

  // Wait for Redis connections to be ready
  await Promise.all([
    new Promise<void>((resolve) => {
      if (redisClient.status === 'ready') {
        resolve();
      } else {
        redisClient.once('ready', resolve);
      }
    }),
    new Promise<void>((resolve) => {
      if (redisSubscriber.status === 'ready') {
        resolve();
      } else {
        redisSubscriber.once('ready', resolve);
      }
    }),
  ]);

  mainLogger.info('Redis connections established');

  // Start WebSocket server
  startWsServer();
  mainLogger.info({ port: config.wsPort }, 'WebSocket server started');

  mainLogger.info('KasagiEngine core modules initialized');
  mainLogger.info(
    { 
      instanceId: config.instanceId,
      snapshotInterval: config.snapshotInterval,
    },
    'Multi-instance sync enabled'
  );

  // Graceful shutdown handlers
  const shutdown = async (signal: string): Promise<void> => {
    mainLogger.info({ signal, instanceId: config.instanceId }, 'Shutdown signal received');

    try {
      // Save all room snapshots before shutdown
      mainLogger.info('Saving room snapshots...');
      await saveAllSnapshots();
      
      // Stop WebSocket server
      await stopWsServer();
      
      // Close Redis connections
      await redisClient.quit();
      await redisSubscriber.quit();
      
      mainLogger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      mainLogger.error({ error: (err as Error).message }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  mainLogger.error({ error: (err as Error).message }, 'Failed to start KasagiEngine');
  process.exit(1);
});

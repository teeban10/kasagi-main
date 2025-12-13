/**
 * Shared constants for KasagiEngine
 */

// Redis channel patterns
export const REDIS_ROOM_CHANNEL_PATTERN = 'room:*:channel';
export const REDIS_ROOM_CHANNEL_PREFIX = 'room:';
export const REDIS_ROOM_CHANNEL_SUFFIX = ':channel';

// Room configuration
export const DEFAULT_TICK_RATE = 20; // ticks per second
export const DEFAULT_TICK_INTERVAL = 1000 / DEFAULT_TICK_RATE; // ms per tick
export const MAX_ENTITIES_PER_ROOM = 100;
export const ROOM_IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// WebSocket configuration (Phase 3)
export const WS_PING_INTERVAL = 30000; // 30 seconds
export const WS_PONG_TIMEOUT = 10000; // 10 seconds
export const WS_MAX_PAYLOAD_SIZE = 64 * 1024; // 64KB

// Delta engine configuration
export const DELTA_BATCH_SIZE = 10;
export const DELTA_BATCH_INTERVAL = 50; // ms
export const SNAPSHOT_INTERVAL = 100; // ticks

// Error codes
export const ErrorCodes = {
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  INVALID_INPUT: 'INVALID_INPUT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  CONNECTION_ERROR: 'CONNECTION_ERROR',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

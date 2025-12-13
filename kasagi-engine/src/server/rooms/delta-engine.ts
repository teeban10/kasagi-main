import msgpack from 'msgpack-lite';
import { logger } from '../../utils/logger.js';
import { config } from '../config/env.js';

const deltaLogger = logger.child({ module: 'delta-engine', instanceId: config.instanceId });

// ============================================================================
// Types
// ============================================================================

export interface DeltaPayload {
  roomId: string;
  entityId: string;
  fields: Record<string, unknown>;
  tick: number;
  seq: number;
  ts: number;
  instanceId: string;
}

export interface EntityDelta {
  [entityId: string]: Record<string, unknown> | null;
}

export interface FullDelta {
  roomId: string;
  delta: EntityDelta;
  tick: number;
  seq: number;
  ts: number;
  instanceId: string;
}

export interface EncodedSnapshot {
  tick: number;
  seq: number;
  data: string;
  timestamp: number;
}

// ============================================================================
// Delta Computation
// ============================================================================

/**
 * Compute a shallow diff between previous and next entity states.
 * Returns an object containing only the changed entity keys.
 */
export function computeEntityDelta(
  prev: Record<string, Record<string, unknown>>,
  next: Record<string, Record<string, unknown>>
): EntityDelta {
  const delta: EntityDelta = {};

  // Check for added or changed entities
  for (const entityId of Object.keys(next)) {
    const prevEntity = prev[entityId];
    const nextEntity = next[entityId];

    if (!prevEntity) {
      // New entity
      delta[entityId] = nextEntity;
    } else if (JSON.stringify(prevEntity) !== JSON.stringify(nextEntity)) {
      // Changed entity - compute field-level diff
      const fieldDelta: Record<string, unknown> = {};
      
      for (const field of Object.keys(nextEntity)) {
        if (prevEntity[field] !== nextEntity[field]) {
          fieldDelta[field] = nextEntity[field];
        }
      }
      
      // Check for removed fields
      for (const field of Object.keys(prevEntity)) {
        if (!(field in nextEntity)) {
          fieldDelta[field] = null;
        }
      }

      if (Object.keys(fieldDelta).length > 0) {
        delta[entityId] = fieldDelta;
      }
    }
  }

  // Check for removed entities (mark as null for deletion)
  for (const entityId of Object.keys(prev)) {
    if (!(entityId in next)) {
      delta[entityId] = null;
    }
  }

  return delta;
}

/**
 * Legacy computeDelta for backwards compatibility.
 */
export function computeDelta(
  prev: Record<string, unknown>,
  next: Record<string, unknown>
): Record<string, unknown> {
  const delta: Record<string, unknown> = {};

  for (const key of Object.keys(next)) {
    if (prev[key] !== next[key]) {
      delta[key] = next[key];
    }
  }

  for (const key of Object.keys(prev)) {
    if (!(key in next)) {
      delta[key] = null;
    }
  }

  return delta;
}

/**
 * Create a full delta payload with metadata.
 */
export function createDeltaPayload(
  roomId: string,
  delta: EntityDelta,
  tick: number,
  seq: number
): FullDelta {
  return {
    roomId,
    delta,
    tick,
    seq,
    ts: Date.now(),
    instanceId: config.instanceId,
  };
}

// ============================================================================
// Encoding / Decoding
// ============================================================================

/**
 * Encode a delta using MessagePack.
 */
export function encodeDelta(delta: FullDelta | Record<string, unknown>): Buffer {
  return Buffer.from(msgpack.encode(delta));
}

/**
 * Decode a MessagePack-encoded delta.
 */
export function decodeDelta(encoded: Uint8Array | Buffer | string): FullDelta {
  // Handle base64 string input
  if (typeof encoded === 'string') {
    encoded = Buffer.from(encoded, 'base64');
  }
  return msgpack.decode(encoded) as FullDelta;
}

/**
 * Encode delta to base64 string for Redis publish.
 */
export function encodeDeltaToBase64(delta: FullDelta): string {
  const buffer = encodeDelta(delta);
  return buffer.toString('base64');
}

/**
 * Decode base64 string from Redis to delta.
 */
export function decodeDeltaFromBase64(base64: string): FullDelta {
  const buffer = Buffer.from(base64, 'base64');
  return msgpack.decode(buffer) as FullDelta;
}

// ============================================================================
// Remote Delta Application
// ============================================================================

/**
 * Check if a remote delta should be applied based on sequence number.
 * Returns true if the delta is newer than our current state.
 */
export function shouldApplyRemoteDelta(
  remoteDelta: FullDelta,
  localSeq: number
): boolean {
  // Ignore deltas from our own instance
  if (remoteDelta.instanceId === config.instanceId) {
    deltaLogger.debug(
      { roomId: remoteDelta.roomId, seq: remoteDelta.seq },
      'Ignoring own delta'
    );
    return false;
  }

  // Ignore stale deltas
  if (remoteDelta.seq <= localSeq) {
    deltaLogger.debug(
      { roomId: remoteDelta.roomId, remoteSeq: remoteDelta.seq, localSeq },
      'Ignoring stale delta'
    );
    return false;
  }

  return true;
}

/**
 * Apply entity delta to a state object.
 * Mutates the entities object in place.
 */
export function applyDeltaToEntities(
  entities: Record<string, Record<string, unknown>>,
  delta: EntityDelta
): void {
  for (const [entityId, changes] of Object.entries(delta)) {
    if (changes === null) {
      // Entity was deleted
      delete entities[entityId];
    } else if (!entities[entityId]) {
      // New entity
      entities[entityId] = changes as Record<string, unknown>;
    } else {
      // Update existing entity
      for (const [field, value] of Object.entries(changes)) {
        if (value === null) {
          delete entities[entityId][field];
        } else {
          entities[entityId][field] = value;
        }
      }
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get current instance ID.
 */
export function getInstanceId(): string {
  return config.instanceId;
}

/**
 * Check if delta is empty.
 */
export function isDeltaEmpty(delta: EntityDelta): boolean {
  return Object.keys(delta).length === 0;
}

export type { EntityDelta as Delta };

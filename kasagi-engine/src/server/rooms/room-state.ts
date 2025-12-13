import type { WebSocket } from 'ws';
import msgpack from 'msgpack-lite';
import { logger } from '../../utils/logger.js';
import { config } from '../config/env.js';
import {
  computeEntityDelta,
  createDeltaPayload,
  encodeDeltaToBase64,
  applyDeltaToEntities,
  shouldApplyRemoteDelta,
  isDeltaEmpty,
  type FullDelta,
  type EntityDelta,
} from './delta-engine.js';
import {
  publishDelta,
  saveRoomSnapshot,
  loadRoomSnapshot,
} from '../redis/redis-client.js';
import type { KasagiSocket } from '../../shared/types.js';

const roomLogger = logger.child({ module: 'room-state', instanceId: config.instanceId });

export interface EntityState {
  [key: string]: unknown;
}

export interface RoomStateData {
  entities: Record<string, EntityState>;
  tick: number;
  seq: number;
}

export interface PlayerInput {
  playerId: string;
  payload: EntityState;
  timestamp?: number;
}

export class RoomState {
  public readonly roomId: string;
  public state: RoomStateData;
  private previousState: RoomStateData;
  public clients: Set<WebSocket>;
  private lastSnapshotTick: number;
  private isApplyingRemoteDelta: boolean;

  constructor(roomId: string, initialState?: RoomStateData) {
    this.roomId = roomId;
    this.state = initialState || {
      entities: {},
      tick: 0,
      seq: 0,
    };
    this.previousState = this.cloneState();
    this.clients = new Set();
    this.lastSnapshotTick = this.state.tick;
    this.isApplyingRemoteDelta = false;

    roomLogger.info({ roomId, tick: this.state.tick, seq: this.state.seq }, 'RoomState initialized');
  }

  /**
   * Create a RoomState from a Redis snapshot.
   */
  static async loadSnapshot(roomId: string): Promise<RoomState | null> {
    try {
      const snapshot = await loadRoomSnapshot(roomId);
      
      if (!snapshot) {
        roomLogger.debug({ roomId }, 'No snapshot found, creating fresh room');
        return null;
      }

      const stateData: RoomStateData = JSON.parse(snapshot.data);
      stateData.tick = snapshot.tick;
      stateData.seq = snapshot.seq;

      roomLogger.info(
        { roomId, tick: stateData.tick, seq: stateData.seq },
        'Room restored from snapshot'
      );

      return new RoomState(roomId, stateData);
    } catch (err) {
      roomLogger.error({ error: (err as Error).message, roomId }, 'Failed to load snapshot');
      return null;
    }
  }

  /**
   * Save current state as a snapshot to Redis.
   */
  async saveSnapshot(): Promise<void> {
    try {
      const data = JSON.stringify({
        entities: this.state.entities,
      });

      await saveRoomSnapshot(this.roomId, data, this.state.seq, this.state.tick);
      this.lastSnapshotTick = this.state.tick;

      roomLogger.info(
        { roomId: this.roomId, tick: this.state.tick, seq: this.state.seq },
        'Snapshot saved'
      );
    } catch (err) {
      roomLogger.error({ error: (err as Error).message, roomId: this.roomId }, 'Failed to save snapshot');
    }
  }

  /**
   * Check if we should save a snapshot and do so if needed.
   */
  private async maybeSnapshot(): Promise<void> {
    const ticksSinceSnapshot = this.state.tick - this.lastSnapshotTick;
    
    if (ticksSinceSnapshot >= config.snapshotInterval) {
      await this.saveSnapshot();
    }
  }

  /**
   * Add a client to this room.
   */
  public addClient(socket: WebSocket): void {
    this.clients.add(socket);
    roomLogger.info(
      { roomId: this.roomId, clientCount: this.clients.size },
      'Client added to room'
    );
  }

  /**
   * Remove a client from this room.
   */
  public removeClient(socket: WebSocket): void {
    this.clients.delete(socket);
    
    const kasagiSocket = socket as KasagiSocket;
    if (kasagiSocket.playerId && this.state.entities[kasagiSocket.playerId]) {
      const delta = this.removeEntity(kasagiSocket.playerId);
      if (!isDeltaEmpty(delta)) {
        this.broadcastDelta(delta);
        // Publish removal to Redis
        this.publishDeltaToRedis(delta);
      }
    }
    
    roomLogger.info(
      { roomId: this.roomId, clientCount: this.clients.size },
      'Client removed from room'
    );
  }

  /**
   * Get the number of connected clients.
   */
  public getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Apply player input to the room state.
   */
  public applyInput(input: PlayerInput, _socket?: WebSocket): EntityDelta {
    const { playerId, payload } = input;
    console.log('🔵 APPLYING INPUT:', { roomId: this.roomId, playerId, payload }); // ADD THIS

    roomLogger.debug({ roomId: this.roomId, playerId }, 'Applying player input');

    // Store previous state for delta computation
    this.previousState = this.cloneState();

    // Mutate the entity state
    this.state.entities[playerId] = {
      ...this.state.entities[playerId],
      ...payload,
      lastUpdate: Date.now(),
    };

    // Increment tick and sequence
    this.state.tick++;
    this.state.seq++;

    // Compute delta
    const delta = computeEntityDelta(
      this.previousState.entities as Record<string, Record<string, unknown>>,
      this.state.entities as Record<string, Record<string, unknown>>
    );

    roomLogger.debug({ roomId: this.roomId, delta, seq: this.state.seq }, 'Delta computed');

    // Broadcast and publish
    if (!isDeltaEmpty(delta)) {
      this.broadcastDelta(delta);
      this.publishDeltaToRedis(delta);
    }

    // Maybe save snapshot
    this.maybeSnapshot();

    return delta;
  }

  /**
   * Apply a remote delta from another server instance.
   * Does NOT re-emit to Redis, only broadcasts to local clients.
   */
  public applyRemoteDelta(remoteDelta: FullDelta): boolean {
    // Check if we should apply this delta
    if (!shouldApplyRemoteDelta(remoteDelta, this.state.seq)) {
      return false;
    }

    roomLogger.info(
      { 
        roomId: this.roomId, 
        remoteSeq: remoteDelta.seq, 
        localSeq: this.state.seq,
        fromInstance: remoteDelta.instanceId 
      },
      'Applying remote delta'
    );

    // Mark that we're applying a remote delta (prevents re-publishing)
    this.isApplyingRemoteDelta = true;

    try {
      // Apply the delta to our entities
      applyDeltaToEntities(
        this.state.entities as Record<string, Record<string, unknown>>,
        remoteDelta.delta
      );

      // Update our state counters
      this.state.seq = remoteDelta.seq;
      this.state.tick = Math.max(this.state.tick, remoteDelta.tick);

      // Broadcast to local WebSocket clients only
      this.broadcastDelta(remoteDelta.delta);

      return true;
    } finally {
      this.isApplyingRemoteDelta = false;
    }
  }

  /**
   * Publish delta to Redis for cross-instance sync.
   */
  private async publishDeltaToRedis(delta: EntityDelta): Promise<void> {
    // Don't re-publish if we're applying a remote delta
    if (this.isApplyingRemoteDelta) {
      return;
    }

    try {
      const fullDelta = createDeltaPayload(
        this.roomId,
        delta,
        this.state.tick,
        this.state.seq
      );
      
      const encoded = encodeDeltaToBase64(fullDelta);
      await publishDelta(this.roomId, encoded);
      roomLogger.info({ roomId: this.roomId, seq: this.state.seq, tick: this.state.tick }, 'Delta published to Redis');
    } catch (err) {
      roomLogger.error(
        { error: (err as Error).message, roomId: this.roomId },
        'Failed to publish delta to Redis'
      );
    }
  }

  /**
   * Broadcast a delta to all connected clients in this room.
   */
  public broadcastDelta(delta: EntityDelta): void {
    if (isDeltaEmpty(delta)) {
      return;
    }

    const message = {
      type: 'delta',
      roomId: this.roomId,
      tick: this.state.tick,
      seq: this.state.seq,
      delta,
      timestamp: Date.now(),
    };

    const encoded = msgpack.encode(message);

    roomLogger.debug(
      { roomId: this.roomId, clientCount: this.clients.size, deltaSize: encoded.length },
      'Broadcasting delta to clients'
    );

    for (const client of this.clients) {
      if (client.readyState === 1) {
        try {
          client.send(encoded);
        } catch (err) {
          roomLogger.error(
            { roomId: this.roomId, error: (err as Error).message },
            'Failed to send delta to client'
          );
        }
      }
    }
  }

  /**
   * Remove an entity from the room state.
   */
  public removeEntity(playerId: string): EntityDelta {
    this.previousState = this.cloneState();

    if (this.state.entities[playerId]) {
      delete this.state.entities[playerId];
      this.state.seq++;
      this.state.tick++;

      const delta = computeEntityDelta(
        this.previousState.entities as Record<string, Record<string, unknown>>,
        this.state.entities as Record<string, Record<string, unknown>>
      );

      roomLogger.info({ roomId: this.roomId, playerId }, 'Entity removed from room');
      return delta;
    }

    return {};
  }

  /**
   * Get the current full state (for snapshots/new client sync).
   */
  public getFullState(): RoomStateData {
    return this.cloneState();
  }

  /**
   * Get snapshot message for sending to new clients.
   */
  public getSnapshotMessage(): {
    type: 'snapshot';
    roomId: string;
    state: RoomStateData;
    tick: number;
    seq: number;
  } {
    return {
      type: 'snapshot',
      roomId: this.roomId,
      state: this.getFullState(),
      tick: this.state.tick,
      seq: this.state.seq,
    };
  }

  /**
   * Increment the tick counter.
   */
  public incrementTick(): number {
    return ++this.state.tick;
  }

  /**
   * Deep clone the current state.
   */
  private cloneState(): RoomStateData {
    return JSON.parse(JSON.stringify(this.state));
  }
}

export default RoomState;

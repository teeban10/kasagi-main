import type { WebSocket } from 'ws';
import { logger } from '../../utils/logger.js';
import { config } from '../config/env.js';
import { RoomState } from './room-state.js';
import type { KasagiSocket } from '../../shared/types.js';

const managerLogger = logger.child({ module: 'room-manager', instanceId: config.instanceId });

// Room storage
const rooms: Map<string, RoomState> = new Map();

// Pending room loads (to prevent race conditions)
const pendingLoads: Map<string, Promise<RoomState>> = new Map();

/**
 * Get an existing room or create a new one if it doesn't exist.
 * Attempts to load from Redis snapshot first.
 */
export async function getOrCreateRoom(roomId: string): Promise<RoomState> {
  // Check if room already exists in memory
  let room = rooms.get(roomId);
  if (room) {
    managerLogger.debug({ roomId }, 'Retrieved existing room from memory');
    return room;
  }

  // Check if there's a pending load for this room
  const pendingLoad = pendingLoads.get(roomId);
  if (pendingLoad) {
    managerLogger.debug({ roomId }, 'Waiting for pending room load');
    return pendingLoad;
  }

  // Create a promise for this load operation
  const loadPromise = (async () => {
    try {
      // Try to load from Redis snapshot first
      const restoredRoom = await RoomState.loadSnapshot(roomId);
      
      if (restoredRoom) {
        rooms.set(roomId, restoredRoom);
        managerLogger.info(
          { roomId, totalRooms: rooms.size, tick: restoredRoom.state.tick, seq: restoredRoom.state.seq },
          'Room restored from snapshot'
        );
        return restoredRoom;
      }

      // Create fresh room if no snapshot exists
      room = new RoomState(roomId);
      rooms.set(roomId, room);
      managerLogger.info({ roomId, totalRooms: rooms.size }, 'New room created');
      return room;
    } finally {
      // Clean up pending load
      pendingLoads.delete(roomId);
    }
  })();

  pendingLoads.set(roomId, loadPromise);
  return loadPromise;
}

/**
 * Synchronous version - only gets room if already loaded.
 */
export function getRoom(roomId: string): RoomState | undefined {
  return rooms.get(roomId);
}

/**
 * Delete a room and clean up its resources.
 * Saves final snapshot before deletion.
 */
export async function deleteRoom(roomId: string): Promise<boolean> {
  const room = rooms.get(roomId);

  if (room) {
    // Check if room has connected clients
    if (room.getClientCount() > 0) {
      managerLogger.warn(
        { roomId, clientCount: room.getClientCount() },
        'Attempted to delete room with connected clients'
      );
    }

    // Save final snapshot before deletion
    try {
      await room.saveSnapshot();
      managerLogger.info({ roomId }, 'Final snapshot saved before room deletion');
    } catch (err) {
      managerLogger.error(
        { roomId, error: (err as Error).message },
        'Failed to save final snapshot'
      );
    }

    rooms.delete(roomId);
    managerLogger.info({ roomId, totalRooms: rooms.size }, 'Room destroyed');
    return true;
  }

  managerLogger.warn({ roomId }, 'Attempted to delete non-existent room');
  return false;
}

/**
 * Join a room - get or create room and add client.
 */
export async function joinRoom(roomId: string, socket: WebSocket): Promise<RoomState> {
  const room = await getOrCreateRoom(roomId);
  room.addClient(socket);

  // Update socket metadata
  const kasagiSocket = socket as KasagiSocket;
  kasagiSocket.roomId = roomId;

  managerLogger.info(
    { roomId, clientCount: room.getClientCount() },
    'Client joined room'
  );

  return room;
}

/**
 * Leave a room - remove client and cleanup if empty.
 */
export async function leaveRoom(roomId: string, socket: WebSocket): Promise<void> {
  const room = rooms.get(roomId);

  if (!room) {
    managerLogger.warn({ roomId }, 'Attempted to leave non-existent room');
    return;
  }

  room.removeClient(socket);

  // Update socket metadata
  const kasagiSocket = socket as KasagiSocket;
  kasagiSocket.roomId = null;
  kasagiSocket.playerId = null;

  managerLogger.info(
    { roomId, clientCount: room.getClientCount() },
    'Client left room'
  );

  // Delete room if empty
  if (room.getClientCount() === 0) {
    await deleteRoom(roomId);
  }
}

/**
 * Check if a room exists in memory.
 */
export function hasRoom(roomId: string): boolean {
  return rooms.has(roomId);
}

/**
 * Get all room IDs.
 */
export function getAllRoomIds(): string[] {
  return Array.from(rooms.keys());
}

/**
 * Get the total number of rooms.
 */
export function getRoomCount(): number {
  return rooms.size;
}

/**
 * Delete empty rooms (no connected clients).
 */
export async function cleanupEmptyRooms(): Promise<number> {
  let deletedCount = 0;
  const roomsToDelete: string[] = [];

  for (const [roomId, room] of rooms) {
    if (room.getClientCount() === 0) {
      roomsToDelete.push(roomId);
    }
  }

  for (const roomId of roomsToDelete) {
    await deleteRoom(roomId);
    deletedCount++;
  }

  if (deletedCount > 0) {
    managerLogger.info({ deletedCount, remainingRooms: rooms.size }, 'Cleanup completed');
  }

  return deletedCount;
}

/**
 * Get room statistics.
 */
export function getRoomStats(): {
  totalRooms: number;
  totalClients: number;
  roomDetails: Array<{ roomId: string; clients: number; tick: number; seq: number }>;
} {
  let totalClients = 0;
  const roomDetails: Array<{ roomId: string; clients: number; tick: number; seq: number }> = [];

  for (const [roomId, room] of rooms) {
    const clientCount = room.getClientCount();
    totalClients += clientCount;
    roomDetails.push({
      roomId,
      clients: clientCount,
      tick: room.state.tick,
      seq: room.state.seq,
    });
  }

  return {
    totalRooms: rooms.size,
    totalClients,
    roomDetails,
  };
}

/**
 * Save all room snapshots (useful for graceful shutdown).
 */
export async function saveAllSnapshots(): Promise<void> {
  managerLogger.info({ roomCount: rooms.size }, 'Saving all room snapshots');
  
  const savePromises: Promise<void>[] = [];
  
  for (const room of rooms.values()) {
    savePromises.push(room.saveSnapshot());
  }

  await Promise.allSettled(savePromises);
  managerLogger.info('All snapshots saved');
}

export { rooms };

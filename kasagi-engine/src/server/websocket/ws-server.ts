import { WebSocketServer, WebSocket } from 'ws';
import msgpack from 'msgpack-lite';
import { logger } from '../../utils/logger.js';
import { config } from '../config/env.js';
import { joinRoom, leaveRoom, getRoom } from '../rooms/room-manager.js';
import type { 
  KasagiSocket, 
  WsClientMessage, 
  WsJoinMessage, 
  WsInputMessage,
  WsJoinedMessage,
  WsErrorMessage,
} from '../../shared/types.js';

const wsLogger = logger.child({ module: 'ws-server', instanceId: config.instanceId });

const WS_PORT = config.wsPort;
const HEARTBEAT_INTERVAL = 30000;

let wss: WebSocketServer | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

/**
 * Start the WebSocket server.
 */
export function startWsServer(): WebSocketServer {
  wss = new WebSocketServer({ port: WS_PORT });

  wsLogger.info({ port: WS_PORT }, 'WebSocket server starting...');

  wss.on('listening', () => {
    wsLogger.info({ port: WS_PORT }, 'WebSocket server started');
  });

  wss.on('connection', handleConnection);

  wss.on('error', (err: Error) => {
    wsLogger.error({ error: err.message }, 'WebSocket server error');
  });

  // Start heartbeat to detect dead connections
  startHeartbeat();

  return wss;
}

/**
 * Handle new WebSocket connection.
 */
function handleConnection(socket: WebSocket): void {
  // Attach metadata to socket
  const kasagiSocket = socket as KasagiSocket;
  kasagiSocket.roomId = null;
  kasagiSocket.playerId = null;
  kasagiSocket.isAlive = true;

  wsLogger.info('Client connected');

  // Handle pong responses for heartbeat
  socket.on('pong', () => {
    kasagiSocket.isAlive = true;
  });

  // Handle incoming messages
  socket.on('message', (data: Buffer | string) => {
    handleMessage(kasagiSocket, data);
  });

  // Handle client disconnect
  socket.on('close', () => {
    handleDisconnect(kasagiSocket);
  });

  // Handle errors
  socket.on('error', (err: Error) => {
    wsLogger.error({ error: err.message }, 'Client socket error');
  });
}

/**
 * Handle incoming WebSocket message.
 */
function handleMessage(socket: KasagiSocket, data: Buffer | string): void {
  try {
    // Parse JSON message from client
    const rawMessage = typeof data === 'string' ? data : data.toString('utf-8');
    const message: WsClientMessage = JSON.parse(rawMessage);

    wsLogger.debug({ type: message.type }, 'Received message');

    switch (message.type) {
      case 'join':
        handleJoin(socket, message as WsJoinMessage);
        break;
      case 'input':
        handleInput(socket, message as WsInputMessage);
        break;
      default:
        sendError(socket, 'INVALID_TYPE', `Unknown message type: ${(message as WsClientMessage).type}`);
    }
  } catch (err) {
    wsLogger.error({ error: (err as Error).message }, 'Failed to parse message');
    sendError(socket, 'PARSE_ERROR', 'Invalid JSON message');
  }
}

/**
 * Handle join room request.
 */
async function handleJoin(socket: KasagiSocket, message: WsJoinMessage): Promise<void> {
  const { roomId, playerId } = message;

  if (!roomId) {
    sendError(socket, 'INVALID_ROOM', 'roomId is required');
    return;
  }

  // Leave current room if already in one
  if (socket.roomId) {
    await leaveRoom(socket.roomId, socket);
  }

  // Generate playerId if not provided
  const assignedPlayerId = playerId || `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  socket.playerId = assignedPlayerId;

  // Join the room (loads from snapshot if available)
  const room = await joinRoom(roomId, socket);

  wsLogger.info({ roomId, playerId: assignedPlayerId }, 'Client joined room');

  // Send join confirmation (as JSON)
  const response: WsJoinedMessage = {
    type: 'joined',
    roomId,
    playerId: assignedPlayerId,
  };
  socket.send(JSON.stringify(response));

  // Send current room state snapshot to the new client (MessagePack encoded)
  const snapshotMessage = room.getSnapshotMessage();
  socket.send(msgpack.encode(snapshotMessage));

  wsLogger.debug(
    { roomId, tick: snapshotMessage.tick, seq: snapshotMessage.seq },
    'Sent snapshot to new client'
  );
}

/**
 * Handle player input.
 */
function handleInput(socket: KasagiSocket, message: WsInputMessage): void {
  const { roomId, playerId, payload } = message;

  if (!roomId || !playerId || !payload) {
    sendError(socket, 'INVALID_INPUT', 'roomId, playerId, and payload are required');
    return;
  }

  // Verify socket is in the correct room
  if (socket.roomId !== roomId) {
    sendError(socket, 'WRONG_ROOM', 'You are not in this room');
    return;
  }

  const room = getRoom(roomId);
  if (!room) {
    sendError(socket, 'ROOM_NOT_FOUND', 'Room does not exist');
    return;
  }

  wsLogger.debug({ roomId, playerId }, 'Processing input');

  // Apply input to room state
  // This automatically broadcasts to local clients AND publishes to Redis
  room.applyInput({ playerId, payload }, socket);
}

/**
 * Handle client disconnect.
 */
async function handleDisconnect(socket: KasagiSocket): Promise<void> {
  wsLogger.info({ roomId: socket.roomId, playerId: socket.playerId }, 'Client disconnected');

  // Leave room if in one
  if (socket.roomId) {
    await leaveRoom(socket.roomId, socket);
  }
}

/**
 * Send error message to client.
 */
function sendError(socket: KasagiSocket, code: string, message: string): void {
  const errorMessage: WsErrorMessage = {
    type: 'error',
    code,
    message,
  };
  socket.send(JSON.stringify(errorMessage));
}

/**
 * Broadcast data to all clients in a specific room.
 */
export function broadcastToRoom(roomId: string, data: unknown): void {
  const room = getRoom(roomId);
  if (!room) {
    wsLogger.warn({ roomId }, 'Cannot broadcast to non-existent room');
    return;
  }

  const encoded = msgpack.encode(data);

  for (const client of room.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(encoded);
      } catch (err) {
        wsLogger.error({ error: (err as Error).message }, 'Failed to broadcast to client');
      }
    }
  }
}

/**
 * Start heartbeat interval to detect dead connections.
 */
function startHeartbeat(): void {
  heartbeatTimer = setInterval(() => {
    if (!wss) return;

    wss.clients.forEach((socket) => {
      const kasagiSocket = socket as KasagiSocket;
      
      if (!kasagiSocket.isAlive) {
        wsLogger.debug('Terminating dead connection');
        return socket.terminate();
      }

      kasagiSocket.isAlive = false;
      socket.ping();
    });
  }, HEARTBEAT_INTERVAL);
}

/**
 * Stop the WebSocket server gracefully.
 */
export async function stopWsServer(): Promise<void> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  if (wss) {
    wsLogger.info('Shutting down WebSocket server...');
    
    // Close all client connections
    wss.clients.forEach((socket) => {
      socket.close(1000, 'Server shutting down');
    });

    await new Promise<void>((resolve) => {
      wss!.close(() => {
        wsLogger.info('WebSocket server stopped');
        resolve();
      });
    });
    
    wss = null;
  }
}

export { wss };

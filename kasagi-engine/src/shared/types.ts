/**
 * Shared type definitions for KasagiEngine
 */

import type { WebSocket } from 'ws';

// Entity and state types
export interface EntityState {
  [key: string]: unknown;
}

export interface RoomStateData {
  entities: Record<string, EntityState>;
  tick: number;
  seq: number;
}

// Player input types
export interface PlayerInput {
  playerId: string;
  payload: EntityState;
  timestamp?: number;
}

// Delta types
export interface Delta {
  roomId: string;
  tick: number;
  seq: number;
  delta: Record<string, unknown>;
  timestamp: number;
}

// ============================================================================
// WebSocket Message Types
// ============================================================================

export type WsMessageType = 'join' | 'input' | 'joined' | 'delta' | 'left' | 'error';

export interface WsBaseMessage {
  type: WsMessageType;
}

// Client → Server: Join a room
export interface WsJoinMessage extends WsBaseMessage {
  type: 'join';
  roomId: string;
  playerId?: string;
}

// Client → Server: Send input
export interface WsInputMessage extends WsBaseMessage {
  type: 'input';
  roomId: string;
  playerId: string;
  payload: EntityState;
}

// Server → Client: Joined confirmation
export interface WsJoinedMessage extends WsBaseMessage {
  type: 'joined';
  roomId: string;
  playerId: string;
}

// Server → Client: State delta (MessagePack encoded)
export interface WsDeltaMessage extends WsBaseMessage {
  type: 'delta';
  roomId: string;
  tick: number;
  seq: number;
  delta: Record<string, unknown>;
  timestamp: number;
}

// Server → Client: Left room
export interface WsLeftMessage extends WsBaseMessage {
  type: 'left';
  roomId: string;
}

// Server → Client: Error
export interface WsErrorMessage extends WsBaseMessage {
  type: 'error';
  code: string;
  message: string;
}

export type WsClientMessage = WsJoinMessage | WsInputMessage;
export type WsServerMessage = WsJoinedMessage | WsDeltaMessage | WsLeftMessage | WsErrorMessage;

// Extended WebSocket with metadata
export interface KasagiSocket extends WebSocket {
  roomId: string | null;
  playerId: string | null;
  isAlive: boolean;
}

// Legacy message types for backwards compatibility
export enum MessageType {
  JOIN_ROOM = 'join_room',
  LEAVE_ROOM = 'leave_room',
  PLAYER_INPUT = 'player_input',
  STATE_DELTA = 'state_delta',
  FULL_STATE = 'full_state',
  ERROR = 'error',
  PING = 'ping',
  PONG = 'pong',
}

export interface BaseMessage {
  type: MessageType;
  timestamp: number;
}

export interface JoinRoomMessage extends BaseMessage {
  type: MessageType.JOIN_ROOM;
  roomId: string;
  playerId: string;
}

export interface LeaveRoomMessage extends BaseMessage {
  type: MessageType.LEAVE_ROOM;
  roomId: string;
  playerId: string;
}

export interface PlayerInputMessage extends BaseMessage {
  type: MessageType.PLAYER_INPUT;
  roomId: string;
  input: PlayerInput;
}

export interface StateDeltaMessage extends BaseMessage {
  type: MessageType.STATE_DELTA;
  roomId: string;
  delta: Delta;
}

export interface FullStateMessage extends BaseMessage {
  type: MessageType.FULL_STATE;
  roomId: string;
  state: RoomStateData;
}

export interface ErrorMessage extends BaseMessage {
  type: MessageType.ERROR;
  code: string;
  message: string;
}

export type GameMessage =
  | JoinRoomMessage
  | LeaveRoomMessage
  | PlayerInputMessage
  | StateDeltaMessage
  | FullStateMessage
  | ErrorMessage;

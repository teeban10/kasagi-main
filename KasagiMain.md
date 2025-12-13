# KasagiEngine Instance Architecture  
## How a Single Instance Works (Input → Rooms → Delta Engine → Redis)

This document explains **exactly how one application instance behaves** inside the KasagiEngine real-time synchronization architecture.  
It covers:

- Client input flow  
- Room lifecycle  
- Delta Engine responsibilities  
- Interaction with Redis (Pub/Sub, Snapshot, Streams)  
- Tick/sequence behavior  
- Cross-instance consistency  
- Recovery logic  

Diagrams included in ASCII form so they render nicely anywhere.

---

# 1. High-Level Instance Architecture

Each instance runs:

- WebSocket Server  
- Room Manager  
- Delta Engine  
- Redis Client (Pub/Sub, Hash, Streams)  

```
┌──────────────────────────────┐
│        App Instance          │
│──────────────────────────────│
│  WebSocket Server            │
│  Room Registry               │
│  Room Actors (in-memory)     │
│  Delta Engine                │
│  Redis Client (Pub/Sub)      │
└──────────────────────────────┘
```

Instance is **stateless** except for in-memory room state.  
Redis provides shared coordination.

---

# 2. Full Input → Output Flow Diagram

```
             ┌──────────────┐
             │   Client     │
             └──────┬───────┘
                    │ Input (WebSocket)
                    ▼
        ┌──────────────────────────────┐
        │     WebSocket Server         │
        └───────┬──────────────────────┘
                │ dispatch by roomId
                ▼
       ┌──────────────────────────────┐
       │        Room Manager          │
       │  (find or create room)       │
       └───────┬──────────────────────┘
               │ apply input
               ▼
        ┌──────────────────────────────┐
        │        Delta Engine          │
        │  diff prev vs new state      │
        │  generate deltas             │
        └───────┬──────────────────────┘
                │
                ├──► Local Clients (WS Broadcast)
                │
                └──► Redis Pub/Sub (Cross-instance sync)
```

---

# 3. Room Lifecycle

Rooms are **in-memory actors** that exist only on instances with active clients.

### 3.1 Room Creation

A room is created when:

- The first client sends `join(roomId)`  
- No existing room actor exists on that instance  

Creation sequence:

```
Client Join
   ▼
Instance checks in-memory registry
   ▼
If room does not exist:
   ▼
Load snapshot from Redis (if exists)
   ▼
Create RoomState object
   ▼
Start timers (tick, flush)
```

### 3.2 Room State Structure

```json
{
  "entities": {
    "p1": { "x": 10, "y": 12, "hp": 99 },
    "p2": { "x": 2,  "y": 5,  "hp": 100 }
  },
  "tick": 1521,
  "seq": 2231
}
```

---

# 4. Delta Engine (Core Concept)

The Delta Engine is responsible for **efficient incremental updates**.

### Responsibilities:

- Track previous state  
- Compare it to new state  
- Extract minimal delta  
- Assign sequence + tick  
- Push deltas to:
  - Local clients  
  - Redis Pub/Sub  
  - (Optional) Redis Streams  
- Support applying remote deltas idempotently  
- Trigger periodic snapshots

### Delta Flow Diagram

```
       Before Input
       ┌──────────────┐
       │ prev state   │
       └─────┬────────┘
             │ mutate
             ▼
       ┌──────────────┐
       │ new state    │
       └─────┬────────┘
             │ shallow/domain diff
             ▼
       ┌───────────────┐
       │ delta payload  │
       └─────┬─────────┘
             │
     ┌───────┴─────────────────────┐
     │ Broadcast locally (WebSocket)│
     └───────┬─────────────────────┘
             │
             ▼
       Publish to Redis (Pub/Sub)
```

---

# 5. How an Instance Interacts with Redis

Instances use **3 Redis features**:

## 5.1 Pub/Sub (Real-time cross-instance sync)

For each room:

```
room:{roomId}:channel
```

When instance A produces delta:

```
PUBLISH room:{id}:channel <MessagePackDelta>
```

Instance B receives:

```
SUBSCRIBE room:{id}:channel
applyRemoteDelta(delta)
broadcastToLocalClients(delta)
```

### Pub/Sub Diagram

```
Instance A ──► Redis Pub/Sub ──► Instance B
     ▲                                  │
     └───────────── Instance C ◄────────┘
```

---

## 5.2 Redis Hash (Room Snapshot)

Key format:

```
room:{id}:snapshot
```

Stored fields:

```
data = serialized room state
seq  = last sequence
tick = last tick
ts   = timestamp
```

### When snapshots are used:

- On room creation  
- On reconnection  
- On instance restart  
- On Redis failover  

---

## 5.3 Redis Streams (Optional Durable Logs)

Key:

```
room:{id}:ops
```

Used for:

- Replay  
- Debugging  
- Rebuilding state  

Flow:

```
XADD room:{id}:ops * data <delta>
```

---

# 6. Complete Instance Behavior Lifecycle

## 6.1 Input Arrives

```
WS Message → instance → find room → apply mutation → delta produced
```

## 6.2 Delta Processing

```
Delta Engine:
  prev state
    ↓
  new state
    ↓
  compute diff
    ↓
  deltas[] with seq/tick
```

## 6.3 Broadcast

```
Local WS clients ◄──────── delta
Redis Pub/Sub   ◄──────── delta
Redis Streams   ◄──────── delta (optional)
```

## 6.4 Receive Remote Deltas

```
Redis Pub/Sub → instance → applyRemoteDelta(delta) → WS broadcast
```

## 6.5 Snapshot

```
Every N seconds/ticks:
HSET room:{id}:snapshot ...
```

---

# 7. Full System Diagram (Instance + Redis + Clients)

```
                         ┌──────────────────────┐
                         │        Clients       │
                         └────────────┬─────────┘
                                      │ WebSocket
                                      ▼
                         ┌──────────────────────┐
                         │    WS Server         │
                         └────────────┬─────────┘
                                      │ room routing
                                      ▼
                    ┌──────────────────────────────────────┐
                    │           Room Actor                  │
                    │ in-memory authoritative state         │
                    └─────────────┬────────────────────────┘
                                  │ mutation
                                  ▼
                         ┌──────────────────────┐
                         │     Delta Engine     │
                         └────────────┬─────────┘
                                      │
                ┌─────────────────────┼───────────────────────────┐
                │                     │                           │
                ▼                     ▼                           ▼
     ┌───────────────────┐   ┌──────────────────┐       ┌─────────────────┐
     │ WS Broadcast      │   │ Redis Pub/Sub    │       │ Redis Streams   │
     └───────────────────┘   └──────────────────┘       └─────────────────┘
                                      │
                                      ▼
                              Other Instances
```

---

# 8. Failure Handling (Instance Perspective)

## Redis Down (temporary)
- Local room continues running  
- New deltas queue locally  
- When Redis returns:
  - Reconnect  
  - Send snapshot or missed deltas  

## Instance Crashes
- Clients reconnect to another instance  
- That instance loads snapshot from Redis  

## Pub/Sub Drop
- Client sees missing seq numbers  
- Requests snapshot resend  

---

# 9. Summary

An instance is responsible for:

1. Managing WebSocket connections  
2. Holding in-memory authoritative room state  
3. Applying client inputs  
4. Running the Delta Engine  
5. Broadcasting updates locally  
6. Publishing/receiving deltas via Redis Pub/Sub  
7. Saving persistent snapshots  
8. Rehydrating rooms after restarts  
9. Remaining stateless with Redis as backing coordination layer  

This achieves:

- Low latency  
- Horizontal scale  
- Cross-instance consistency  
- Fault tolerance  
- Efficient bandwidth usage  

---

# End of Document  
KasagiEngine – Instance Architecture & Interaction with Redis  

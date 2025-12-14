KasagiEngine Real-Time State Synchronization Service  
Architecture & Design Document
====================================================

Author: Teeban Kumar
Purpose: Backend Challenge Submission  
Tech Stack: Node.js, WebSockets, Redis

1. Overview
-----------

The KasagiEngine Real-Time State Synchronization Service provides a scalable, fault-tolerant, low-latency backend for multiplayer games or collaborative applications. Its purpose is to ensure all connected clients share a consistent, up-to-date state of the world or document.

Key technologies used:
- WebSockets for real-time communication
- Authoritative server model for correctness
- Redis Pub/Sub for cross-instance synchronization
- Redis Hashes for snapshot storage
- Redis Streams (optional) for durable replay and recovery

This system supports horizontal scaling, delta synchronization, fast failover, and high throughput.

2. Problem Definition
---------------------

We need a backend that can:

- Handle a high volume of concurrent clients
- Sync shared state in real-time
- Guarantee consistency across all users
- Provide resilience against server failures
- Scale horizontally across many app instances
- Minimize bandwidth with delta updates
- Use efficient binary serialization

Use cases:
- Multiplayer game rooms
- Collaborative drawing/editing sessions
- Shared dashboards or live systems
- Virtual world interactions

3. High-Level Architecture
--------------------------

System architecture overview:

Load Balancer  
→ Multiple App Instances (WebSocket + Room Manager + Redis Client)  
→ Redis Cluster (Pub/Sub, Hash Snapshots, Streams)

Diagram (ASCII):

                   LOAD BALANCER
                         |
      -----------------------------------------
      |                   |                   |
   INSTANCE A         INSTANCE B           INSTANCE C
   - WebSockets       - WebSockets         - WebSockets
   - Rooms            - Rooms              - Rooms
   - Delta Engine     - Delta Engine       - Delta Engine
   - Redis Client     - Redis Client       - Redis Client
      |                   |                   |
      ------------------ Redis -------------------------
           - Pub/Sub channels (real-time sync)
           - Hash snapshots (state store)
           - Streams (optional op log)

4. Core Components
------------------

4.1 WebSocket Gateway  
Handles:
- Client connections
- Room join/leave requests
- Receiving client inputs
- Sending delta/state updates

All instances are stateless → supports horizontal scaling.

4.2 Room Manager (Authoritative Loop)  
Each room is a lightweight in-memory actor responsible for:
- Maintaining authoritative state
- Applying client actions
- Generating minimal delta updates
- Broadcasting updates to room participants
- Saving periodic room snapshots to Redis

4.3 Redis Pub/Sub  
Used for cross-instance synchronization.

Flow:
1. Instance A applies an update
2. Publishes delta to channel: room:<id>:channel
3. Other instances receive delta
4. They update their own room state and forward to clients

4.4 Redis Hash (Snapshot Store)  
room:<id>:snapshot → latest JSON snapshot  
room:<id>:tick → authoritative tick/sequence

Used for:
- Client reconnection
- Server recovery
- New instance cold starts

4.5 Redis Streams (Optional)  
room:<id>:ops → XADD log of operations

Used for:
- Replaying missed updates
- Debugging / forking room state
- Ensuring strong recoverability

5. Data Flow
------------

5.1 Client Joins Room  
Client connects → sends Join(roomId)  
Server loads snapshot → sends snapshot → client syncs

5.2 Delta Sync Flow  
Client → sends input  
Instance A → applies update  
Instance A → broadcasts delta to local clients  
Instance A → publishes delta to Redis  
Instances B/C → receive delta → update and broadcast

5.3 Reconnection Flow  
Client reconnects  
Server loads snapshot from Redis  
Server sends snapshot to client  
Client resumes deltas

6. State Model
--------------

Example room state:

{
  "players": {
    "p1": { "x": 10, "y": 14, "hp": 100 },
    "p2": { "x": 8,  "y": 9,  "hp": 90 }
  },
  "objects": {},
  "tick": 1522
}

Example delta:

{
  "id": "p1",
  "pos": { "x": 11, "y": 14 },
  "tick": 1523
}

We only send changed fields.

7. Scaling Strategy
-------------------

Horizontal scaling is achieved by:
- Running multiple app instances
- Making each instance stateless
- Using Redis Pub/Sub to keep state consistent across instances

Potential bottlenecks and solutions:

| Bottleneck          | Solution                           |
|---------------------|------------------------------------|
| High Redis traffic  | Room sharding                      |
| Large room states   | Delta compression                  |
| CPU overload        | Add more instances                 |
| Redis limits        | Redis Cluster                      |

8. Resilience & Fault Tolerance
-------------------------------

Server Crash:
- Instance reloads state from Redis snapshot
- Optional: replay missed ops via Redis Streams

Redis Crash:
- AOF/RDB persistence restores state
- Cluster mode ensures HA

Client Disconnect:
- Client reconnects
- Receives fresh snapshot
- Continues receiving deltas

9. Event Loop & Concurrency
---------------------------

Node.js event loop advantages:
- High throughput
- Non-blocking I/O
- Perfect for WebSockets

Guideline:
Never perform heavy CPU tasks in the event loop. Use workers if needed.

10. Serialization & Performance
-------------------------------

Use MessagePack or Protobuf for binary serialization.

Optimizations:
- Delta compression
- Only send changed fields
- Batch updates when idle

11. Prototype Feature Requirements
----------------------------------

The prototype demonstrates:

- WebSocket server
- Client join flow
- State storage in Redis
- Client → server → delta → broadcast loop
- Redis Pub/Sub cross-instance sync
- Redis snapshot for reconnection

12. Testing Plan
----------------

Load Tests:
- k6 WebSocket load simulation
- 1000+ concurrent users
- Validate latency and throughput

Reliability Tests:
- Kill app instances randomly
- Redis failover
- Reconnection handling

Consistency Tests:
- Ensure state convergence
- Verify no dropped deltas
- Validate tick ordering

13. Trade-offs & Justification
------------------------------

Not using CRDT:
- Too slow for real-time play
- Not suitable for authoritative physics/state
- Adds unnecessary metadata overhead

Not using Kafka:
- Not designed for low-latency real-time sync
- Too heavy and complex for gameplay data
- Better suited for analytics/event pipelines

Using Redis:
- Sub-ms latency
- Simple and reliable
- Perfect for cross-instance event propagation

14. Future Extensions
---------------------

- Move durable log to JetStream (NATS)
- Add interest-based state filtering
- Multi-region replication
- Hybrid UDP transport for physics (non-browser)

15. TL;DR Summary
-----------------

KasagiEngine uses:
- WebSockets for real-time
- Authoritative state server for correctness
- Redis Pub/Sub for scaling + consistency
- Redis Hash for snapshots
- Delta updates for performance
- Stateless instances for horizontal scale

This architecture is fast, scalable, fault-tolerant, and satisfies all backend challenge requirements.

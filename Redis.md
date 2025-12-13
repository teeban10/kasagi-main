# Redis Architecture for KasagiEngine Real-Time Sync
This document explains how Redis is used in the KasagiEngine real-time state synchronization backend, including architecture, high availability, clustering strategy, key structure, and failover behavior.

---

## 1. Why Redis in KasagiEngine?
Redis is used as the backbone for:
- **Cross-instance real-time synchronization** (Pub/Sub)
- **Authoritative room snapshots** (Hashes)
- **Optional durable operation logs** (Streams)
- **Low-latency message propagation**
- **Horizontal scaling support**

Redis is ideal because it provides:
- Sub-millisecond latency  
- High throughput  
- Simple operational model  
- Built-in replication + HA  
- Cluster mode for scale-out  

---

## 2. Redis Components Used

### ### 2.1 Redis Pub/Sub  
Used for broadcasting deltas from one app instance to all others.

Channel structure:
```
room:<roomId>:channel
```

When an instance calculates a delta, it publishes:
- The delta metadata (seq, tick, entityId, fields)
- Serialized with MessagePack (base64 encoded)

All other instances subscribed to this channel apply the delta and forward it to their connected clients.

---

### ### 2.2 Redis Hashes (Room Snapshots)
Each room stores its authoritative snapshot in Redis:

```
room:<roomId>:snapshot
```

Stored fields:
- `data` → serialized room state (JSON or binary)
- `seq` → last applied sequence number
- `tick` → last authoritative tick

Used for:
- Client reconnection (fresh snapshot)
- Server recovery (cold start)
- Debugging / admin tooling

---

### ### 2.3 Redis Streams (Optional, Durable Log)
Streams are optional and provide:
- Replay for missed deltas  
- Full room history  
- Crash resilience  

Key pattern:
```
room:<roomId>:ops
```

Each entry:
```
XADD room:<id>:ops * data <msgpack delta>
```

Use cases:
- Rebuild room state after restart  
- Debugging  
- Persistent replay  
- Consistency verification  

---

## 3. Redis High Availability Setup

KasagiEngine requires Redis to be highly available because it participates in cross-instance synchronization and snapshot storage.

We use **Redis Sentinel Mode**:

```
                 ┌──────────────────────────┐
                 │      Sentinel Cluster     │
                 │ (3 sentinel processes)    │
                 └───────────┬──────────────┘
                             │
      ┌──────────────────────┼────────────────────────┐
      │                      │                        │
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Redis Master │ <-> │ Redis Replica│ <-> │ Redis Replica│
└──────────────┘     └──────────────┘     └──────────────┘
```

### ### How Sentinel protects us:
- Monitors master health  
- Elects replica as new master on failure  
- Application reconnects automatically  
- No manual intervention needed  

This prevents Redis from becoming a single point of failure.

---

## 4. Redis Cluster (Scale-Out Architecture)

For large deployments (>20k rooms, heavy Pub/Sub load), we move to **Redis Cluster**.

Example 3-shard cluster:

```
   ┌──────────┐   ┌──────────┐   ┌──────────┐
   │ Master A  │   │ Master B  │   │ Master C  │
   └─────┬────┘   └────┬─────┘   └────┬─────┘
         │              │              │
   ┌─────▼────┐   ┌────▼─────┐   ┌────▼─────┐
   │ Replica A│   │ Replica B │   │ Replica C│
   └──────────┘   └───────────┘   └──────────┘
```

### ### Hash Slot Strategy
Redis cluster shards keys by hash slots (0–16383).

We enforce:
```
room:{<roomId>}:snapshot
room:{<roomId>}:ops
room:{<roomId>}:channel
```

The `{…}` hash tag ensures **all keys for the same room go to the same shard**, improving locality and reducing latency.

---

## 5. Redis Failure Behavior

### ### If Redis Master Dies
- Sentinel marks it DOWN  
- Elects a new master from replicas  
- Application reconnects  
- Pub/Sub continues working  
- Snapshots remain available  

Downtime: **~200ms to 2 seconds**, depending on config.

### ### If a Cluster Shard Dies
Cluster will:
- Promote replica  
- Rebalance slots if needed  
- Maintain online operations  

### ### If Redis Fully Goes Down
Gameplay continues using in-memory room state.  
Only multi-instance sync pauses temporarily.  
Once Redis returns:
- Missing deltas are resent via snapshot or Streams replay  

This ensures **graceful degradation**.

---

## 6. Redis Key Naming Convention

Consistent naming avoids collisions and supports sharding.

```
room:{roomId}:snapshot
room:{roomId}:channel
room:{roomId}:ops
room:{roomId}:tick
```

Example with room `abc123`:

```
room:{abc123}:snapshot
room:{abc123}:channel
room:{abc123}:ops
room:{abc123}:tick
```

---

## 7. How Redis Integrates Into the Engine

### Write Path
```
Client Input
→ App Instance applies update
→ Delta Engine generates delta
→ Publish delta via Redis Pub/Sub
→ Save snapshot every N ticks to Redis Hash
→ (Optional) Append op to Redis Streams
```

### Read Path
```
Instance subscribes to Pub/Sub channels
→ Receives deltas
→ Applies deltas to local state
→ Broadcasts to connected local clients
```

---

## 8. Why Redis Instead of a DB?

Reasons:
- Real-time performance (<1ms)
- Pub/Sub built in
- No heavy queries
- Perfect for ephemeral and fast-changing state
- Easy horizontal scaling
- Event-driven architecture aligns well with gameplay

Traditional DBs cannot handle:
- Tick-rate updates
- Thousands of fanout events
- Sub-ms synchronization guarantees

---

## 9. Summary

KasagiEngine uses Redis as a **fast, reliable, horizontally scalable coordination layer**.

It enables:
- Multi-instance synchronization  
- Low-latency fanout  
- Fault tolerance  
- Room recovery  
- Optional persistent replay  

Our deployment mode:
- **Redis Sentinel for HA** (primary choice)
- **Redis Cluster for scale-out** (optional advanced mode)


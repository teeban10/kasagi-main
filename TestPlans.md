# KasagiEngine Comprehensive Test Plan
## Functional, Load, Chaos, Metrics & Distributed Testing

This document defines a **complete test strategy** for KasagiEngine, covering:
- Functional correctness
- Multi-client & multi-instance behavior
- High-frequency update handling
- Metrics & observability
- Chaos & failure testing
- Redis Sentinel resilience

This is suitable for **backend challenges, architecture reviews, and production-readiness validation**.

---

## 1. Test Environment

### 1.1 Infrastructure
- Redis Sentinel cluster
  - 1 master
  - 2 replicas
  - 3 sentinels
- Node.js 18+
- Docker + Docker Compose
- Linux / macOS

### 1.2 Environment Variables
```
SENTINEL_1=sentinel1
SENTINEL_2=sentinel2
SENTINEL_3=sentinel3
INSTANCE_ID=A
```

---

## 2. Functional Tests

### 2.1 WebSocket Connectivity
**Goal:** Verify WS server accepts connections.

Steps:
- Connect via `wscat`
- Join a room

Expected:
- Join ACK
- Room created
- No errors

---

### 2.2 Input → Delta → Broadcast
**Goal:** Validate core real-time loop.

Steps:
- Send input message
- Observe delta

Expected:
- Delta generated
- Delta broadcast to all room clients
- Delta published to Redis

---

## 3. Multi-Client Tests

### 3.1 Multiple Clients, Single Room
**Goal:** Validate fan-out.

Steps:
- Spawn 10–50 WS clients
- All join same room
- Send input from one client

Expected:
- All clients receive same delta
- No duplication
- No dropped connections

---

### 3.2 Multiple Rooms
**Goal:** Validate isolation.

Steps:
- Create 5 rooms
- 10 clients per room
- Send input per room

Expected:
- Updates stay within correct room
- No cross-room leakage

---

## 4. Multi-Update & High-Frequency Tests

### 4.1 Rapid Input Flood
**Goal:** Validate batching & tick stability.

Steps:
- One client sends inputs every 10ms
- Tick rate remains fixed (e.g., 20 TPS)

Expected:
- One delta per tick
- No Redis spam
- Stable CPU usage

---

### 4.2 Concurrent Updates
**Goal:** Validate conflict-free updates.

Steps:
- Multiple clients update different entities simultaneously

Expected:
- All entity updates applied
- Deterministic ordering via seq/tick
- No state rollback

---

## 5. Load & Scale Testing (Simulated Clients)

### 5.1 Adjustable Load Test
Run:
```bash
node scripts/ws-load-test.js <N>
```

Test values:
- 10
- 50
- 100
- 500
- 1000

Expected:
- Linear CPU scaling
- Memory stable
- No crashes

---

### 5.2 Multi-Instance Load
Steps:
- Run 2–3 Node instances
- Distribute clients evenly

Expected:
- Redis Pub/Sub distributes deltas
- Cross-instance state consistency

---

## 6. Metrics & Observability Tests

### 6.1 Application Metrics
Monitor:
- CPU usage
- Memory usage
- Event loop delay
- WebSocket connections count
- Messages/sec

Expected:
- Predictable growth
- No exponential spikes

---

### 6.2 Redis Metrics
Check via:
```bash
redis-cli info stats
```

Observe:
- `total_commands_processed`
- `pubsub_channels`
- `connected_clients`

Expected:
- Pub/Sub traffic proportional to rooms
- No unbounded growth

---

## 7. Chaos Testing (Failure Injection)

### 7.1 Redis Master Failure
Steps:
```bash
docker stop redis-master
```

Expected:
- Sentinel promotes replica
- Node reconnects
- Gameplay continues
- Minimal disruption (<2s)

---

### 7.2 Redis Full Outage
Steps:
- Stop all Redis containers

Expected:
- In-memory gameplay continues
- Deltas queued locally
- Snapshots fail gracefully
- Recovery when Redis returns

---

### 7.3 Node Instance Crash
Steps:
- Kill one Node instance under load

Expected:
- Clients reconnect to other instance
- Snapshot restores state
- No data corruption

---

### 7.4 Network Partition (Optional)
Steps:
- Block Redis network temporarily

Expected:
- Local rooms continue
- On reconnect, snapshot heals state

---

## 8. Snapshot & Recovery Tests

### 8.1 Snapshot Creation
**Goal:** Validate persistence.

Steps:
- Let room run > snapshot interval
- Inspect Redis keys

Expected:
```
room:{roomId}:snapshot
```

---

### 8.2 Snapshot Restore
Steps:
- Kill all Node instances
- Restart one instance
- Join room

Expected:
- Snapshot loaded
- State restored correctly

---

## 9. Ordering & Consistency Tests

### 9.1 Sequence Validation
Verify:
- `seq` strictly increasing
- Old deltas ignored
- No duplicate application

---

### 9.2 Tick Validation
Verify:
- Fixed tick rate
- Batching reduces delta count
- Tick independent of input frequency

---

## 10. Success Criteria

KasagiEngine passes if:

✔ Multi-client rooms stay consistent  
✔ Multi-instance sync works  
✔ Redis Sentinel failover succeeds  
✔ High input rates do not flood Redis  
✔ Chaos events do not crash engine  
✔ Snapshots reliably restore state  
✔ Metrics scale linearly  

---

## 11. Notes

- Redis is coordination, not authority
- In-memory state is authoritative
- Batch deltas prevent overload
- Snapshots provide recovery
- Sentinel ensures HA
- Architecture degrades gracefully under failure

---

## End of Document
KasagiEngine – Comprehensive Test Plan

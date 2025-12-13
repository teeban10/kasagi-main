# Redis Sentinel Setup for KasagiEngine

This directory contains a production-ready Redis Sentinel configuration for the KasagiEngine real-time WebSocket synchronization system.

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │         Sentinel Cluster            │
                    │  ┌─────────┐ ┌─────────┐ ┌─────────┐│
                    │  │Sentinel1│ │Sentinel2│ │Sentinel3││
                    │  │ :26379  │ │ :26380  │ │ :26381  ││
                    │  └────┬────┘ └────┬────┘ └────┬────┘│
                    └───────┼───────────┼───────────┼─────┘
                            │           │           │
                    ┌───────▼───────────▼───────────▼─────┐
                    │            Monitors                  │
                    └───────┬───────────┬───────────┬─────┘
                            │           │           │
     ┌──────────────────────▼───────────▼───────────▼─────┐
     │                                                     │
     │  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐│
     │  │Redis Master │──▶│  Replica 1  │──▶│  Replica 2  ││
     │  │   :6379     │   │   :6380     │   │   :6381     ││
     │  └─────────────┘   └─────────────┘   └─────────────┘│
     │                                                     │
     └─────────────────────────────────────────────────────┘
                         kasagi-network
```

## Quick Start

```bash
# Start the cluster
make up

# View status
make status

# Test failover
make failover-test

# Stop everything
make down

# Clean up (including volumes)
make clean
```

## Connecting Your Application

### Using Sentinel Discovery (Recommended)

The proper way to connect to a Sentinel-managed Redis cluster is through **Sentinel discovery**. This ensures your application automatically connects to the current master, even after failover.

#### Node.js with ioredis

```typescript
import Redis from 'ioredis';

// Create a Sentinel-aware Redis client
const redis = new Redis({
  sentinels: [
    { host: 'localhost', port: 26379 },
    { host: 'localhost', port: 26380 },
    { host: 'localhost', port: 26381 },
  ],
  name: 'kasagi-master', // The master name defined in sentinel.conf
  
  // Optional: Connection options
  connectTimeout: 10000,
  maxRetriesPerRequest: 3,
  
  // Optional: Enable read from replicas for better performance
  // role: 'master', // Only connect to master (default)
});

// For Pub/Sub (separate connection recommended)
const redisSub = new Redis({
  sentinels: [
    { host: 'localhost', port: 26379 },
    { host: 'localhost', port: 26380 },
    { host: 'localhost', port: 26381 },
  ],
  name: 'kasagi-master',
});

// Handle connection events
redis.on('connect', () => console.log('Connected to Redis master'));
redis.on('error', (err) => console.error('Redis error:', err));
redis.on('reconnecting', () => console.log('Reconnecting to Redis...'));

// Example: Room state operations
async function saveRoomSnapshot(roomId: string, state: object) {
  await redis.hset(`room:{${roomId}}:snapshot`, {
    data: JSON.stringify(state),
    seq: Date.now(),
    tick: 0,
  });
}

// Example: Pub/Sub for delta broadcasting
redisSub.subscribe(`room:{roomId}:channel`);
redisSub.on('message', (channel, message) => {
  // Handle incoming delta
});
```

#### Production Configuration

```typescript
import Redis from 'ioredis';

const createRedisClient = () => {
  return new Redis({
    sentinels: [
      { host: process.env.SENTINEL_HOST_1 || 'sentinel-1', port: 26379 },
      { host: process.env.SENTINEL_HOST_2 || 'sentinel-2', port: 26379 },
      { host: process.env.SENTINEL_HOST_3 || 'sentinel-3', port: 26379 },
    ],
    name: process.env.REDIS_MASTER_NAME || 'kasagi-master',
    
    // Password if configured
    password: process.env.REDIS_PASSWORD,
    sentinelPassword: process.env.SENTINEL_PASSWORD,
    
    // Connection pool settings
    family: 4, // IPv4
    connectTimeout: 10000,
    commandTimeout: 5000,
    
    // Retry strategy
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    
    // Reconnect on certain errors
    reconnectOnError: (err) => {
      const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNREFUSED'];
      return targetErrors.some(e => err.message.includes(e));
    },
    
    // Enable offline queue (buffer commands when disconnected)
    enableOfflineQueue: true,
    
    // Lazy connect (don't connect until first command)
    lazyConnect: false,
  });
};

// Create separate clients for different use cases
const redisCommands = createRedisClient();  // For commands
const redisSubscriber = createRedisClient(); // For Pub/Sub subscriptions
const redisPublisher = createRedisClient();  // For Pub/Sub publishing
```

### Docker Compose Integration

If your KasagiEngine application runs in Docker, add it to the same network:

```yaml
# In your application's docker-compose.yml
services:
  kasagi-server:
    image: your-kasagi-image
    networks:
      - kasagi-network
    environment:
      - SENTINEL_HOST_1=sentinel-1
      - SENTINEL_HOST_2=sentinel-2
      - SENTINEL_HOST_3=sentinel-3
      - REDIS_MASTER_NAME=kasagi-master

networks:
  kasagi-network:
    external: true
    name: kasagi-network
```

### Direct Connection (Development Only)

For local development, you can connect directly to the master:

```typescript
// NOT recommended for production!
const redis = new Redis({
  host: 'localhost',
  port: 6379,
});
```

## Key Naming Convention

Following the KasagiEngine specification, use hash tags for cluster compatibility:

```
room:{<roomId>}:snapshot   - Room state snapshot (Hash)
room:{<roomId>}:channel    - Pub/Sub channel for deltas
room:{<roomId>}:ops        - Operation log (Stream, optional)
room:{<roomId>}:tick       - Current tick counter
```

The `{...}` ensures all keys for a room land on the same shard in Redis Cluster mode.

## Failover Behavior

### What Happens During Failover

1. **Detection**: Sentinels detect master is unreachable (5 seconds)
2. **Voting**: Sentinels reach quorum (2 out of 3 agree)
3. **Election**: Best replica is selected based on:
   - Replica priority (lower = higher preference)
   - Replication offset (more data = better)
   - Run ID (tie-breaker)
4. **Promotion**: Selected replica becomes new master
5. **Reconfiguration**: Other replicas point to new master
6. **Notification**: Clients are notified via Sentinel

### Application Impact

- **Connection drops**: Brief disconnection (~200ms - 2s)
- **ioredis handles this**: Automatically reconnects to new master
- **Pub/Sub**: Subscriptions need to be re-established
- **In-flight commands**: May fail, implement retry logic

### Best Practices

```typescript
// Handle failover gracefully
redis.on('error', (err) => {
  if (err.message.includes('READONLY')) {
    // Connected to a replica that was just demoted
    // ioredis will automatically reconnect to new master
    console.log('Failover detected, reconnecting...');
  }
});

// Re-subscribe after reconnection
redisSub.on('ready', () => {
  // Re-subscribe to all channels
  activeRooms.forEach(roomId => {
    redisSub.subscribe(`room:{${roomId}}:channel`);
  });
});
```

## Monitoring

### Check Cluster Health

```bash
# View overall status
make status

# Detailed Sentinel info
make sentinel-status

# Connect to Sentinel CLI
make cli-sentinel

# In Sentinel CLI:
SENTINEL master kasagi-master
SENTINEL replicas kasagi-master
SENTINEL sentinels kasagi-master
```

### Key Metrics to Monitor

- `master_link_status` on replicas (should be "up")
- `connected_slaves` on master (should be 2)
- Sentinel `num-slaves` and `num-other-sentinels`
- Replication lag (`master_repl_offset` vs `slave_repl_offset`)

## Troubleshooting

### Sentinel Can't Find Master

```bash
# Check if master is running
docker exec kasagi-redis-master redis-cli PING

# Check Sentinel logs
docker logs kasagi-sentinel-1

# Verify Sentinel config
docker exec kasagi-sentinel-1 cat /usr/local/etc/redis/sentinel.conf
```

### Replicas Not Syncing

```bash
# Check replica status
docker exec kasagi-redis-replica-1 redis-cli INFO replication

# Check if master allows connections
docker exec kasagi-redis-master redis-cli CLIENT LIST
```

### After Failover, Old Master Won't Rejoin

```bash
# The old master might still think it's master
# Force it to become a replica of new master:
docker exec kasagi-redis-master redis-cli REPLICAOF <new-master-ip> 6379
```

## Production Considerations

1. **Memory**: Set appropriate `maxmemory` based on your data size
2. **Persistence**: Both RDB and AOF are enabled for durability
3. **Network**: Use dedicated network with low latency between nodes
4. **Monitoring**: Set up alerts for failover events
5. **Backups**: Regularly backup RDB files from replicas
6. **Security**: Enable authentication in production

## Files

```
redis-sentinel/
├── docker-compose.yml      # Container orchestration
├── Makefile                # Convenience commands
├── README.md               # This file
├── redis/
│   ├── redis-master.conf   # Master configuration
│   └── redis-replica.conf  # Replica configuration
└── sentinel/
    ├── sentinel-1.conf     # Sentinel 1 configuration
    ├── sentinel-2.conf     # Sentinel 2 configuration
    └── sentinel-3.conf     # Sentinel 3 configuration
```


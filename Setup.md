# KasagiEngine Setup Guide

This guide will walk you through setting up and running the KasagiEngine application, starting with Redis and then moving to the engine itself.

## Prerequisites

- **Node.js** >= 18.0.0
- **pnpm** (package manager)
- **Docker** and **Docker Compose** (for Redis setup)
- **Make** (optional, for convenience commands)

## Part 1: Redis Setup

KasagiEngine uses Redis Sentinel for high availability and cross-instance synchronization. The Redis cluster consists of:
- 1 Redis Master
- 2 Redis Replicas
- 3 Sentinel Nodes

### Step 1: Navigate to Redis Directory

```bash
cd redis-sentinel
```

### Step 2: Start Redis Cluster

Using Make (recommended):
```bash
make up
```

Or using Docker Compose directly:
```bash
docker compose up -d
```

This will start:
- Redis Master on port `6380` (mapped from internal 6379)
- Redis Replica 1 on port `6381`
- Redis Replica 2 on port `6382`
- Sentinel 1 on port `26379`
- Sentinel 2 on port `26380`
- Sentinel 3 on port `26381`

### Step 3: Verify Redis Cluster Status

Check that everything is running correctly:

```bash
make status
```

Or manually:
```bash
docker compose ps
```

You should see all 6 containers running (1 master, 2 replicas, 3 sentinels).

### Step 4: Test Redis Connectivity

Test that you can connect to the Redis master:

```bash
make test-connectivity
```

Or manually:
```bash
docker exec kasagi-redis-master redis-cli PING
```

Expected output: `PONG`

### Redis Connection Details

For local development, the application will connect to:
- **Sentinel Hosts**: `localhost:26379`, `localhost:26380`, `localhost:26381`
- **Master Name**: `kasagi-master`
- **Master Port** (direct connection): `localhost:6380`

### Useful Redis Commands

- View logs: `make logs` or `make logs-master`
- Check status: `make status`
- Connect to Redis CLI: `make cli-master`
- Connect to Sentinel CLI: `make cli-sentinel`
- Stop cluster: `make down`
- Clean up (removes volumes): `make clean`

---

## Part 2: Engine Setup

### Step 1: Navigate to Engine Directory

```bash
cd ../kasagi-engine
```

### Step 2: Install Dependencies

Using pnpm (as per project requirements):

```bash
pnpm install
```

### Step 3: Configure Environment Variables

Create a `.env` file in the `kasagi-engine` directory with the following variables:

```env
# Required: Sentinel Configuration
SENTINEL_1=localhost
SENTINEL_1_PORT=26379
SENTINEL_2=localhost
SENTINEL_2_PORT=26380
SENTINEL_3=localhost
SENTINEL_3_PORT=26381

# Optional: Redis Configuration
REDIS_MASTER_NAME=kasagi-master
REDIS_PASSWORD=
SENTINEL_PASSWORD=

# Optional: Application Configuration
NODE_ENV=development
PORT=3000
WS_PORT=8080
INSTANCE_ID=
SNAPSHOT_INTERVAL=100
LOG_LEVEL=info
```

**Note**: The `SENTINEL_1`, `SENTINEL_2`, and `SENTINEL_3` environment variables are **required**. The application will fail to start if they are missing.

### Step 4: Build the Application

Compile TypeScript to JavaScript:

```bash
pnpm run build
```

This will create the `dist/` directory with compiled JavaScript files.

### Step 5: Start the Engine

#### Development Mode (with hot reload):

```bash
pnpm run dev
```

This uses `tsx watch` to automatically recompile and restart on file changes.

#### Production Mode:

```bash
pnpm start
```

This runs the compiled JavaScript from the `dist/` directory.

### Step 6: Verify Engine is Running

The engine should:
1. Connect to Redis via Sentinel
2. Start the WebSocket server on the configured port (default: 8080)
3. Log initialization messages

You should see output like:
```
Starting KasagiEngine...
Redis connections established
WebSocket server started on port 8080
KasagiEngine core modules initialized
```

### WebSocket Server

The WebSocket server will be available at:
- **ws://localhost:8080** (default, configurable via `WS_PORT`)

---

## Running Multiple Instances (Horizontal Scaling)

To test horizontal scaling, you can run multiple instances of the engine:

### Terminal 1:
```bash
cd kasagi-engine
INSTANCE_ID=instance-1 WS_PORT=8080 pnpm run dev
```

### Terminal 2:
```bash
cd kasagi-engine
INSTANCE_ID=instance-2 WS_PORT=8081 pnpm run dev
```

### Terminal 3:
```bash
cd kasagi-engine
INSTANCE_ID=instance-3 WS_PORT=8082 pnpm run dev
```

Each instance will:
- Connect to the same Redis cluster
- Sync state via Redis Pub/Sub
- Handle clients independently
- Share room state across instances

---

## Troubleshooting

### Redis Connection Issues

**Problem**: Engine fails to connect to Redis

**Solutions**:
1. Verify Redis cluster is running: `cd redis-sentinel && make status`
2. Check Sentinel ports are accessible: `telnet localhost 26379`
3. Verify environment variables are set correctly
4. Check Redis logs: `cd redis-sentinel && make logs`

### Port Already in Use

**Problem**: `Error: listen EADDRINUSE: address already in use`

**Solutions**:
1. Change the `WS_PORT` in your `.env` file
2. Or stop the process using the port:
   ```bash
   lsof -ti:8080 | xargs kill -9
   ```

### Missing Environment Variables

**Problem**: `Missing required environment variables: SENTINEL_1, SENTINEL_2, SENTINEL_3`

**Solution**: Ensure your `.env` file exists and contains all required variables (see Step 3 above).

### Redis Sentinel Not Found

**Problem**: Engine can't discover Redis master via Sentinel

**Solutions**:
1. Wait a few seconds after starting Redis cluster (Sentinels need time to discover master)
2. Check Sentinel status: `cd redis-sentinel && make sentinel-status`
3. Verify Sentinel configs: `docker exec kasagi-sentinel-1 cat /usr/local/etc/redis/sentinel.conf`

---

## Quick Start Summary

For a quick start, run these commands in order:

```bash
# 1. Start Redis
cd redis-sentinel
make up

# 2. Wait a few seconds for cluster to initialize
sleep 5

# 3. Verify Redis is running
make status

# 4. Start Engine
cd ../kasagi-engine
pnpm install
pnpm run build

# 5. Create .env file (see Step 3 above)
# ... create .env with required variables ...

# 6. Run engine
pnpm run dev
```

---

## Additional Resources

- **Architecture Documentation**: See `Readme.md` and `KasagiMain.md`
- **Redis Documentation**: See `redis-sentinel/README.md` and `Redis.md`
- **Redis Commands**: See `redis-sentinel/Makefile` for all available commands

---

## Production Considerations

For production deployments:

1. **Security**: Enable Redis password authentication
2. **Monitoring**: Set up monitoring for Redis and application metrics
3. **Persistence**: Ensure Redis persistence (RDB/AOF) is configured
4. **Network**: Use proper network isolation and firewall rules
5. **Load Balancing**: Use a load balancer in front of multiple engine instances
6. **Health Checks**: Implement health check endpoints for the engine
7. **Logging**: Configure proper log aggregation and rotation

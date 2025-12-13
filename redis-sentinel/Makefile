# =============================================================================
# Makefile for KasagiEngine Redis Sentinel Setup
# =============================================================================
# Commands:
#   make up            - Start all Redis and Sentinel containers
#   make down          - Stop and remove all containers
#   make logs          - Tail logs from all containers
#   make failover-test - Simulate master failure and test failover
#   make status        - Show replication and Sentinel status
#   make clean         - Remove containers, volumes, and reset configs
# =============================================================================

.PHONY: up down logs failover-test status clean reset-sentinel-configs help

# Default target
.DEFAULT_GOAL := help

# =============================================================================
# MAIN COMMANDS
# =============================================================================

## Start all Redis and Sentinel containers
up:
	@echo "🚀 Starting KasagiEngine Redis Sentinel cluster..."
	@echo "   - 1 Redis Master"
	@echo "   - 2 Redis Replicas"
	@echo "   - 3 Sentinel Nodes"
	@echo ""
	@# Reset sentinel configs to initial state (they get modified at runtime)
	@$(MAKE) reset-sentinel-configs --no-print-directory
	@docker compose up -d
	@echo ""
	@echo "⏳ Waiting for cluster to initialize..."
	@sleep 5
	@echo ""
	@$(MAKE) status --no-print-directory
	@echo ""
	@echo "✅ Cluster is ready!"
	@echo ""
	@echo "📡 Connection endpoints:"
	@echo "   Master:     localhost:6379"
	@echo "   Replica 1:  localhost:6380"
	@echo "   Replica 2:  localhost:6381"
	@echo "   Sentinel 1: localhost:26379"
	@echo "   Sentinel 2: localhost:26380"
	@echo "   Sentinel 3: localhost:26381"

## Stop and remove all containers
down:
	@echo "🛑 Stopping KasagiEngine Redis Sentinel cluster..."
	@docker compose down
	@echo "✅ Cluster stopped"

## Tail logs from all containers
logs:
	@docker compose logs -f

## Tail logs from master only
logs-master:
	@docker compose logs -f redis-master

## Tail logs from sentinels only
logs-sentinel:
	@docker compose logs -f sentinel-1 sentinel-2 sentinel-3

# =============================================================================
# STATUS AND MONITORING
# =============================================================================

## Show replication and Sentinel status
status:
	@echo "📊 Cluster Status"
	@echo "================="
	@echo ""
	@echo "🔷 Master Replication Info:"
	@docker exec kasagi-redis-master redis-cli INFO replication | grep -E "role|connected_slaves|slave[0-9]" || true
	@echo ""
	@echo "🔷 Sentinel Master Info:"
	@docker exec kasagi-sentinel-1 redis-cli -p 26379 SENTINEL master kasagi-master 2>/dev/null | head -20 || echo "Sentinel not ready yet"
	@echo ""
	@echo "🔷 Sentinel Replicas:"
	@docker exec kasagi-sentinel-1 redis-cli -p 26379 SENTINEL replicas kasagi-master 2>/dev/null | head -30 || echo "Sentinel not ready yet"

## Show detailed Sentinel status
sentinel-status:
	@echo "📊 Detailed Sentinel Status"
	@echo "==========================="
	@echo ""
	@echo "🔷 Sentinel 1 view of master:"
	@docker exec kasagi-sentinel-1 redis-cli -p 26379 SENTINEL master kasagi-master
	@echo ""
	@echo "🔷 Known Sentinels:"
	@docker exec kasagi-sentinel-1 redis-cli -p 26379 SENTINEL sentinels kasagi-master
master:
	@docker exec kasagi-sentinel-1 redis-cli -p 26379 SENTINEL get-master-addr-by-name kasagi-master

# =============================================================================
# FAILOVER TESTING
# =============================================================================

## Simulate master failure and test automatic failover
failover-test:
	@echo "🧪 Starting Failover Test"
	@echo "========================="
	@echo ""
	@echo "📊 Current master info:"
	@docker exec kasagi-sentinel-1 redis-cli -p 26379 SENTINEL get-master-addr-by-name kasagi-master
	@echo ""
	@echo "⚠️  Pausing master container for 10 seconds to simulate failure..."
	@docker pause kasagi-redis-master
	@echo ""
	@echo "⏳ Waiting for Sentinel to detect failure and initiate failover..."
	@echo "   (down-after-milliseconds is set to 5000ms)"
	@sleep 12
	@echo ""
	@echo "📊 New master after failover:"
	@docker exec kasagi-sentinel-1 redis-cli -p 26379 SENTINEL get-master-addr-by-name kasagi-master || echo "Failover in progress..."
	@echo ""
	@echo "🔄 Unpausing old master (will become replica)..."
	@docker unpause kasagi-redis-master
	@sleep 3
	@echo ""
	@echo "📊 Final cluster state:"
	@$(MAKE) status --no-print-directory
	@echo ""
	@echo "✅ Failover test complete!"
	@echo ""
	@echo "Note: The old master (redis-master container) is now a replica."
	@echo "      To restore original topology, run: make restore-master"

## Manually trigger a failover (for testing)
manual-failover:
	@echo "🔄 Triggering manual failover..."
	@docker exec kasagi-sentinel-1 redis-cli -p 26379 SENTINEL failover kasagi-master
	@sleep 5
	@$(MAKE) status --no-print-directory

## Restore original master (after failover test)
restore-master:
	@echo "🔄 Attempting to restore redis-master as the primary..."
	@echo "   This triggers a failover to prefer redis-master"
	@# First, we need to make redis-master have highest priority
	@docker exec kasagi-redis-master redis-cli CONFIG SET replica-priority 1 || true
	@docker exec kasagi-redis-replica-1 redis-cli CONFIG SET replica-priority 100 || true
	@docker exec kasagi-redis-replica-2 redis-cli CONFIG SET replica-priority 100 || true
	@sleep 1
	@docker exec kasagi-sentinel-1 redis-cli -p 26379 SENTINEL failover kasagi-master
	@sleep 5
	@$(MAKE) status --no-print-directory

# =============================================================================
# CLEANUP
# =============================================================================

## Remove containers, volumes, and reset configs
clean:
	@echo "🧹 Cleaning up KasagiEngine Redis cluster..."
	@docker compose down -v
	@$(MAKE) reset-sentinel-configs --no-print-directory
	@echo "✅ Cleanup complete"

## Reset Sentinel configs to initial state
reset-sentinel-configs:
	@echo "📝 Resetting Sentinel configurations..."
	@# Sentinel modifies its config at runtime, so we need to reset it
	@cat sentinel/sentinel-1.conf.template > sentinel/sentinel-1.conf 2>/dev/null || true
	@cat sentinel/sentinel-2.conf.template > sentinel/sentinel-2.conf 2>/dev/null || true
	@cat sentinel/sentinel-3.conf.template > sentinel/sentinel-3.conf 2>/dev/null || true

# =============================================================================
# UTILITY COMMANDS
# =============================================================================

## Connect to master Redis CLI
cli-master:
	@docker exec -it kasagi-redis-master redis-cli

## Connect to Sentinel CLI
cli-sentinel:
	@docker exec -it kasagi-sentinel-1 redis-cli -p 26379

## Test Pub/Sub (open two terminals)
test-pubsub-subscribe:
	@echo "📡 Subscribing to room:test:channel..."
	@docker exec -it kasagi-redis-master redis-cli SUBSCRIBE "room:test:channel"

test-pubsub-publish:
	@echo "📤 Publishing to room:test:channel..."
	@docker exec kasagi-redis-master redis-cli PUBLISH "room:test:channel" "Hello from KasagiEngine!"

## Check connectivity from application perspective
test-connectivity:
	@echo "🔌 Testing connectivity..."
	@echo ""
	@echo "Master PING:"
	@docker exec kasagi-redis-master redis-cli PING
	@echo ""
	@echo "Replica 1 PING:"
	@docker exec kasagi-redis-replica-1 redis-cli PING
	@echo ""
	@echo "Replica 2 PING:"
	@docker exec kasagi-redis-replica-2 redis-cli PING
	@echo ""
	@echo "Sentinel 1 PING:"
	@docker exec kasagi-sentinel-1 redis-cli -p 26379 PING
	@echo ""
	@echo "✅ All nodes responding!"

# =============================================================================
# HELP
# =============================================================================

## Show this help message
help:
	@echo "KasagiEngine Redis Sentinel - Makefile Commands"
	@echo "================================================"
	@echo ""
	@echo "Usage: make [command]"
	@echo ""
	@echo "Main Commands:"
	@echo "  up              Start all Redis and Sentinel containers"
	@echo "  down            Stop and remove all containers"
	@echo "  logs            Tail logs from all containers"
	@echo "  logs-master     Tail logs from master only"
	@echo "  logs-sentinel   Tail logs from sentinels only"
	@echo ""
	@echo "Status:"
	@echo "  status          Show replication and Sentinel status"
	@echo "  sentinel-status Show detailed Sentinel information"
	@echo ""
	@echo "Testing:"
	@echo "  failover-test   Simulate master failure and test failover"
	@echo "  manual-failover Trigger manual failover via Sentinel"
	@echo "  restore-master  Restore redis-master as primary"
	@echo "  test-connectivity Test all node connectivity"
	@echo ""
	@echo "Pub/Sub Testing:"
	@echo "  test-pubsub-subscribe  Subscribe to test channel"
	@echo "  test-pubsub-publish    Publish to test channel"
	@echo ""
	@echo "CLI Access:"
	@echo "  cli-master      Connect to master Redis CLI"
	@echo "  cli-sentinel    Connect to Sentinel CLI"
	@echo ""
	@echo "Cleanup:"
	@echo "  clean           Remove containers, volumes, reset configs"
	@echo ""


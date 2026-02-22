"""
Main storage module for the AI automation storage test platform.
Combines PostgreSQL and Redis for different storage needs.
"""
import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Any, Optional, Union

from .postgres import PostgreSQLStorage
from .redis_client import RedisStorage
from .models import TaskState, FlowState, AgentState, AuditLog
from ..core.types import TaskStatus, FlowStatus
from ..core.exceptions import StorageError


logger = logging.getLogger(__name__)


class CombinedStorage:
    """
    Combined storage implementation that uses PostgreSQL for persistent storage
    and Redis for temporary/cached storage.
    """

    def __init__(self, postgres_storage: Optional[PostgreSQLStorage] = None,
                 redis_storage: Optional[RedisStorage] = None):
        self.postgres = postgres_storage or PostgreSQLStorage()
        self.redis = redis_storage or RedisStorage()
        self._initialized = False

    async def initialize(self):
        """
        Initialize both PostgreSQL and Redis storages.
        """
        if self._initialized:
            return

        await self.postgres.initialize()
        await self.redis.initialize()
        self._initialized = True
        logger.info("Combined storage initialized")

    async def save_task_state(self, task_state: TaskState, use_redis_cache: bool = True) -> bool:
        """
        Save task state to both PostgreSQL (permanent) and Redis (cache).
        """
        # Save to PostgreSQL first
        pg_success = await self.postgres.save_task_state(task_state)

        # Save to Redis cache if requested
        if use_redis_cache:
            redis_success = await self.redis.save_task_state(task_state)
            return pg_success and redis_success

        return pg_success

    async def get_task_state(self, task_id: str) -> Optional[TaskState]:
        """
        Get task state from Redis cache first, fall back to PostgreSQL.
        """
        # Try Redis cache first
        task_state = await self.redis.get_task_state(task_id)
        if task_state:
            return task_state

        # Fall back to PostgreSQL
        task_state = await self.postgres.get_task_state(task_id)

        # If found in PostgreSQL, cache it in Redis
        if task_state:
            await self.redis.save_task_state(task_state)

        return task_state

    async def save_flow_state(self, flow_state: FlowState, use_redis_cache: bool = True) -> bool:
        """
        Save flow state to both PostgreSQL (permanent) and Redis (cache).
        """
        # Save to PostgreSQL first
        pg_success = await self.postgres.save_flow_state(flow_state)

        # Save to Redis cache if requested
        if use_redis_cache:
            redis_success = await self.redis.save_flow_state(flow_state)
            return pg_success and redis_success

        return pg_success

    async def get_flow_state(self, flow_id: str) -> Optional[FlowState]:
        """
        Get flow state from Redis cache first, fall back to PostgreSQL.
        """
        # Try Redis cache first
        flow_state = await self.redis.get_flow_state(flow_id)
        if flow_state:
            return flow_state

        # Fall back to PostgreSQL
        flow_state = await self.postgres.get_flow_state(flow_id)

        # If found in PostgreSQL, cache it in Redis
        if flow_state:
            await self.redis.save_flow_state(flow_state)

        return flow_state

    async def save_agent_state(self, agent_state: AgentState, use_redis_cache: bool = True) -> bool:
        """
        Save agent state to both PostgreSQL (permanent) and Redis (cache).
        """
        # Save to PostgreSQL first
        pg_success = await self.postgres.save_agent_state(agent_state)

        # Save to Redis cache if requested
        if use_redis_cache:
            redis_success = await self.redis.save_agent_state(agent_state)
            return pg_success and redis_success

        return pg_success

    async def get_agent_state(self, agent_id: str) -> Optional[AgentState]:
        """
        Get agent state from Redis cache first, fall back to PostgreSQL.
        """
        # Try Redis cache first
        agent_state = await self.redis.get_agent_state(agent_id)
        if agent_state:
            return agent_state

        # Fall back to PostgreSQL
        agent_state = await self.postgres.get_agent_state(agent_id)

        # If found in PostgreSQL, cache it in Redis
        if agent_state:
            await self.redis.save_agent_state(agent_state)

        return agent_state

    async def save_audit_log(self, audit_log: AuditLog) -> bool:
        """
        Save audit log to both PostgreSQL (permanent) and Redis (temporary stream).
        """
        # Save to PostgreSQL
        pg_success = await self.postgres.save_audit_log(audit_log)

        # Save to Redis as well for quick access
        redis_success = await self.redis.save_audit_log(audit_log)

        return pg_success and redis_success

    async def get_audit_logs(self, limit: int = 100, offset: int = 0) -> List[AuditLog]:
        """
        Get audit logs from PostgreSQL (primary) and Redis (secondary).
        """
        # Get from PostgreSQL (primary source)
        pg_logs = await self.postgres.get_audit_logs(limit, offset)

        # Get recent logs from Redis (for quick access to latest events)
        redis_logs = await self.redis.get_recent_audit_logs(limit)

        # Combine logs, prioritizing PostgreSQL as the primary source
        # but supplementing with Redis for very recent entries
        all_logs = pg_logs + redis_logs

        # Remove duplicates based on ID and sort by timestamp
        seen_ids = set()
        unique_logs = []
        for log in all_logs:
            if log.id not in seen_ids:
                seen_ids.add(log.id)
                unique_logs.append(log)

        # Sort by timestamp, newest first
        unique_logs.sort(key=lambda x: x.timestamp, reverse=True)

        return unique_logs[:limit]

    async def get_task_history(self, task_filter: Optional[Dict[str, Any]] = None) -> List[TaskState]:
        """
        Get task history from PostgreSQL.
        """
        return await self.postgres.get_task_history(task_filter)

    async def refresh_cache_for_task(self, task_id: str) -> bool:
        """
        Refresh the Redis cache for a specific task from PostgreSQL.
        """
        task_state = await self.postgres.get_task_state(task_id)
        if task_state:
            return await self.redis.save_task_state(task_state)
        else:
            # If not in PostgreSQL, clear cache
            await self.redis.clear_cache_for_task(task_id)
            return True

    async def refresh_cache_for_flow(self, flow_id: str) -> bool:
        """
        Refresh the Redis cache for a specific flow from PostgreSQL.
        """
        flow_state = await self.postgres.get_flow_state(flow_id)
        if flow_state:
            return await self.redis.save_flow_state(flow_state)
        else:
            # If not in PostgreSQL, clear cache
            await self.redis.clear_cache_for_flow(flow_id)
            return True

    async def refresh_cache_for_agent(self, agent_id: str) -> bool:
        """
        Refresh the Redis cache for a specific agent from PostgreSQL.
        """
        agent_state = await self.postgres.get_agent_state(agent_id)
        if agent_state:
            return await self.redis.save_agent_state(agent_state)
        else:
            # If not in PostgreSQL, clear cache
            await self.redis.clear_cache_for_agent(agent_id)
            return True

    async def save_transient_data(self, key: str, value: Any, ttl: Optional[int] = None) -> bool:
        """
        Save transient data to Redis only.
        """
        return await self.redis.save_transient_data(key, value, ttl)

    async def get_transient_data(self, key: str) -> Optional[Any]:
        """
        Get transient data from Redis only.
        """
        return await self.redis.get_transient_data(key)

    async def delete_transient_data(self, key: str) -> bool:
        """
        Delete transient data from Redis only.
        """
        return await self.redis.delete_transient_data(key)

    async def cleanup_old_records(self, days_old: int = 30) -> int:
        """
        Clean up old records from PostgreSQL.
        """
        return await self.postgres.cleanup_old_records(days_old)

    async def get_storage_stats(self) -> Dict[str, Any]:
        """
        Get statistics about both PostgreSQL and Redis storage.
        """
        # This would collect stats from both systems in a real implementation
        # For demo purposes:
        return {
            "timestamp": datetime.now().isoformat(),
            "postgres": {
                "connected": True,
                "tables": ["task_states", "flow_states", "agent_states", "audit_logs"],
                "records_count": {
                    "tasks": 100,
                    "flows": 50,
                    "agents": 10,
                    "audit_logs": 1000
                }
            },
            "redis": {
                "connected": True,
                "cached_items": {
                    "tasks": len(await self.redis.get_all_cached_tasks()),
                    "flows": len(await self.redis.get_all_cached_flows()),
                    "agents": len(await self.redis.get_all_cached_agents())
                }
            }
        }

    async def close(self):
        """
        Close both PostgreSQL and Redis connections.
        """
        await self.postgres.close()
        # Redis mock doesn't need closing in this implementation
        logger.info("Combined storage closed")
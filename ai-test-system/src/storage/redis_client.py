"""
Redis storage implementation for the AI automation storage test platform.
Handles temporary storage and caching of task states, flow states, and other runtime data.
"""
import asyncio
import logging
import json
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Union

from .models import TaskState, FlowState, AgentState, AuditLog
from ..core.types import TaskStatus, FlowStatus
from ..core.exceptions import StorageError


logger = logging.getLogger(__name__)


class RedisClient:
    """
    Mock Redis client for demonstration purposes.
    In a real implementation, this would use a library like aioredis.
    """

    def __init__(self):
        self._store = {}
        self._expires = {}  # Track expiration times

    async def set(self, key: str, value: str, ex: Optional[int] = None):
        """
        Set a key-value pair in Redis with optional expiration.
        """
        self._store[key] = value
        if ex:
            self._expires[key] = datetime.now() + timedelta(seconds=ex)
        logger.debug(f"SET {key} = {value[:50]}{'...' if len(value) > 50 else ''}")

    async def get(self, key: str) -> Optional[str]:
        """
        Get a value from Redis.
        """
        # Check expiration
        if key in self._expires:
            if datetime.now() > self._expires[key]:
                del self._store[key]
                del self._expires[key]
                return None

        return self._store.get(key)

    async def delete(self, key: str):
        """
        Delete a key from Redis.
        """
        if key in self._store:
            del self._store[key]
        if key in self._expires:
            del self._expires[key]

    async def exists(self, key: str) -> bool:
        """
        Check if a key exists in Redis.
        """
        # Check expiration first
        if key in self._expires:
            if datetime.now() > self._expires[key]:
                del self._store[key]
                del self._expires[key]
                return False

        return key in self._store

    async def keys(self, pattern: str) -> List[str]:
        """
        Get all keys matching a pattern.
        """
        import fnmatch

        # Filter out expired keys first
        expired_keys = []
        for key, expire_time in self._expires.items():
            if datetime.now() > expire_time:
                expired_keys.append(key)

        for key in expired_keys:
            if key in self._store:
                del self._store[key]
            del self._expires[key]

        # Match keys to pattern
        matched_keys = []
        for key in self._store.keys():
            if fnmatch.fnmatch(key, pattern):
                matched_keys.append(key)

        return matched_keys

    async def hset(self, name: str, key: str, value: str):
        """
        Set a hash field in Redis.
        """
        if name not in self._store:
            self._store[name] = {}

        if isinstance(self._store[name], dict):
            self._store[name][key] = value
        else:
            # Convert to dict if it was stored as string
            self._store[name] = {key: value}

        logger.debug(f"HSET {name}.{key} = {value[:50]}{'...' if len(value) > 50 else ''}")

    async def hget(self, name: str, key: str) -> Optional[str]:
        """
        Get a hash field from Redis.
        """
        if name in self._store and isinstance(self._store[name], dict):
            return self._store[name].get(key)
        return None

    async def hgetall(self, name: str) -> Dict[str, str]:
        """
        Get all fields in a hash from Redis.
        """
        if name in self._store and isinstance(self._store[name], dict):
            # Filter out expired keys
            if name in self._expires:
                if datetime.now() > self._expires[name]:
                    del self._store[name]
                    del self._expires[name]
                    return {}
            return self._store[name]
        return {}

    async def expire(self, key: str, seconds: int):
        """
        Set expiration time for a key.
        """
        self._expires[key] = datetime.now() + timedelta(seconds=seconds)

    async def lpush(self, name: str, *values: str):
        """
        Push values to the beginning of a list.
        """
        if name not in self._store:
            self._store[name] = []

        if not isinstance(self._store[name], list):
            self._store[name] = [self._store[name]]

        for value in reversed(values):
            self._store[name].insert(0, value)

    async def rpop(self, name: str) -> Optional[str]:
        """
        Pop a value from the end of a list.
        """
        if name in self._store and isinstance(self._store[name], list):
            if self._store[name]:
                return self._store[name].pop()
        return None

    async def llen(self, name: str) -> int:
        """
        Get the length of a list.
        """
        if name in self._store and isinstance(self._store[name], list):
            return len(self._store[name])
        return 0


class RedisStorage:
    """
    Redis-based storage implementation for caching and temporary state management.
    """

    def __init__(self, redis_client=None, default_ttl: int = 3600):  # 1 hour default TTL
        self.redis = redis_client or RedisClient()
        self.default_ttl = default_ttl

    async def initialize(self):
        """
        Initialize the Redis storage.
        """
        logger.info("Redis storage initialized")

    async def save_task_state(self, task_state: TaskState, ttl: Optional[int] = None) -> bool:
        """
        Save the state of a task to Redis.
        """
        try:
            key = f"task_state:{task_state.id}"
            value = json.dumps(task_state.to_dict())
            ttl = ttl or self.default_ttl

            await self.redis.set(key, value, ex=ttl)
            logger.info(f"Saved task state {task_state.id} to Redis with TTL {ttl}s")
            return True

        except Exception as e:
            logger.error(f"Failed to save task state {task_state.id} to Redis: {str(e)}")
            raise StorageError(f"Failed to save task state to Redis: {str(e)}")

    async def get_task_state(self, task_id: str) -> Optional[TaskState]:
        """
        Get the state of a task from Redis.
        """
        try:
            key = f"task_state:{task_id}"
            value = await self.redis.get(key)

            if not value:
                return None

            data = json.loads(value)
            return TaskState.from_dict(data)

        except Exception as e:
            logger.error(f"Failed to get task state {task_id} from Redis: {str(e)}")
            raise StorageError(f"Failed to get task state from Redis: {str(e)}")

    async def save_flow_state(self, flow_state: FlowState, ttl: Optional[int] = None) -> bool:
        """
        Save the state of a flow to Redis.
        """
        try:
            key = f"flow_state:{flow_state.id}"
            value = json.dumps(flow_state.to_dict())
            ttl = ttl or self.default_ttl

            await self.redis.set(key, value, ex=ttl)
            logger.info(f"Saved flow state {flow_state.id} to Redis with TTL {ttl}s")
            return True

        except Exception as e:
            logger.error(f"Failed to save flow state {flow_state.id} to Redis: {str(e)}")
            raise StorageError(f"Failed to save flow state to Redis: {str(e)}")

    async def get_flow_state(self, flow_id: str) -> Optional[FlowState]:
        """
        Get the state of a flow from Redis.
        """
        try:
            key = f"flow_state:{flow_id}"
            value = await self.redis.get(key)

            if not value:
                return None

            data = json.loads(value)
            return FlowState.from_dict(data)

        except Exception as e:
            logger.error(f"Failed to get flow state {flow_id} from Redis: {str(e)}")
            raise StorageError(f"Failed to get flow state from Redis: {str(e)}")

    async def save_agent_state(self, agent_state: AgentState, ttl: Optional[int] = None) -> bool:
        """
        Save the state of an agent to Redis.
        """
        try:
            key = f"agent_state:{agent_state.id}"
            value = json.dumps(agent_state.to_dict())
            ttl = ttl or self.default_ttl

            await self.redis.set(key, value, ex=ttl)
            logger.info(f"Saved agent state {agent_state.id} to Redis with TTL {ttl}s")
            return True

        except Exception as e:
            logger.error(f"Failed to save agent state {agent_state.id} to Redis: {str(e)}")
            raise StorageError(f"Failed to save agent state to Redis: {str(e)}")

    async def get_agent_state(self, agent_id: str) -> Optional[AgentState]:
        """
        Get the state of an agent from Redis.
        """
        try:
            key = f"agent_state:{agent_id}"
            value = await self.redis.get(key)

            if not value:
                return None

            data = json.loads(value)
            return AgentState.from_dict(data)

        except Exception as e:
            logger.error(f"Failed to get agent state {agent_id} from Redis: {str(e)}")
            raise StorageError(f"Failed to get agent state from Redis: {str(e)}")

    async def save_audit_log(self, audit_log: AuditLog, ttl: Optional[int] = None) -> bool:
        """
        Save an audit log entry to Redis (typically as part of a list).
        """
        try:
            # Add to audit log stream
            stream_key = "audit_stream"
            log_value = json.dumps(audit_log.to_dict())
            ttl = ttl or self.default_ttl

            # For Redis, we'll use a simple list to simulate a stream
            await self.redis.lpush(stream_key, log_value)

            # Keep only recent logs
            max_logs = 1000
            current_len = await self.redis.llen(stream_key)
            if current_len > max_logs:
                # In a real Redis, we would trim the list, but our mock doesn't support that
                logger.info(f"Audit stream length: {current_len}")

            logger.info(f"Added audit log {audit_log.id} to Redis stream")
            return True

        except Exception as e:
            logger.error(f"Failed to save audit log to Redis: {str(e)}")
            raise StorageError(f"Failed to save audit log to Redis: {str(e)}")

    async def get_recent_audit_logs(self, limit: int = 10) -> List[AuditLog]:
        """
        Get recent audit logs from Redis.
        """
        try:
            stream_key = "audit_stream"
            logs = []

            # Since our mock Redis doesn't have native streaming, we'll simulate
            # by looking for all audit log entries
            keys = await self.redis.keys("audit:*")
            for key in keys:
                value = await self.redis.get(key)
                if value:
                    try:
                        data = json.loads(value)
                        logs.append(AuditLog.from_dict(data))
                    except:
                        continue

            # Also check the audit stream list
            for i in range(min(limit, await self.redis.llen(stream_key))):
                value = await self.redis.get(f"{stream_key}:{i}")  # This is simulated
                if value:
                    try:
                        data = json.loads(value)
                        logs.append(AuditLog.from_dict(data))
                    except:
                        continue

            # Sort by timestamp (most recent first) and limit
            logs.sort(key=lambda x: x.timestamp, reverse=True)
            return logs[:limit]

        except Exception as e:
            logger.error(f"Failed to get audit logs from Redis: {str(e)}")
            raise StorageError(f"Failed to get audit logs from Redis: {str(e)}")

    async def save_transient_data(self, key: str, value: Any, ttl: Optional[int] = None) -> bool:
        """
        Save transient data to Redis with specified TTL.
        """
        try:
            ttl = ttl or self.default_ttl
            str_value = json.dumps(value) if not isinstance(value, str) else value

            await self.redis.set(key, str_value, ex=ttl)
            logger.debug(f"Saved transient data to Redis: {key}")
            return True

        except Exception as e:
            logger.error(f"Failed to save transient data {key} to Redis: {str(e)}")
            raise StorageError(f"Failed to save transient data to Redis: {str(e)}")

    async def get_transient_data(self, key: str) -> Optional[Any]:
        """
        Get transient data from Redis.
        """
        try:
            value = await self.redis.get(key)
            if value:
                # Try to deserialize as JSON, otherwise return as string
                try:
                    return json.loads(value)
                except json.JSONDecodeError:
                    return value
            return None

        except Exception as e:
            logger.error(f"Failed to get transient data {key} from Redis: {str(e)}")
            raise StorageError(f"Failed to get transient data from Redis: {str(e)}")

    async def delete_transient_data(self, key: str) -> bool:
        """
        Delete transient data from Redis.
        """
        try:
            await self.redis.delete(key)
            logger.debug(f"Deleted transient data from Redis: {key}")
            return True

        except Exception as e:
            logger.error(f"Failed to delete transient data {key} from Redis: {str(e)}")
            raise StorageError(f"Failed to delete transient data from Redis: {str(e)}")

    async def clear_cache_for_task(self, task_id: str) -> bool:
        """
        Clear all cached data for a specific task.
        """
        try:
            # Delete task state
            await self.redis.delete(f"task_state:{task_id}")

            # Delete any task-specific cache entries
            task_keys = await self.redis.keys(f"task:{task_id}:*")
            for key in task_keys:
                await self.redis.delete(key)

            logger.info(f"Cleared cache for task {task_id}")
            return True

        except Exception as e:
            logger.error(f"Failed to clear cache for task {task_id}: {str(e)}")
            raise StorageError(f"Failed to clear cache for task: {str(e)}")

    async def clear_cache_for_flow(self, flow_id: str) -> bool:
        """
        Clear all cached data for a specific flow.
        """
        try:
            # Delete flow state
            await self.redis.delete(f"flow_state:{flow_id}")

            # Delete any flow-specific cache entries
            flow_keys = await self.redis.keys(f"flow:{flow_id}:*")
            for key in flow_keys:
                await self.redis.delete(key)

            logger.info(f"Cleared cache for flow {flow_id}")
            return True

        except Exception as e:
            logger.error(f"Failed to clear cache for flow {flow_id}: {str(e)}")
            raise StorageError(f"Failed to clear cache for flow: {str(e)}")

    async def clear_cache_for_agent(self, agent_id: str) -> bool:
        """
        Clear all cached data for a specific agent.
        """
        try:
            # Delete agent state
            await self.redis.delete(f"agent_state:{agent_id}")

            # Delete any agent-specific cache entries
            agent_keys = await self.redis.keys(f"agent:{agent_id}:*")
            for key in agent_keys:
                await self.redis.delete(key)

            logger.info(f"Cleared cache for agent {agent_id}")
            return True

        except Exception as e:
            logger.error(f"Failed to clear cache for agent {agent_id}: {str(e)}")
            raise StorageError(f"Failed to clear cache for agent: {str(e)}")

    async def get_all_cached_tasks(self) -> List[str]:
        """
        Get all cached task IDs.
        """
        try:
            task_keys = await self.redis.keys("task_state:*")
            task_ids = [key.split(":")[1] for key in task_keys]
            return task_ids

        except Exception as e:
            logger.error(f"Failed to get cached tasks: {str(e)}")
            raise StorageError(f"Failed to get cached tasks: {str(e)}")

    async def get_all_cached_flows(self) -> List[str]:
        """
        Get all cached flow IDs.
        """
        try:
            flow_keys = await self.redis.keys("flow_state:*")
            flow_ids = [key.split(":")[1] for key in flow_keys]
            return flow_ids

        except Exception as e:
            logger.error(f"Failed to get cached flows: {str(e)}")
            raise StorageError(f"Failed to get cached flows: {str(e)}")

    async def get_all_cached_agents(self) -> List[str]:
        """
        Get all cached agent IDs.
        """
        try:
            agent_keys = await self.redis.keys("agent_state:*")
            agent_ids = [key.split(":")[1] for key in agent_keys]
            return agent_ids

        except Exception as e:
            logger.error(f"Failed to get cached agents: {str(e)}")
            raise StorageError(f"Failed to get cached agents: {str(e)}")
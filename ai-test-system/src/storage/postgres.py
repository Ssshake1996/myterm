"""
PostgreSQL storage implementation for the AI automation storage test platform.
Handles persistent storage of task states, flow states, agent states, and audit logs.
"""
import asyncio
import logging
import json
from datetime import datetime
from typing import Dict, List, Any, Optional, Union
from contextlib import asynccontextmanager

from .models import TaskState, FlowState, AgentState, AuditLog
from ..core.types import TaskStatus, FlowStatus
from ..core.exceptions import StorageError


logger = logging.getLogger(__name__)


class PostgreSQLStorage:
    """
    PostgreSQL-based storage implementation for persistent state management.
    """

    def __init__(self, connection_pool=None, connection_string: Optional[str] = None):
        self.connection_pool = connection_pool
        self.connection_string = connection_string
        self._initialized = False

    async def initialize(self):
        """
        Initialize the PostgreSQL storage by creating required tables.
        """
        if self._initialized:
            return

        # For demo purposes, we'll simulate the table creation
        # In a real implementation, this would create actual PostgreSQL tables
        logger.info("Initializing PostgreSQL storage (simulated)")

        # Create tables schema (in real implementation)
        # await self._create_tables()

        self._initialized = True
        logger.info("PostgreSQL storage initialized")

    async def _get_connection(self):
        """
        Get a database connection from the pool.
        For demo purposes, this returns a mock connection.
        """
        # In a real implementation, this would get an actual PostgreSQL connection
        # from the connection pool

        # For simulation, we'll just return a mock object
        class MockConnection:
            async def execute(self, query, *args):
                logger.debug(f"SQL EXECUTE: {query} with args {args}")
                # Simulate database operation
                await asyncio.sleep(0.01)  # Simulate I/O delay
                return type('MockResult', (), {'rowcount': 1})()

            async def fetchall(self, query, *args):
                logger.debug(f"SQL FETCHALL: {query} with args {args}")
                # Simulate empty result
                await asyncio.sleep(0.01)  # Simulate I/O delay
                return []

            async def fetchone(self, query, *args):
                logger.debug(f"SQL FETCHONE: {query} with args {args}")
                # Simulate no result
                await asyncio.sleep(0.01)  # Simulate I/O delay
                return None

        return MockConnection()

    async def save_task_state(self, task_state: TaskState) -> bool:
        """
        Save the state of a task to the database.
        """
        try:
            conn = await self._get_connection()

            # Convert task state to dict and handle special fields
            task_dict = task_state.to_dict()

            # In a real implementation, this would be an INSERT/UPDATE query
            query = """
                INSERT INTO task_states (
                    id, name, description, status, priority, dependencies,
                    assigned_node, created_at, started_at, completed_at,
                    error_message, metadata, result
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    status = EXCLUDED.status,
                    priority = EXCLUDED.priority,
                    dependencies = EXCLUDED.dependencies,
                    assigned_node = EXCLUDED.assigned_node,
                    started_at = EXCLUDED.started_at,
                    completed_at = EXCLUDED.completed_at,
                    error_message = EXCLUDED.error_message,
                    metadata = EXCLUDED.metadata,
                    result = EXCLUDED.result
            """

            # Execute the query
            await conn.execute(
                query,
                task_dict['id'],
                task_dict['name'],
                task_dict['description'],
                task_dict['status'],
                task_dict['priority'],
                json.dumps(task_dict['dependencies']),
                task_dict['assigned_node'],
                task_dict['created_at'],
                task_dict.get('started_at'),
                task_dict.get('completed_at'),
                task_dict.get('error_message'),
                json.dumps(task_dict['metadata']),
                json.dumps(task_dict['result']) if task_dict['result'] else None
            )

            logger.info(f"Saved task state for {task_state.id}")
            return True

        except Exception as e:
            logger.error(f"Failed to save task state {task_state.id}: {str(e)}")
            raise StorageError(f"Failed to save task state: {str(e)}")

    async def get_task_state(self, task_id: str) -> Optional[TaskState]:
        """
        Get the state of a task from the database.
        """
        try:
            conn = await self._get_connection()

            # In a real implementation, this would be a SELECT query
            query = "SELECT * FROM task_states WHERE id = $1 LIMIT 1"
            row = await conn.fetchone(query, task_id)

            if not row:
                return None

            # In a real implementation, we would construct the TaskState from the row
            # For demo, return a mock TaskState
            return TaskState(
                id=task_id,
                name=f"Task {task_id}",
                description="Mock task for demo",
                status=TaskStatus.PENDING,
                priority=1,
                dependencies=[],
                assigned_node="mock-node",
                created_at=datetime.now(),
                started_at=None,
                completed_at=None,
                error_message=None,
                metadata={"mock": True}
            )

        except Exception as e:
            logger.error(f"Failed to get task state {task_id}: {str(e)}")
            raise StorageError(f"Failed to get task state: {str(e)}")

    async def save_flow_state(self, flow_state: FlowState) -> bool:
        """
        Save the state of a flow to the database.
        """
        try:
            conn = await self._get_connection()

            # Convert flow state to dict
            flow_dict = flow_state.to_dict()

            # In a real implementation, this would be an INSERT/UPDATE query
            query = """
                INSERT INTO flow_states (
                    id, flow_definition_id, status, started_at, completed_at,
                    node_executions, variables, metadata
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (id) DO UPDATE SET
                    flow_definition_id = EXCLUDED.flow_definition_id,
                    status = EXCLUDED.status,
                    started_at = EXCLUDED.started_at,
                    completed_at = EXCLUDED.completed_at,
                    node_executions = EXCLUDED.node_executions,
                    variables = EXCLUDED.variables,
                    metadata = EXCLUDED.metadata
            """

            await conn.execute(
                query,
                flow_dict['id'],
                flow_dict['flow_definition_id'],
                flow_dict['status'],
                flow_dict['started_at'],
                flow_dict.get('completed_at'),
                json.dumps(flow_dict['node_executions']),
                json.dumps(flow_dict['variables']),
                json.dumps(flow_dict['metadata'])
            )

            logger.info(f"Saved flow state for {flow_state.id}")
            return True

        except Exception as e:
            logger.error(f"Failed to save flow state {flow_state.id}: {str(e)}")
            raise StorageError(f"Failed to save flow state: {str(e)}")

    async def get_flow_state(self, flow_id: str) -> Optional[FlowState]:
        """
        Get the state of a flow from the database.
        """
        try:
            conn = await self._get_connection()

            query = "SELECT * FROM flow_states WHERE id = $1 LIMIT 1"
            row = await conn.fetchone(query, flow_id)

            if not row:
                return None

            # For demo, return a mock FlowState
            return FlowState(
                id=flow_id,
                flow_definition_id="mock-definition",
                status=FlowStatus.RUNNING,
                started_at=datetime.now(),
                completed_at=None,
                node_executions={},
                variables={},
                metadata={"mock": True}
            )

        except Exception as e:
            logger.error(f"Failed to get flow state {flow_id}: {str(e)}")
            raise StorageError(f"Failed to get flow state: {str(e)}")

    async def save_agent_state(self, agent_state: AgentState) -> bool:
        """
        Save the state of an agent to the database.
        """
        try:
            conn = await self._get_connection()

            # Convert agent state to dict
            agent_dict = agent_state.to_dict()

            # In a real implementation, this would be an INSERT/UPDATE query
            query = """
                INSERT INTO agent_states (
                    id, name, role, description, status, goals, tools,
                    created_at, last_activity, metadata, current_task
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    role = EXCLUDED.role,
                    description = EXCLUDED.description,
                    status = EXCLUDED.status,
                    goals = EXCLUDED.goals,
                    tools = EXCLUDED.tools,
                    last_activity = EXCLUDED.last_activity,
                    metadata = EXCLUDED.metadata,
                    current_task = EXCLUDED.current_task
            """

            await conn.execute(
                query,
                agent_dict['id'],
                agent_dict['name'],
                agent_dict['role'],
                agent_dict['description'],
                agent_dict['status'],
                json.dumps(agent_dict['goals']),
                json.dumps(agent_dict['tools']),
                agent_dict['created_at'],
                agent_dict['last_activity'],
                json.dumps(agent_dict['metadata']),
                agent_dict['current_task']
            )

            logger.info(f"Saved agent state for {agent_state.id}")
            return True

        except Exception as e:
            logger.error(f"Failed to save agent state {agent_state.id}: {str(e)}")
            raise StorageError(f"Failed to save agent state: {str(e)}")

    async def get_agent_state(self, agent_id: str) -> Optional[AgentState]:
        """
        Get the state of an agent from the database.
        """
        try:
            conn = await self._get_connection()

            query = "SELECT * FROM agent_states WHERE id = $1 LIMIT 1"
            row = await conn.fetchone(query, agent_id)

            if not row:
                return None

            # For demo, return a mock AgentState
            return AgentState(
                id=agent_id,
                name=f"Agent {agent_id}",
                role="test",
                description="Mock agent for demo",
                status="active",
                goals=[],
                tools=[],
                created_at=datetime.now(),
                last_activity=datetime.now(),
                metadata={"mock": True}
            )

        except Exception as e:
            logger.error(f"Failed to get agent state {agent_id}: {str(e)}")
            raise StorageError(f"Failed to get agent state: {str(e)}")

    async def save_audit_log(self, audit_log: AuditLog) -> bool:
        """
        Save an audit log entry to the database.
        """
        try:
            conn = await self._get_connection()

            # Convert audit log to dict
            log_dict = audit_log.to_dict()

            # In a real implementation, this would be an INSERT query
            query = """
                INSERT INTO audit_logs (
                    id, timestamp, event_type, actor, action, resource_type,
                    resource_id, details, metadata
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """

            await conn.execute(
                query,
                log_dict['id'],
                log_dict['timestamp'],
                log_dict['event_type'],
                log_dict['actor'],
                log_dict['action'],
                log_dict['resource_type'],
                log_dict['resource_id'],
                json.dumps(log_dict['details']),
                json.dumps(log_dict['metadata'])
            )

            logger.info(f"Saved audit log for {audit_log.event_type}")
            return True

        except Exception as e:
            logger.error(f"Failed to save audit log: {str(e)}")
            raise StorageError(f"Failed to save audit log: {str(e)}")

    async def get_audit_logs(self, limit: int = 100, offset: int = 0) -> List[AuditLog]:
        """
        Get audit logs from the database.
        """
        try:
            conn = await self._get_connection()

            query = """
                SELECT * FROM audit_logs
                ORDER BY timestamp DESC
                LIMIT $1 OFFSET $2
            """
            rows = await conn.fetchall(query, limit, offset)

            # For demo, return empty list
            return []

        except Exception as e:
            logger.error(f"Failed to get audit logs: {str(e)}")
            raise StorageError(f"Failed to get audit logs: {str(e)}")

    async def get_task_history(self, task_filter: Optional[Dict[str, Any]] = None) -> List[TaskState]:
        """
        Get task history with optional filtering.
        """
        try:
            conn = await self._get_connection()

            # Build query based on filters
            base_query = "SELECT * FROM task_states WHERE 1=1"
            params = []
            param_index = 1

            if task_filter:
                if 'status' in task_filter:
                    base_query += f" AND status = ${param_index}"
                    params.append(task_filter['status'])
                    param_index += 1

                if 'assigned_node' in task_filter:
                    base_query += f" AND assigned_node = ${param_index}"
                    params.append(task_filter['assigned_node'])
                    param_index += 1

            base_query += " ORDER BY created_at DESC LIMIT 100"

            rows = await conn.fetchall(base_query, *params)

            # For demo, return empty list
            return []

        except Exception as e:
            logger.error(f"Failed to get task history: {str(e)}")
            raise StorageError(f"Failed to get task history: {str(e)}")

    async def cleanup_old_records(self, days_old: int = 30) -> int:
        """
        Clean up old records from the database.
        """
        try:
            conn = await self._get_connection()

            # In a real implementation, this would delete old records
            # For demo, return mock number of cleaned records
            logger.info(f"Cleaned up records older than {days_old} days (simulated)")
            return 0

        except Exception as e:
            logger.error(f"Failed to cleanup old records: {str(e)}")
            raise StorageError(f"Failed to cleanup old records: {str(e)}")

    async def close(self):
        """
        Close the database connections.
        """
        if self.connection_pool:
            # In a real implementation, this would close the connection pool
            pass
        logger.info("PostgreSQL storage closed")
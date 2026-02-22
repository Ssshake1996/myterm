"""
Execution Nodes module for the AI automation storage test platform.
Handles distributed execution environments, node registration, and task execution.
"""
import asyncio
import logging
import uuid
from datetime import datetime
from typing import Dict, List, Any, Optional, Callable
from dataclasses import dataclass

from ..core.types import NodeInfo
from ..core.exceptions import NodeRegistrationError, NodeHeartbeatError


logger = logging.getLogger(__name__)


@dataclass
class TaskAssignment:
    """
    Represents a task assigned to a node.
    """
    task_id: str
    node_id: str
    assigned_at: datetime
    status: str  # 'assigned', 'running', 'completed', 'failed', 'cancelled'
    result: Optional[Any] = None
    error: Optional[str] = None


class NodeManager:
    """
    Manages execution nodes including registration, heartbeat monitoring, and task assignment.
    """

    def __init__(self):
        self.nodes: Dict[str, NodeInfo] = {}
        self.task_assignments: Dict[str, TaskAssignment] = {}  # task_id -> assignment
        self.node_tasks: Dict[str, List[str]] = {}  # node_id -> [task_ids]
        self.heartbeat_interval = 30  # seconds
        self.heartbeat_timeout = 60  # seconds
        self._running = False
        self._monitor_task: Optional[asyncio.Task] = None

    async def register_node(self, node_info: NodeInfo) -> bool:
        """
        Register a new execution node.
        """
        try:
            # Validate node info
            if not node_info.id or not node_info.address:
                raise NodeRegistrationError("Node ID and address are required")

            # Check if node already exists
            if node_info.id in self.nodes:
                logger.warning(f"Node {node_info.id} already registered, updating info")

            # Add or update node
            self.nodes[node_info.id] = node_info
            self.node_tasks[node_info.id] = []

            logger.info(f"Node {node_info.id} registered successfully at {node_info.address}:{node_info.port}")
            return True

        except Exception as e:
            logger.error(f"Failed to register node {node_info.id}: {str(e)}")
            raise NodeRegistrationError(f"Node registration failed: {str(e)}")

    async def unregister_node(self, node_id: str) -> bool:
        """
        Unregister an execution node.
        """
        if node_id not in self.nodes:
            return False

        # Cancel any assigned tasks for this node
        node_tasks = self.node_tasks.get(node_id, [])
        for task_id in node_tasks:
            if task_id in self.task_assignments:
                assignment = self.task_assignments[task_id]
                assignment.status = 'failed'
                assignment.error = f"Node {node_id} unregistered during execution"

        # Remove node and its tasks
        del self.nodes[node_id]
        if node_id in self.node_tasks:
            del self.node_tasks[node_id]

        logger.info(f"Node {node_id} unregistered successfully")
        return True

    async def heartbeat(self, node_id: str) -> bool:
        """
        Handle node heartbeat to confirm it's still alive.
        """
        if node_id not in self.nodes:
            logger.warning(f"Heartbeat from unregistered node {node_id}")
            return False

        # Update heartbeat timestamp
        self.nodes[node_id].last_heartbeat = datetime.now()
        logger.debug(f"Heartbeat received from node {node_id}")

        return True

    async def get_node_status(self, node_id: str) -> Optional[Dict[str, Any]]:
        """
        Get the status of a specific node.
        """
        if node_id not in self.nodes:
            return None

        node = self.nodes[node_id]
        current_time = datetime.now()
        time_since_heartbeat = (current_time - node.last_heartbeat).total_seconds()

        status = {
            "id": node.id,
            "name": node.name,
            "address": node.address,
            "port": node.port,
            "status": "active" if time_since_heartbeat < self.heartbeat_timeout else "inactive",
            "last_heartbeat": node.last_heartbeat.isoformat(),
            "time_since_heartbeat": time_since_heartbeat,
            "capacity": node.capacity,
            "load": node.load,
            "assigned_tasks": len(self.node_tasks.get(node_id, [])),
            "metadata": node.metadata
        }

        return status

    async def get_all_nodes_status(self) -> List[Dict[str, Any]]:
        """
        Get the status of all registered nodes.
        """
        statuses = []
        for node_id in self.nodes:
            status = await self.get_node_status(node_id)
            if status:
                statuses.append(status)
        return statuses

    async def assign_task(self, task_id: str, node_id: str) -> bool:
        """
        Assign a task to a specific node.
        """
        if node_id not in self.nodes:
            logger.error(f"Cannot assign task {task_id} to unregistered node {node_id}")
            return False

        if task_id in self.task_assignments:
            logger.warning(f"Task {task_id} already assigned, reassigning")
            # Cancel previous assignment
            old_assignment = self.task_assignments[task_id]
            if old_assignment.node_id in self.node_tasks:
                if task_id in self.node_tasks[old_assignment.node_id]:
                    self.node_tasks[old_assignment.node_id].remove(task_id)

        # Create new assignment
        assignment = TaskAssignment(
            task_id=task_id,
            node_id=node_id,
            assigned_at=datetime.now(),
            status="assigned"
        )
        self.task_assignments[task_id] = assignment

        # Add to node's task list
        if node_id not in self.node_tasks:
            self.node_tasks[node_id] = []
        self.node_tasks[node_id].append(task_id)

        # Update node load
        self.nodes[node_id].load += 1

        logger.info(f"Task {task_id} assigned to node {node_id}")
        return True

    async def update_task_status(self, task_id: str, status: str, result: Optional[Any] = None, error: Optional[str] = None) -> bool:
        """
        Update the status of an assigned task.
        """
        if task_id not in self.task_assignments:
            logger.error(f"Task {task_id} is not assigned to any node")
            return False

        assignment = self.task_assignments[task_id]
        assignment.status = status
        assignment.result = result
        assignment.error = error

        # If completed, update node load
        if status in ['completed', 'failed', 'cancelled']:
            node_id = assignment.node_id
            if node_id in self.nodes:
                self.nodes[node_id].load = max(0, self.nodes[node_id].load - 1)

            # Remove from node's task list
            if node_id in self.node_tasks and task_id in self.node_tasks[node_id]:
                self.node_tasks[node_id].remove(task_id)

        logger.debug(f"Task {task_id} status updated to {status}")
        return True

    async def get_assigned_tasks(self, node_id: str) -> List[TaskAssignment]:
        """
        Get all tasks assigned to a specific node.
        """
        if node_id not in self.node_tasks:
            return []

        assignments = []
        for task_id in self.node_tasks[node_id]:
            if task_id in self.task_assignments:
                assignments.append(self.task_assignments[task_id])

        return assignments

    async def get_task_assignment(self, task_id: str) -> Optional[TaskAssignment]:
        """
        Get the assignment for a specific task.
        """
        return self.task_assignments.get(task_id)

    async def start_monitoring(self):
        """
        Start the heartbeat monitoring task.
        """
        if self._running:
            return

        self._running = True
        self._monitor_task = asyncio.create_task(self._monitor_heartbeats())
        logger.info("Node heartbeat monitoring started")

    async def stop_monitoring(self):
        """
        Stop the heartbeat monitoring task.
        """
        self._running = False
        if self._monitor_task:
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass
        logger.info("Node heartbeat monitoring stopped")

    async def _monitor_heartbeats(self):
        """
        Internal task to monitor node heartbeats and mark inactive nodes.
        """
        while self._running:
            try:
                current_time = datetime.now()

                for node_id, node in list(self.nodes.items()):
                    time_since_heartbeat = (current_time - node.last_heartbeat).total_seconds()

                    if time_since_heartbeat > self.heartbeat_timeout:
                        logger.warning(f"Node {node_id} is inactive (last heartbeat {time_since_heartbeat}s ago)")

                        # Mark node as inactive and reassign tasks if needed
                        # In a real implementation, you'd reassign tasks to other nodes

                # Sleep before next check
                await asyncio.sleep(self.heartbeat_interval)
            except asyncio.CancelledError:
                logger.info("Heartbeat monitor cancelled")
                break
            except Exception as e:
                logger.error(f"Error in heartbeat monitoring: {str(e)}")
                await asyncio.sleep(self.heartbeat_interval)

    async def cleanup_inactive_nodes(self) -> int:
        """
        Remove inactive nodes and reassign their tasks.
        Returns the number of nodes removed.
        """
        current_time = datetime.now()
        nodes_to_remove = []

        for node_id, node in self.nodes.items():
            time_since_heartbeat = (current_time - node.last_heartbeat).total_seconds()

            if time_since_heartbeat > self.heartbeat_timeout * 2:  # Double timeout for removal
                nodes_to_remove.append(node_id)

        removed_count = 0
        for node_id in nodes_to_remove:
            logger.info(f"Removing inactive node {node_id}")
            await self.unregister_node(node_id)
            removed_count += 1

        return removed_count

    async def get_available_nodes(self) -> List[NodeInfo]:
        """
        Get list of currently available (active) nodes.
        """
        available_nodes = []
        current_time = datetime.now()

        for node in self.nodes.values():
            time_since_heartbeat = (current_time - node.last_heartbeat).total_seconds()
            if time_since_heartbeat < self.heartbeat_timeout:
                available_nodes.append(node)

        return available_nodes

    async def get_load_distribution(self) -> Dict[str, int]:
        """
        Get the current load distribution across nodes.
        """
        load_dist = {}
        for node_id, node in self.nodes.items():
            time_since_heartbeat = (datetime.now() - node.last_heartbeat).total_seconds()
            if time_since_heartbeat < self.heartbeat_timeout:  # Only active nodes
                load_dist[node_id] = node.load
            else:
                load_dist[node_id] = -1  # Inactive node

        return load_dist
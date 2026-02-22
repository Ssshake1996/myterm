"""
Task dispatcher for assigning tasks to execution nodes.
"""
import asyncio
import random
from datetime import datetime
from typing import Dict, List, Optional
from ..core.types import Task, NodeInfo
from ..core.exceptions import TaskSchedulingError


class TaskDispatcher:
    """
    Responsible for assigning tasks to available execution nodes.
    """

    def __init__(self):
        self.nodes: Dict[str, NodeInfo] = {}
        self.task_assignments: Dict[str, str] = {}  # task_id -> node_id

    def register_node(self, node_info: NodeInfo) -> None:
        """
        Register an execution node with the dispatcher.
        """
        self.nodes[node_info.id] = node_info

    def unregister_node(self, node_id: str) -> None:
        """
        Unregister an execution node.
        """
        if node_id in self.nodes:
            del self.nodes[node_id]
            # Remove any assignments to this node
            tasks_to_remove = [tid for tid, nid in self.task_assignments.items() if nid == node_id]
            for task_id in tasks_to_remove:
                del self.task_assignments[task_id]

    async def assign_task(self, task: Task) -> Optional[str]:
        """
        Assign a task to an available execution node.
        Returns the node ID if successful, None if no nodes available.
        """
        available_nodes = self._get_available_nodes()

        if not available_nodes:
            return None

        # Select a node using load balancing algorithm
        # For now, we use a simple least-loaded algorithm
        selected_node = self._select_least_loaded_node(available_nodes)

        if selected_node:
            self.task_assignments[task.id] = selected_node.id
            # Update node load info (this would normally be done by the node itself)
            selected_node.load += 1
            selected_node.last_heartbeat = datetime.now()
            return selected_node.id

        return None

    def _get_available_nodes(self) -> List[NodeInfo]:
        """
        Get list of available (active) execution nodes.
        """
        available = []
        current_time = datetime.now()

        for node in self.nodes.values():
            # Consider node available if it has sent heartbeat in last 60 seconds
            if (current_time - node.last_heartbeat).seconds < 60:
                available.append(node)

        return available

    def _select_least_loaded_node(self, nodes: List[NodeInfo]) -> Optional[NodeInfo]:
        """
        Select the node with the lowest current load.
        """
        if not nodes:
            return None

        # Filter out nodes that are at capacity
        available_nodes = [node for node in nodes if node.load < node.capacity]

        if not available_nodes:
            return None

        # Return the node with the minimum load
        return min(available_nodes, key=lambda n: n.load)

    def release_assignment(self, task_id: str) -> None:
        """
        Release a task assignment when the task is completed or failed.
        """
        if task_id in self.task_assignments:
            node_id = self.task_assignments[task_id]
            # Reduce load on the node
            if node_id in self.nodes:
                self.nodes[node_id].load = max(0, self.nodes[node_id].load - 1)

            del self.task_assignments[task_id]

    def get_node_load(self, node_id: str) -> Optional[int]:
        """
        Get the current load of a specific node.
        """
        if node_id in self.nodes:
            return self.nodes[node_id].load
        return None

    def get_all_loads(self) -> Dict[str, int]:
        """
        Get the loads of all registered nodes.
        """
        return {nid: node.load for nid, node in self.nodes.items()}
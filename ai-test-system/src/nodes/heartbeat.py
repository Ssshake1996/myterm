"""
Heartbeat module for the AI automation storage test platform.
Handles node heartbeat monitoring and status checking.
"""
import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Any, Optional

from .manager import NodeManager
from ..core.types import NodeInfo


logger = logging.getLogger(__name__)


class HeartbeatMonitor:
    """
    Monitors heartbeats from execution nodes and handles node status updates.
    """

    def __init__(self, node_manager: NodeManager, heartbeat_interval: int = 30, timeout: int = 60):
        self.node_manager = node_manager
        self.heartbeat_interval = heartbeat_interval
        self.timeout = timeout
        self._running = False
        self._monitor_task: Optional[asyncio.Task] = None

    async def start_monitoring(self):
        """
        Start the heartbeat monitoring loop.
        """
        if self._running:
            return

        self._running = True
        self._monitor_task = asyncio.create_task(self._monitor_loop())
        logger.info(f"Heartbeat monitoring started (interval: {self.heartbeat_interval}s, timeout: {self.timeout}s)")

    async def stop_monitoring(self):
        """
        Stop the heartbeat monitoring loop.
        """
        self._running = False
        if self._monitor_task:
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass
        logger.info("Heartbeat monitoring stopped")

    async def _monitor_loop(self):
        """
        Main monitoring loop that periodically checks node heartbeats.
        """
        while self._running:
            try:
                await self._check_heartbeats()
                await asyncio.sleep(self.heartbeat_interval)
            except asyncio.CancelledError:
                logger.info("Heartbeat monitor loop cancelled")
                break
            except Exception as e:
                logger.error(f"Error in heartbeat monitor loop: {str(e)}")
                await asyncio.sleep(self.heartbeat_interval)

    async def _check_heartbeats(self):
        """
        Check heartbeats for all registered nodes and update their status.
        """
        current_time = datetime.now()

        for node_id, node in self.node_manager.nodes.items():
            time_since_heartbeat = (current_time - node.last_heartbeat).total_seconds()

            if time_since_heartbeat > self.timeout:
                # Node is inactive
                logger.warning(f"Node {node_id} is inactive (last heartbeat {time_since_heartbeat}s ago)")

                # In a real implementation, you might want to:
                # - Mark tasks as failed
                # - Reassign tasks to other nodes
                # - Send alerts
                # - Trigger recovery procedures

                # Update node status in metadata
                node.metadata["status"] = "inactive"
                node.metadata["last_seen"] = node.last_heartbeat.isoformat()
            else:
                # Node is active
                node.metadata["status"] = "active"
                node.metadata["last_seen"] = current_time.isoformat()

    async def get_heartbeat_status(self) -> Dict[str, Any]:
        """
        Get the current heartbeat status of all nodes.
        """
        current_time = datetime.now()
        status = {
            "timestamp": current_time.isoformat(),
            "total_nodes": len(self.node_manager.nodes),
            "active_nodes": 0,
            "inactive_nodes": 0,
            "node_details": []
        }

        for node_id, node in self.node_manager.nodes.items():
            time_since_heartbeat = (current_time - node.last_heartbeat).total_seconds()
            is_active = time_since_heartbeat <= self.timeout

            if is_active:
                status["active_nodes"] += 1
            else:
                status["inactive_nodes"] += 1

            node_detail = {
                "node_id": node_id,
                "name": node.name,
                "address": node.address,
                "port": node.port,
                "active": is_active,
                "time_since_heartbeat": time_since_heartbeat,
                "capacity": node.capacity,
                "load": node.load,
                "metadata": node.metadata
            }

            status["node_details"].append(node_detail)

        return status

    async def register_node(self, node_info: NodeInfo) -> bool:
        """
        Register a node and initialize its heartbeat tracking.
        """
        node_info.last_heartbeat = datetime.now()
        return await self.node_manager.register_node(node_info)

    async def handle_heartbeat(self, node_id: str) -> bool:
        """
        Handle a heartbeat received from a node.
        """
        return await self.node_manager.heartbeat(node_id)


class NodeHealthChecker:
    """
    Performs deeper health checks on nodes beyond basic heartbeat.
    """

    def __init__(self, node_manager: NodeManager):
        self.node_manager = node_manager

    async def check_node_health(self, node_id: str) -> Dict[str, Any]:
        """
        Perform a comprehensive health check on a node.
        This would typically involve calling the node directly in a real implementation.
        """
        node_status = await self.node_manager.get_node_status(node_id)

        if not node_status:
            return {
                "node_id": node_id,
                "status": "not_found",
                "timestamp": datetime.now().isoformat()
            }

        # Simulate detailed health check
        # In a real implementation, this would make API calls to the actual node

        health_checks = {
            "connectivity": await self._check_connectivity(node_id),
            "resources": await self._check_resources(node_id),
            "tasks": await self._check_tasks(node_id),
            "storage": await self._check_storage_health(node_id)
        }

        # Overall health assessment
        overall_health = "healthy"
        if not health_checks["connectivity"]["ok"]:
            overall_health = "critical"
        elif not health_checks["resources"]["ok"] or not health_checks["storage"]["ok"]:
            overall_health = "warning"

        return {
            "node_id": node_id,
            "overall_health": overall_health,
            "timestamp": datetime.now().isoformat(),
            "checks": health_checks
        }

    async def _check_connectivity(self, node_id: str) -> Dict[str, Any]:
        """
        Check if the node is reachable.
        """
        node = self.node_manager.nodes.get(node_id)
        if not node:
            return {"ok": False, "error": "Node not found"}

        current_time = datetime.now()
        time_since_heartbeat = (current_time - node.last_heartbeat).total_seconds()

        return {
            "ok": time_since_heartbeat <= self.node_manager.heartbeat_timeout,
            "latency_ms": min(time_since_heartbeat * 1000, 9999),  # Cap at 9999ms
            "last_heartbeat": node.last_heartbeat.isoformat()
        }

    async def _check_resources(self, node_id: str) -> Dict[str, Any]:
        """
        Check node resource utilization.
        """
        node = self.node_manager.nodes.get(node_id)
        if not node:
            return {"ok": False, "error": "Node not found"}

        # In a real implementation, this would query the node for actual resource usage
        # For now, we'll use the metadata or mock values based on the node's load
        cpu_usage = min(10 + (node.load * 15), 95)  # Mock CPU usage based on load
        memory_usage = min(20 + (node.load * 10), 90)  # Mock memory usage based on load

        is_ok = cpu_usage < 80 and memory_usage < 80

        return {
            "ok": is_ok,
            "cpu_percent": cpu_usage,
            "memory_percent": memory_usage,
            "load": node.load,
            "capacity": node.capacity
        }

    async def _check_tasks(self, node_id: str) -> Dict[str, Any]:
        """
        Check the status of tasks assigned to the node.
        """
        assignments = await self.node_manager.get_assigned_tasks(node_id)

        total_tasks = len(assignments)
        running_tasks = sum(1 for a in assignments if a.status == "running")
        completed_tasks = sum(1 for a in assignments if a.status == "completed")
        failed_tasks = sum(1 for a in assignments if a.status == "failed")

        return {
            "ok": failed_tasks == 0,  # Health is OK if no tasks have failed
            "total": total_tasks,
            "running": running_tasks,
            "completed": completed_tasks,
            "failed": failed_tasks
        }

    async def _check_storage_health(self, node_id: str) -> Dict[str, Any]:
        """
        Check the health of storage on the node.
        """
        # In a real implementation, this would check actual storage metrics
        # For now, we'll just return a mock status
        return {
            "ok": True,
            "free_space_percent": 75,  # Mock 75% free space
            "read_speed_mbps": 250,   # Mock read speed
            "write_speed_mbps": 200   # Mock write speed
        }

    async def get_overall_cluster_health(self) -> Dict[str, Any]:
        """
        Get the overall health of the cluster.
        """
        all_statuses = await self.node_manager.get_all_nodes_status()

        healthy_nodes = 0
        warning_nodes = 0
        critical_nodes = 0

        for status in all_statuses:
            node_health = await self.check_node_health(status["id"])
            overall_health = node_health["overall_health"]

            if overall_health == "healthy":
                healthy_nodes += 1
            elif overall_health == "warning":
                warning_nodes += 1
            else:  # critical
                critical_nodes += 1

        cluster_health = "healthy"
        if critical_nodes > 0:
            cluster_health = "critical"
        elif warning_nodes > 0:
            cluster_health = "warning"

        return {
            "cluster_health": cluster_health,
            "timestamp": datetime.now().isoformat(),
            "total_nodes": len(all_statuses),
            "healthy_nodes": healthy_nodes,
            "warning_nodes": warning_nodes,
            "critical_nodes": critical_nodes
        }
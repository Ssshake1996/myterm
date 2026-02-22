"""
Node control tool for the AI automation storage test platform.
Allows agents to manage and interact with execution nodes.
"""
import asyncio
import logging
import subprocess
from typing import Any, Dict, List, Optional
from datetime import datetime

from .base import BaseTool
from ..core.exceptions import ToolExecutionError


logger = logging.getLogger(__name__)


class NodeControlTool(BaseTool):
    """
    Tool for controlling and managing execution nodes.
    """

    def __init__(self, node_manager: Any = None):
        super().__init__(
            name="control_node",
            description="Control and manage execution nodes",
            parameters={
                "node_id": {
                    "type": "string",
                    "description": "ID of the node to control",
                    "required": True
                },
                "action": {
                    "type": "string",
                    "description": "Action to perform on the node (ping, ssh, restart, etc.)",
                    "required": True,
                    "enum": ["ping", "ssh", "restart", "status", "health_check"]
                },
                "command": {
                    "type": "string",
                    "description": "Command to execute on the node (for ssh action)",
                    "default": ""
                }
            }
        )
        self.node_manager = node_manager

    async def execute(self, **kwargs) -> Dict[str, Any]:
        """
        Execute the node control action.
        """
        node_id = kwargs.get("node_id")
        action = kwargs.get("action")

        if not node_id or not action:
            raise ToolExecutionError("node_id and action parameters are required for node control")

        logger.info(f"Performing action '{action}' on node '{node_id}'")

        try:
            if action == "ping":
                result = await self.ping_node(node_id)
            elif action == "ssh":
                command = kwargs.get("command", "")
                result = await self.ssh_command(node_id, command)
            elif action == "restart":
                result = await self.restart_node(node_id)
            elif action == "status":
                result = await self.get_node_status(node_id)
            elif action == "health_check":
                result = await self.health_check(node_id)
            else:
                raise ToolExecutionError(f"Unknown action '{action}' for node control")

            return result
        except Exception as e:
            logger.error(f"Node control action '{action}' on node '{node_id}' failed: {str(e)}")
            raise ToolExecutionError(f"Node control action '{action}' failed: {str(e)}")

    async def ping_node(self, node_id: str) -> Dict[str, Any]:
        """
        Ping a node to check connectivity.
        """
        if self.node_manager and hasattr(self.node_manager, 'get_node_address'):
            node_addr = self.node_manager.get_node_address(node_id)
        else:
            # For demo purposes, assume localhost
            node_addr = "127.0.0.1"

        try:
            # For demo purposes, we'll simulate ping
            start_time = datetime.now()
            # Simulate a successful ping
            await asyncio.sleep(0.1)  # Simulate network delay
            ping_time = (datetime.now() - start_time).total_seconds()

            return {
                "node_id": node_id,
                "action": "ping",
                "status": "reachable",
                "response_time_ms": ping_time * 1000,
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            return {
                "node_id": node_id,
                "action": "ping",
                "status": "unreachable",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }

    async def ssh_command(self, node_id: str, command: str) -> Dict[str, Any]:
        """
        Execute a command via SSH on the specified node.
        """
        if not command:
            return {
                "node_id": node_id,
                "action": "ssh",
                "command": command,
                "status": "error",
                "error": "No command provided",
                "timestamp": datetime.now().isoformat()
            }

        if self.node_manager and hasattr(self.node_manager, 'get_node_ssh_info'):
            node_info = self.node_manager.get_node_ssh_info(node_id)
        else:
            # For demo purposes, assume localhost and basic connection
            node_info = {
                "host": "127.0.0.1",
                "port": 22,
                "username": "demo_user",
                "password": "demo_password"  # In real implementation, use proper authentication
            }

        try:
            # For demo purposes, we'll simulate the SSH command execution
            start_time = datetime.now()

            # Simulate command execution
            if command == "df -h":
                output = """
Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        20G   10G  9.0G  53% /
none            4.0K     0  4.0K   0% /sys/fs/cgroup
udev            3.9G  8.0K  3.9G   1% /dev
tmpfs           799M  1.7M  798M   1% /run
"""
            elif command == "ps aux | grep python":
                output = """
user  1234  0.1  0.2 123456  7890 ?  Ssl  10:00   0:01 python3 /app/main.py
user  5678  0.0  0.1  98765  4321 ?  S    10:15   0:00 grep python
"""
            else:
                output = f"Simulated output for command: {command}"

            execution_time = (datetime.now() - start_time).total_seconds()

            return {
                "node_id": node_id,
                "action": "ssh",
                "command": command,
                "status": "success",
                "output": output.strip(),
                "execution_time": execution_time,
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            return {
                "node_id": node_id,
                "action": "ssh",
                "command": command,
                "status": "error",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }

    async def restart_node(self, node_id: str) -> Dict[str, Any]:
        """
        Restart a node.
        """
        # In a real implementation, this would perform the actual restart
        # For demo purposes, we'll just return success
        try:
            logger.info(f"Restarting node {node_id}...")
            # Simulate restart process
            await asyncio.sleep(0.5)  # Simulate restart time

            return {
                "node_id": node_id,
                "action": "restart",
                "status": "success",
                "message": f"Node {node_id} restart initiated successfully",
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            return {
                "node_id": node_id,
                "action": "restart",
                "status": "error",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }

    async def get_node_status(self, node_id: str) -> Dict[str, Any]:
        """
        Get the current status of a node.
        """
        if self.node_manager and hasattr(self.node_manager, 'get_node_info'):
            node_info = self.node_manager.get_node_info(node_id)
        else:
            # For demo purposes, return mock node information
            node_info = {
                "id": node_id,
                "address": "127.0.0.1",
                "status": "active",
                "cpu_usage": 25.5,
                "memory_usage": 42.3,
                "disk_usage": 60.1,
                "active_tasks": 2,
                "capacity": 10,
                "load": 2
            }

        return {
            "node_id": node_id,
            "action": "status",
            "status": "success",
            "node_info": node_info,
            "timestamp": datetime.now().isoformat()
        }

    async def health_check(self, node_id: str) -> Dict[str, Any]:
        """
        Perform a health check on a node.
        """
        try:
            # Get node status first
            status_result = await self.get_node_status(node_id)
            if status_result["status"] != "success":
                return {
                    "node_id": node_id,
                    "action": "health_check",
                    "status": "error",
                    "error": "Could not get node status",
                    "timestamp": datetime.now().isoformat()
                }

            node_info = status_result["node_info"]

            # Evaluate health based on resource usage
            cpu_health = "healthy" if node_info["cpu_usage"] < 80 else "warning" if node_info["cpu_usage"] < 90 else "critical"
            mem_health = "healthy" if node_info["memory_usage"] < 80 else "warning" if node_info["memory_usage"] < 90 else "critical"
            disk_health = "healthy" if node_info["disk_usage"] < 80 else "warning" if node_info["disk_usage"] < 90 else "critical"

            overall_health = "healthy"
            if cpu_health == "critical" or mem_health == "critical" or disk_health == "critical":
                overall_health = "critical"
            elif cpu_health == "warning" or mem_health == "warning" or disk_health == "warning":
                overall_health = "warning"

            return {
                "node_id": node_id,
                "action": "health_check",
                "status": "success",
                "overall_health": overall_health,
                "details": {
                    "cpu": {"usage": node_info["cpu_usage"], "health": cpu_health},
                    "memory": {"usage": node_info["memory_usage"], "health": mem_health},
                    "disk": {"usage": node_info["disk_usage"], "health": disk_health},
                    "tasks": {"active": node_info["active_tasks"], "capacity": node_info["capacity"]}
                },
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            return {
                "node_id": node_id,
                "action": "health_check",
                "status": "error",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }
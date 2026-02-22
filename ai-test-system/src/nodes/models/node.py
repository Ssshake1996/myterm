"""
Node models for the AI automation storage test platform.
"""
from datetime import datetime
from typing import Dict, Any, Optional
from dataclasses import dataclass


@dataclass
class NodeRegistration:
    """
    Model for node registration information.
    """
    node_id: str
    name: str
    address: str
    port: int
    capacity: int
    description: str = ""
    metadata: Optional[Dict[str, Any]] = None
    registered_at: Optional[datetime] = None

    def __post_init__(self):
        if self.registered_at is None:
            self.registered_at = datetime.now()

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert to dictionary representation.
        """
        return {
            "node_id": self.node_id,
            "name": self.name,
            "address": self.address,
            "port": self.port,
            "capacity": self.capacity,
            "description": self.description,
            "metadata": self.metadata or {},
            "registered_at": self.registered_at.isoformat()
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'NodeRegistration':
        """
        Create from dictionary.
        """
        return cls(
            node_id=data["node_id"],
            name=data["name"],
            address=data["address"],
            port=data["port"],
            capacity=data["capacity"],
            description=data.get("description", ""),
            metadata=data.get("metadata"),
            registered_at=datetime.fromisoformat(data["registered_at"]) if data.get("registered_at") else None
        )


@dataclass
class NodeHeartbeat:
    """
    Model for node heartbeat information.
    """
    node_id: str
    timestamp: datetime
    load: float
    available_memory: int
    available_disk: int
    active_tasks: int
    status: str = "active"  # active, inactive, overloaded, etc.
    metadata: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert to dictionary representation.
        """
        return {
            "node_id": self.node_id,
            "timestamp": self.timestamp.isoformat(),
            "load": self.load,
            "available_memory": self.available_memory,
            "available_disk": self.available_disk,
            "active_tasks": self.active_tasks,
            "status": self.status,
            "metadata": self.metadata or {}
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'NodeHeartbeat':
        """
        Create from dictionary.
        """
        return cls(
            node_id=data["node_id"],
            timestamp=datetime.fromisoformat(data["timestamp"]),
            load=data["load"],
            available_memory=data["available_memory"],
            available_disk=data["available_disk"],
            active_tasks=data["active_tasks"],
            status=data.get("status", "active"),
            metadata=data.get("metadata")
        )


@dataclass
class NodeTaskAssignment:
    """
    Model for task assignment to a node.
    """
    assignment_id: str
    task_id: str
    node_id: str
    assigned_at: datetime
    status: str  # assigned, running, completed, failed, cancelled
    result: Optional[Any] = None
    error: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert to dictionary representation.
        """
        return {
            "assignment_id": self.assignment_id,
            "task_id": self.task_id,
            "node_id": self.node_id,
            "assigned_at": self.assigned_at.isoformat(),
            "status": self.status,
            "result": self.result,
            "error": self.error,
            "metadata": self.metadata or {}
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'NodeTaskAssignment':
        """
        Create from dictionary.
        """
        return cls(
            assignment_id=data["assignment_id"],
            task_id=data["task_id"],
            node_id=data["node_id"],
            assigned_at=datetime.fromisoformat(data["assigned_at"]),
            status=data["status"],
            result=data.get("result"),
            error=data.get("error"),
            metadata=data.get("metadata")
        )


@dataclass
class NodeLoadReport:
    """
    Model for node load report.
    """
    node_id: str
    timestamp: datetime
    cpu_usage: float
    memory_usage: float
    disk_usage: float
    network_io: Dict[str, float]  # Contains 'rx' and 'tx' in MB/s
    tasks_running: int
    tasks_completed: int
    tasks_failed: int
    metadata: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert to dictionary representation.
        """
        return {
            "node_id": self.node_id,
            "timestamp": self.timestamp.isoformat(),
            "cpu_usage": self.cpu_usage,
            "memory_usage": self.memory_usage,
            "disk_usage": self.disk_usage,
            "network_io": self.network_io,
            "tasks_running": self.tasks_running,
            "tasks_completed": self.tasks_completed,
            "tasks_failed": self.tasks_failed,
            "metadata": self.metadata or {}
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'NodeLoadReport':
        """
        Create from dictionary.
        """
        return cls(
            node_id=data["node_id"],
            timestamp=datetime.fromisoformat(data["timestamp"]),
            cpu_usage=data["cpu_usage"],
            memory_usage=data["memory_usage"],
            disk_usage=data["disk_usage"],
            network_io=data["network_io"],
            tasks_running=data["tasks_running"],
            tasks_completed=data["tasks_completed"],
            tasks_failed=data["tasks_failed"],
            metadata=data.get("metadata")
        )
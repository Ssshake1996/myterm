"""
State Store module for the AI automation storage test platform.
Handles persistent storage of task states, flow states, agent states, and audit logs.
"""
import asyncio
import logging
import json
from datetime import datetime
from typing import Dict, List, Any, Optional, Union
from dataclasses import dataclass, asdict

# Fixed relative import path
from ..core.types import TaskStatus, FlowStatus
from ..core.exceptions import StorageError


logger = logging.getLogger(__name__)


@dataclass
class TaskState:
    """
    Represents the state of a task in the system.
    """
    id: str
    name: str
    description: str
    status: TaskStatus
    priority: int
    dependencies: List[str]
    assigned_node: Optional[str]
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    error_message: Optional[str]
    metadata: Dict[str, Any]
    result: Optional[Any] = None

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert to dictionary representation for storage.
        """
        result = asdict(self)
        result['status'] = self.status.value
        result['created_at'] = self.created_at.isoformat()
        if self.started_at:
            result['started_at'] = self.started_at.isoformat()
        if self.completed_at:
            result['completed_at'] = self.completed_at.isoformat()
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'TaskState':
        """
        Create from dictionary representation.
        """
        return cls(
            id=data['id'],
            name=data['name'],
            description=data['description'],
            status=TaskStatus(data['status']),
            priority=data['priority'],
            dependencies=data['dependencies'],
            assigned_node=data.get('assigned_node'),
            created_at=datetime.fromisoformat(data['created_at']),
            started_at=datetime.fromisoformat(data['started_at']) if data.get('started_at') else None,
            completed_at=datetime.fromisoformat(data['completed_at']) if data.get('completed_at') else None,
            error_message=data.get('error_message'),
            metadata=data.get('metadata', {}),
            result=data.get('result')
        )


@dataclass
class FlowState:
    """
    Represents the state of a flow execution in the system.
    """
    id: str
    flow_definition_id: str
    status: FlowStatus
    started_at: datetime
    completed_at: Optional[datetime]
    node_executions: Dict[str, Any]
    variables: Dict[str, Any]
    metadata: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert to dictionary representation for storage.
        """
        result = asdict(self)
        result['status'] = self.status.value
        result['started_at'] = self.started_at.isoformat()
        if self.completed_at:
            result['completed_at'] = self.completed_at.isoformat()
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'FlowState':
        """
        Create from dictionary representation.
        """
        return cls(
            id=data['id'],
            flow_definition_id=data['flow_definition_id'],
            status=FlowStatus(data['status']),
            started_at=datetime.fromisoformat(data['started_at']),
            completed_at=datetime.fromisoformat(data['completed_at']) if data.get('completed_at') else None,
            node_executions=data['node_executions'],
            variables=data['variables'],
            metadata=data['metadata']
        )


@dataclass
class AgentState:
    """
    Represents the state of an agent in the system.
    """
    id: str
    name: str
    role: str
    description: str
    status: str
    goals: List[str]
    tools: List[str]
    created_at: datetime
    last_activity: datetime
    metadata: Dict[str, Any]
    current_task: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert to dictionary representation for storage.
        """
        result = asdict(self)
        result['created_at'] = self.created_at.isoformat()
        result['last_activity'] = self.last_activity.isoformat()
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'AgentState':
        """
        Create from dictionary representation.
        """
        return cls(
            id=data['id'],
            name=data['name'],
            role=data['role'],
            description=data['description'],
            status=data['status'],
            goals=data['goals'],
            tools=data['tools'],
            created_at=datetime.fromisoformat(data['created_at']),
            last_activity=datetime.fromisoformat(data['last_activity']),
            metadata=data['metadata'],
            current_task=data.get('current_task')
        )


@dataclass
class AuditLog:
    """
    Represents an audit log entry in the system.
    """
    id: str
    timestamp: datetime
    event_type: str
    actor: str
    action: str
    resource_type: str
    resource_id: str
    details: Dict[str, Any]
    metadata: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert to dictionary representation for storage.
        """
        result = asdict(self)
        result['timestamp'] = self.timestamp.isoformat()
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'AuditLog':
        """
        Create from dictionary representation.
        """
        return cls(
            id=data['id'],
            timestamp=datetime.fromisoformat(data['timestamp']),
            event_type=data['event_type'],
            actor=data['actor'],
            action=data['action'],
            resource_type=data['resource_type'],
            resource_id=data['resource_id'],
            details=data['details'],
            metadata=data['metadata']
        )
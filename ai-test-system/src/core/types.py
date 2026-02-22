"""
Type definitions for the AI automation storage test platform.
"""
from typing import Dict, List, Any, Optional, Callable, Union
from enum import Enum
from dataclasses import dataclass
from datetime import datetime


class NodeType(str, Enum):
    """Types of nodes in the flow."""
    START = "start"
    END = "end"
    PROCESS = "process"
    DECISION = "decision"
    AGENT = "agent"
    TOOL = "tool"


class FlowStatus(str, Enum):
    """Status of a flow execution."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskStatus(str, Enum):
    """Status of a task."""
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class AgentRole(str, Enum):
    """Roles of agents in the system."""
    TEST = "test"
    ANALYSIS = "analysis"
    REPAIR = "repair"


@dataclass
class NodeData:
    """Data structure for a node in the flow."""
    id: str
    type: NodeType
    name: str
    function: Callable
    inputs: List[str]
    outputs: List[str]
    metadata: Dict[str, Any]


@dataclass
class EdgeData:
    """Data structure for an edge connecting two nodes."""
    source: str
    target: str
    condition: Optional[str] = None
    metadata: Dict[str, Any] = None


@dataclass
class FlowDefinition:
    """Definition of a flow including nodes and edges."""
    id: str
    name: str
    description: str
    nodes: List[NodeData]
    edges: List[EdgeData]
    created_at: datetime
    updated_at: datetime
    metadata: Dict[str, Any]


@dataclass
class FlowExecution:
    """Runtime representation of a flow execution."""
    id: str
    flow_definition_id: str
    status: FlowStatus
    started_at: datetime
    completed_at: Optional[datetime]
    node_executions: Dict[str, Any]  # node_id -> execution_result
    variables: Dict[str, Any]
    metadata: Dict[str, Any]


@dataclass
class Task:
    """Task definition for the scheduler."""
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


@dataclass
class NodeInfo:
    """Information about an execution node."""
    id: str
    name: str
    address: str
    port: int
    status: str
    last_heartbeat: datetime
    capacity: int
    load: int
    metadata: Dict[str, Any]
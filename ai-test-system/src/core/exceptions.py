"""
Core exception definitions for the AI automation storage test platform.
"""
from typing import Optional


class FlowEngineException(Exception):
    """Base exception for flow engine operations."""
    pass


class NodeExecutionError(FlowEngineException):
    """Raised when a node fails to execute."""
    def __init__(self, node_id: str, message: str, original_error: Optional[Exception] = None):
        self.node_id = node_id
        self.original_error = original_error
        super().__init__(f"Node {node_id} execution failed: {message}")


class CycleDetectedError(FlowEngineException):
    """Raised when a cycle is detected in the DAG."""
    pass


class InvalidFlowDefinitionError(FlowEngineException):
    """Raised when a flow definition is invalid."""
    pass


class AgentException(Exception):
    """Base exception for agent operations."""
    pass


class PlanningError(AgentException):
    """Raised when an agent fails to plan."""
    pass


class ExecutionError(AgentException):
    """Raised when an agent fails to execute an action."""
    pass


class ToolExecutionError(AgentException):
    """Raised when a tool fails to execute."""
    pass


class KnowledgeRetrievalError(AgentException):
    """Raised when knowledge retrieval fails."""
    pass


class NodeRegistrationError(Exception):
    """Raised when node registration fails."""
    pass


class NodeHeartbeatError(Exception):
    """Raised when node heartbeat fails."""
    pass


class TaskSchedulingError(Exception):
    """Raised when task scheduling fails."""
    pass


class StorageError(Exception):
    """Raised when storage operations fail."""
    pass
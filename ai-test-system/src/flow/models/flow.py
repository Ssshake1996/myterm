"""
Flow models for the AI automation storage test platform.
"""
from datetime import datetime
from typing import Dict, List, Any, Optional
from ..core.types import NodeData, EdgeData, FlowStatus


class FlowModel:
    """
    Represents a flow definition in the system.
    """
    def __init__(
        self,
        id: str,
        name: str,
        description: str = "",
        nodes: Optional[List[NodeData]] = None,
        edges: Optional[List[EdgeData]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        self.id = id
        self.name = name
        self.description = description
        self.nodes = nodes or []
        self.edges = edges or []
        self.created_at = datetime.now()
        self.updated_at = datetime.now()
        self.metadata = metadata or {}

    def add_node(self, node: NodeData) -> None:
        """
        Add a node to the flow.
        """
        self.nodes.append(node)
        self.updated_at = datetime.now()

    def add_edge(self, edge: EdgeData) -> None:
        """
        Add an edge to the flow.
        """
        self.edges.append(edge)
        self.updated_at = datetime.now()

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert the flow to a dictionary representation.
        """
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "nodes": [
                {
                    "id": node.id,
                    "type": node.type.value,
                    "name": node.name,
                    "inputs": node.inputs,
                    "outputs": node.outputs,
                    "metadata": node.metadata
                }
                for node in self.nodes
            ],
            "edges": [
                {
                    "source": edge.source,
                    "target": edge.target,
                    "condition": edge.condition,
                    "metadata": edge.metadata
                }
                for edge in self.edges
            ],
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "metadata": self.metadata
        }


class FlowExecutionModel:
    """
    Represents a flow execution instance.
    """
    def __init__(
        self,
        id: str,
        flow_definition_id: str,
        status: FlowStatus,
        started_at: datetime,
        node_executions: Optional[Dict[str, Any]] = None,
        variables: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        self.id = id
        self.flow_definition_id = flow_definition_id
        self.status = status
        self.started_at = started_at
        self.completed_at: Optional[datetime] = None
        self.node_executions = node_executions or {}
        self.variables = variables or {}
        self.metadata = metadata or {}

    def complete(self, status: FlowStatus = FlowStatus.COMPLETED) -> None:
        """
        Mark the execution as completed.
        """
        self.status = status
        self.completed_at = datetime.now()

    def fail(self, error_message: str) -> None:
        """
        Mark the execution as failed.
        """
        self.status = FlowStatus.FAILED
        self.completed_at = datetime.now()
        self.metadata["error"] = error_message

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert the execution to a dictionary representation.
        """
        return {
            "id": self.id,
            "flow_definition_id": self.flow_definition_id,
            "status": self.status.value,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "node_executions": self.node_executions,
            "variables": self.variables,
            "metadata": self.metadata
        }
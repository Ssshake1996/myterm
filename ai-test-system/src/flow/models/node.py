"""
Node and Edge models for the Flow Engine.
"""
from typing import Dict, List, Any, Optional, Callable
from enum import Enum
from datetime import datetime
from ..core.types import NodeType


class NodeModel:
    """
    Represents a node in the flow.
    """
    def __init__(
        self,
        id: str,
        type: NodeType,
        name: str,
        function: Optional[Callable] = None,
        inputs: Optional[List[str]] = None,
        outputs: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        self.id = id
        self.type = type
        self.name = name
        self.function = function
        self.inputs = inputs or []
        self.outputs = outputs or []
        self.created_at = datetime.now()
        self.updated_at = datetime.now()
        self.metadata = metadata or {}

    def update(self, **kwargs) -> None:
        """
        Update node properties.
        """
        for key, value in kwargs.items():
            if hasattr(self, key):
                setattr(self, key, value)
        self.updated_at = datetime.now()

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert the node to a dictionary representation.
        """
        return {
            "id": self.id,
            "type": self.type.value,
            "name": self.name,
            "inputs": self.inputs,
            "outputs": self.outputs,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "metadata": self.metadata
        }


class EdgeModel:
    """
    Represents an edge connecting two nodes in the flow.
    """
    def __init__(
        self,
        source: str,
        target: str,
        condition: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        self.source = source
        self.target = target
        self.condition = condition
        self.created_at = datetime.now()
        self.updated_at = datetime.now()
        self.metadata = metadata or {}

    def update(self, **kwargs) -> None:
        """
        Update edge properties.
        """
        for key, value in kwargs.items():
            if hasattr(self, key):
                setattr(self, key, value)
        self.updated_at = datetime.now()

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert the edge to a dictionary representation.
        """
        return {
            "source": self.source,
            "target": self.target,
            "condition": self.condition,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "metadata": self.metadata
        }
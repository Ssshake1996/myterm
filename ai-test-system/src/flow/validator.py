"""
Flow validator for the AI automation storage test platform.
Validates flow definitions before execution.
"""
from typing import List, Dict, Any
from .models.flow import FlowModel
from .models.node import NodeModel
from ..core.types import NodeType
from ..core.exceptions import InvalidFlowDefinitionError


class FlowValidator:
    """
    Validates flow definitions to ensure they meet requirements.
    """

    @staticmethod
    def validate(flow: FlowModel) -> List[str]:
        """
        Validate a flow and return a list of validation errors.
        """
        errors = []

        # Check required fields
        if not flow.id:
            errors.append("Flow ID is required")

        if not flow.name:
            errors.append("Flow name is required")

        # Check for at least one node
        if not flow.nodes:
            errors.append("Flow must have at least one node")

        # Validate nodes
        errors.extend(FlowValidator._validate_nodes(flow.nodes))

        # Validate edges
        errors.extend(FlowValidator._validate_edges(flow.nodes, flow.edges))

        # Check for start and end nodes
        errors.extend(FlowValidator._validate_start_end_nodes(flow.nodes))

        return errors

    @staticmethod
    def _validate_nodes(nodes: List[NodeModel]) -> List[str]:
        """
        Validate individual nodes in the flow.
        """
        errors = []
        node_ids = set()

        for node in nodes:
            # Check for duplicate IDs
            if node.id in node_ids:
                errors.append(f"Duplicate node ID: {node.id}")
            else:
                node_ids.add(node.id)

            # Check required fields
            if not node.id:
                errors.append("Node ID is required")

            if not node.name:
                errors.append(f"Node {node.id} name is required")

            # Validate node type
            try:
                NodeType(node.type)
            except ValueError:
                errors.append(f"Invalid node type '{node.type}' for node {node.id}")

        return errors

    @staticmethod
    def _validate_edges(nodes: List[NodeModel], edges: List[Any]) -> List[str]:
        """
        Validate edges in the flow.
        """
        errors = []
        node_ids = {node.id for node in nodes}

        for i, edge in enumerate(edges):
            # Check if source and target nodes exist
            if edge.source not in node_ids:
                errors.append(f"Edge {i}: Source node '{edge.source}' does not exist")

            if edge.target not in node_ids:
                errors.append(f"Edge {i}: Target node '{edge.target}' does not exist")

            # Check for self-loop
            if edge.source == edge.target:
                errors.append(f"Edge {i}: Self-loop detected for node '{edge.source}'")

        return errors

    @staticmethod
    def _validate_start_end_nodes(nodes: List[NodeModel]) -> List[str]:
        """
        Validate that flow has appropriate start and end nodes.
        """
        errors = []

        start_nodes = [n for n in nodes if n.type == NodeType.START]
        end_nodes = [n for n in nodes if n.type == NodeType.END]

        if len(start_nodes) == 0:
            errors.append("Flow must have at least one start node")

        if len(end_nodes) == 0:
            errors.append("Flow must have at least one end node")

        return errors

    @staticmethod
    def is_valid(flow: FlowModel) -> bool:
        """
        Check if a flow is valid (has no validation errors).
        """
        return len(FlowValidator.validate(flow)) == 0

    @staticmethod
    def validate_and_raise(flow: FlowModel) -> None:
        """
        Validate a flow and raise an exception if it's invalid.
        """
        errors = FlowValidator.validate(flow)
        if errors:
            error_msg = "; ".join(errors)
            raise InvalidFlowDefinitionError(f"Invalid flow: {error_msg}")
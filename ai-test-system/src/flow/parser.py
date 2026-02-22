"""
Flow parser for the AI automation storage test platform.
Converts flow definitions from various formats to internal representations.
"""
import json
from typing import Dict, Any, Union
from .models.flow import FlowModel
from .models.node import NodeModel, EdgeModel
from ..core.types import NodeType
from ..core.exceptions import InvalidFlowDefinitionError


class FlowParser:
    """
    Parses flow definitions from different formats into internal models.
    """

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> FlowModel:
        """
        Parse a flow from a dictionary representation.
        """
        try:
            # Create the flow model
            flow = FlowModel(
                id=data['id'],
                name=data['name'],
                description=data.get('description', ''),
                metadata=data.get('metadata', {})
            )

            # Add nodes
            for node_data in data.get('nodes', []):
                node_type = NodeType(node_data['type'])
                node = NodeModel(
                    id=node_data['id'],
                    type=node_type,
                    name=node_data['name'],
                    inputs=node_data.get('inputs', []),
                    outputs=node_data.get('outputs', []),
                    metadata=node_data.get('metadata', {})
                )
                flow.add_node(node)

            # Add edges
            for edge_data in data.get('edges', []):
                edge = EdgeModel(
                    source=edge_data['source'],
                    target=edge_data['target'],
                    condition=edge_data.get('condition'),
                    metadata=edge_data.get('metadata', {})
                )
                flow.add_edge(edge)

            return flow

        except KeyError as e:
            raise InvalidFlowDefinitionError(f"Missing required field: {e}")
        except ValueError as e:
            raise InvalidFlowDefinitionError(f"Invalid value: {e}")

    @staticmethod
    def from_json(json_str: str) -> FlowModel:
        """
        Parse a flow from a JSON string.
        """
        data = json.loads(json_str)
        return FlowParser.from_dict(data)

    @staticmethod
    def from_file(file_path: str) -> FlowModel:
        """
        Parse a flow from a JSON file.
        """
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return FlowParser.from_dict(data)

    @staticmethod
    def to_dict(flow: FlowModel) -> Dict[str, Any]:
        """
        Convert a flow to a dictionary representation.
        """
        return flow.to_dict()

    @staticmethod
    def to_json(flow: FlowModel) -> str:
        """
        Convert a flow to a JSON string.
        """
        return json.dumps(FlowParser.to_dict(flow), indent=2)
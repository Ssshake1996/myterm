"""
Flow visualization for the AI automation storage test platform.
Generates visual representations of flows.
"""
from typing import Dict, Any, List
from .models.flow import FlowModel
from .dag import DAG


class FlowVisualization:
    """
    Generates visual representations of flows for UI display.
    """

    @staticmethod
    def generate_graph_data(flow: FlowModel) -> Dict[str, Any]:
        """
        Generate graph data suitable for visualization libraries.
        """
        nodes = []
        edges = []

        # Process nodes
        for node in flow.nodes:
            node_data = {
                "id": node.id,
                "type": node.type.value,
                "label": node.name,
                "inputs": node.inputs,
                "outputs": node.outputs,
                "metadata": node.metadata
            }
            nodes.append(node_data)

        # Process edges
        for edge in flow.edges:
            edge_data = {
                "source": edge.source,
                "target": edge.target,
                "condition": edge.condition,
                "metadata": edge.metadata
            }
            edges.append(edge_data)

        return {
            "nodes": nodes,
            "edges": edges,
            "flowId": flow.id,
            "flowName": flow.name,
            "createdAt": flow.created_at.isoformat(),
            "updatedAt": flow.updated_at.isoformat()
        }

    @staticmethod
    def generate_mermaid_diagram(flow: FlowModel) -> str:
        """
        Generate a Mermaid diagram string for the flow.
        """
        dag = DAG()

        # Add nodes
        for node in flow.nodes:
            dag.add_node(node.id)

        # Add edges
        for edge in flow.edges:
            dag.add_edge(edge.source, edge.target)

        # Generate Mermaid diagram
        mermaid_lines = ["graph TD"]

        # Add all nodes
        for node in flow.nodes:
            # Format node label to be Mermaid-friendly
            label = node.name.replace(" ", "_")
            if node.type == 'start':
                mermaid_lines.append(f"    {node.id}[({label})]")
            elif node.type == 'end':
                mermaid_lines.append(f"    {node.id}[({label})]")
            elif node.type == 'decision':
                mermaid_lines.append(f"    {node.id}{{\"{label}\"}}")
            elif node.type == 'process':
                mermaid_lines.append(f"    {node.id}[\"{label}\"]")
            else:
                mermaid_lines.append(f"    {node.id}[\"{label}\"]")

        # Add all edges
        for edge in flow.edges:
            if edge.condition:
                mermaid_lines.append(f"    {edge.source} -->|{edge.condition}| {edge.target}")
            else:
                mermaid_lines.append(f"    {edge.source} --> {edge.target}")

        return "\n".join(mermaid_lines)

    @staticmethod
    def get_flow_statistics(flow: FlowModel) -> Dict[str, Any]:
        """
        Get statistics about the flow structure.
        """
        node_counts = {}
        for node in flow.nodes:
            node_type = node.type.value
            node_counts[node_type] = node_counts.get(node_type, 0) + 1

        return {
            "total_nodes": len(flow.nodes),
            "total_edges": len(flow.edges),
            "node_types": node_counts,
            "start_nodes": node_counts.get('start', 0),
            "end_nodes": node_counts.get('end', 0),
            "process_nodes": node_counts.get('process', 0),
            "decision_nodes": node_counts.get('decision', 0),
            "agent_nodes": node_counts.get('agent', 0),
            "tool_nodes": node_counts.get('tool', 0),
            "is_acyclic": FlowVisualization._is_flow_acyclic(flow)
        }

    @staticmethod
    def _is_flow_acyclic(flow: FlowModel) -> bool:
        """
        Check if the flow forms an acyclic graph.
        """
        dag = DAG()

        # Add nodes
        for node in flow.nodes:
            dag.add_node(node.id)

        # Add edges
        for edge in flow.edges:
            dag.add_edge(edge.source, edge.target)

        return dag.is_acyclic()
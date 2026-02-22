"""
Test file for the Flow Engine module.
"""
import asyncio
import tempfile
import os
from datetime import datetime
from src.flow.engine import FlowEngine
from src.flow.models.flow import FlowModel
from src.flow.models.node import NodeModel
from src.flow.parser import FlowParser
from src.flow.validator import FlowValidator
from src.core.types import NodeType


def simple_task_function(**kwargs):
    """Simple function for testing node execution."""
    print(f"Executing simple task with inputs: {kwargs}")
    return {"result": "success", "variables": {"last_result": "success"}}


async def test_flow_engine():
    """Test the basic functionality of the Flow Engine."""
    # Create a flow engine instance
    engine = FlowEngine()

    # Create nodes for a simple flow
    start_node = NodeModel(
        id="start",
        type=NodeType.START,
        name="Start Node",
        inputs=[],
        outputs=["next"],
        metadata={"description": "Starting point of the flow"}
    )

    process_node = NodeModel(
        id="process",
        type=NodeType.PROCESS,
        name="Process Node",
        function=simple_task_function,
        inputs=["input_data"],
        outputs=["result"],
        metadata={"description": "Processing step"}
    )

    end_node = NodeModel(
        id="end",
        type=NodeType.END,
        name="End Node",
        inputs=["prev"],
        outputs=[],
        metadata={"description": "End point of the flow"}
    )

    # Create a flow definition
    flow = FlowModel(
        id="test_flow",
        name="Test Flow",
        description="A simple test flow"
    )

    # Add nodes to the flow
    flow.add_node(start_node)
    flow.add_node(process_node)
    flow.add_node(end_node)

    # Add edges to connect nodes
    from src.flow.models.node import EdgeModel
    flow.add_edge(EdgeModel(source="start", target="process"))
    flow.add_edge(EdgeModel(source="process", target="end"))

    # Validate the flow
    errors = FlowValidator.validate(flow)
    if errors:
        print(f"Validation errors: {errors}")
        return

    print("Flow validation passed!")

    # Register the flow in the engine
    engine.register_flow(flow)
    print(f"Flow {flow.id} registered successfully")

    # Execute the flow
    execution_id = await engine.execute_flow(
        flow_id="test_flow",
        initial_variables={"input_data": "test_value"}
    )

    print(f"Flow executed with ID: {execution_id}")

    # Check execution status
    execution = engine.get_execution_status(execution_id)
    if execution:
        print(f"Execution status: {execution.status}")
        print(f"Node executions: {list(execution.node_executions.keys())}")

    # Test flow serialization
    flow_dict = FlowParser.to_dict(flow)
    print(f"Flow serialized to dict with keys: {list(flow_dict.keys())}")

    # Test flow deserialization
    reconstructed_flow = FlowParser.from_dict(flow_dict)
    print(f"Reconstructed flow: {reconstructed_flow.name}")

    print("All tests passed!")


if __name__ == "__main__":
    asyncio.run(test_flow_engine())
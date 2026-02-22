"""
Flow Engine implementation for the AI automation storage test platform.
Handles DAG execution, flow visualization, and workflow management.
"""
import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Any, Optional
from ..core.exceptions import FlowEngineException, CycleDetectedError, InvalidFlowDefinitionError
from ..core.types import FlowDefinition, FlowExecution, FlowStatus, NodeData, EdgeData, NodeType
from .dag import DAG


logger = logging.getLogger(__name__)


class FlowEngine:
    """
    Core engine for managing and executing flows based on DAG structures.
    """

    def __init__(self):
        self.flows: Dict[str, FlowDefinition] = {}
        self.executions: Dict[str, FlowExecution] = {}
        self.dags: Dict[str, DAG] = {}

    def register_flow(self, flow_def: FlowDefinition) -> None:
        """
        Register a new flow definition in the engine.
        """
        # Validate the flow definition
        self._validate_flow(flow_def)

        # Create DAG from flow definition
        dag = DAG()
        for node in flow_def.nodes:
            dag.add_node(node.id)

        for edge in flow_def.edges:
            dag.add_edge(edge.source, edge.target)

        # Check for cycles
        if not dag.is_acyclic():
            raise CycleDetectedError(f"Cycle detected in flow {flow_def.id}")

        # Register flow and DAG
        self.flows[flow_def.id] = flow_def
        self.dags[flow_def.id] = dag
        logger.info(f"Registered flow {flow_def.id}: {flow_def.name}")

    def _validate_flow(self, flow_def: FlowDefinition) -> None:
        """
        Validate a flow definition before registration.
        """
        # Check if required fields exist
        if not flow_def.id:
            raise InvalidFlowDefinitionError("Flow ID is required")

        if not flow_def.name:
            raise InvalidFlowDefinitionError("Flow name is required")

        if not flow_def.nodes:
            raise InvalidFlowDefinitionError("Flow must have at least one node")

        # Check for start and end nodes
        start_nodes = [n for n in flow_def.nodes if n.type == NodeType.START]
        end_nodes = [n for n in flow_def.nodes if n.type == NodeType.END]

        if len(start_nodes) == 0:
            raise InvalidFlowDefinitionError("Flow must have at least one start node")

        if len(end_nodes) == 0:
            raise InvalidFlowDefinitionError("Flow must have at least one end node")

        # Validate node connections
        node_ids = {n.id for n in flow_def.nodes}
        for edge in flow_def.edges:
            if edge.source not in node_ids:
                raise InvalidFlowDefinitionError(f"Edge source {edge.source} does not exist")
            if edge.target not in node_ids:
                raise InvalidFlowDefinitionError(f"Edge target {edge.target} does not exist")

    async def execute_flow(self, flow_id: str, initial_variables: Optional[Dict[str, Any]] = None) -> str:
        """
        Execute a registered flow asynchronously.
        Returns the execution ID.
        """
        if flow_id not in self.flows:
            raise FlowEngineException(f"Flow {flow_id} not found")

        flow_def = self.flows[flow_id]
        execution_id = f"{flow_id}_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"

        # Create execution record
        execution = FlowExecution(
            id=execution_id,
            flow_definition_id=flow_id,
            status=FlowStatus.RUNNING,
            started_at=datetime.now(),
            completed_at=None,
            node_executions={},
            variables=initial_variables or {},
            metadata={"engine_version": "1.0.0"}
        )

        self.executions[execution_id] = execution
        logger.info(f"Starting execution {execution_id} of flow {flow_id}")

        try:
            # Execute the DAG
            await self._execute_dag(execution_id, flow_def)

            # Mark execution as completed
            execution.status = FlowStatus.COMPLETED
            execution.completed_at = datetime.now()
            logger.info(f"Execution {execution_id} completed successfully")

        except Exception as e:
            execution.status = FlowStatus.FAILED
            execution.completed_at = datetime.now()
            logger.error(f"Execution {execution_id} failed: {str(e)}")
            raise

        return execution_id

    async def _execute_dag(self, execution_id: str, flow_def: FlowDefinition) -> None:
        """
        Execute the DAG associated with the flow.
        """
        execution = self.executions[execution_id]
        dag = self.dags[flow_def.id]

        # Get execution order from topological sort
        execution_order = dag.topological_sort()

        # Map node_id to NodeData for easy lookup
        node_map = {node.id: node for node in flow_def.nodes}

        for node_id in execution_order:
            node = node_map[node_id]

            try:
                logger.info(f"Executing node {node_id} in execution {execution_id}")

                # Prepare inputs for the node
                inputs = self._prepare_node_inputs(execution, node, flow_def.edges)

                # Execute the node function
                result = await self._execute_node(node, inputs)

                # Store the result
                execution.node_executions[node_id] = result

                # Update variables if the node outputs any
                if isinstance(result, dict):
                    execution.variables.update(result.get('variables', {}))

            except Exception as e:
                logger.error(f"Failed to execute node {node_id}: {str(e)}")
                raise FlowEngineException(f"Node {node_id} execution failed: {str(e)}")

    def _prepare_node_inputs(self, execution: FlowExecution, node: NodeData, edges: List[EdgeData]) -> Dict[str, Any]:
        """
        Prepare inputs for a node based on connected edges and current variables.
        """
        inputs = {}

        # Find incoming edges to this node
        incoming_edges = [e for e in edges if e.target == node.id]

        for edge in incoming_edges:
            source_node_id = edge.source

            # Get the output from the source node
            if source_node_id in execution.node_executions:
                source_output = execution.node_executions[source_node_id]

                # If source output is a dict, we might need to extract specific values
                if isinstance(source_output, dict):
                    # For now, we'll pass the entire output - in a real implementation
                    # we might want more sophisticated data routing
                    inputs.update(source_output)
                else:
                    inputs[f"input_from_{source_node_id}"] = source_output

        # Add any global variables that match expected inputs
        for expected_input in node.inputs:
            if expected_input in execution.variables:
                inputs[expected_input] = execution.variables[expected_input]

        return inputs

    async def _execute_node(self, node: NodeData, inputs: Dict[str, Any]) -> Any:
        """
        Execute a single node.
        """
        # For now, we'll simulate execution based on node type
        # In a real implementation, this would call the actual function
        if node.type == NodeType.AGENT:
            # Simulate agent execution
            result = await self._execute_agent_node(node, inputs)
        elif node.type == NodeType.TOOL:
            # Simulate tool execution
            result = await self._execute_tool_node(node, inputs)
        else:
            # For other node types, call the provided function
            try:
                if asyncio.iscoroutinefunction(node.function):
                    result = await node.function(**inputs)
                else:
                    result = node.function(**inputs)
            except Exception as e:
                logger.error(f"Error executing node {node.id}: {str(e)}")
                raise

        return result

    async def _execute_agent_node(self, node: NodeData, inputs: Dict[str, Any]) -> Any:
        """
        Execute an agent node.
        """
        # Placeholder for agent execution
        # In a real implementation, this would interact with the Agent Engine
        logger.info(f"Executing agent node {node.id}")
        return {"status": "agent_executed", "result": f"Executed agent {node.name}", "variables": {}}

    async def _execute_tool_node(self, node: NodeData, inputs: Dict[str, Any]) -> Any:
        """
        Execute a tool node.
        """
        # Placeholder for tool execution
        # In a real implementation, this would call the Tool Layer
        logger.info(f"Executing tool node {node.id}")
        return {"status": "tool_executed", "result": f"Executed tool {node.name}", "variables": {}}

    def get_execution_status(self, execution_id: str) -> Optional[FlowExecution]:
        """
        Get the status of a flow execution.
        """
        return self.executions.get(execution_id)

    def cancel_execution(self, execution_id: str) -> bool:
        """
        Cancel a running flow execution.
        """
        if execution_id in self.executions:
            execution = self.executions[execution_id]
            if execution.status == FlowStatus.RUNNING:
                execution.status = FlowStatus.CANCELLED
                execution.completed_at = datetime.now()
                logger.info(f"Execution {execution_id} cancelled")
                return True
        return False


# Global flow engine instance
flow_engine = FlowEngine()
"""
Agent executor for the AI automation storage test platform.
Responsible for executing agent plans and managing tool calls.
"""
import asyncio
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime

from .base_agent import BaseAgent
from .planner import PlanStep
from ..core.exceptions import ExecutionError, ToolExecutionError
from .planner import AgentPlanner


logger = logging.getLogger(__name__)


class AgentExecutor:
    """
    Executor that runs agent plans and manages tool calls.
    """

    def __init__(self):
        self.max_concurrent_steps = 5  # Maximum concurrent steps for parallel execution

    async def execute(self, agent: BaseAgent, plan: List[PlanStep]) -> Dict[str, Any]:
        """
        Execute a plan for an agent.
        """
        logger.info(f"Starting execution of plan with {len(plan)} steps for agent {agent.id}")

        # Initialize step tracking
        step_results: Dict[str, Any] = {}
        step_status: Dict[str, str] = {step.step_id: "pending" for step in plan}

        # Build dependency graph
        dependencies: Dict[str, List[str]] = {}
        dependents: Dict[str, List[str]] = {}

        for step in plan:
            dependencies[step.step_id] = step.dependencies
            for dep_id in step.dependencies:
                if dep_id not in dependents:
                    dependents[dep_id] = []
                dependents[dep_id].append(step.step_id)

        # Execute steps respecting dependencies
        completed = set()
        remaining = set(step.step_id for step in plan)

        while remaining:
            # Find steps whose dependencies are satisfied
            ready_steps = [
                step for step in plan
                if step.step_id in remaining and
                all(dep in completed for dep in dependencies[step.step_id])
            ]

            if not ready_steps:
                raise ExecutionError(f"No progress can be made - potential circular dependency in plan for agent {agent.id}")

            # Execute ready steps in parallel, respecting the max concurrency limit
            for step_batch in self._batch_steps(ready_steps, self.max_concurrent_steps):
                batch_results = await asyncio.gather(*[
                    self._execute_step(agent, step, step_results)
                    for step in step_batch
                ], return_exceptions=True)

                # Process results
                for i, step in enumerate(step_batch):
                    if isinstance(batch_results[i], Exception):
                        logger.error(f"Step {step.step_id} failed: {batch_results[i]}")
                        step_results[step.step_id] = {"error": str(batch_results[i])}
                        step_status[step.step_id] = "failed"
                    else:
                        step_results[step.step_id] = batch_results[i]
                        step_status[step.step_id] = "completed"

                    completed.add(step.step_id)
                    remaining.remove(step.step_id)

        logger.info(f"Completed execution of plan for agent {agent.id}")

        return {
            "step_results": step_results,
            "step_status": step_status,
            "completed_count": len(completed),
            "total_count": len(plan),
            "timestamp": datetime.now().isoformat()
        }

    async def _execute_step(self, agent: BaseAgent, step: PlanStep, step_results: Dict[str, Any]) -> Any:
        """
        Execute a single step in the plan.
        """
        logger.info(f"Executing step {step.step_id} for agent {agent.id}: {step.description}")

        try:
            # Find the appropriate tool in the agent's tool list
            tool = self._find_tool(agent, step.tool_name)

            if not tool:
                raise ToolExecutionError(f"Agent {agent.id} does not have tool '{step.tool_name}'")

            # Prepare parameters, possibly incorporating results from previous steps
            params = step.parameters.copy()

            # Add results from dependencies if needed
            for dep_id in step.dependencies:
                if dep_id in step_results:
                    params[f"input_from_{dep_id}"] = step_results[dep_id]

            # Execute the tool with the prepared parameters
            if asyncio.iscoroutinefunction(tool):
                result = await tool(**params)
            else:
                result = tool(**params)

            logger.info(f"Step {step.step_id} completed successfully")
            return result

        except Exception as e:
            logger.error(f"Failed to execute step {step.step_id}: {str(e)}")
            raise ToolExecutionError(f"Failed to execute step '{step.description}': {str(e)}")

    def _find_tool(self, agent: BaseAgent, tool_name: str) -> Optional[callable]:
        """
        Find a tool by name in the agent's tool list.
        """
        for tool in agent.tools:
            # Simple matching - in a real implementation, this might need to be more sophisticated
            if hasattr(tool, '__name__') and tool.__name__ == tool_name:
                return tool
            elif str(tool) == tool_name:
                return tool
            elif tool_name in str(tool):
                # Partial match as fallback
                return tool

        return None

    def _batch_steps(self, steps: List[PlanStep], batch_size: int) -> List[List[PlanStep]]:
        """
        Split steps into batches of the specified size.
        """
        batches = []
        for i in range(0, len(steps), batch_size):
            batches.append(steps[i:i + batch_size])
        return batches

    async def execute_with_retry(
        self,
        agent: BaseAgent,
        plan: List[PlanStep],
        max_retries: int = 3
    ) -> Dict[str, Any]:
        """
        Execute a plan with automatic retries for failed steps.
        """
        for attempt in range(max_retries + 1):
            try:
                result = await self.execute(agent, plan)

                # Check if all steps were successful
                failed_steps = [
                    step_id for step_id, status in result["step_status"].items()
                    if status == "failed"
                ]

                if not failed_steps:
                    logger.info(f"Plan executed successfully on attempt {attempt + 1}")
                    return result
                else:
                    logger.warning(f"Attempt {attempt + 1} had failed steps: {failed_steps}")
                    if attempt == max_retries:
                        logger.error(f"All {max_retries + 1} attempts failed")
                        return result

            except Exception as e:
                logger.error(f"Attempt {attempt + 1} failed with error: {str(e)}")
                if attempt == max_retries:
                    raise e
                await asyncio.sleep(2 ** attempt)  # Exponential backoff

        return result

    async def execute_tool(
        self,
        agent: BaseAgent,
        tool_name: str,
        parameters: Dict[str, Any]
    ) -> Any:
        """
        Execute a single tool directly without going through planning.
        """
        tool = self._find_tool(agent, tool_name)

        if not tool:
            raise ToolExecutionError(f"Agent {agent.id} does not have tool '{tool_name}'")

        try:
            if asyncio.iscoroutinefunction(tool):
                return await tool(**parameters)
            else:
                return tool(**parameters)
        except Exception as e:
            logger.error(f"Tool {tool_name} execution failed: {str(e)}")
            raise ToolExecutionError(f"Tool execution failed: {str(e)}")
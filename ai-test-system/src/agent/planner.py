"""
Agent planner for the AI automation storage test platform.
Responsible for creating execution plans based on goals and available tools.
"""
import asyncio
import logging
from typing import Dict, List, Any, Optional
from enum import Enum

from .base_agent import BaseAgent
from .models.agent import AgentModel
from ..core.exceptions import PlanningError


logger = logging.getLogger(__name__)


class PlanStep:
    """
    Represents a single step in an agent's plan.
    """

    def __init__(
        self,
        step_id: str,
        description: str,
        tool_name: str,
        parameters: Dict[str, Any],
        dependencies: List[str] = None,
        expected_outcome: str = ""
    ):
        self.step_id = step_id
        self.description = description
        self.tool_name = tool_name
        self.parameters = parameters
        self.dependencies = dependencies or []
        self.expected_outcome = expected_outcome
        self.actual_outcome: Optional[str] = None
        self.status: str = "pending"  # pending, executing, completed, failed


class AgentPlanner:
    """
    Planner that generates execution plans for agents based on goals and tools.
    """

    def __init__(self):
        self.planning_strategies = {
            "sequential": self._create_sequential_plan,
            "parallelizable": self._create_parallelizable_plan,
            "conditional": self._create_conditional_plan
        }

    async def plan(self, agent: 'BaseAgent', task_description: str) -> List[PlanStep]:
        """
        Generate a plan for the agent to execute the given task.
        """
        logger.info(f"Creating plan for agent {agent.id} to perform: {task_description}")

        # Determine the most appropriate planning strategy based on the task
        strategy = self._determine_strategy(task_description)

        # Generate the plan using the selected strategy
        plan = await self.planning_strategies[strategy](agent, task_description)

        logger.info(f"Generated plan with {len(plan)} steps for agent {agent.id}")

        return plan

    def _determine_strategy(self, task_description: str) -> str:
        """
        Determine the most appropriate planning strategy based on the task description.
        """
        task_lower = task_description.lower()

        # Check for conditional keywords
        if any(keyword in task_lower for keyword in ["if", "when", "condition", "depends"]):
            return "conditional"

        # Check for parallelization opportunities
        if any(keyword in task_lower for keyword in ["parallel", "simultaneously", "at the same time"]):
            return "parallelizable"

        # Default to sequential
        return "sequential"

    async def _create_sequential_plan(self, agent: 'BaseAgent', task_description: str) -> List[PlanStep]:
        """
        Create a sequential plan where steps are executed one after another.
        """
        # In a real implementation, this would involve more sophisticated
        # parsing and planning logic, potentially using LLMs
        # For now, we'll create a simple plan based on common patterns

        steps = []

        # Example: if it's a test task, create steps for preparation, execution, and validation
        task_lower = task_description.lower()

        if "test" in task_lower:
            # Add preparation step
            steps.append(PlanStep(
                step_id="prep_1",
                description="Prepare test environment",
                tool_name="prepare_environment",
                parameters={"task": task_description},
                expected_outcome="Test environment is ready"
            ))

            # Add execution step
            steps.append(PlanStep(
                step_id="exec_1",
                description="Execute the test",
                tool_name="execute_test",
                parameters={"task": task_description},
                dependencies=["prep_1"],
                expected_outcome="Test is executed"
            ))

            # Add validation step
            steps.append(PlanStep(
                step_id="valid_1",
                description="Validate test results",
                tool_name="validate_results",
                parameters={"task": task_description},
                dependencies=["exec_1"],
                expected_outcome="Test results are validated"
            ))
        elif "analyze" in task_lower or "analysis" in task_lower:
            # Add data collection step
            steps.append(PlanStep(
                step_id="collect_1",
                description="Collect relevant data",
                tool_name="collect_data",
                parameters={"task": task_description},
                expected_outcome="Data is collected"
            ))

            # Add analysis step
            steps.append(PlanStep(
                step_id="analyze_1",
                description="Analyze the collected data",
                tool_name="analyze_data",
                parameters={"task": task_description},
                dependencies=["collect_1"],
                expected_outcome="Data analysis is complete"
            ))

            # Add reporting step
            steps.append(PlanStep(
                step_id="report_1",
                description="Generate analysis report",
                tool_name="generate_report",
                parameters={"task": task_description},
                dependencies=["analyze_1"],
                expected_outcome="Analysis report is generated"
            ))
        elif "repair" in task_lower or "fix" in task_lower:
            # Add diagnosis step
            steps.append(PlanStep(
                step_id="diagnose_1",
                description="Diagnose the issue",
                tool_name="diagnose_issue",
                parameters={"task": task_description},
                expected_outcome="Issue is diagnosed"
            ))

            # Add repair step
            steps.append(PlanStep(
                step_id="repair_1",
                description="Perform repair action",
                tool_name="perform_repair",
                parameters={"task": task_description},
                dependencies=["diagnose_1"],
                expected_outcome="Repair is performed"
            ))

            # Add verification step
            steps.append(PlanStep(
                step_id="verify_1",
                description="Verify repair success",
                tool_name="verify_repair",
                parameters={"task": task_description},
                dependencies=["repair_1"],
                expected_outcome="Repair success is verified"
            ))
        else:
            # Generic plan for unknown task types
            steps.append(PlanStep(
                step_id="identify_1",
                description="Identify appropriate tools and approach",
                tool_name="identify_approach",
                parameters={"task": task_description},
                expected_outcome="Appropriate tools and approach identified"
            ))

            steps.append(PlanStep(
                step_id="execute_1",
                description="Execute the task using identified approach",
                tool_name="execute_task",
                parameters={"task": task_description},
                dependencies=["identify_1"],
                expected_outcome="Task is executed"
            ))

        return steps

    async def _create_parallelizable_plan(self, agent: 'BaseAgent', task_description: str) -> List[PlanStep]:
        """
        Create a plan that can be partially executed in parallel.
        """
        # Identify steps that can run in parallel
        steps = []

        # For parallelizable tasks, we might split into multiple subtasks
        # that can run simultaneously
        if "test" in task_description.lower():
            # Run multiple tests in parallel
            steps.append(PlanStep(
                step_id="test_1",
                description="Execute first test in parallel",
                tool_name="execute_test",
                parameters={"task": task_description, "subset": "part_1"},
                expected_outcome="First part of test executed"
            ))

            steps.append(PlanStep(
                step_id="test_2",
                description="Execute second test in parallel",
                tool_name="execute_test",
                parameters={"task": task_description, "subset": "part_2"},
                expected_outcome="Second part of test executed"
            ))

            # Combine results
            steps.append(PlanStep(
                step_id="combine_1",
                description="Combine parallel test results",
                tool_name="combine_results",
                parameters={"task": task_description},
                dependencies=["test_1", "test_2"],
                expected_outcome="Results combined"
            ))
        else:
            # Fall back to sequential for other tasks
            return await self._create_sequential_plan(agent, task_description)

        return steps

    async def _create_conditional_plan(self, agent: 'BaseAgent', task_description: str) -> List[PlanStep]:
        """
        Create a plan with conditional steps based on outcomes.
        """
        steps = []

        # Start with an initial assessment
        steps.append(PlanStep(
            step_id="assess_1",
            description="Assess the situation",
            tool_name="assess_situation",
            parameters={"task": task_description},
            expected_outcome="Situation assessed, next step determined"
        ))

        # Conditional step 1: If condition A, then action A
        steps.append(PlanStep(
            step_id="cond_a_1",
            description="Conditional action for scenario A",
            tool_name="action_scenario_a",
            parameters={"task": task_description},
            dependencies=["assess_1"],
            expected_outcome="Action for scenario A completed"
        ))

        # Conditional step 2: If condition B, then action B
        steps.append(PlanStep(
            step_id="cond_b_1",
            description="Conditional action for scenario B",
            tool_name="action_scenario_b",
            parameters={"task": task_description},
            dependencies=["assess_1"],
            expected_outcome="Action for scenario B completed"
        ))

        # Finalize based on which action was taken
        steps.append(PlanStep(
            step_id="finalize_1",
            description="Finalize the task",
            tool_name="finalize_task",
            parameters={"task": task_description},
            dependencies=["cond_a_1", "cond_b_1"],  # Both conditions feed into finalization
            expected_outcome="Task finalized"
        ))

        return steps

    async def validate_plan(self, plan: List[PlanStep], agent: 'BaseAgent') -> bool:
        """
        Validate a plan to ensure it's executable with the agent's tools.
        """
        for step in plan:
            # Check if the agent has the required tool
            tool_names = [str(tool) for tool in agent.tools]
            if step.tool_name not in tool_names:
                logger.warning(f"Agent {agent.id} lacks required tool: {step.tool_name}")
                return False

        return True

    async def optimize_plan(self, plan: List[PlanStep]) -> List[PlanStep]:
        """
        Optimize a plan by potentially combining steps or changing execution order.
        """
        # Simple optimization: merge consecutive steps that use the same tool
        optimized_plan = []
        i = 0

        while i < len(plan):
            current_step = plan[i]

            # Check if the next step uses the same tool
            if i + 1 < len(plan) and plan[i + 1].tool_name == current_step.tool_name:
                # Merge steps that use the same tool
                merged_step = PlanStep(
                    step_id=f"merged_{current_step.step_id}_{plan[i+1].step_id}",
                    description=f"{current_step.description} and {plan[i+1].description}",
                    tool_name=current_step.tool_name,
                    parameters={**current_step.parameters, **plan[i+1].parameters},
                    dependencies=list(set(current_step.dependencies + plan[i+1].dependencies)),
                    expected_outcome=f"{current_step.expected_outcome} and {plan[i+1].expected_outcome}"
                )
                optimized_plan.append(merged_step)
                i += 2  # Skip the next step since we merged it
            else:
                optimized_plan.append(current_step)
                i += 1

        return optimized_plan
"""
Agent Engine module for the AI automation storage test platform.
Manages autonomous agents including TestAgent, AnalysisAgent, and RepairAgent.
"""
import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Any, Optional, Callable
from enum import Enum

from ..core.types import AgentRole
from ..core.exceptions import AgentException, PlanningError, ExecutionError
from .models.agent import AgentModel
from .memory.short_memory import ShortTermMemory
from .memory.long_memory import LongTermMemory
from .planner import AgentPlanner
from .executor import AgentExecutor
from .base_agent import BaseAgent, TestAgent, AnalysisAgent, RepairAgent


logger = logging.getLogger(__name__)


class AgentEngine:
    """
    Main engine for managing autonomous agents in the system.
    """

    def __init__(self):
        self.agents: Dict[str, 'BaseAgent'] = {}
        self.planner = AgentPlanner()
        self.executor = AgentExecutor()
        self.short_term_memory = ShortTermMemory()
        self.long_term_memory = LongTermMemory()

    def register_agent(self, agent: 'BaseAgent') -> None:
        """
        Register an agent with the engine.
        """
        self.agents[agent.id] = agent
        logger.info(f"Agent {agent.id} ({agent.role.value}) registered")

    def unregister_agent(self, agent_id: str) -> bool:
        """
        Unregister an agent from the engine.
        """
        if agent_id in self.agents:
            del self.agents[agent_id]
            logger.info(f"Agent {agent_id} unregistered")
            return True
        return False

    async def create_agent(
        self,
        agent_id: str,
        role: AgentRole,
        name: str,
        description: str = "",
        initial_goals: Optional[List[str]] = None,
        tools: Optional[List[Callable]] = None
    ) -> 'BaseAgent':
        """
        Create and register a new agent.
        """
        if initial_goals is None:
            initial_goals = []
        if tools is None:
            tools = []

        if role == AgentRole.TEST:
            agent = TestAgent(
                id=agent_id,
                name=name,
                description=description,
                goals=initial_goals,
                tools=tools
            )
        elif role == AgentRole.ANALYSIS:
            agent = AnalysisAgent(
                id=agent_id,
                name=name,
                description=description,
                goals=initial_goals,
                tools=tools
            )
        elif role == AgentRole.REPAIR:
            agent = RepairAgent(
                id=agent_id,
                name=name,
                description=description,
                goals=initial_goals,
                tools=tools
            )
        else:
            raise AgentException(f"Unknown agent role: {role}")

        self.register_agent(agent)
        return agent

    async def execute_agent_task(self, agent_id: str, task_description: str) -> Dict[str, Any]:
        """
        Execute a task for a specific agent.
        """
        if agent_id not in self.agents:
            raise AgentException(f"Agent {agent_id} not found")

        agent = self.agents[agent_id]

        try:
            # Plan the task
            plan = await self.planner.plan(agent, task_description)
            logger.info(f"Agent {agent_id} created plan for task: {task_description[:50]}...")

            # Execute the plan
            result = await self.executor.execute(agent, plan)
            logger.info(f"Agent {agent_id} completed task: {task_description[:50]}...")

            # Update memories
            await self._update_memories(agent_id, task_description, plan, result)

            return {
                "success": True,
                "agent_id": agent_id,
                "task": task_description,
                "plan": plan,
                "result": result,
                "timestamp": datetime.now().isoformat()
            }

        except Exception as e:
            logger.error(f"Agent {agent_id} failed to execute task: {str(e)}")
            return {
                "success": False,
                "agent_id": agent_id,
                "task": task_description,
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }

    async def _update_memories(self, agent_id: str, task: str, plan: Any, result: Any) -> None:
        """
        Update both short-term and long-term memories based on task execution.
        """
        memory_entry = {
            "agent_id": agent_id,
            "task": task,
            "plan": plan,
            "result": result,
            "timestamp": datetime.now().isoformat()
        }

        # Update short-term memory (volatile, session-based)
        self.short_term_memory.store(f"{agent_id}_task_{datetime.now().timestamp()}", memory_entry)

        # Update long-term memory (persistent, learning-based)
        await self.long_term_memory.store_experience(memory_entry)

    async def get_agent_status(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """
        Get the status of a specific agent.
        """
        if agent_id not in self.agents:
            return None

        agent = self.agents[agent_id]
        return {
            "id": agent.id,
            "name": agent.name,
            "role": agent.role.value,
            "description": agent.description,
            "status": agent.get_status(),
            "goals": agent.goals,
            "tools": [str(tool) for tool in agent.tools],
            "timestamp": datetime.now().isoformat()
        }

    async def get_all_agents_status(self) -> List[Dict[str, Any]]:
        """
        Get status of all registered agents.
        """
        statuses = []
        for agent_id in self.agents:
            status = await self.get_agent_status(agent_id)
            if status:
                statuses.append(status)
        return statuses

    async def get_agent_memory(self, agent_id: str, memory_type: str = "short") -> List[Dict[str, Any]]:
        """
        Retrieve memory entries for a specific agent.
        """
        if memory_type == "short":
            # Return relevant short-term memories
            memories = self.short_term_memory.search(f"{agent_id}_task")
            return [entry for entry in memories if entry.get('agent_id') == agent_id]
        elif memory_type == "long":
            # Return long-term memories for the agent
            return await self.long_term_memory.retrieve_agent_experiences(agent_id)
        else:
            raise AgentException(f"Unknown memory type: {memory_type}")

    async def shutdown(self) -> None:
        """
        Shutdown the agent engine gracefully.
        """
        # Clear memories
        self.short_term_memory.clear()
        await self.long_term_memory.cleanup()

        # Unregister all agents
        agent_ids = list(self.agents.keys())
        for agent_id in agent_ids:
            self.unregister_agent(agent_id)

        logger.info(f"Agent engine shutdown complete. {len(agent_ids)} agents unregistered")
"""
Base agent definitions for the AI automation storage test platform.
"""
from datetime import datetime
from typing import Dict, List, Any, Optional, Callable
from enum import Enum

from ..core.types import AgentRole


class BaseAgent:
    """
    Base class for all agents in the system.
    """

    def __init__(
        self,
        id: str,
        name: str,
        role: AgentRole,
        description: str = "",
        goals: Optional[List[str]] = None,
        tools: Optional[List[Callable]] = None
    ):
        self.id = id
        self.name = name
        self.role = role
        self.description = description
        self.goals = goals or []
        self.tools = tools or []
        self.created_at = datetime.now()
        self.last_activity = datetime.now()

    def add_goal(self, goal: str) -> None:
        """
        Add a goal to the agent's goal list.
        """
        if goal not in self.goals:
            self.goals.append(goal)
            self.last_activity = datetime.now()

    def remove_goal(self, goal: str) -> bool:
        """
        Remove a goal from the agent's goal list.
        """
        if goal in self.goals:
            self.goals.remove(goal)
            self.last_activity = datetime.now()
            return True
        return False

    def add_tool(self, tool: Callable) -> None:
        """
        Add a tool to the agent's tool list.
        """
        if tool not in self.tools:
            self.tools.append(tool)

    def get_status(self) -> str:
        """
        Get the current status of the agent.
        """
        if self.goals:
            return "active"
        else:
            return "idle"


class TestAgent(BaseAgent):
    """
    Agent responsible for executing tests.
    """

    def __init__(
        self,
        id: str,
        name: str,
        description: str = "",
        goals: Optional[List[str]] = None,
        tools: Optional[List[Callable]] = None
    ):
        super().__init__(
            id=id,
            name=name,
            role=AgentRole.TEST,
            description=description or "Responsible for executing tests",
            goals=goals,
            tools=tools
        )


class AnalysisAgent(BaseAgent):
    """
    Agent responsible for analyzing results.
    """

    def __init__(
        self,
        id: str,
        name: str,
        description: str = "",
        goals: Optional[List[str]] = None,
        tools: Optional[List[Callable]] = None
    ):
        super().__init__(
            id=id,
            name=name,
            role=AgentRole.ANALYSIS,
            description=description or "Responsible for analyzing test results",
            goals=goals,
            tools=tools
        )


class RepairAgent(BaseAgent):
    """
    Agent responsible for repairing issues.
    """

    def __init__(
        self,
        id: str,
        name: str,
        description: str = "",
        goals: Optional[List[str]] = None,
        tools: Optional[List[Callable]] = None
    ):
        super().__init__(
            id=id,
            name=name,
            role=AgentRole.REPAIR,
            description=description or "Responsible for repairing identified issues",
            goals=goals,
            tools=tools
        )
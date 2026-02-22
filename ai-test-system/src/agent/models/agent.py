"""
Agent models for the AI automation storage test platform.
"""
from datetime import datetime
from typing import Dict, List, Any, Optional
from ...core.types import AgentRole


class AgentModel:
    """
    Represents an agent in the system with all its properties.
    """

    def __init__(
        self,
        id: str,
        name: str,
        role: AgentRole,
        description: str = "",
        goals: Optional[List[str]] = None,
        tools: Optional[List[str]] = None,
        created_at: Optional[datetime] = None,
        last_activity: Optional[datetime] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        self.id = id
        self.name = name
        self.role = role
        self.description = description
        self.goals = goals or []
        self.tools = tools or []
        self.created_at = created_at or datetime.now()
        self.last_activity = last_activity or datetime.now()
        self.metadata = metadata or {}
        self.updated_at = datetime.now()

    def add_goal(self, goal: str) -> None:
        """
        Add a goal to the agent's goal list.
        """
        if goal not in self.goals:
            self.goals.append(goal)
            self.updated_at = datetime.now()

    def remove_goal(self, goal: str) -> bool:
        """
        Remove a goal from the agent's goal list.
        """
        if goal in self.goals:
            self.goals.remove(goal)
            self.updated_at = datetime.now()
            return True
        return False

    def update_activity(self) -> None:
        """
        Update the last activity timestamp.
        """
        self.last_activity = datetime.now()
        self.updated_at = datetime.now()

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert the agent to a dictionary representation.
        """
        return {
            "id": self.id,
            "name": self.name,
            "role": self.role.value,
            "description": self.description,
            "goals": self.goals,
            "tools": self.tools,
            "created_at": self.created_at.isoformat(),
            "last_activity": self.last_activity.isoformat(),
            "metadata": self.metadata,
            "updated_at": self.updated_at.isoformat()
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'AgentModel':
        """
        Create an AgentModel from a dictionary.
        """
        from ...core.types import AgentRole

        return cls(
            id=data["id"],
            name=data["name"],
            role=AgentRole(data["role"]),
            description=data.get("description", ""),
            goals=data.get("goals", []),
            tools=data.get("tools", []),
            created_at=datetime.fromisoformat(data["created_at"]) if data.get("created_at") else datetime.now(),
            last_activity=datetime.fromisoformat(data["last_activity"]) if data.get("last_activity") else datetime.now(),
            metadata=data.get("metadata", {})
        )


class AgentConfig:
    """
    Configuration for agent behavior and capabilities.
    """

    def __init__(
        self,
        max_iterations: int = 10,
        max_execution_time: int = 300,  # 5 minutes
        confidence_threshold: float = 0.7,
        retry_attempts: int = 3,
        memory_retention_hours: int = 24,
        planning_depth: int = 5,
        tool_usage_timeout: int = 60  # 1 minute
    ):
        self.max_iterations = max_iterations
        self.max_execution_time = max_execution_time  # in seconds
        self.confidence_threshold = confidence_threshold
        self.retry_attempts = retry_attempts
        self.memory_retention_hours = memory_retention_hours
        self.planning_depth = planning_depth
        self.tool_usage_timeout = tool_usage_timeout

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert the configuration to a dictionary.
        """
        return {
            "max_iterations": self.max_iterations,
            "max_execution_time": self.max_execution_time,
            "confidence_threshold": self.confidence_threshold,
            "retry_attempts": self.retry_attempts,
            "memory_retention_hours": self.memory_retention_hours,
            "planning_depth": self.planning_depth,
            "tool_usage_timeout": self.tool_usage_timeout
        }


class AgentTask:
    """
    Represents a task assigned to an agent.
    """

    def __init__(
        self,
        id: str,
        agent_id: str,
        description: str,
        priority: int = 1,
        deadline: Optional[datetime] = None,
        constraints: Optional[List[str]] = None,
        expected_outcomes: Optional[List[str]] = None,
        context: Optional[Dict[str, Any]] = None
    ):
        self.id = id
        self.agent_id = agent_id
        self.description = description
        self.priority = priority
        self.deadline = deadline
        self.constraints = constraints or []
        self.expected_outcomes = expected_outcomes or []
        self.context = context or {}
        self.created_at = datetime.now()
        self.status = "pending"  # pending, in_progress, completed, failed, cancelled
        self.result: Optional[Any] = None
        self.error: Optional[str] = None
        self.started_at: Optional[datetime] = None
        self.completed_at: Optional[datetime] = None

    def start(self) -> None:
        """
        Mark the task as started.
        """
        self.status = "in_progress"
        self.started_at = datetime.now()

    def complete(self, result: Any) -> None:
        """
        Mark the task as completed.
        """
        self.status = "completed"
        self.result = result
        self.completed_at = datetime.now()

    def fail(self, error: str) -> None:
        """
        Mark the task as failed.
        """
        self.status = "failed"
        self.error = error
        self.completed_at = datetime.now()

    def cancel(self) -> None:
        """
        Mark the task as cancelled.
        """
        self.status = "cancelled"
        self.completed_at = datetime.now()

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert the task to a dictionary representation.
        """
        return {
            "id": self.id,
            "agent_id": self.agent_id,
            "description": self.description,
            "priority": self.priority,
            "deadline": self.deadline.isoformat() if self.deadline else None,
            "constraints": self.constraints,
            "expected_outcomes": self.expected_outcomes,
            "context": self.context,
            "created_at": self.created_at.isoformat(),
            "status": self.status,
            "result": self.result,
            "error": self.error,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None
        }
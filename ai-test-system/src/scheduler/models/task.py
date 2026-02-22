"""
Task model for the scheduler module.
"""
from datetime import datetime
from typing import Dict, List, Optional, Any
from ...core.types import TaskStatus


class TaskModel:
    """
    Enhanced model for tasks in the scheduler with additional fields for persistence.
    """

    def __init__(
        self,
        id: str,
        name: str,
        description: str = "",
        status: TaskStatus = TaskStatus.PENDING,
        priority: int = 0,
        dependencies: Optional[List[str]] = None,
        assigned_node: Optional[str] = None,
        created_at: Optional[datetime] = None,
        started_at: Optional[datetime] = None,
        completed_at: Optional[datetime] = None,
        error_message: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        self.id = id
        self.name = name
        self.description = description
        self.status = status
        self.priority = priority
        self.dependencies = dependencies or []
        self.assigned_node = assigned_node
        self.created_at = created_at or datetime.now()
        self.started_at = started_at
        self.completed_at = completed_at
        self.error_message = error_message
        self.metadata = metadata or {}
        self.updated_at = datetime.now()

    def start_execution(self) -> None:
        """
        Mark the task as started.
        """
        self.status = TaskStatus.RUNNING
        self.started_at = datetime.now()
        self.updated_at = datetime.now()

    def complete(self, error_message: Optional[str] = None) -> None:
        """
        Mark the task as completed.
        """
        self.completed_at = datetime.now()
        self.updated_at = datetime.now()

        if error_message:
            self.error_message = error_message
            self.status = TaskStatus.FAILED
        else:
            self.status = TaskStatus.COMPLETED

    def cancel(self) -> None:
        """
        Mark the task as cancelled.
        """
        self.completed_at = datetime.now()
        self.updated_at = datetime.now()
        self.status = TaskStatus.CANCELLED

    def update_status(self, new_status: TaskStatus) -> None:
        """
        Update the task status.
        """
        self.status = new_status
        self.updated_at = datetime.now()

    def add_dependency(self, dependency_id: str) -> None:
        """
        Add a dependency to the task.
        """
        if dependency_id not in self.dependencies:
            self.dependencies.append(dependency_id)
            self.updated_at = datetime.now()

    def remove_dependency(self, dependency_id: str) -> bool:
        """
        Remove a dependency from the task.
        """
        if dependency_id in self.dependencies:
            self.dependencies.remove(dependency_id)
            self.updated_at = datetime.now()
            return True
        return False

    def is_ready(self, completed_dependencies: List[str]) -> bool:
        """
        Check if all dependencies are completed.
        """
        return all(dep in completed_dependencies for dep in self.dependencies)

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert the task to a dictionary representation.
        """
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "status": self.status.value,
            "priority": self.priority,
            "dependencies": self.dependencies,
            "assigned_node": self.assigned_node,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "error_message": self.error_message,
            "metadata": self.metadata,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'TaskModel':
        """
        Create a TaskModel from a dictionary.
        """
        from ...core.types import TaskStatus

        return cls(
            id=data["id"],
            name=data["name"],
            description=data.get("description", ""),
            status=TaskStatus(data["status"]),
            priority=data.get("priority", 0),
            dependencies=data.get("dependencies", []),
            assigned_node=data.get("assigned_node"),
            created_at=datetime.fromisoformat(data["created_at"]) if data.get("created_at") else None,
            started_at=datetime.fromisoformat(data["started_at"]) if data.get("started_at") else None,
            completed_at=datetime.fromisoformat(data["completed_at"]) if data.get("completed_at") else None,
            error_message=data.get("error_message"),
            metadata=data.get("metadata", {})
        )


class ScheduleModel:
    """
    Model representing a scheduled task group or recurring schedule.
    """

    def __init__(
        self,
        id: str,
        name: str,
        cron_expression: str,
        task_template: Dict[str, Any],
        active: bool = True,
        created_at: Optional[datetime] = None,
        last_run: Optional[datetime] = None,
        next_run: Optional[datetime] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        self.id = id
        self.name = name
        self.cron_expression = cron_expression
        self.task_template = task_template
        self.active = active
        self.created_at = created_at or datetime.now()
        self.last_run = last_run
        self.next_run = next_run
        self.metadata = metadata or {}
        self.updated_at = datetime.now()

    def update_next_run(self, next_run_time: datetime) -> None:
        """
        Update the next scheduled run time.
        """
        self.next_run = next_run_time
        self.updated_at = datetime.now()

    def activate(self) -> None:
        """
        Activate the schedule.
        """
        self.active = True
        self.updated_at = datetime.now()

    def deactivate(self) -> None:
        """
        Deactivate the schedule.
        """
        self.active = False
        self.updated_at = datetime.now()

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert the schedule to a dictionary representation.
        """
        return {
            "id": self.id,
            "name": self.name,
            "cron_expression": self.cron_expression,
            "task_template": self.task_template,
            "active": self.active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_run": self.last_run.isoformat() if self.last_run else None,
            "next_run": self.next_run.isoformat() if self.next_run else None,
            "metadata": self.metadata,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }
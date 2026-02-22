"""
Task monitor for tracking task execution status and metrics.
"""
import asyncio
from datetime import datetime
from typing import Dict, List, Callable, Awaitable
from ..core.types import Task, TaskStatus


class TaskMonitor:
    """
    Monitors task execution and provides status updates and metrics.
    """

    def __init__(self):
        self.task_status_callbacks: List[Callable[[Task], Awaitable[None]]] = []
        self.metrics = {
            'total_tasks': 0,
            'completed_tasks': 0,
            'failed_tasks': 0,
            'average_runtime': 0,
            'tasks_by_status': {}
        }

    def subscribe_to_status_changes(self, callback: Callable[[Task], Awaitable[None]]) -> None:
        """
        Subscribe to task status change events.
        """
        self.task_status_callbacks.append(callback)

    def unsubscribe_from_status_changes(self, callback: Callable[[Task], Awaitable[None]]) -> None:
        """
        Unsubscribe from task status change events.
        """
        if callback in self.task_status_callbacks:
            self.task_status_callbacks.remove(callback)

    async def notify_status_change(self, task: Task) -> None:
        """
        Notify all subscribers about a task status change.
        """
        for callback in self.task_status_callbacks:
            try:
                await callback(task)
            except Exception as e:
                # Log error but don't fail the notification process
                print(f"Error in task status callback: {e}")

    def update_metrics(self, task: Task) -> None:
        """
        Update internal metrics based on task status.
        """
        self.metrics['total_tasks'] += 1

        # Update status count
        status_str = task.status.value
        if status_str not in self.metrics['tasks_by_status']:
            self.metrics['tasks_by_status'][status_str] = 0
        self.metrics['tasks_by_status'][status_str] += 1

        # Update completed/failed counts
        if task.status == TaskStatus.COMPLETED:
            self.metrics['completed_tasks'] += 1
            # Calculate average runtime if available
            if task.started_at and task.completed_at:
                runtime = (task.completed_at - task.started_at).total_seconds()
                total_runtime = self.metrics['average_runtime'] * (self.metrics['completed_tasks'] - 1) + runtime
                self.metrics['average_runtime'] = total_runtime / self.metrics['completed_tasks']
        elif task.status == TaskStatus.FAILED:
            self.metrics['failed_tasks'] += 1

    async def get_task_history(self, limit: int = 100) -> List[Task]:
        """
        Get recent task execution history.
        This would typically interface with a persistent store.
        For now, it returns an empty list.
        """
        # In a real implementation, this would query a database
        return []

    def get_current_metrics(self) -> Dict:
        """
        Get current monitoring metrics.
        """
        return self.metrics.copy()

    def get_task_efficiency(self) -> float:
        """
        Calculate task execution efficiency (completed / total attempted).
        """
        if self.metrics['total_tasks'] == 0:
            return 0.0
        return self.metrics['completed_tasks'] / self.metrics['total_tasks']

    def get_failure_rate(self) -> float:
        """
        Calculate task failure rate.
        """
        if self.metrics['total_tasks'] == 0:
            return 0.0
        return self.metrics['failed_tasks'] / self.metrics['total_tasks']

    async def get_active_tasks(self) -> List[Task]:
        """
        Get currently active (non-completed) tasks.
        This would typically interface with a persistent store.
        For now, it returns an empty list.
        """
        # In a real implementation, this would query the scheduler's active task lists
        return []
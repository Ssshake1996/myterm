"""
Scheduler module for the AI automation storage test platform.
Manages task scheduling, priority queues, and execution distribution.
"""
import asyncio
import heapq
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from enum import Enum

from ..core.types import Task, TaskStatus
from ..core.exceptions import TaskSchedulingError
from .models.task import TaskModel
from .queue import PriorityQueue
from .dispatcher import TaskDispatcher


logger = logging.getLogger(__name__)


class Scheduler:
    """
    Main scheduler class that manages task scheduling and execution.
    """

    def __init__(self):
        self.priority_queue = PriorityQueue()
        self.running_tasks: Dict[str, Task] = {}
        self.completed_tasks: Dict[str, Task] = {}
        self.failed_tasks: Dict[str, Task] = {}
        self.dispatcher = TaskDispatcher()
        self._shutdown = False

    async def add_task(self, task: Task) -> None:
        """
        Add a task to the scheduler.
        """
        if self._shutdown:
            raise TaskSchedulingError("Scheduler is shutting down")

        # Check dependencies
        if not await self._check_dependencies(task):
            task.status = TaskStatus.PENDING
            self.priority_queue.put(task)
            logger.info(f"Task {task.id} added to queue with pending dependencies")
            return

        task.status = TaskStatus.QUEUED
        self.priority_queue.put(task)
        logger.info(f"Task {task.id} added to queue with priority {task.priority}")

        # Trigger immediate scheduling check
        await self._schedule_tasks()

    async def _check_dependencies(self, task: Task) -> bool:
        """
        Check if all dependencies for a task are satisfied.
        """
        for dep_id in task.dependencies:
            if dep_id in self.failed_tasks:
                logger.warning(f"Dependency {dep_id} failed, task {task.id} cannot run")
                return False
            if dep_id not in self.completed_tasks:
                logger.debug(f"Dependency {dep_id} not yet completed for task {task.id}")
                return False
        return True

    async def _schedule_tasks(self) -> None:
        """
        Schedule eligible tasks for execution.
        """
        if self._shutdown:
            return

        # Process tasks that have their dependencies met
        pending_tasks = []
        temp_queue = PriorityQueue()

        while not self.priority_queue.empty():
            task = self.priority_queue.get()

            if await self._check_dependencies(task):
                # Dependencies are met, schedule for execution
                await self._dispatch_task(task)
            else:
                # Put back tasks with unmet dependencies
                pending_tasks.append(task)

        # Restore tasks with unmet dependencies to the queue
        for task in pending_tasks:
            self.priority_queue.put(task)

    async def _dispatch_task(self, task: Task) -> None:
        """
        Dispatch a task for execution.
        """
        try:
            task.status = TaskStatus.RUNNING
            task.started_at = datetime.now()

            # Assign to an available execution node
            assigned_node = await self.dispatcher.assign_task(task)
            if assigned_node:
                task.assigned_node = assigned_node
                logger.info(f"Task {task.id} assigned to node {assigned_node}")
            else:
                # No available nodes, put back in queue
                task.status = TaskStatus.QUEUED
                self.priority_queue.put(task)
                return

            # Track running task
            self.running_tasks[task.id] = task

            # Execute task asynchronously
            asyncio.create_task(self._execute_task(task))

        except Exception as e:
            logger.error(f"Failed to dispatch task {task.id}: {str(e)}")
            task.status = TaskStatus.FAILED
            task.error_message = str(e)
            self.failed_tasks[task.id] = task

    async def _execute_task(self, task: Task) -> None:
        """
        Execute a single task.
        """
        try:
            # In a real implementation, this would communicate with execution nodes
            # For now, we'll simulate task execution
            await asyncio.sleep(0.1)  # Simulate some work

            # Mark as completed
            task.status = TaskStatus.COMPLETED
            task.completed_at = datetime.now()

            # Move from running to completed
            del self.running_tasks[task.id]
            self.completed_tasks[task.id] = task

            logger.info(f"Task {task.id} completed successfully")

            # Check for new schedulable tasks
            await self._schedule_tasks()

        except Exception as e:
            logger.error(f"Task {task.id} failed during execution: {str(e)}")
            task.status = TaskStatus.FAILED
            task.completed_at = datetime.now()
            task.error_message = str(e)

            # Move from running to failed
            del self.running_tasks[task.id]
            self.failed_tasks[task.id] = task

    async def get_task_status(self, task_id: str) -> Optional[Task]:
        """
        Get the status of a specific task.
        """
        if task_id in self.running_tasks:
            return self.running_tasks[task_id]
        elif task_id in self.completed_tasks:
            return self.completed_tasks[task_id]
        elif task_id in self.failed_tasks:
            return self.failed_tasks[task_id]
        else:
            # Check if it's in the queue
            # This is a simplified implementation - in reality,
            # we'd need to look through the queue
            return None

    async def cancel_task(self, task_id: str) -> bool:
        """
        Cancel a queued or running task.
        """
        # Check running tasks
        if task_id in self.running_tasks:
            task = self.running_tasks[task_id]
            task.status = TaskStatus.CANCELLED
            task.completed_at = datetime.now()
            self.failed_tasks[task_id] = task
            del self.running_tasks[task_id]
            logger.info(f"Running task {task_id} cancelled")
            return True

        # Check queued tasks
        # Simplified implementation - in reality we'd search the priority queue
        temp_tasks = []
        cancelled = False
        while not self.priority_queue.empty():
            task = self.priority_queue.get()
            if task.id == task_id:
                task.status = TaskStatus.CANCELLED
                task.completed_at = datetime.now()
                self.failed_tasks[task_id] = task
                cancelled = True
                logger.info(f"Queued task {task_id} cancelled")
            else:
                temp_tasks.append(task)

        # Restore non-cancelled tasks
        for task in temp_tasks:
            self.priority_queue.put(task)

        return cancelled

    async def shutdown(self) -> None:
        """
        Shutdown the scheduler gracefully.
        """
        self._shutdown = True

        # Wait for running tasks to complete (with timeout)
        timeout = 30  # seconds
        start_time = datetime.now()

        while len(self.running_tasks) > 0:
            if (datetime.now() - start_time).seconds > timeout:
                logger.warning("Timeout waiting for tasks to complete during shutdown")
                break
            await asyncio.sleep(0.1)

    async def get_stats(self) -> Dict[str, Any]:
        """
        Get scheduler statistics.
        """
        return {
            "queued_tasks": self.priority_queue.qsize(),
            "running_tasks": len(self.running_tasks),
            "completed_tasks": len(self.completed_tasks),
            "failed_tasks": len(self.failed_tasks),
            "timestamp": datetime.now().isoformat()
        }
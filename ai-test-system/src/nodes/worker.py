"""
Worker module for the AI automation storage test platform.
Handles execution of tasks on execution nodes.
"""
import asyncio
import logging
import json
from datetime import datetime
from typing import Dict, Any, Optional, Callable, List
from dataclasses import dataclass

from ..core.exceptions import ExecutionError
from ..tools.base import ToolManager


logger = logging.getLogger(__name__)


@dataclass
class WorkerTask:
    """
    Represents a task that is being executed by a worker.
    """
    id: str
    name: str
    description: str
    task_type: str  # 'flow', 'agent', 'tool', etc.
    parameters: Dict[str, Any]
    assigned_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    status: str = 'pending'  # 'pending', 'running', 'completed', 'failed', 'cancelled'
    result: Optional[Any] = None
    error: Optional[str] = None


class Worker:
    """
    Executes tasks assigned to a node.
    """

    def __init__(self, node_id: str, tool_manager: Optional[ToolManager] = None):
        self.node_id = node_id
        self.tool_manager = tool_manager or ToolManager()
        self.current_task: Optional[WorkerTask] = None
        self.task_history: List[WorkerTask] = []
        self._running = False
        self._worker_task: Optional[asyncio.Task] = None

    async def start(self):
        """
        Start the worker.
        """
        if self._running:
            return

        self._running = True
        logger.info(f"Worker started on node {self.node_id}")

    async def stop(self):
        """
        Stop the worker.
        """
        self._running = False
        if self.current_task and self.current_task.status == 'running':
            await self.cancel_task(self.current_task.id)

        logger.info(f"Worker stopped on node {self.node_id}")

    async def execute_task(self, task: WorkerTask) -> WorkerTask:
        """
        Execute a task and return the updated task object.
        """
        if self.current_task and self.current_task.status == 'running':
            raise ExecutionError(f"Worker already executing task {self.current_task.id}")

        self.current_task = task
        task.started_at = datetime.now()
        task.status = 'running'

        try:
            logger.info(f"Starting execution of task {task.id} on node {self.node_id}")

            # Execute based on task type
            if task.task_type == 'tool':
                result = await self._execute_tool_task(task)
            elif task.task_type == 'agent':
                result = await self._execute_agent_task(task)
            elif task.task_type == 'flow':
                result = await self._execute_flow_task(task)
            else:
                raise ExecutionError(f"Unknown task type: {task.task_type}")

            task.result = result
            task.status = 'completed'
            task.completed_at = datetime.now()

            logger.info(f"Task {task.id} completed successfully on node {self.node_id}")

        except Exception as e:
            logger.error(f"Task {task.id} failed on node {self.node_id}: {str(e)}")
            task.error = str(e)
            task.status = 'failed'
            task.completed_at = datetime.now()

        finally:
            # Add to history
            self.task_history.append(task)

            # Keep only the last 100 tasks in history
            if len(self.task_history) > 100:
                self.task_history = self.task_history[-100:]

            # Clear current task
            self.current_task = None

        return task

    async def _execute_tool_task(self, task: WorkerTask) -> Any:
        """
        Execute a tool-based task.
        """
        tool_name = task.parameters.get('tool_name')
        if not tool_name:
            raise ExecutionError("Tool name not specified in task parameters")

        tool_params = task.parameters.get('tool_params', {})

        logger.debug(f"Executing tool {tool_name} with parameters: {tool_params}")

        # Execute the tool
        result = await self.tool_manager.execute_tool(tool_name, **tool_params)
        return result

    async def _execute_agent_task(self, task: WorkerTask) -> Any:
        """
        Execute an agent-based task.
        For now, this is simulated as agents would be handled by the Agent Engine in a real implementation.
        """
        agent_name = task.parameters.get('agent_name')
        agent_task = task.parameters.get('agent_task', 'default_task')

        logger.debug(f"Executing agent {agent_name} with task: {agent_task}")

        # Simulate agent execution
        # In a real implementation, this would interface with the Agent Engine
        await asyncio.sleep(1)  # Simulate processing time

        # Mock result based on the agent and task
        result = {
            "agent": agent_name,
            "task": agent_task,
            "status": "completed",
            "message": f"Simulated execution of {agent_task} by {agent_name}",
            "execution_time": 1.0,
            "details": {
                "node": self.node_id,
                "task_id": task.id
            }
        }

        return result

    async def _execute_flow_task(self, task: WorkerTask) -> Any:
        """
        Execute a flow-based task.
        For now, this is simulated as flows would be handled by the Flow Engine in a real implementation.
        """
        flow_name = task.parameters.get('flow_name')
        flow_params = task.parameters.get('flow_params', {})

        logger.debug(f"Executing flow {flow_name} with parameters: {flow_params}")

        # Simulate flow execution
        # In a real implementation, this would interface with the Flow Engine
        await asyncio.sleep(2)  # Simulate processing time for flow

        # Mock result based on the flow
        result = {
            "flow": flow_name,
            "status": "completed",
            "message": f"Simulated execution of flow {flow_name}",
            "execution_time": 2.0,
            "steps_completed": flow_params.get('expected_steps', 5),
            "details": {
                "node": self.node_id,
                "task_id": task.id
            }
        }

        return result

    async def cancel_task(self, task_id: str) -> bool:
        """
        Cancel a running task.
        """
        if not self.current_task or self.current_task.id != task_id:
            logger.warning(f"Cannot cancel task {task_id}, it's not currently running")
            return False

        logger.info(f"Cancelling task {task_id} on node {self.node_id}")

        # In a real implementation, we would cancel the running asyncio task
        # For now, we'll just mark it as cancelled
        self.current_task.status = 'cancelled'
        self.current_task.completed_at = datetime.now()

        # Add to history
        self.task_history.append(self.current_task)

        # Keep only the last 100 tasks in history
        if len(self.task_history) > 100:
            self.task_history = self.task_history[-100:]

        self.current_task = None

        return True

    async def get_worker_status(self) -> Dict[str, Any]:
        """
        Get the status of the worker.
        """
        current_task_info = None
        if self.current_task:
            current_task_info = {
                "id": self.current_task.id,
                "name": self.current_task.name,
                "status": self.current_task.status,
                "started_at": self.current_task.started_at.isoformat() if self.current_task.started_at else None,
                "elapsed_time": (datetime.now() - self.current_task.started_at).total_seconds() if self.current_task.started_at else None
            }

        return {
            "node_id": self.node_id,
            "worker_running": self._running,
            "current_task": current_task_info,
            "total_tasks_completed": len([t for t in self.task_history if t.status == 'completed']),
            "total_tasks_failed": len([t for t in self.task_history if t.status == 'failed']),
            "total_tasks_cancelled": len([t for t in self.task_history if t.status == 'cancelled']),
            "recent_tasks": [
                {
                    "id": t.id,
                    "name": t.name,
                    "status": t.status,
                    "completed_at": t.completed_at.isoformat() if t.completed_at else None
                }
                for t in self.task_history[-5:]  # Last 5 tasks
            ] if self.task_history else [],
            "timestamp": datetime.now().isoformat()
        }

    async def get_task_result(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        Get the result of a completed task.
        """
        # Check current task
        if self.current_task and self.current_task.id == task_id:
            return {
                "id": self.current_task.id,
                "status": self.current_task.status,
                "result": self.current_task.result,
                "error": self.current_task.error,
                "current": True
            }

        # Check task history
        for task in self.task_history:
            if task.id == task_id:
                return {
                    "id": task.id,
                    "status": task.status,
                    "result": task.result,
                    "error": task.error,
                    "completed_at": task.completed_at.isoformat() if task.completed_at else None,
                    "current": False
                }

        return None

    async def cleanup_completed_tasks(self) -> int:
        """
        Clean up completed tasks from history that are older than a threshold.
        """
        cutoff_time = datetime.now()
        removed_count = 0

        # For demo purposes, we'll just keep the last 50 tasks
        if len(self.task_history) > 50:
            self.task_history = self.task_history[-50:]
            removed_count = len([t for t in self.task_history if t.status in ['completed', 'failed']])

        return removed_count


class TaskQueue:
    """
    Queue for managing tasks to be executed by workers.
    """

    def __init__(self, maxsize: int = 0):
        self.queue = asyncio.Queue(maxsize=maxsize)

    async def put(self, task: WorkerTask) -> None:
        """
        Add a task to the queue.
        """
        await self.queue.put(task)

    async def get(self) -> WorkerTask:
        """
        Get a task from the queue (blocks until available).
        """
        return await self.queue.get()

    def empty(self) -> bool:
        """
        Check if the queue is empty.
        """
        return self.queue.empty()

    def qsize(self) -> int:
        """
        Get the size of the queue.
        """
        return self.queue.qsize()

    async def join(self) -> None:
        """
        Block until all items in the queue have been processed.
        """
        await self.queue.join()
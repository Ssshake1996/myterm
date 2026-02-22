"""
Test file for the Scheduler module.
"""
import asyncio
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from datetime import datetime
from ai_test_system.src.scheduler.scheduler import Scheduler
from ai_test_system.src.scheduler.models.task import TaskModel
from ai_test_system.src.core.types import Task, TaskStatus
from ai_test_system.src.core.types import NodeInfo


async def test_scheduler():
    """Test the basic functionality of the Scheduler module."""
    print("Initializing scheduler...")
    scheduler = Scheduler()

    # Create some test nodes
    node1 = NodeInfo(
        id="node1",
        name="Execution Node 1",
        address="localhost",
        port=8080,
        status="active",
        last_heartbeat=datetime.now(),
        capacity=10,
        load=0,
        metadata={}
    )

    node2 = NodeInfo(
        id="node2",
        name="Execution Node 2",
        address="localhost",
        port=8081,
        status="active",
        last_heartbeat=datetime.now(),
        capacity=5,
        load=0,
        metadata={}
    )

    # Register nodes with the dispatcher
    scheduler.dispatcher.register_node(node1)
    scheduler.dispatcher.register_node(node2)

    print("Nodes registered successfully")

    # Create some test tasks
    task1 = Task(
        id="task1",
        name="Test Task 1",
        description="First test task",
        status=TaskStatus.PENDING,
        priority=1,
        dependencies=[],
        assigned_node=None,
        created_at=datetime.now(),
        started_at=None,
        completed_at=None,
        error_message=None,
        metadata={}
    )

    task2 = Task(
        id="task2",
        name="Test Task 2",
        description="Second test task with higher priority",
        status=TaskStatus.PENDING,
        priority=5,  # Higher priority
        dependencies=["task1"],  # Depends on task1
        assigned_node=None,
        created_at=datetime.now(),
        started_at=None,
        completed_at=None,
        error_message=None,
        metadata={}
    )

    task3 = Task(
        id="task3",
        name="Test Task 3",
        description="Third test task with medium priority",
        status=TaskStatus.PENDING,
        priority=3,  # Medium priority
        dependencies=[],
        assigned_node=None,
        created_at=datetime.now(),
        started_at=None,
        completed_at=None,
        error_message=None,
        metadata={}
    )

    print("Adding tasks to scheduler...")
    await scheduler.add_task(task1)
    await scheduler.add_task(task2)  # This should remain pending due to dependency
    await scheduler.add_task(task3)

    print(f"Initial queue size: {scheduler.priority_queue.qsize()}")
    print(f"Tasks in queue: {[t.id for t in scheduler.priority_queue._queue]}")

    # Simulate task1 completion to allow task2 to run
    print("\nSimulating completion of task1 to unlock task2...")
    task1.status = TaskStatus.COMPLETED
    task1.completed_at = datetime.now()
    scheduler.completed_tasks[task1.id] = task1

    # Re-schedule to process dependencies
    await scheduler._schedule_tasks()

    print(f"After dependency resolution:")
    print(f"Queue size: {scheduler.priority_queue.qsize()}")
    print(f"Running tasks: {list(scheduler.running_tasks.keys())}")

    # Check scheduler stats
    stats = await scheduler.get_stats()
    print(f"\nScheduler stats: {stats}")

    # Wait a moment for tasks to potentially execute
    await asyncio.sleep(0.5)

    # Check final states
    for task_id in ["task1", "task2", "task3"]:
        status = await scheduler.get_task_status(task_id)
        if status:
            print(f"Task {task_id}: {status.status}")

    # Test cancellation
    print("\nTesting task cancellation...")
    cancel_result = await scheduler.cancel_task("task1")
    print(f"Cancel result for task1: {cancel_result}")

    # Final stats
    final_stats = await scheduler.get_stats()
    print(f"\nFinal scheduler stats: {final_stats}")

    print("\nScheduler tests completed!")


if __name__ == "__main__":
    asyncio.run(test_scheduler())
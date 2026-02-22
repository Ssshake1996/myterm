"""
Test file for the State Store module.
"""
import asyncio
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from datetime import datetime
from ai_test_system.src.storage.database import CombinedStorage
from ai_test_system.src.storage.models import TaskState, FlowState, AgentState, AuditLog
from ai_test_system.src.core.types import TaskStatus, FlowStatus


async def test_state_store():
    """Test the basic functionality of the State Store module."""
    print("Initializing Combined Storage...")
    storage = CombinedStorage()

    # Initialize the storage
    await storage.initialize()
    print("✓ Storage initialized")

    # Test TaskState operations
    print("\\nTesting TaskState operations...")
    task_state = TaskState(
        id="task1",
        name="Test Task 1",
        description="A test task for state management",
        status=TaskStatus.PENDING,
        priority=1,
        dependencies=[],
        assigned_node="node1",
        created_at=datetime.now(),
        started_at=None,
        completed_at=None,
        error_message=None,
        metadata={"test": True, "version": "1.0"}
    )

    # Save task state
    save_result = await storage.save_task_state(task_state)
    print(f"✓ Saved task state: {save_result}")

    # Retrieve task state
    retrieved_task = await storage.get_task_state("task1")
    if retrieved_task:
        print(f"✓ Retrieved task state: {retrieved_task.name}")
        print(f"  - Status: {retrieved_task.status.value}")
        print(f"  - Priority: {retrieved_task.priority}")

    # Test FlowState operations
    print("\\nTesting FlowState operations...")
    flow_state = FlowState(
        id="flow1",
        flow_definition_id="definition1",
        status=FlowStatus.RUNNING,
        started_at=datetime.now(),
        completed_at=None,
        node_executions={"node1": {"status": "completed"}},
        variables={"test_var": "test_value"},
        metadata={"test": True, "version": "1.0"}
    )

    # Save flow state
    save_result = await storage.save_flow_state(flow_state)
    print(f"✓ Saved flow state: {save_result}")

    # Retrieve flow state
    retrieved_flow = await storage.get_flow_state("flow1")
    if retrieved_flow:
        print(f"✓ Retrieved flow state: {retrieved_flow.id}")
        print(f"  - Status: {retrieved_flow.status.value}")
        print(f"  - Node executions: {len(retrieved_flow.node_executions)}")

    # Test AgentState operations
    print("\\nTesting AgentState operations...")
    agent_state = AgentState(
        id="agent1",
        name="Test Agent 1",
        role="test",
        description="A test agent for state management",
        status="active",
        goals=["test goal 1", "test goal 2"],
        tools=["tool1", "tool2"],
        created_at=datetime.now(),
        last_activity=datetime.now(),
        metadata={"test": True, "version": "1.0"}
    )

    # Save agent state
    save_result = await storage.save_agent_state(agent_state)
    print(f"✓ Saved agent state: {save_result}")

    # Retrieve agent state
    retrieved_agent = await storage.get_agent_state("agent1")
    if retrieved_agent:
        print(f"✓ Retrieved agent state: {retrieved_agent.name}")
        print(f"  - Role: {retrieved_agent.role}")
        print(f"  - Goals: {len(retrieved_agent.goals)}")

    # Test AuditLog operations
    print("\\nTesting AuditLog operations...")
    audit_log = AuditLog(
        id="log1",
        timestamp=datetime.now(),
        event_type="task_created",
        actor="system",
        action="create",
        resource_type="task",
        resource_id="task1",
        details={"task_name": "Test Task 1", "priority": 1},
        metadata={"test": True, "version": "1.0"}
    )

    # Save audit log
    save_result = await storage.save_audit_log(audit_log)
    print(f"✓ Saved audit log: {save_result}")

    # Retrieve audit logs
    audit_logs = await storage.get_audit_logs(limit=10)
    print(f"✓ Retrieved {len(audit_logs)} audit logs")

    # Test transient data operations
    print("\\nTesting Transient Data operations...")
    trans_save = await storage.save_transient_data("temp_key", {"data": "test_value"}, ttl=300)
    print(f"✓ Saved transient data: {trans_save}")

    trans_get = await storage.get_transient_data("temp_key")
    print(f"✓ Retrieved transient data: {trans_get}")

    trans_del = await storage.delete_transient_data("temp_key")
    print(f"✓ Deleted transient data: {trans_del}")

    # Test refreshing cache
    print("\\nTesting Cache Refresh operations...")
    refresh_task = await storage.refresh_cache_for_task("task1")
    print(f"✓ Refreshed task cache: {refresh_task}")

    refresh_flow = await storage.refresh_cache_for_flow("flow1")
    print(f"✓ Refreshed flow cache: {refresh_flow}")

    refresh_agent = await storage.refresh_cache_for_agent("agent1")
    print(f"✓ Refreshed agent cache: {refresh_agent}")

    # Test storage stats
    print("\\nTesting Storage Stats...")
    stats = await storage.get_storage_stats()
    print(f"✓ Got storage stats:")
    print(f"  - PostgreSQL connected: {stats['postgres']['connected']}")
    print(f"  - Redis connected: {stats['redis']['connected']}")
    print(f"  - Cached tasks: {stats['redis']['cached_items']['tasks']}")
    print(f"  - Cached flows: {stats['redis']['cached_items']['flows']}")
    print(f"  - Cached agents: {stats['redis']['cached_items']['agents']}")

    print("\\nState Store tests completed!")


if __name__ == "__main__":
    asyncio.run(test_state_store())
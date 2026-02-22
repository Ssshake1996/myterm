"""
Test file for the Execution Nodes module.
"""
import asyncio
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from datetime import datetime
from ai_test_system.src.nodes.manager import NodeManager
from ai_test_system.src.nodes.heartbeat import HeartbeatMonitor, NodeHealthChecker
from ai_test_system.src.nodes.worker import Worker, WorkerTask
from ai_test_system.src.core.types import NodeInfo
from ai_test_system.src.tools.base import ToolManager
from ai_test_system.src.tools.knowledge_tool import KnowledgeTool


async def test_execution_nodes():
    """Test the basic functionality of the Execution Nodes module."""
    print("Initializing Node Manager...")
    node_manager = NodeManager()

    # Create a tool manager and add a test tool for the worker
    print("\\nSetting up Tool Manager...")
    tool_manager = ToolManager()
    knowledge_tool = KnowledgeTool()
    tool_manager.register_tool(knowledge_tool, "knowledge")
    print(f"✓ Registered tool: {knowledge_tool.name}")

    # Create a worker
    print("\\nCreating Worker...")
    worker = Worker(node_id="worker_node_1", tool_manager=tool_manager)
    await worker.start()
    print(f"✓ Created and started worker: {worker.node_id}")

    # Test node registration
    print("\\nTesting Node Registration...")
    node1 = NodeInfo(
        id="node1",
        name="Execution Node 1",
        address="192.168.1.10",
        port=8080,
        status="active",
        last_heartbeat=datetime.now(),
        capacity=10,
        load=0,
        metadata={"region": "us-east", "type": "compute"}
    )

    success = await node_manager.register_node(node1)
    print(f"✓ Node registration: {success}")

    node2 = NodeInfo(
        id="node2",
        name="Execution Node 2",
        address="192.168.1.11",
        port=8080,
        status="active",
        last_heartbeat=datetime.now(),
        capacity=5,
        load=0,
        metadata={"region": "us-west", "type": "storage"}
    )

    success = await node_manager.register_node(node2)
    print(f"✓ Node registration: {success}")

    # Test heartbeat
    print("\\nTesting Heartbeat...")
    heartbeat_success = await node_manager.heartbeat("node1")
    print(f"✓ Heartbeat from node1: {heartbeat_success}")

    heartbeat_success = await node_manager.heartbeat("node2")
    print(f"✓ Heartbeat from node2: {heartbeat_success}")

    # Test node status
    print("\\nTesting Node Status...")
    node1_status = await node_manager.get_node_status("node1")
    if node1_status:
        print(f"✓ Node1 status: {node1_status['status']}, load: {node1_status['load']}")

    all_statuses = await node_manager.get_all_nodes_status()
    print(f"✓ Total nodes in system: {len(all_statuses)}")

    # Test task assignment
    print("\\nTesting Task Assignment...")
    assignment_success = await node_manager.assign_task("task1", "node1")
    print(f"✓ Task assignment to node1: {assignment_success}")

    assignment_success = await node_manager.assign_task("task2", "node2")
    print(f"✓ Task assignment to node2: {assignment_success}")

    # Test worker task execution
    print("\\nTesting Worker Task Execution...")

    # Create a tool task
    tool_task = WorkerTask(
        id="tool_task_1",
        name="Knowledge Search Task",
        description="Search knowledge base for RAID configuration",
        task_type="tool",
        parameters={
            "tool_name": "search_knowledge",
            "tool_params": {
                "query": "RAID configuration best practices",
                "limit": 3
            }
        },
        assigned_at=datetime.now()
    )

    # Execute the tool task
    result = await worker.execute_task(tool_task)
    print(f"✓ Tool task execution: {result.status}")
    if result.result:
        print(f"  - Found {len(result.result.get('results', []))} knowledge results")

    # Test updating task status
    print("\\nTesting Task Status Updates...")
    status_update = await node_manager.update_task_status("task1", "running", result={"progress": 50})
    print(f"✓ Task status update: {status_update}")

    status_update = await node_manager.update_task_status("task1", "completed", result={"final": "success"})
    print(f"✓ Task status update to completed: {status_update}")

    # Test heartbeat monitor
    print("\\nTesting Heartbeat Monitor...")
    heartbeat_monitor = HeartbeatMonitor(node_manager)
    register_success = await heartbeat_monitor.register_node(
        NodeInfo(
            id="monitor_node",
            name="Monitor Test Node",
            address="192.168.1.12",
            port=8080,
            status="active",
            last_heartbeat=datetime.now(),
            capacity=8,
            load=2,
            metadata={"region": "eu-central", "type": "mixed"}
        )
    )
    print(f"✓ Monitor node registration: {register_success}")

    # Check heartbeat status
    heartbeat_status = await heartbeat_monitor.get_heartbeat_status()
    print(f"✓ Heartbeat status checked: {heartbeat_status['active_nodes']} active nodes")

    # Test node health checker
    print("\\nTesting Node Health Checker...")
    health_checker = NodeHealthChecker(node_manager)
    node_health = await health_checker.check_node_health("node1")
    print(f"✓ Node1 health check: {node_health['overall_health']}")

    cluster_health = await health_checker.get_overall_cluster_health()
    print(f"✓ Cluster health: {cluster_health['cluster_health']} - {cluster_health['healthy_nodes']}/{cluster_health['total_nodes']} healthy nodes")

    # Test getting load distribution
    print("\\nTesting Load Distribution...")
    load_dist = await node_manager.get_load_distribution()
    print(f"✓ Load distribution: {load_dist}")

    # Test getting assigned tasks
    print("\\nTesting Assigned Tasks Retrieval...")
    node1_tasks = await node_manager.get_assigned_tasks("node1")
    print(f"✓ Node1 assigned tasks: {len(node1_tasks)}")

    # Stop the worker
    await worker.stop()
    print("\\n✓ Worker stopped successfully")

    print("\\nExecution Nodes tests completed!")


if __name__ == "__main__":
    asyncio.run(test_execution_nodes())
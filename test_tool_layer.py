"""
Test file for the Tool Layer module.
"""
import asyncio
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from ai_test_system.src.tools.base import ToolManager, BaseTool
from ai_test_system.src.tools.knowledge_tool import KnowledgeTool
from ai_test_system.src.tools.node_control_tool import NodeControlTool
from ai_test_system.src.tools.storage_tool import StorageTool


class MockKnowledgeService:
    """Mock knowledge service for testing."""
    async def search(self, query, limit=5, filters=None):
        # Mock implementation
        return []


class MockNodeManager:
    """Mock node manager for testing."""
    def get_node_address(self, node_id):
        return "127.0.0.1"

    def get_node_ssh_info(self, node_id):
        return {
            "host": "127.0.0.1",
            "port": 22,
            "username": "test",
            "password": "test"
        }

    def get_node_info(self, node_id):
        return {
            "id": node_id,
            "address": "127.0.0.1",
            "status": "active",
            "cpu_usage": 25.5,
            "memory_usage": 42.3,
            "disk_usage": 60.1,
            "active_tasks": 2,
            "capacity": 10,
            "load": 2
        }


class MockStorageManager:
    """Mock storage manager for testing."""
    pass


async def test_tool_layer():
    """Test the basic functionality of the Tool Layer."""
    print("Initializing Tool Manager...")
    tool_manager = ToolManager()

    # Test Knowledge Tool
    print("\\nTesting Knowledge Tool...")
    knowledge_service = MockKnowledgeService()
    knowledge_tool = KnowledgeTool(knowledge_service=knowledge_service)

    tool_manager.register_tool(knowledge_tool, "knowledge")
    print(f"✓ Registered {knowledge_tool.name}: {knowledge_tool.description}")

    # Execute a knowledge search
    try:
        result = await tool_manager.execute_tool("search_knowledge", query="RAID configuration best practices", limit=3)
        print(f"✓ Knowledge search executed successfully: {len(result['results'])} results")
    except Exception as e:
        print(f"✗ Knowledge search failed: {e}")

    # Test Node Control Tool
    print("\\nTesting Node Control Tool...")
    node_manager = MockNodeManager()
    node_control_tool = NodeControlTool(node_manager=node_manager)

    tool_manager.register_tool(node_control_tool, "node_control")
    print(f"✓ Registered {node_control_tool.name}: {node_control_tool.description}")

    # Execute a node ping
    try:
        result = await tool_manager.execute_tool("control_node", node_id="node1", action="ping")
        print(f"✓ Node ping executed successfully: {result['status']}")
    except Exception as e:
        print(f"✗ Node ping failed: {e}")

    # Execute a node status check
    try:
        result = await tool_manager.execute_tool("control_node", node_id="node1", action="status")
        print(f"✓ Node status executed successfully: {result['node_info']['status']}")
    except Exception as e:
        print(f"✗ Node status failed: {e}")

    # Test Storage Tool
    print("\\nTesting Storage Tool...")
    storage_manager = MockStorageManager()
    storage_tool = StorageTool(storage_manager=storage_manager)

    tool_manager.register_tool(storage_tool, "storage")
    print(f"✓ Registered {storage_tool.name}: {storage_tool.description}")

    # Execute a storage health check
    try:
        result = await tool_manager.execute_tool("storage_operation", operation="check_health", device="/dev/sda")
        print(f"✓ Storage health check executed successfully: {result['health_status']}")
    except Exception as e:
        print(f"✗ Storage health check failed: {e}")

    # Execute a storage read operation
    try:
        result = await tool_manager.execute_tool("storage_operation", operation="read", device="/dev/sda", size=1024*1024)
        print(f"✓ Storage read executed successfully: {result['status']}, {result['bytes_read']} bytes read")
    except Exception as e:
        print(f"✗ Storage read failed: {e}")

    # List all registered tools
    print("\\nListing all registered tools:")
    all_tools = tool_manager.registry.list_tools()
    for tool in all_tools:
        print(f"- {tool.name} ({tool.__class__.__name__}): {tool.description}")

    # List tools by category
    print("\\nListing tools by category:")
    tools_by_category = tool_manager.registry.get_tools_by_category()
    for category, tools in tools_by_category.items():
        print(f"{category}:")
        for tool in tools:
            print(f"  - {tool.name}")

    # Test tool status
    print("\\nTesting tool status:")
    for tool_name in ["search_knowledge", "control_node", "storage_operation"]:
        status = tool_manager.get_tool_status(tool_name)
        if status:
            print(f"- {tool_name}: {status['usage_count']} usages, last used: {status['last_used']}")

    print("\\nTool Layer tests completed!")


if __name__ == "__main__":
    asyncio.run(test_tool_layer())
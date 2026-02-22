"""
Test file for the Agent Engine module.
"""
import asyncio
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from datetime import datetime
from ai_test_system.src.agent.engine import AgentEngine, TestAgent, AnalysisAgent, RepairAgent
from ai_test_system.src.core.types import AgentRole


async def sample_tool_1(**kwargs):
    """Sample tool for testing."""
    print(f"Sample tool 1 executed with: {kwargs}")
    return {"status": "success", "result": "Tool 1 executed successfully"}


async def sample_tool_2(**kwargs):
    """Another sample tool for testing."""
    print(f"Sample tool 2 executed with: {kwargs}")
    return {"status": "success", "result": "Tool 2 executed successfully"}


async def test_agent_engine():
    """Test the basic functionality of the Agent Engine."""
    print("Initializing agent engine...")
    engine = AgentEngine()

    # Create some sample tools
    tools = [sample_tool_1, sample_tool_2]

    # Create a Test Agent
    print("\nCreating Test Agent...")
    test_agent = await engine.create_agent(
        agent_id="test_agent_1",
        role=AgentRole.TEST,
        name="Storage Test Agent",
        description="Responsible for executing storage tests",
        initial_goals=["Perform IO stress test", "Validate RAID rebuild process"],
        tools=tools
    )
    print(f"Test Agent created: {test_agent.name}")

    # Create an Analysis Agent
    print("\nCreating Analysis Agent...")
    analysis_agent = await engine.create_agent(
        agent_id="analysis_agent_1",
        role=AgentRole.ANALYSIS,
        name="Analysis Agent",
        description="Responsible for analyzing test results",
        initial_goals=["Analyze performance metrics", "Generate reports"],
        tools=tools
    )
    print(f"Analysis Agent created: {analysis_agent.name}")

    # Create a Repair Agent
    print("\nCreating Repair Agent...")
    repair_agent = await engine.create_agent(
        agent_id="repair_agent_1",
        role=AgentRole.REPAIR,
        name="Repair Agent",
        description="Responsible for repairing issues",
        initial_goals=["Fix broken nodes", "Restore system stability"],
        tools=tools
    )
    print(f"Repair Agent created: {repair_agent.name}")

    # Get all agent statuses
    print("\nGetting all agent statuses...")
    statuses = await engine.get_all_agents_status()
    for status in statuses:
        print(f"- {status['name']} ({status['role']}): {status['status']}")

    # Execute a task with the Test Agent
    print("\nExecuting a task with Test Agent...")
    task_result = await engine.execute_agent_task(
        agent_id="test_agent_1",
        task_description="Run basic storage performance test"
    )
    print(f"Task result: {task_result['success']}")
    if task_result['success']:
        print(f"Task completed with {len(task_result['plan'])} plan steps")

    # Execute a task with the Analysis Agent
    print("\nExecuting a task with Analysis Agent...")
    task_result = await engine.execute_agent_task(
        agent_id="analysis_agent_1",
        task_description="Analyze recent test results for performance trends"
    )
    print(f"Task result: {task_result['success']}")
    if task_result['success']:
        print(f"Task completed with {len(task_result['plan'])} plan steps")

    # Execute a task with the Repair Agent
    print("\nExecuting a task with Repair Agent...")
    task_result = await engine.execute_agent_task(
        agent_id="repair_agent_1",
        task_description="Diagnose and fix network connectivity issues"
    )
    print(f"Task result: {task_result['success']}")
    if task_result['success']:
        print(f"Task completed with {len(task_result['plan'])} plan steps")

    # Check agent memory
    print("\nChecking agent memory...")
    test_agent_memory = await engine.get_agent_memory("test_agent_1", "short")
    print(f"Test Agent short-term memory entries: {len(test_agent_memory)}")

    analysis_agent_memory = await engine.get_agent_memory("analysis_agent_1", "short")
    print(f"Analysis Agent short-term memory entries: {len(analysis_agent_memory)}")

    # Print final status
    print("\nFinal agent statuses:")
    statuses = await engine.get_all_agents_status()
    for status in statuses:
        print(f"- {status['name']}: {status['status']}")

    print("\nAgent engine tests completed!")


if __name__ == "__main__":
    asyncio.run(test_agent_engine())
"""
Tool Layer module for the AI automation storage test platform.
Provides standardized interfaces for interacting with various system components.
"""
import asyncio
import logging
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Union
from datetime import datetime

from ..core.exceptions import ToolExecutionError
from ..core.types import AgentRole


logger = logging.getLogger(__name__)


class BaseTool(ABC):
    """
    Abstract base class for all tools in the system.
    """

    def __init__(self, name: str, description: str = "", parameters: Optional[Dict] = None):
        self.name = name
        self.description = description
        self.parameters = parameters or {}
        self.last_used = None
        self.usage_count = 0

    @abstractmethod
    async def execute(self, **kwargs) -> Any:
        """
        Execute the tool with the given parameters.
        """
        pass

    def increment_usage(self) -> None:
        """
        Increment the usage counter and update last used timestamp.
        """
        self.usage_count += 1
        self.last_used = datetime.now()

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert the tool to a dictionary representation.
        """
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
            "last_used": self.last_used.isoformat() if self.last_used else None,
            "usage_count": self.usage_count
        }


class ToolRegistry:
    """
    Registry for managing available tools in the system.
    """

    def __init__(self):
        self._tools: Dict[str, BaseTool] = {}
        self._categories: Dict[str, List[str]] = {}

    def register_tool(self, tool: BaseTool, category: str = "general") -> None:
        """
        Register a tool in the registry.
        """
        self._tools[tool.name] = tool

        if category not in self._categories:
            self._categories[category] = []
        if tool.name not in self._categories[category]:
            self._categories[category].append(tool.name)

        logger.info(f"Tool '{tool.name}' registered in category '{category}'")

    def unregister_tool(self, tool_name: str) -> bool:
        """
        Unregister a tool from the registry.
        """
        if tool_name in self._tools:
            # Remove from categories
            for category, tools in self._categories.items():
                if tool_name in tools:
                    tools.remove(tool_name)

            del self._tools[tool_name]
            logger.info(f"Tool '{tool_name}' unregistered")
            return True
        return False

    def get_tool(self, tool_name: str) -> Optional[BaseTool]:
        """
        Get a tool by name.
        """
        return self._tools.get(tool_name)

    def list_tools(self, category: Optional[str] = None) -> List[BaseTool]:
        """
        List all registered tools, optionally filtered by category.
        """
        if category:
            if category not in self._categories:
                return []
            return [self._tools[name] for name in self._categories[category] if name in self._tools]

        return list(self._tools.values())

    def list_categories(self) -> List[str]:
        """
        List all available categories.
        """
        return list(self._categories.keys())

    def get_tools_by_category(self) -> Dict[str, List[BaseTool]]:
        """
        Get all tools grouped by category.
        """
        result = {}
        for category, tool_names in self._categories.items():
            result[category] = [self._tools[name] for name in tool_names if name in self._tools]
        return result


class ToolManager:
    """
    Manager for executing tools and handling tool-related operations.
    """

    def __init__(self, registry: Optional[ToolRegistry] = None):
        self.registry = registry or ToolRegistry()

    async def execute_tool(self, tool_name: str, **kwargs) -> Any:
        """
        Execute a tool by name with the given parameters.
        """
        tool = self.registry.get_tool(tool_name)
        if not tool:
            raise ToolExecutionError(f"Tool '{tool_name}' not found in registry")

        logger.info(f"Executing tool '{tool_name}' with parameters: {kwargs}")

        try:
            result = await tool.execute(**kwargs)
            tool.increment_usage()
            logger.info(f"Tool '{tool_name}' executed successfully")
            return result
        except Exception as e:
            logger.error(f"Tool '{tool_name}' execution failed: {str(e)}")
            raise ToolExecutionError(f"Tool '{tool_name}' execution failed: {str(e)}")

    def register_tool(self, tool: BaseTool, category: str = "general") -> None:
        """
        Register a tool in the manager's registry.
        """
        self.registry.register_tool(tool, category)

    def get_tool_status(self, tool_name: str) -> Optional[Dict[str, Any]]:
        """
        Get the status of a specific tool.
        """
        tool = self.registry.get_tool(tool_name)
        if not tool:
            return None

        return {
            "name": tool.name,
            "description": tool.description,
            "last_used": tool.last_used,
            "usage_count": tool.usage_count,
            "available": True
        }
"""
Storage tool for the AI automation storage test platform.
Allows agents to interact with storage devices and perform storage-related operations.
"""
import asyncio
import logging
from typing import Any, Dict, List, Optional
from datetime import datetime

from .base import BaseTool
from ..core.exceptions import ToolExecutionError


logger = logging.getLogger(__name__)


class StorageTool(BaseTool):
    """
    Tool for interacting with storage devices and performing storage operations.
    """

    def __init__(self, storage_manager: Any = None):
        super().__init__(
            name="storage_operation",
            description="Perform operations on storage devices",
            parameters={
                "operation": {
                    "type": "string",
                    "description": "Operation to perform (read, write, benchmark, check_health, etc.)",
                    "required": True,
                    "enum": ["read", "write", "benchmark", "check_health", "format", "mount", "unmount"]
                },
                "device": {
                    "type": "string",
                    "description": "Storage device identifier (e.g., /dev/sda, RAID volume)",
                    "required": True
                },
                "size": {
                    "type": "integer",
                    "description": "Size in bytes for the operation (where applicable)",
                    "default": 0
                },
                "duration": {
                    "type": "integer",
                    "description": "Duration in seconds for the operation (where applicable)",
                    "default": 60
                },
                "block_size": {
                    "type": "string",
                    "description": "Block size for the operation (e.g., 4k, 64k, 1m)",
                    "default": "4k"
                }
            }
        )
        self.storage_manager = storage_manager

    async def execute(self, **kwargs) -> Dict[str, Any]:
        """
        Execute the storage operation.
        """
        operation = kwargs.get("operation")
        device = kwargs.get("device")

        if not operation or not device:
            raise ToolExecutionError("operation and device parameters are required for storage operations")

        logger.info(f"Performing operation '{operation}' on device '{device}'")

        try:
            if operation == "read":
                result = await self.read_operation(device, kwargs)
            elif operation == "write":
                result = await self.write_operation(device, kwargs)
            elif operation == "benchmark":
                result = await self.benchmark_operation(device, kwargs)
            elif operation == "check_health":
                result = await self.health_check_operation(device, kwargs)
            elif operation == "format":
                result = await self.format_operation(device, kwargs)
            elif operation == "mount":
                result = await self.mount_operation(device, kwargs)
            elif operation == "unmount":
                result = await self.unmount_operation(device, kwargs)
            else:
                raise ToolExecutionError(f"Unknown operation '{operation}' for storage tool")

            return result
        except Exception as e:
            logger.error(f"Storage operation '{operation}' on device '{device}' failed: {str(e)}")
            raise ToolExecutionError(f"Storage operation '{operation}' failed: {str(e)}")

    async def read_operation(self, device: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Perform a read operation on the storage device.
        """
        size = params.get("size", 1024*1024)  # 1MB default
        block_size = params.get("block_size", "4k")

        start_time = datetime.now()
        try:
            # Simulate read operation
            await asyncio.sleep(0.2)  # Simulate I/O delay

            # Mock read statistics
            data_read = min(size, 1024*1024)  # Cap at 1MB for demo
            read_speed = data_read / 0.2  # bytes per second

            duration = (datetime.now() - start_time).total_seconds()

            return {
                "device": device,
                "operation": "read",
                "status": "success",
                "bytes_read": data_read,
                "block_size": block_size,
                "duration": duration,
                "speed_bps": read_speed,
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            return {
                "device": device,
                "operation": "read",
                "status": "error",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }

    async def write_operation(self, device: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Perform a write operation on the storage device.
        """
        size = params.get("size", 1024*1024)  # 1MB default
        block_size = params.get("block_size", "4k")

        start_time = datetime.now()
        try:
            # Simulate write operation
            await asyncio.sleep(0.3)  # Simulate I/O delay

            # Mock write statistics
            data_written = min(size, 1024*1024)  # Cap at 1MB for demo
            write_speed = data_written / 0.3  # bytes per second

            duration = (datetime.now() - start_time).total_seconds()

            return {
                "device": device,
                "operation": "write",
                "status": "success",
                "bytes_written": data_written,
                "block_size": block_size,
                "duration": duration,
                "speed_bps": write_speed,
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            return {
                "device": device,
                "operation": "write",
                "status": "error",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }

    async def benchmark_operation(self, device: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Perform a benchmark operation on the storage device.
        """
        duration = params.get("duration", 60)  # 60 seconds default
        block_size = params.get("block_size", "4k")

        start_time = datetime.now()
        try:
            # Simulate benchmark operation (reduce duration for demo)
            effective_duration = min(duration, 5)  # Limit to 5 seconds for demo
            await asyncio.sleep(effective_duration)

            # Mock benchmark results
            total_time = effective_duration
            random_read_iops = 10000  # Mock random read IOPS
            random_write_iops = 8000  # Mock random write IOPS
            seq_read_bw = 500 * 1024 * 1024  # Mock sequential read bandwidth in bytes/sec
            seq_write_bw = 400 * 1024 * 1024  # Mock sequential write bandwidth in bytes/sec

            return {
                "device": device,
                "operation": "benchmark",
                "status": "success",
                "duration": total_time,
                "block_size": block_size,
                "results": {
                    "random_read_iops": random_read_iops,
                    "random_write_iops": random_write_iops,
                    "seq_read_bps": seq_read_bw,
                    "seq_write_bps": seq_write_bw,
                    "avg_latency_ms": 0.1
                },
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            return {
                "device": device,
                "operation": "benchmark",
                "status": "error",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }

    async def health_check_operation(self, device: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Check the health of the storage device.
        """
        start_time = datetime.now()
        try:
            # Simulate health check
            await asyncio.sleep(0.1)  # Simulate health check delay

            # Mock health information
            duration = (datetime.now() - start_time).total_seconds()

            return {
                "device": device,
                "operation": "check_health",
                "status": "success",
                "duration": duration,
                "health_status": "healthy",
                "details": {
                    "temperature_celsius": 35,
                    "power_cycles": 1200,
                    "power_on_hours": 8760,
                    "wear_level": 0.75,
                    "bad_blocks": 0,
                    "reallocation_events": 0
                },
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            return {
                "device": device,
                "operation": "check_health",
                "status": "error",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }

    async def format_operation(self, device: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Format the storage device.
        """
        start_time = datetime.now()
        try:
            # Simulate format operation (would take much longer in reality)
            await asyncio.sleep(1.0)  # Simulate formatting time

            duration = (datetime.now() - start_time).total_seconds()

            return {
                "device": device,
                "operation": "format",
                "status": "success",
                "duration": duration,
                "message": f"Device {device} formatted successfully",
                "filesystem": "ext4",
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            return {
                "device": device,
                "operation": "format",
                "status": "error",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }

    async def mount_operation(self, device: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Mount the storage device.
        """
        mount_point = params.get("mount_point", f"/mnt/{device.split('/')[-1]}")

        start_time = datetime.now()
        try:
            # Simulate mount operation
            await asyncio.sleep(0.1)

            duration = (datetime.now() - start_time).total_seconds()

            return {
                "device": device,
                "operation": "mount",
                "status": "success",
                "mount_point": mount_point,
                "duration": duration,
                "message": f"Device {device} mounted at {mount_point}",
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            return {
                "device": device,
                "operation": "mount",
                "status": "error",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }

    async def unmount_operation(self, device: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Unmount the storage device.
        """
        mount_point = params.get("mount_point", f"/mnt/{device.split('/')[-1]}")

        start_time = datetime.now()
        try:
            # Simulate unmount operation
            await asyncio.sleep(0.1)

            duration = (datetime.now() - start_time).total_seconds()

            return {
                "device": device,
                "operation": "unmount",
                "status": "success",
                "mount_point": mount_point,
                "duration": duration,
                "message": f"Device {device} unmounted from {mount_point}",
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            return {
                "device": device,
                "operation": "unmount",
                "status": "error",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }

    async def get_device_info(self, device: str) -> Dict[str, Any]:
        """
        Get detailed information about a storage device.
        """
        try:
            # Mock device information
            await asyncio.sleep(0.05)  # Simulate query time

            return {
                "device": device,
                "info": {
                    "model": "ST1000DM010-2EP102",
                    "vendor": "Seagate",
                    "size_bytes": 1000204886016,  # ~1TB
                    "block_size": 512,
                    "rotational": True,
                    "removable": False,
                    "wwn": "502234567890abcd",
                    "serial": "WD-WCC123456789",
                    "firmware": "CC43"
                },
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            return {
                "device": device,
                "status": "error",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }
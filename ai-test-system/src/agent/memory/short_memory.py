"""
Short-term memory for agents in the AI automation storage test platform.
Stores temporary information during agent sessions.
"""
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple

logger = logging.getLogger(__name__)


class ShortTermMemory:
    """
    Stores short-term memory for agents, cleared between sessions.
    Uses a dictionary-based storage with TTL (Time To Live) for entries.
    """

    def __init__(self, default_ttl_minutes: int = 30):
        self.memory_store: Dict[str, Dict[str, Any]] = {}
        self.ttl_info: Dict[str, datetime] = {}  # Maps key to expiration time
        self.default_ttl = timedelta(minutes=default_ttl_minutes)
        self._lock = asyncio.Lock()

    async def store(self, key: str, value: Any, ttl_minutes: Optional[int] = None) -> None:
        """
        Store a value in short-term memory with an optional TTL.
        """
        async with self._lock:
            self.memory_store[key] = value

            if ttl_minutes is not None:
                ttl = timedelta(minutes=ttl_minutes)
            else:
                ttl = self.default_ttl

            self.ttl_info[key] = datetime.now() + ttl
            logger.debug(f"Stored key '{key}' in short-term memory with TTL of {ttl}")

    async def retrieve(self, key: str) -> Optional[Any]:
        """
        Retrieve a value from short-term memory.
        Returns None if the key doesn't exist or has expired.
        """
        async with self._lock:
            # First, clean up expired entries
            await self._cleanup_expired()

            if key in self.memory_store:
                logger.debug(f"Retrieved key '{key}' from short-term memory")
                return self.memory_store[key]

            logger.debug(f"Key '{key}' not found in short-term memory")
            return None

    async def update(self, key: str, value: Any, extend_ttl: bool = True) -> bool:
        """
        Update an existing value in short-term memory.
        Optionally extends the TTL if extend_ttl is True.
        Returns True if the key existed and was updated, False otherwise.
        """
        async with self._lock:
            # Clean up expired entries first
            await self._cleanup_expired()

            if key not in self.memory_store:
                logger.warning(f"Key '{key}' not found for update in short-term memory")
                return False

            self.memory_store[key] = value

            if extend_ttl:
                # Extend TTL from now
                self.ttl_info[key] = datetime.now() + self.default_ttl
                logger.debug(f"Updated key '{key}' and extended TTL in short-term memory")
            else:
                logger.debug(f"Updated key '{key}' without extending TTL in short-term memory")

            return True

    async def delete(self, key: str) -> bool:
        """
        Delete a key from short-term memory.
        Returns True if the key existed and was deleted, False otherwise.
        """
        async with self._lock:
            # Clean up expired entries first
            await self._cleanup_expired()

            if key in self.memory_store:
                del self.memory_store[key]
                if key in self.ttl_info:
                    del self.ttl_info[key]
                logger.debug(f"Deleted key '{key}' from short-term memory")
                return True

            logger.debug(f"Key '{key}' not found for deletion in short-term memory")
            return False

    async def search(self, prefix: str) -> List[Tuple[str, Any]]:
        """
        Search for keys that start with the given prefix.
        Returns a list of (key, value) tuples.
        """
        async with self._lock:
            # Clean up expired entries first
            await self._cleanup_expired()

            results = []
            for key, value in self.memory_store.items():
                if key.startswith(prefix):
                    results.append((key, value))

            logger.debug(f"Found {len(results)} entries with prefix '{prefix}' in short-term memory")
            return results

    async def list_keys(self) -> List[str]:
        """
        Get a list of all keys in short-term memory.
        """
        async with self._lock:
            # Clean up expired entries first
            await self._cleanup_expired()

            keys = list(self.memory_store.keys())
            logger.debug(f"Listing {len(keys)} keys in short-term memory")
            return keys

    async def _cleanup_expired(self) -> None:
        """
        Remove expired entries from memory.
        """
        now = datetime.now()
        expired_keys = [key for key, expiry in self.ttl_info.items() if expiry <= now]

        for key in expired_keys:
            if key in self.memory_store:
                del self.memory_store[key]
            del self.ttl_info[key]

        if expired_keys:
            logger.debug(f"Cleaned up {len(expired_keys)} expired entries from short-term memory")

    async def clear(self) -> None:
        """
        Clear all entries from short-term memory.
        """
        async with self._lock:
            self.memory_store.clear()
            self.ttl_info.clear()
            logger.info("Cleared all entries from short-term memory")

    async def size(self) -> int:
        """
        Get the number of entries in short-term memory.
        """
        async with self._lock:
            # Clean up expired entries first
            await self._cleanup_expired()

            size = len(self.memory_store)
            logger.debug(f"Short-term memory size: {size}")
            return size

    async def get_ttl_info(self) -> Dict[str, datetime]:
        """
        Get TTL information for all entries (for debugging purposes).
        """
        async with self._lock:
            # Clean up expired entries first
            await self._cleanup_expired()

            return self.ttl_info.copy()
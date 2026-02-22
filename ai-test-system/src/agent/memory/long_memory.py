"""
Long-term memory for agents in the AI automation storage test platform.
Stores persistent information that survives between sessions.
"""
import asyncio
import logging
import pickle
import os
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from pathlib import Path

logger = logging.getLogger(__name__)


class LongTermMemory:
    """
    Stores long-term memory for agents, persists between sessions.
    Uses file-based storage for persistence.
    """

    def __init__(self, storage_path: str = "./data/long_term_memory"):
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)
        self.experience_file = self.storage_path / "experiences.pkl"
        self.knowledge_file = self.storage_path / "knowledge.pkl"

        # Load existing data if available
        self.experiences: List[Dict[str, Any]] = self._load_experiences()
        self.knowledge_base: Dict[str, Any] = self._load_knowledge()
        self._lock = asyncio.Lock()

    async def store_experience(self, experience: Dict[str, Any]) -> None:
        """
        Store an experience in long-term memory.
        """
        async with self._lock:
            experience["stored_at"] = datetime.now()
            self.experiences.append(experience)

            # Limit experiences to prevent infinite growth
            if len(self.experiences) > 1000:  # Keep only last 1000 experiences
                self.experiences = self.experiences[-500:]  # Keep 500 most recent

            await self._save_experiences()
            logger.debug(f"Stored experience in long-term memory. Total: {len(self.experiences)}")

    async def retrieve_experience(self, agent_id: str, task_keyword: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Retrieve experiences for a specific agent, optionally filtered by keyword.
        """
        async with self._lock:
            results = [
                exp for exp in self.experiences
                if exp.get("agent_id") == agent_id and
                (task_keyword is None or task_keyword.lower() in str(exp.get("task", "")).lower())
            ]

            logger.debug(f"Retrieved {len(results)} experiences for agent {agent_id}")
            return results

    async def retrieve_agent_experiences(self, agent_id: str) -> List[Dict[str, Any]]:
        """
        Retrieve all experiences for a specific agent.
        """
        async with self._lock:
            results = [exp for exp in self.experiences if exp.get("agent_id") == agent_id]
            logger.debug(f"Retrieved {len(results)} experiences for agent {agent_id}")
            return results

    async def store_knowledge(self, key: str, value: Any) -> None:
        """
        Store a piece of knowledge in the knowledge base.
        """
        async with self._lock:
            self.knowledge_base[key] = {
                "value": value,
                "stored_at": datetime.now(),
                "last_accessed": datetime.now()
            }
            await self._save_knowledge()
            logger.debug(f"Stored knowledge with key '{key}' in long-term memory")

    async def retrieve_knowledge(self, key: str) -> Optional[Any]:
        """
        Retrieve a piece of knowledge from the knowledge base.
        """
        async with self._lock:
            if key in self.knowledge_base:
                self.knowledge_base[key]["last_accessed"] = datetime.now()
                await self._save_knowledge()

                logger.debug(f"Retrieved knowledge with key '{key}' from long-term memory")
                return self.knowledge_base[key]["value"]

            logger.debug(f"Knowledge with key '{key}' not found in long-term memory")
            return None

    async def search_knowledge(self, keyword: str) -> List[Tuple[str, Any]]:
        """
        Search for knowledge entries containing the keyword.
        """
        async with self._lock:
            results = []
            keyword_lower = keyword.lower()

            for key, entry in self.knowledge_base.items():
                # Search in key
                if keyword_lower in key.lower():
                    results.append((key, entry["value"]))
                    continue

                # Search in value if it's string-like
                value_str = str(entry["value"]).lower()
                if keyword_lower in value_str:
                    results.append((key, entry["value"]))

            logger.debug(f"Found {len(results)} knowledge entries containing '{keyword}'")
            return results

    async def update_knowledge(self, key: str, value: Any) -> bool:
        """
        Update an existing knowledge entry.
        Returns True if updated, False if key doesn't exist.
        """
        async with self._lock:
            if key in self.knowledge_base:
                self.knowledge_base[key]["value"] = value
                self.knowledge_base[key]["last_accessed"] = datetime.now()
                await self._save_knowledge()
                logger.debug(f"Updated knowledge with key '{key}' in long-term memory")
                return True

            logger.debug(f"Knowledge with key '{key}' not found for update")
            return False

    async def delete_knowledge(self, key: str) -> bool:
        """
        Delete a knowledge entry.
        Returns True if deleted, False if key doesn't exist.
        """
        async with self._lock:
            if key in self.knowledge_base:
                del self.knowledge_base[key]
                await self._save_knowledge()
                logger.debug(f"Deleted knowledge with key '{key}' from long-term memory")
                return True

            logger.debug(f"Knowledge with key '{key}' not found for deletion")
            return False

    async def get_recent_experiences(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Get the most recent experiences.
        """
        async with self._lock:
            recent = self.experiences[-limit:] if self.experiences else []
            logger.debug(f"Retrieved {len(recent)} recent experiences")
            return recent

    async def get_knowledge_keys(self) -> List[str]:
        """
        Get a list of all knowledge keys.
        """
        async with self._lock:
            keys = list(self.knowledge_base.keys())
            logger.debug(f"Retrieved {len(keys)} knowledge keys")
            return keys

    def _load_experiences(self) -> List[Dict[str, Any]]:
        """
        Load experiences from file storage.
        """
        if self.experience_file.exists():
            try:
                with open(self.experience_file, 'rb') as f:
                    experiences = pickle.load(f)
                    logger.info(f"Loaded {len(experiences)} experiences from file")
                    return experiences
            except Exception as e:
                logger.error(f"Error loading experiences: {e}")
                return []
        else:
            logger.info("No experiences file found, starting with empty list")
            return []

    def _load_knowledge(self) -> Dict[str, Any]:
        """
        Load knowledge base from file storage.
        """
        if self.knowledge_file.exists():
            try:
                with open(self.knowledge_file, 'rb') as f:
                    knowledge = pickle.load(f)
                    logger.info(f"Loaded {len(knowledge)} knowledge entries from file")
                    return knowledge
            except Exception as e:
                logger.error(f"Error loading knowledge: {e}")
                return {}
        else:
            logger.info("No knowledge file found, starting with empty dict")
            return {}

    async def _save_experiences(self) -> None:
        """
        Save experiences to file storage.
        """
        try:
            with open(self.experience_file, 'wb') as f:
                pickle.dump(self.experiences, f)
            logger.debug("Saved experiences to file")
        except Exception as e:
            logger.error(f"Error saving experiences: {e}")

    async def _save_knowledge(self) -> None:
        """
        Save knowledge base to file storage.
        """
        try:
            with open(self.knowledge_file, 'wb') as f:
                pickle.dump(self.knowledge_base, f)
            logger.debug("Saved knowledge base to file")
        except Exception as e:
            logger.error(f"Error saving knowledge: {e}")

    async def cleanup_old_experiences(self, days_old: int = 30) -> int:
        """
        Remove experiences older than the specified number of days.
        Returns the number of experiences removed.
        """
        async with self._lock:
            cutoff_date = datetime.now() - timedelta(days=days_old)
            old_count = len(self.experiences)

            self.experiences = [
                exp for exp in self.experiences
                if exp.get("stored_at", datetime.min) >= cutoff_date
            ]

            removed_count = old_count - len(self.experiences)

            if removed_count > 0:
                await self._save_experiences()
                logger.info(f"Removed {removed_count} experiences older than {days_old} days")

            return removed_count

    async def cleanup(self) -> None:
        """
        Perform general cleanup of the memory system.
        """
        async with self._lock:
            # Cleanup old experiences (keep only last 30 days)
            await self.cleanup_old_experiences(days_old=30)

            logger.info("Long-term memory cleanup completed")

    async def export_memory(self, export_path: str) -> None:
        """
        Export the entire memory to a backup file.
        """
        async with self._lock:
            export_data = {
                "experiences": self.experiences,
                "knowledge_base": self.knowledge_base,
                "exported_at": datetime.now()
            }

            export_file = Path(export_path)
            with open(export_file, 'wb') as f:
                pickle.dump(export_data, f)

            logger.info(f"Exported memory to {export_path}")

    async def import_memory(self, import_path: str) -> None:
        """
        Import memory from a backup file.
        """
        async with self._lock:
            import_file = Path(import_path)
            if not import_file.exists():
                raise FileNotFoundError(f"Import file does not exist: {import_path}")

            with open(import_file, 'rb') as f:
                import_data = pickle.load(f)

            self.experiences = import_data.get("experiences", [])
            self.knowledge_base = import_data.get("knowledge_base", {})

            # Save imported data
            await self._save_experiences()
            await self._save_knowledge()

            logger.info(f"Imported memory from {import_path}")
            logger.info(f"Loaded {len(self.experiences)} experiences and {len(self.knowledge_base)} knowledge entries")
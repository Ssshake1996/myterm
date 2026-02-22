"""
Priority queue implementation for the scheduler.
"""
import heapq
from typing import Any
from queue import Empty, Queue
from ..core.types import Task


class PriorityQueue:
    """
    Priority queue for tasks based on their priority attribute.
    Higher priority number means higher priority (runs first).
    """

    def __init__(self):
        self._queue = []
        self._index = 0  # To maintain FIFO order for items with same priority
        self._lock = None  # No lock needed for synchronous operations

    def put(self, item: Task) -> None:
        """
        Add an item to the queue.
        """
        # Use negative priority to make higher priority numbers come first
        # We add index to maintain insertion order for equal priorities
        heapq.heappush(self._queue, (-item.priority, self._index, item))
        self._index += 1

    def get(self) -> Task:
        """
        Remove and return the highest priority item.
        """
        if self.empty():
            raise Empty("Queue is empty")
        _, _, item = heapq.heappop(self._queue)
        return item

    def empty(self) -> bool:
        """
        Check if the queue is empty.
        """
        return len(self._queue) == 0

    def qsize(self) -> int:
        """
        Get the number of items in the queue.
        """
        return len(self._queue)

    def peek(self) -> Task:
        """
        Look at the highest priority item without removing it.
        """
        if self.empty():
            raise Empty("Queue is empty")
        _, _, item = self._queue[0]
        return item

    def __len__(self) -> int:
        """
        Get the length of the queue.
        """
        return len(self._queue)
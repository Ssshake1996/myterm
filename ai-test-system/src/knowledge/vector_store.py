"""
Knowledge Layer module for the AI automation storage test platform.
Handles document processing, vector storage, and knowledge retrieval.
"""
import asyncio
import logging
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime

from ..core.exceptions import KnowledgeRetrievalError


logger = logging.getLogger(__name__)


class Document:
    """
    Represents a document in the knowledge system.
    """

    def __init__(
        self,
        id: str,
        content: str,
        source: str,
        metadata: Optional[Dict[str, Any]] = None,
        created_at: Optional[datetime] = None
    ):
        self.id = id
        self.content = content
        self.source = source
        self.metadata = metadata or {}
        self.created_at = created_at or datetime.now()
        self.updated_at = datetime.now()

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert the document to a dictionary representation.
        """
        return {
            "id": self.id,
            "content": self.content,
            "source": self.source,
            "metadata": self.metadata,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat()
        }


class Chunk:
    """
    Represents a chunk of a document after splitting.
    """

    def __init__(
        self,
        id: str,
        document_id: str,
        content: str,
        embedding: Optional[List[float]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        position: int = 0
    ):
        self.id = id
        self.document_id = document_id
        self.content = content
        self.embedding = embedding
        self.metadata = metadata or {}
        self.position = position
        self.created_at = datetime.now()

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert the chunk to a dictionary representation.
        """
        return {
            "id": self.id,
            "document_id": self.document_id,
            "content": self.content,
            "embedding": self.embedding,
            "metadata": self.metadata,
            "position": self.position,
            "created_at": self.created_at.isoformat()
        }


class VectorStore:
    """
    Interface for vector storage operations.
    """

    def __init__(self):
        self.chunks: Dict[str, Chunk] = {}
        self.embeddings_dim: Optional[int] = None

    async def add_chunk(self, chunk: Chunk) -> bool:
        """
        Add a chunk to the vector store.
        """
        self.chunks[chunk.id] = chunk
        if chunk.embedding:
            if self.embeddings_dim is None:
                self.embeddings_dim = len(chunk.embedding)
            elif len(chunk.embedding) != self.embeddings_dim:
                raise ValueError(f"Embedding dimension mismatch. Expected {self.embeddings_dim}, got {len(chunk.embedding)}")
        logger.info(f"Added chunk {chunk.id} to vector store")
        return True

    async def add_chunks(self, chunks: List[Chunk]) -> bool:
        """
        Add multiple chunks to the vector store.
        """
        for chunk in chunks:
            await self.add_chunk(chunk)
        logger.info(f"Added {len(chunks)} chunks to vector store")
        return True

    async def get_chunk(self, chunk_id: str) -> Optional[Chunk]:
        """
        Retrieve a chunk by ID.
        """
        return self.chunks.get(chunk_id)

    async def search(self, query_embedding: List[float], top_k: int = 5) -> List[Tuple[Chunk, float]]:
        """
        Search for similar chunks using cosine similarity.
        """
        if not query_embedding:
            raise ValueError("Query embedding cannot be empty")

        if self.embeddings_dim and len(query_embedding) != self.embeddings_dim:
            raise ValueError(f"Query embedding dimension mismatch. Expected {self.embeddings_dim}, got {len(query_embedding)}")

        results = []
        for chunk in self.chunks.values():
            if chunk.embedding is not None:
                similarity = self._cosine_similarity(query_embedding, chunk.embedding)
                results.append((chunk, similarity))

        # Sort by similarity score in descending order
        results.sort(key=lambda x: x[1], reverse=True)

        # Return top_k results
        return results[:top_k]

    def _cosine_similarity(self, vec1: List[float], vec2: List[float]) -> float:
        """
        Calculate cosine similarity between two vectors.
        """
        dot_product = sum(a * b for a, b in zip(vec1, vec2))
        magnitude1 = sum(a * a for a in vec1) ** 0.5
        magnitude2 = sum(b * b for b in vec2) ** 0.5

        if magnitude1 == 0 or magnitude2 == 0:
            return 0.0

        return dot_product / (magnitude1 * magnitude2)

    async def delete_chunk(self, chunk_id: str) -> bool:
        """
        Delete a chunk from the vector store.
        """
        if chunk_id in self.chunks:
            del self.chunks[chunk_id]
            logger.info(f"Deleted chunk {chunk_id} from vector store")
            return True
        return False

    async def clear(self) -> bool:
        """
        Clear all chunks from the vector store.
        """
        self.chunks.clear()
        logger.info("Cleared vector store")
        return True

    async def get_chunk_count(self) -> int:
        """
        Get the number of chunks in the vector store.
        """
        return len(self.chunks)
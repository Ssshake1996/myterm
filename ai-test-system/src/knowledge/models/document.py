"""
Knowledge models for the AI automation storage test platform.
"""
from datetime import datetime
from typing import Dict, List, Any, Optional
from dataclasses import dataclass


@dataclass
class KnowledgeDocument:
    """
    Model for a knowledge document.
    """
    id: str
    content: str
    source: str
    metadata: Optional[Dict[str, Any]] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    def __post_init__(self):
        if self.created_at is None:
            self.created_at = datetime.now()
        if self.updated_at is None:
            self.updated_at = datetime.now()

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert the document to a dictionary representation.
        """
        return {
            "id": self.id,
            "content": self.content,
            "source": self.source,
            "metadata": self.metadata or {},
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'KnowledgeDocument':
        """
        Create a KnowledgeDocument from a dictionary.
        """
        return cls(
            id=data["id"],
            content=data["content"],
            source=data["source"],
            metadata=data.get("metadata"),
            created_at=datetime.fromisoformat(data["created_at"]) if data.get("created_at") else None,
            updated_at=datetime.fromisoformat(data["updated_at"]) if data.get("updated_at") else None
        )


@dataclass
class KnowledgeChunk:
    """
    Model for a knowledge chunk.
    """
    id: str
    document_id: str
    content: str
    embedding: Optional[List[float]] = None
    metadata: Optional[Dict[str, Any]] = None
    position: int = 0
    created_at: Optional[datetime] = None

    def __post_init__(self):
        if self.created_at is None:
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
            "metadata": self.metadata or {},
            "position": self.position,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'KnowledgeChunk':
        """
        Create a KnowledgeChunk from a dictionary.
        """
        return cls(
            id=data["id"],
            document_id=data["document_id"],
            content=data["content"],
            embedding=data.get("embedding"),
            metadata=data.get("metadata"),
            position=data.get("position", 0),
            created_at=datetime.fromisoformat(data["created_at"]) if data.get("created_at") else None
        )


@dataclass
class SearchResult:
    """
    Model for search results.
    """
    text: str
    source: str
    similarity_score: float
    chunk_id: str
    document_id: str
    metadata: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert the search result to a dictionary representation.
        """
        return {
            "text": self.text,
            "source": self.source,
            "similarity_score": self.similarity_score,
            "chunk_id": self.chunk_id,
            "document_id": self.document_id,
            "metadata": self.metadata or {}
        }
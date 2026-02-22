"""
Knowledge service for the AI automation storage test platform.
Provides REST API endpoints for knowledge operations.
"""
import asyncio
import logging
from typing import Dict, List, Any, Optional, Union
from datetime import datetime

from .vector_store import VectorStore, Chunk, Document
from .embedding import DocumentProcessor, EmbeddingGenerator
from ..core.exceptions import KnowledgeRetrievalError


logger = logging.getLogger(__name__)


class KnowledgeService:
    """
    Service layer for knowledge operations including document ingestion,
    search, and management.
    """

    def __init__(self, vector_store: Optional[VectorStore] = None,
                 document_processor: Optional[DocumentProcessor] = None,
                 embedding_generator: Optional[EmbeddingGenerator] = None):
        self.vector_store = vector_store or VectorStore()
        self.document_processor = document_processor or DocumentProcessor()
        self.embedding_generator = embedding_generator or EmbeddingGenerator()

        # For demo purposes, we'll use in-memory storage
        # In production, this would connect to a persistent database
        self.documents: Dict[str, Document] = {}

    async def add_document(self, document: Document) -> Dict[str, Any]:
        """
        Add a document to the knowledge base and process it.
        """
        logger.info(f"Adding document {document.id} to knowledge base")

        # Store the document
        self.documents[document.id] = document

        # Process the document into chunks and add to vector store
        chunks = await self.document_processor.process_document(document)
        await self.vector_store.add_chunks(chunks)

        return {
            "document_id": document.id,
            "chunks_created": len(chunks),
            "status": "success",
            "timestamp": datetime.now().isoformat()
        }

    async def add_documents(self, documents: List[Document]) -> Dict[str, Any]:
        """
        Add multiple documents to the knowledge base.
        """
        results = []
        for document in documents:
            result = await self.add_document(document)
            results.append(result)

        return {
            "documents_processed": len(documents),
            "results": results,
            "status": "success",
            "timestamp": datetime.now().isoformat()
        }

    async def search(self, query: str, top_k: int = 5, filters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Search for relevant documents/chunks based on the query.
        """
        logger.info(f"Searching knowledge base for query: '{query[:50]}{'...' if len(query) > 50 else ''}'")

        try:
            # Generate embedding for the query
            query_embedding = await self.embedding_generator.generate_embedding(query)

            # Search in vector store
            search_results = await self.vector_store.search(query_embedding, top_k=top_k)

            # Format results
            formatted_results = []
            for chunk, similarity in search_results:
                formatted_results.append({
                    "text": chunk.content,
                    "source": chunk.metadata.get("source", "unknown"),
                    "similarity_score": similarity,
                    "chunk_id": chunk.id,
                    "document_id": chunk.document_id,
                    "metadata": chunk.metadata
                })

            return {
                "query": query,
                "results": formatted_results,
                "total_found": len(formatted_results),
                "search_time": 0.0,  # Would be calculated in a real implementation
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Search failed: {str(e)}")
            raise KnowledgeRetrievalError(f"Search failed: {str(e)}")

    async def get_document(self, document_id: str) -> Optional[Document]:
        """
        Retrieve a document by ID.
        """
        return self.documents.get(document_id)

    async def get_document_chunks(self, document_id: str) -> List[Chunk]:
        """
        Retrieve all chunks for a specific document.
        """
        # Find chunks belonging to the document
        document_chunks = []
        for chunk in self.vector_store.chunks.values():
            if chunk.document_id == document_id:
                document_chunks.append(chunk)

        # Sort by position
        document_chunks.sort(key=lambda c: c.position)
        return document_chunks

    async def delete_document(self, document_id: str) -> bool:
        """
        Delete a document and all its chunks from the knowledge base.
        """
        if document_id not in self.documents:
            return False

        # Remove document
        del self.documents[document_id]

        # Remove all chunks belonging to this document
        chunks_to_delete = []
        for chunk_id, chunk in self.vector_store.chunks.items():
            if chunk.document_id == document_id:
                chunks_to_delete.append(chunk_id)

        for chunk_id in chunks_to_delete:
            del self.vector_store.chunks[chunk_id]

        logger.info(f"Deleted document {document_id} and {len(chunks_to_delete)} chunks")
        return True

    async def update_document(self, document: Document) -> Dict[str, Any]:
        """
        Update an existing document in the knowledge base.
        """
        # Delete the old document and its chunks
        await self.delete_document(document.id)

        # Add the updated document
        return await self.add_document(document)

    async def list_documents(self) -> List[Dict[str, Any]]:
        """
        List all documents in the knowledge base.
        """
        return [
            {
                "id": doc.id,
                "source": doc.source,
                "metadata": doc.metadata,
                "created_at": doc.created_at.isoformat(),
                "updated_at": doc.updated_at.isoformat()
            }
            for doc in self.documents.values()
        ]

    async def get_stats(self) -> Dict[str, Any]:
        """
        Get statistics about the knowledge base.
        """
        total_chunks = await self.vector_store.get_chunk_count()

        return {
            "total_documents": len(self.documents),
            "total_chunks": total_chunks,
            "average_chunks_per_document": total_chunks / len(self.documents) if self.documents else 0,
            "indexed_at": datetime.now().isoformat()
        }

    async def clear_knowledge_base(self) -> bool:
        """
        Clear all documents and chunks from the knowledge base.
        """
        self.documents.clear()
        await self.vector_store.clear()

        logger.info("Knowledge base cleared")
        return True
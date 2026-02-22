"""
Embedding module for the AI automation storage test platform.
Handles generation and management of embeddings for documents.
"""
import asyncio
import logging
import hashlib
from typing import List, Dict, Any, Optional
from datetime import datetime

from .vector_store import Chunk, Document
from ..core.exceptions import KnowledgeRetrievalError


logger = logging.getLogger(__name__)


class EmbeddingGenerator:
    """
    Generates embeddings for text content.
    In a real implementation, this would use models like OpenAI, SentenceTransformer, etc.
    For demo purposes, we'll use a simple hash-based approach.
    """

    def __init__(self, dimensions: int = 1536):
        self.dimensions = dimensions

    async def generate_embedding(self, text: str) -> List[float]:
        """
        Generate an embedding for the given text.
        In a real implementation, this would call an ML model.
        For demo, we'll use a hash-based approach that creates consistent embeddings.
        """
        # For demonstration purposes, we'll create a deterministic vector based on the text
        # In a real system, this would use a neural network model

        # Create a hash of the text
        text_hash = hashlib.sha256(text.encode()).hexdigest()

        # Convert hash to a sequence of numbers
        embedding = []
        for i in range(0, len(text_hash), 2):
            if len(embedding) >= self.dimensions:
                break
            # Take two hex characters and convert to a number between -1 and 1
            hex_val = text_hash[i:i+2]
            val = int(hex_val, 16) / 128.0 - 1.0  # Normalize to [-1, 1]
            embedding.append(val)

        # If we don't have enough dimensions, pad with zeros
        while len(embedding) < self.dimensions:
            embedding.append(0.0)

        # Trim to exact dimensions
        embedding = embedding[:self.dimensions]

        return embedding

    async def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for multiple texts.
        """
        embeddings = []
        for text in texts:
            embedding = await self.generate_embedding(text)
            embeddings.append(embedding)
        return embeddings


class DocumentProcessor:
    """
    Processes documents by splitting them into chunks and generating embeddings.
    """

    def __init__(self, chunk_size: int = 1000, overlap: int = 200, embedding_generator: Optional[EmbeddingGenerator] = None):
        self.chunk_size = chunk_size
        self.overlap = overlap
        self.embedding_generator = embedding_generator or EmbeddingGenerator()

    async def process_document(self, document: Document) -> List[Chunk]:
        """
        Process a document by splitting it into chunks and generating embeddings.
        """
        chunks = self._split_text(document.content)
        processed_chunks = []

        for i, chunk_content in enumerate(chunks):
            chunk_id = f"{document.id}_chunk_{i}"

            # Generate embedding for the chunk
            embedding = await self.embedding_generator.generate_embedding(chunk_content)

            chunk = Chunk(
                id=chunk_id,
                document_id=document.id,
                content=chunk_content,
                embedding=embedding,
                metadata={
                    "source": document.source,
                    "original_doc_metadata": document.metadata,
                    "position": i,
                    "processed_at": datetime.now().isoformat()
                },
                position=i
            )

            processed_chunks.append(chunk)
            logger.debug(f"Processed chunk {chunk_id} for document {document.id}")

        logger.info(f"Processed document {document.id} into {len(processed_chunks)} chunks")
        return processed_chunks

    def _split_text(self, text: str) -> List[str]:
        """
        Split text into overlapping chunks.
        """
        if len(text) <= self.chunk_size:
            return [text]

        chunks = []
        start = 0

        while start < len(text):
            end = start + self.chunk_size

            # If this is not the last chunk, try to end at a sentence boundary
            if end < len(text):
                # Look for a sentence ending near the end
                chunk_portion = text[start:end]
                last_sentence_end = max(
                    chunk_portion.rfind('. ') + 2,
                    chunk_portion.rfind('? ') + 2,
                    chunk_portion.rfind('! ') + 2,
                    chunk_portion.rfind('\n') + 1
                )

                if last_sentence_end > len(chunk_portion) // 2:  # Only if it's in the latter half
                    end = start + last_sentence_end

            chunk = text[start:end].strip()
            if chunk:  # Only add non-empty chunks
                chunks.append(chunk)

            # Move start forward by chunk_size minus overlap
            start = end - self.overlap

            # If the remaining text is smaller than chunk_size, make it the final chunk
            if len(text) - start <= self.chunk_size:
                if start < len(text):
                    final_chunk = text[start:].strip()
                    if final_chunk and final_chunk not in chunks:
                        chunks.append(final_chunk)
                break

        return chunks

    async def process_multiple_documents(self, documents: List[Document]) -> List[Chunk]:
        """
        Process multiple documents into chunks.
        """
        all_chunks = []
        for document in documents:
            chunks = await self.process_document(document)
            all_chunks.extend(chunks)
        logger.info(f"Processed {len(documents)} documents into {len(all_chunks)} total chunks")
        return all_chunks
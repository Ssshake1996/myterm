"""
Test file for the Knowledge Layer module.
"""
import asyncio
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from ai_test_system.src.knowledge.service import KnowledgeService
from ai_test_system.src.knowledge.vector_store import Document
from ai_test_system.src.knowledge.embedding import EmbeddingGenerator, DocumentProcessor


async def test_knowledge_layer():
    """Test the basic functionality of the Knowledge Layer."""
    print("Initializing Knowledge Service...")
    knowledge_service = KnowledgeService()

    # Test creating a document
    print("\\nTesting Document Creation...")
    doc1 = Document(
        id="doc1",
        content="RAID (Redundant Array of Independent Disks) is a technology that combines multiple physical disk drives into a single logical unit to increase performance and/or reliability. There are several RAID levels including RAID 0, RAID 1, RAID 5, RAID 6, and RAID 10, each offering different balances of performance, redundancy, and storage capacity.",
        source="raid_basics.md",
        metadata={"type": "specification", "product": "storage_system", "version": "1.0"}
    )
    print(f"✓ Created document: {doc1.id}")

    # Test adding a document
    print("\\nTesting Document Addition...")
    result = await knowledge_service.add_document(doc1)
    print(f"✓ Document added successfully: {result['chunks_created']} chunks created")

    # Add another document
    doc2 = Document(
        id="doc2",
        content="Storage benchmarks are crucial for evaluating the performance of storage systems. Common benchmarks include IOPS (Input/Output Operations Per Second), throughput (MB/s), and latency (ms). Tools like fio, dd, and iometer are commonly used for storage benchmarking.",
        source="storage_benchmarks.md",
        metadata={"type": "guideline", "product": "storage_system", "version": "1.0"}
    )
    result2 = await knowledge_service.add_document(doc2)
    print(f"✓ Second document added: {result2['chunks_created']} chunks created")

    # Test searching the knowledge base
    print("\\nTesting Knowledge Search...")
    search_results = await knowledge_service.search("What is RAID?", top_k=3)
    print(f"✓ Search completed successfully: {search_results['total_found']} results found")

    if search_results['results']:
        first_result = search_results['results'][0]
        print(f"  - Top result similarity: {first_result['similarity_score']:.3f}")
        print(f"  - From source: {first_result['source']}")
        print(f"  - Text preview: {first_result['text'][:100]}...")

    # Search for storage benchmarks
    benchmark_results = await knowledge_service.search("storage benchmark tools", top_k=3)
    print(f"✓ Benchmark search completed: {benchmark_results['total_found']} results found")

    # Test retrieving documents
    print("\\nTesting Document Retrieval...")
    retrieved_doc = await knowledge_service.get_document("doc1")
    if retrieved_doc:
        print(f"✓ Retrieved document: {retrieved_doc.id}")
        print(f"  - Source: {retrieved_doc.source}")
        print(f"  - Content preview: {retrieved_doc.content[:100]}...")

    # Test listing documents
    print("\\nTesting Document Listing...")
    all_docs = await knowledge_service.list_documents()
    print(f"✓ Listed {len(all_docs)} documents:")
    for doc in all_docs:
        print(f"  - {doc['id']}: {doc['source']}")

    # Test getting statistics
    print("\\nTesting Statistics...")
    stats = await knowledge_service.get_stats()
    print(f"✓ Statistics retrieved:")
    print(f"  - Total documents: {stats['total_documents']}")
    print(f"  - Total chunks: {stats['total_chunks']}")
    print(f"  - Average chunks per document: {stats['average_chunks_per_document']:.2f}")

    # Test document processor separately
    print("\\nTesting Document Processor...")
    processor = DocumentProcessor(chunk_size=500, overlap=100)
    test_doc = Document(
        id="test_doc",
        content="This is a test document with multiple sections. The first section discusses the basics of storage systems. Storage systems are essential components of modern computing infrastructure. They provide the ability to store and retrieve digital information reliably. The second section covers advanced topics in storage optimization. Performance optimization is crucial for effective storage systems. Techniques include caching, tiering, and compression. The third section concludes with best practices for storage management. Proper management ensures data integrity and optimal performance.",
        source="test_doc.txt"
    )

    chunks = await processor.process_document(test_doc)
    print(f"✓ Document processed into {len(chunks)} chunks")

    # Show first chunk
    if chunks:
        first_chunk = chunks[0]
        print(f"  - First chunk size: {len(first_chunk.content)} characters")
        print(f"  - Embedding dimension: {len(first_chunk.embedding) if first_chunk.embedding else 0}")
        print(f"  - Chunk preview: {first_chunk.content[:100]}...")

    print("\\nKnowledge Layer tests completed!")


if __name__ == "__main__":
    asyncio.run(test_knowledge_layer())
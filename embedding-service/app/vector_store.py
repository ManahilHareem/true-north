"""
═══════════════════════════════════════════════════════════════════════════════
True North — Vector Store (ChromaDB)

Provides persistent vector storage and similarity search using ChromaDB.
Each uploaded file gets its own metadata tag, enabling per-file and
cross-file querying.

Collections:
  - "truenorth_embeddings" — default collection for all file embeddings

Operations:
  - store_embeddings()  — Add chunks + vectors to the store
  - search_similar()    — Find top-k similar chunks by query
  - delete_file()       — Remove all chunks for a specific file
  - list_files()        — List all files in the store
═══════════════════════════════════════════════════════════════════════════════
"""

import logging
from pathlib import Path
from typing import Optional

import chromadb

from app.config import (
    CHROMA_API_KEY,
    CHROMA_DATABASE,
    CHROMA_PERSIST_DIR,
    CHROMA_TENANT,
    CHROMA_USE_CLOUD,
    EMBEDDING_PROVIDER,
)
from app.chunker import TextChunk

logger = logging.getLogger("embedding-service")

# ── Singleton client ──────────────────────────────────────────────
_chroma_client: Optional[chromadb.ClientAPI] = None
_collection = None

COLLECTION_NAME = "truenorth_embeddings"


def _get_client() -> chromadb.ClientAPI:
    """Get or create the ChromaDB client."""
    global _chroma_client
    if _chroma_client is None:
        if CHROMA_USE_CLOUD:
            _chroma_client = chromadb.CloudClient(
                tenant=CHROMA_TENANT,
                database=CHROMA_DATABASE,
                api_key=CHROMA_API_KEY or None,
            )
            logger.info(f"🗃️  ChromaDB cloud initialized: {CHROMA_TENANT} / {CHROMA_DATABASE}")
        else:
            persist_dir = Path(CHROMA_PERSIST_DIR).expanduser().resolve()
            persist_dir.mkdir(parents=True, exist_ok=True)
            _chroma_client = chromadb.PersistentClient(path=str(persist_dir))
            logger.info(f"🗃️  ChromaDB local store initialized: {persist_dir}")
    return _chroma_client


def _get_collection():
    """Get or create the default collection."""
    global _collection
    if _collection is None:
        client = _get_client()
        _collection = client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )
        logger.info(f"📂 Collection ready: {COLLECTION_NAME}")
    return _collection


def store_embeddings(
    file_id: str,
    file_name: str,
    chunks: list[TextChunk],
    embeddings: list[list[float]],
    user_id: Optional[str] = None,
) -> int:
    """
    Store text chunks and their embeddings in ChromaDB.

    Args:
        file_id: Unique identifier for this file.
        file_name: Original file name.
        chunks: List of TextChunk objects.
        embeddings: Corresponding embedding vectors.

    Returns:
        Number of chunks stored.
    """
    collection = _get_collection()

    ids = [f"{file_id}_chunk_{chunk.chunk_index}" for chunk in chunks]
    documents = [chunk.text for chunk in chunks]
    metadatas = [
        {
            "file_id": file_id,
            "file_name": file_name,
            "chunk_index": chunk.chunk_index,
            "total_chunks": chunk.total_chunks,
            "char_start": chunk.char_start,
            "char_end": chunk.char_end,
            "provider": EMBEDDING_PROVIDER,
            **({"user_id": user_id} if user_id else {}),
        }
        for chunk in chunks
    ]

    collection.add(
        ids=ids,
        documents=documents,
        embeddings=embeddings,
        metadatas=metadatas,
    )

    logger.info(f"✅ Stored {len(chunks)} chunks for file: {file_name} (id: {file_id})")
    return len(chunks)


def search_similar(
    query_embedding: list[float],
    top_k: int = 5,
    file_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> list[dict]:
    """
    Search for the most similar chunks to a query embedding.

    Args:
        query_embedding: The query vector.
        top_k: Number of results to return.
        file_id: Optional filter — search only within a specific file.
        user_id: Optional filter — search only within a specific user's files.

    Returns:
        List of result dictionaries with text, metadata, and distance.
    """
    collection = _get_collection()

    if file_id and user_id:
        where_filter = {"$and": [{"file_id": file_id}, {"user_id": user_id}]}
    elif file_id:
        where_filter = {"file_id": file_id}
    elif user_id:
        where_filter = {"user_id": user_id}
    else:
        where_filter = None

    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k,
        where=where_filter,
        include=["documents", "metadatas", "distances"],
    )

    output = []
    if results and results["documents"]:
        for i, doc in enumerate(results["documents"][0]):
            output.append({
                "text": doc,
                "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
                "distance": results["distances"][0][i] if results["distances"] else None,
            })

    return output


def delete_file(file_id: str) -> int:
    """
    Delete all chunks for a specific file from the store.

    Returns:
        Number of chunks deleted.
    """
    collection = _get_collection()

    # Get existing chunks for this file
    existing = collection.get(where={"file_id": file_id})
    count = len(existing["ids"]) if existing["ids"] else 0

    if count > 0:
        collection.delete(ids=existing["ids"])
        logger.info(f"🗑️  Deleted {count} chunks for file_id: {file_id}")

    return count


def list_stored_files() -> list[dict]:
    """
    List all unique files stored in the collection.

    Returns:
        List of file info dictionaries.
    """
    collection = _get_collection()
    all_data = collection.get(include=["metadatas"])

    if not all_data or not all_data["metadatas"]:
        return []

    # Group by file_id
    files: dict[str, dict] = {}
    for meta in all_data["metadatas"]:
        fid = meta.get("file_id", "unknown")
        if fid not in files:
            files[fid] = {
                "file_id": fid,
                "file_name": meta.get("file_name", "unknown"),
                "total_chunks": meta.get("total_chunks", 0),
                "provider": meta.get("provider", "unknown"),
            }

    return list(files.values())


def get_collection_stats() -> dict:
    """Return stats about the current collection."""
    collection = _get_collection()
    return {
        "collection_name": COLLECTION_NAME,
        "total_chunks": collection.count(),
        "total_files": len(list_stored_files()),
    }

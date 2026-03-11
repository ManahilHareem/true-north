"""
═══════════════════════════════════════════════════════════════════════════════
True North — Pydantic Response Models

Defines all request/response schemas for the FastAPI endpoints.
These models drive the auto-generated Swagger UI documentation and
ensure strict type validation on all API responses.
═══════════════════════════════════════════════════════════════════════════════
"""

from pydantic import BaseModel, Field
from typing import Optional


# ── Health / Info ─────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str = Field(description="Service health status")
    version: str = Field(description="Service version")
    embedding_provider: str = Field(description="Active embedding provider (openai/local)")
    embedding_model: str = Field(description="Model name being used")
    embedding_dimensions: int = Field(description="Vector dimensions")


# ── File Upload / Embedding ──────────────────────────────────────

class ChunkInfo(BaseModel):
    chunk_index: int = Field(description="Index of this chunk")
    total_chunks: int = Field(description="Total number of chunks")
    text_preview: str = Field(description="First 200 characters of chunk text")
    char_start: int = Field(description="Character start position in original text")
    char_end: int = Field(description="Character end position in original text")


class EmbeddingResult(BaseModel):
    file_id: str = Field(description="Unique file identifier")
    file_name: str = Field(description="Original file name")
    file_size_bytes: int = Field(description="File size in bytes")
    total_characters: int = Field(description="Total characters extracted")
    total_chunks: int = Field(description="Number of chunks created")
    embedding_dimensions: int = Field(description="Dimension of each embedding vector")
    embedding_provider: str = Field(description="Embedding provider used")
    embedding_model: str = Field(description="Embedding model used")
    chunks: list[ChunkInfo] = Field(description="Info about each chunk")
    stored_in_vector_db: bool = Field(description="Whether embeddings were stored in ChromaDB")
    processing_time_seconds: float = Field(description="Total processing time")

    class Config:
        json_schema_extra = {
            "example": {
                "file_id": "abc123",
                "file_name": "quarterly_report.pdf",
                "file_size_bytes": 245000,
                "total_characters": 15234,
                "total_chunks": 12,
                "embedding_dimensions": 384,
                "embedding_provider": "local",
                "embedding_model": "all-MiniLM-L6-v2",
                "chunks": [
                    {
                        "chunk_index": 0,
                        "total_chunks": 12,
                        "text_preview": "Executive summary of Q3 results...",
                        "char_start": 0,
                        "char_end": 512,
                    }
                ],
                "stored_in_vector_db": True,
                "processing_time_seconds": 1.42,
            }
        }


# ── Search ────────────────────────────────────────────────────────

class SearchRequest(BaseModel):
    query: str = Field(description="Natural language query to search for")
    top_k: int = Field(default=5, ge=1, le=50, description="Number of results to return")
    file_id: Optional[str] = Field(default=None, description="Filter results to a specific file")
    user_id: Optional[str] = Field(default=None, description="Filter results to a specific user's files")


class SearchResult(BaseModel):
    text: str = Field(description="Matched chunk text")
    file_name: str = Field(description="Source file name")
    file_id: str = Field(description="Source file ID")
    chunk_index: int = Field(description="Chunk index within the file")
    similarity_score: float = Field(description="Cosine similarity score (0-1, higher is more similar)")


class SearchResponse(BaseModel):
    query: str = Field(description="Original query")
    results: list[SearchResult] = Field(description="Search results ordered by similarity")
    total_results: int = Field(description="Number of results returned")


# ── File Management ───────────────────────────────────────────────

class FileInfo(BaseModel):
    file_id: str = Field(description="Unique file identifier")
    file_name: str = Field(description="Original file name")
    total_chunks: int = Field(description="Number of chunks stored")
    provider: str = Field(description="Embedding provider used")


class FileListResponse(BaseModel):
    files: list[FileInfo] = Field(description="List of embedded files")
    total_files: int = Field(description="Total number of files")


class DeleteResponse(BaseModel):
    file_id: str = Field(description="ID of deleted file")
    chunks_deleted: int = Field(description="Number of chunks removed")
    message: str = Field(description="Status message")


# ── Collection Stats ─────────────────────────────────────────────

class CollectionStatsResponse(BaseModel):
    collection_name: str = Field(description="ChromaDB collection name")
    total_chunks: int = Field(description="Total chunks in collection")
    total_files: int = Field(description="Total files embedded")
    embedding_provider: str = Field(description="Current embedding provider")
    embedding_model: str = Field(description="Current embedding model")
    embedding_dimensions: int = Field(description="Vector dimensions")

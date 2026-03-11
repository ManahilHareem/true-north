"""
═══════════════════════════════════════════════════════════════════════════════
True North — Embedding Service (FastAPI)

A microservice that creates vector embeddings from uploaded files.
Part of the True North AI-powered personal growth platform.

ENDPOINTS:
  POST  /api/v1/embeddings/upload     — Upload a file → extract text → chunk → embed → store
  POST  /api/v1/embeddings/search     — Semantic search across all embedded files
  GET   /api/v1/embeddings/files      — List all embedded files
  GET   /api/v1/embeddings/files/{id} — Get details for a specific embedded file
  DELETE /api/v1/embeddings/files/{id} — Delete a file's embeddings
  GET   /api/v1/embeddings/stats      — Collection statistics
  GET   /health                       — Health check

ARCHITECTURE:
  ┌────────────┐     ┌────────────┐     ┌──────────┐     ┌──────────────┐
  │  File      │ ──→ │  Text      │ ──→ │ Chunker  │ ──→ │  Embedder    │
  │  Upload    │     │  Extractor │     │          │     │  (OpenAI /   │
  │            │     │ (PDF/DOCX/ │     │ (sliding │     │   local)     │
  │            │     │  TXT/HTML) │     │  window) │     │              │
  └────────────┘     └────────────┘     └──────────┘     └──────┬───────┘
                                                                │
                                                        ┌───────▼───────┐
                                                        │  ChromaDB     │
                                                        │  Vector Store │
                                                        │  (persistent) │
                                                        └───────────────┘

RUNS ON: http://localhost:8000
DOCS:    http://localhost:8000/docs (Swagger UI)
═══════════════════════════════════════════════════════════════════════════════
"""

import os
import time
import uuid
import shutil
import logging
from typing import Optional
import tempfile
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import (
    SUPPORTED_EXTENSIONS,
    MAX_FILE_SIZE_BYTES,
    MAX_FILE_SIZE_MB,
    EMBEDDING_PROVIDER,
    OPENAI_EMBEDDING_MODEL,
    LOCAL_MODEL_NAME,
    get_embedding_dim,
    HOST,
    PORT,
)
from app.extractor import extract_text
from app.chunker import chunk_text
from app.embedder import generate_embeddings, generate_single_embedding, get_provider_info
from app.vector_store import (
    store_embeddings,
    search_similar,
    delete_file,
    list_stored_files,
    get_collection_stats,
)
from app.models import (
    HealthResponse,
    EmbeddingResult,
    ChunkInfo,
    SearchRequest,
    SearchResponse,
    SearchResult,
    FileListResponse,
    FileInfo,
    DeleteResponse,
    CollectionStatsResponse,
)

# ── Logging ───────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(name)s │ %(levelname)s │ %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("embedding-service")


# ── Lifespan ──────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown logic."""
    provider = get_provider_info()
    logger.info("═" * 60)
    logger.info("  🧭 True North — Embedding Service")
    logger.info(f"  Provider: {provider['provider']} ({provider['model']})")
    logger.info(f"  Dimensions: {provider['dimensions']}")
    logger.info(f"  Docs: http://{HOST}:{PORT}/docs")
    logger.info("═" * 60)
    yield
    logger.info("🛑 Embedding Service shutting down...")


# ── FastAPI App ───────────────────────────────────────────────────
app = FastAPI(
    title="True North Embedding Service",
    description=(
        "🧭 **True North Embedding Service** — A microservice for generating "
        "vector embeddings from uploaded files.\n\n"
        "Part of the True North AI-powered personal growth platform.\n\n"
        "### Supported File Types\n"
        "`.txt` `.md` `.pdf` `.docx` `.html` `.csv` `.json` `.py` `.js` `.ts` `.yaml` `.xml`\n\n"
        "### Embedding Providers\n"
        "- **OpenAI** `text-embedding-3-small` (1536 dim, high quality, requires API key)\n"
        "- **Local** `all-MiniLM-L6-v2` (384 dim, free, runs locally)\n\n"
        "### Architecture\n"
        "Upload → Extract Text → Chunk → Embed → Store in ChromaDB → Search"
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ──────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to your Angular app's domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ═══════════════════════════════════════════════════════════════════
# HEALTH CHECK
# ═══════════════════════════════════════════════════════════════════

@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["Health"],
    summary="Health check",
    description="Returns service status and embedding configuration.",
)
async def health_check():
    provider = get_provider_info()
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        embedding_provider=provider["provider"],
        embedding_model=provider["model"],
        embedding_dimensions=provider["dimensions"],
    )


# ═══════════════════════════════════════════════════════════════════
# FILE UPLOAD → EMBED
# ═══════════════════════════════════════════════════════════════════

@app.post(
    "/api/v1/embeddings/upload",
    response_model=EmbeddingResult,
    tags=["Embeddings"],
    summary="Upload a file and generate embeddings",
    description=(
        "Upload a file to extract text, split into chunks, generate vector "
        "embeddings, and store them in the ChromaDB vector store.\n\n"
        "**Supported formats:** PDF, DOCX, TXT, MD, HTML, CSV, JSON, "
        "Python, JavaScript, TypeScript, YAML, XML\n\n"
        f"**Max file size:** {MAX_FILE_SIZE_MB} MB"
    ),
)
async def upload_and_embed(
    file: UploadFile = File(..., description="The file to upload and embed"),
    store_vectors: bool = Query(default=True, description="Whether to persist embeddings in ChromaDB vector store"),
    file_id: Optional[str] = Form(default=None, description="Use this ID instead of generating one (e.g. Firestore doc ID)"),
    user_id: Optional[str] = Form(default=None, description="Owner user ID — stored in metadata for per-user search filtering"),
):
    start_time = time.time()

    # ── Validate file ─────────────────────────────────────────────
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = Path(file.filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: '{ext}'. Supported: {sorted(SUPPORTED_EXTENSIONS)}",
        )

    # ── Read and validate size ────────────────────────────────────
    content = await file.read()
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({len(content) / 1024 / 1024:.1f} MB). "
                   f"Max: {MAX_FILE_SIZE_MB} MB",
        )

    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file uploaded")

    # ── Save to temp file ─────────────────────────────────────────
    temp_dir = tempfile.mkdtemp()
    temp_path = os.path.join(temp_dir, file.filename)
    try:
        with open(temp_path, "wb") as f:
            f.write(content)

        # ── Step 1: Extract text ──────────────────────────────────
        logger.info(f"📄 Extracting text from: {file.filename} ({len(content)} bytes)")
        try:
            text = extract_text(temp_path, ext)
        except Exception as e:
            raise HTTPException(
                status_code=422,
                detail=f"Failed to extract text from '{file.filename}': {str(e)}",
            )

        if not text or not text.strip():
            raise HTTPException(
                status_code=422,
                detail=f"No text content could be extracted from '{file.filename}'",
            )

        logger.info(f"📝 Extracted {len(text)} characters")

        # ── Step 2: Chunk text ────────────────────────────────────
        chunks = chunk_text(text, file_name=file.filename)
        logger.info(f"🔪 Split into {len(chunks)} chunks")

        if not chunks:
            raise HTTPException(
                status_code=422,
                detail="Text was extracted but no chunks could be created",
            )

        # ── Step 3: Generate embeddings ───────────────────────────
        chunk_texts = [chunk.text for chunk in chunks]
        embeddings = generate_embeddings(chunk_texts)

        # ── Step 4: Store in vector DB ────────────────────────────
        if not file_id:
            file_id = str(uuid.uuid4())[:12]
        stored = False

        if store_vectors:
            store_embeddings(file_id, file.filename, chunks, embeddings, user_id=user_id)
            stored = True

        # ── Build response ────────────────────────────────────────
        provider = get_provider_info()
        elapsed = time.time() - start_time

        chunk_infos = [
            ChunkInfo(
                chunk_index=chunk.chunk_index,
                total_chunks=chunk.total_chunks,
                text_preview=chunk.text[:200] + ("..." if len(chunk.text) > 200 else ""),
                char_start=chunk.char_start,
                char_end=chunk.char_end,
            )
            for chunk in chunks
        ]

        return EmbeddingResult(
            file_id=file_id,
            file_name=file.filename,
            file_size_bytes=len(content),
            total_characters=len(text),
            total_chunks=len(chunks),
            embedding_dimensions=provider["dimensions"],
            embedding_provider=provider["provider"],
            embedding_model=provider["model"],
            chunks=chunk_infos,
            stored_in_vector_db=stored,
            processing_time_seconds=round(elapsed, 3),
        )

    finally:
        # Clean up temp files
        shutil.rmtree(temp_dir, ignore_errors=True)


# ═══════════════════════════════════════════════════════════════════
# SEMANTIC SEARCH
# ═══════════════════════════════════════════════════════════════════

@app.post(
    "/api/v1/embeddings/search",
    response_model=SearchResponse,
    tags=["Search"],
    summary="Semantic search across embedded files",
    description=(
        "Search for the most semantically similar text chunks across all "
        "embedded files. Optionally filter by a specific file ID."
    ),
)
async def semantic_search(request: SearchRequest):
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    # Generate embedding for the query
    query_embedding = generate_single_embedding(request.query)

    if not query_embedding:
        raise HTTPException(status_code=500, detail="Failed to generate query embedding")

    # Search the vector store
    results = search_similar(
        query_embedding=query_embedding,
        top_k=request.top_k,
        file_id=request.file_id,
        user_id=request.user_id,
    )

    # Format results
    search_results = []
    for r in results:
        distance = r.get("distance", 1.0)
        # ChromaDB returns cosine distance; convert to similarity (1 - distance)
        similarity = max(0.0, min(1.0, 1.0 - distance))

        search_results.append(
            SearchResult(
                text=r["text"],
                file_name=r["metadata"].get("file_name", "unknown"),
                file_id=r["metadata"].get("file_id", "unknown"),
                chunk_index=r["metadata"].get("chunk_index", 0),
                similarity_score=round(similarity, 4),
            )
        )

    return SearchResponse(
        query=request.query,
        results=search_results,
        total_results=len(search_results),
    )


# ═══════════════════════════════════════════════════════════════════
# FILE MANAGEMENT
# ═══════════════════════════════════════════════════════════════════

@app.get(
    "/api/v1/embeddings/files",
    response_model=FileListResponse,
    tags=["Files"],
    summary="List all embedded files",
    description="Returns a list of all files that have been embedded and stored.",
)
async def list_files():
    files = list_stored_files()
    file_infos = [
        FileInfo(
            file_id=f["file_id"],
            file_name=f["file_name"],
            total_chunks=f["total_chunks"],
            provider=f["provider"],
        )
        for f in files
    ]
    return FileListResponse(files=file_infos, total_files=len(file_infos))


@app.delete(
    "/api/v1/embeddings/files/{file_id}",
    response_model=DeleteResponse,
    tags=["Files"],
    summary="Delete a file's embeddings",
    description="Remove all embeddings and chunks for a specific file from the vector store.",
)
async def delete_file_embeddings(file_id: str):
    count = delete_file(file_id)
    if count == 0:
        raise HTTPException(
            status_code=404,
            detail=f"No embeddings found for file_id: {file_id}",
        )
    return DeleteResponse(
        file_id=file_id,
        chunks_deleted=count,
        message=f"Successfully deleted {count} chunks for file {file_id}",
    )


# ═══════════════════════════════════════════════════════════════════
# COLLECTION STATS
# ═══════════════════════════════════════════════════════════════════

@app.get(
    "/api/v1/embeddings/stats",
    response_model=CollectionStatsResponse,
    tags=["Stats"],
    summary="Collection statistics",
    description="Returns statistics about the embedding collection (total chunks, files, etc.).",
)
async def collection_stats():
    stats = get_collection_stats()
    provider = get_provider_info()
    return CollectionStatsResponse(
        collection_name=stats["collection_name"],
        total_chunks=stats["total_chunks"],
        total_files=stats["total_files"],
        embedding_provider=provider["provider"],
        embedding_model=provider["model"],
        embedding_dimensions=provider["dimensions"],
    )


# ═══════════════════════════════════════════════════════════════════
# BATCH UPLOAD
# ═══════════════════════════════════════════════════════════════════

@app.post(
    "/api/v1/embeddings/upload/batch",
    tags=["Embeddings"],
    summary="Upload multiple files and generate embeddings",
    description=(
        "Upload multiple files at once. Each file is processed independently "
        "through the same extract → chunk → embed → store pipeline."
    ),
)
async def batch_upload(
    files: list[UploadFile] = File(..., description="Files to upload and embed"),
    store_vectors: bool = Query(default=True, description="Store in ChromaDB"),
):
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    if len(files) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 files per batch upload")

    results = []
    errors = []

    for file in files:
        try:
            # Process each file using the single upload logic
            result = await upload_and_embed(file=file, store_vectors=store_vectors)
            results.append(result)
        except HTTPException as e:
            errors.append({
                "file_name": file.filename,
                "error": e.detail,
            })
        except Exception as e:
            errors.append({
                "file_name": file.filename,
                "error": str(e),
            })

    return {
        "total_files": len(files),
        "successful": len(results),
        "failed": len(errors),
        "results": results,
        "errors": errors,
    }


# ═══════════════════════════════════════════════════════════════════
# RAW TEXT EMBEDDING (no file upload needed)
# ═══════════════════════════════════════════════════════════════════

@app.post(
    "/api/v1/embeddings/text",
    tags=["Embeddings"],
    summary="Embed raw text directly",
    description="Generate embeddings from raw text without uploading a file.",
)
async def embed_text(
    text: str = Query(..., description="Text to embed", min_length=1),
    store_vectors: bool = Query(default=False, description="Store in ChromaDB"),
    label: str = Query(default="raw_text", description="Label for this text in the store"),
):
    start_time = time.time()

    # Chunk the text
    chunks = chunk_text(text, file_name=label)
    if not chunks:
        raise HTTPException(status_code=422, detail="Could not create chunks from text")

    # Generate embeddings
    chunk_texts = [chunk.text for chunk in chunks]
    embeddings = generate_embeddings(chunk_texts)

    # Optionally store
    file_id = str(uuid.uuid4())[:12]
    if store_vectors:
        store_embeddings(file_id, label, chunks, embeddings)

    provider = get_provider_info()
    elapsed = time.time() - start_time

    return {
        "file_id": file_id,
        "label": label,
        "total_characters": len(text),
        "total_chunks": len(chunks),
        "embedding_dimensions": provider["dimensions"],
        "embeddings": embeddings,
        "stored_in_vector_db": store_vectors,
        "processing_time_seconds": round(elapsed, 3),
    }

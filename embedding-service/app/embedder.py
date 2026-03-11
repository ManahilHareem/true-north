"""
═══════════════════════════════════════════════════════════════════════════════
True North — Embedding Engine

Generates vector embeddings from text chunks. Two providers:

  1. OpenAI (text-embedding-3-small):
     - 1536 dimensions, high quality
     - Requires OPENAI_API_KEY
     - ~$0.02 per 1M tokens
     - Batches up to 2048 inputs per request

  2. Local (sentence-transformers/all-MiniLM-L6-v2):
     - 384 dimensions, good quality
     - Runs 100% locally, no API key needed
     - Free forever
     - Perfect for development and small-scale use

The engine auto-selects based on EMBEDDING_PROVIDER in config.
═══════════════════════════════════════════════════════════════════════════════
"""

import time
import logging
from typing import Optional

from app.config import (
    EMBEDDING_PROVIDER,
    OPENAI_API_KEY,
    OPENAI_EMBEDDING_MODEL,
    LOCAL_MODEL_NAME,
    get_embedding_dim,
)

logger = logging.getLogger("embedding-service")

# ── Singleton model holders ───────────────────────────────────────
_openai_client = None
_local_model = None


def _get_openai_client():
    """Lazy-load the OpenAI client."""
    global _openai_client
    if _openai_client is None:
        from openai import OpenAI
        _openai_client = OpenAI(api_key=OPENAI_API_KEY)
        logger.info(f"🔑 OpenAI client initialized (model: {OPENAI_EMBEDDING_MODEL})")
    return _openai_client


def _get_local_model():
    """Lazy-load the local sentence-transformers model."""
    global _local_model
    if _local_model is None:
        from sentence_transformers import SentenceTransformer
        logger.info(f"⏳ Loading local model: {LOCAL_MODEL_NAME} ...")
        _local_model = SentenceTransformer(LOCAL_MODEL_NAME)
        logger.info(f"✅ Local model loaded: {LOCAL_MODEL_NAME}")
    return _local_model


def generate_embeddings(texts: list[str]) -> list[list[float]]:
    """
    Generate embeddings for a list of text strings.

    Args:
        texts: List of text strings to embed.

    Returns:
        List of embedding vectors (each is a list of floats).
    """
    if not texts:
        return []

    start = time.time()

    if EMBEDDING_PROVIDER == "openai":
        embeddings = _embed_openai(texts)
    else:
        embeddings = _embed_local(texts)

    elapsed = time.time() - start
    logger.info(
        f"📊 Generated {len(embeddings)} embeddings "
        f"(dim={len(embeddings[0]) if embeddings else 0}) "
        f"in {elapsed:.2f}s"
    )
    return embeddings


def generate_single_embedding(text: str) -> list[float]:
    """Generate an embedding for a single text string."""
    result = generate_embeddings([text])
    return result[0] if result else []


def _embed_openai(texts: list[str]) -> list[list[float]]:
    """Generate embeddings using OpenAI API."""
    client = _get_openai_client()

    # OpenAI supports batching up to 2048 inputs
    all_embeddings = []
    batch_size = 2048

    for i in range(0, len(texts), batch_size):
        batch = texts[i: i + batch_size]
        response = client.embeddings.create(
            input=batch,
            model=OPENAI_EMBEDDING_MODEL,
        )
        batch_embeddings = [item.embedding for item in response.data]
        all_embeddings.extend(batch_embeddings)

    return all_embeddings


def _embed_local(texts: list[str]) -> list[list[float]]:
    """Generate embeddings using local sentence-transformers model."""
    model = _get_local_model()
    embeddings = model.encode(texts, show_progress_bar=False, convert_to_numpy=True)
    return [emb.tolist() for emb in embeddings]


def get_provider_info() -> dict:
    """Return info about the current embedding provider."""
    return {
        "provider": EMBEDDING_PROVIDER,
        "model": OPENAI_EMBEDDING_MODEL if EMBEDDING_PROVIDER == "openai" else LOCAL_MODEL_NAME,
        "dimensions": get_embedding_dim(),
    }

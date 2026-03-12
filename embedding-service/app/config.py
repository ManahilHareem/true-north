"""
═══════════════════════════════════════════════════════════════════════════════
True North — Embedding Service Configuration

Loads environment variables and provides typed configuration for the
entire embedding service. Supports two embedding providers:
  - "openai"  → OpenAI text-embedding-3-small (requires OPENAI_API_KEY)
  - "local"   → sentence-transformers all-MiniLM-L6-v2 (free, runs locally)
═══════════════════════════════════════════════════════════════════════════════
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env file from the embedding-service directory
_env_path = Path(__file__).parent.parent / ".env"
load_dotenv(_env_path)

# ── Embedding Provider ────────────────────────────────────────────
EMBEDDING_PROVIDER: str = os.getenv("EMBEDDING_PROVIDER", "local")  # "openai" or "local"

# ── OpenAI Config ─────────────────────────────────────────────────
OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
OPENAI_EMBEDDING_MODEL: str = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")

# ── Local Model Config ────────────────────────────────────────────
LOCAL_MODEL_NAME: str = os.getenv("LOCAL_MODEL_NAME", "all-MiniLM-L6-v2")

# ── Server Config ─────────────────────────────────────────────────
HOST: str = os.getenv("HOST", "0.0.0.0")
PORT: int = int(os.getenv("PORT", "8000"))

# ── Chunking Config ───────────────────────────────────────────────
CHUNK_SIZE: int = int(os.getenv("CHUNK_SIZE", "512"))
CHUNK_OVERLAP: int = int(os.getenv("CHUNK_OVERLAP", "64"))

# ── ChromaDB Cloud Config ─────────────────────────────────────────
CHROMA_USE_CLOUD: bool = os.getenv("CHROMA_USE_CLOUD", "false").strip().lower() == "true"
CHROMA_HOST: str = os.getenv("CHROMA_HOST", "")
CHROMA_API_KEY: str = os.getenv("CHROMA_API_KEY", "")
CHROMA_TENANT: str = os.getenv("CHROMA_TENANT", "")
CHROMA_DATABASE: str = os.getenv("CHROMA_DATABASE", "default_database")
CHROMA_PERSIST_DIR: str = os.getenv(
    "CHROMA_PERSIST_DIR",
    str(Path(__file__).parent.parent / "chroma_data"),
)

# ── Upload Config ─────────────────────────────────────────────────
MAX_FILE_SIZE_MB: int = int(os.getenv("MAX_FILE_SIZE_MB", "50"))
MAX_FILE_SIZE_BYTES: int = MAX_FILE_SIZE_MB * 1024 * 1024

# ── Supported File Types ──────────────────────────────────────────
SUPPORTED_EXTENSIONS: set[str] = {
    ".txt", ".md", ".csv", ".json",
    ".pdf",
    ".docx",
    ".html", ".htm",
    ".py", ".js", ".ts", ".jsx", ".tsx",
    ".log", ".xml", ".yaml", ".yml",
}

# ── Embedding Dimensions ─────────────────────────────────────────
EMBEDDING_DIMENSIONS: dict[str, int] = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "all-MiniLM-L6-v2": 384,
    "all-mpnet-base-v2": 768,
}


def get_embedding_dim() -> int:
    """Return the embedding dimension for the configured model."""
    if EMBEDDING_PROVIDER == "openai":
        return EMBEDDING_DIMENSIONS.get(OPENAI_EMBEDDING_MODEL, 1536)
    return EMBEDDING_DIMENSIONS.get(LOCAL_MODEL_NAME, 384)

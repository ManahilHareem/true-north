# True North — Embedding Service

> 🧭 A FastAPI microservice that creates vector embeddings from uploaded files.
> Part of the True North AI-powered personal growth platform.

## Architecture

```
┌────────────┐     ┌────────────┐     ┌──────────┐     ┌──────────────┐
│  File      │ ──→ │  Text      │ ──→ │ Chunker  │ ──→ │  Embedder    │
│  Upload    │     │  Extractor │     │          │     │  (OpenAI /   │
│  (API)     │     │ (PDF/DOCX/ │     │ (sliding │     │   local)     │
│            │     │  TXT/HTML) │     │  window) │     │              │
└────────────┘     └────────────┘     └──────────┘     └──────┬───────┘
                                                              │
                                                      ┌───────▼───────┐
                                                      │  ChromaDB     │
                                                      │  Vector Store │
                                                      │  (persistent) │
                                                      └───────────────┘
```

## Quick Start

### 1. Create virtual environment

```bash
cd embedding-service
python3 -m venv venv
source venv/bin/activate
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env to set your preferences (defaults work out of box with local embeddings)
```

### 4. Start the server

```bash
python run.py
```

The server starts at **http://localhost:8000**

- **Swagger UI:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc

## Embedding Providers

| Provider | Model | Dimensions | Cost | Quality |
|----------|-------|------------|------|---------|
| `local` (default) | `all-MiniLM-L6-v2` | 384 | Free | Good |
| `openai` | `text-embedding-3-small` | 1536 | ~$0.02/1M tokens | Excellent |

Set `EMBEDDING_PROVIDER=local` or `EMBEDDING_PROVIDER=openai` in `.env`.

## API Endpoints

### Upload & Embed

```bash
# Single file
curl -X POST http://localhost:8000/api/v1/embeddings/upload \
  -F "file=@document.pdf"

# Multiple files
curl -X POST http://localhost:8000/api/v1/embeddings/upload/batch \
  -F "files=@doc1.pdf" \
  -F "files=@doc2.txt"

# Raw text
curl -X POST "http://localhost:8000/api/v1/embeddings/text?text=Hello+world&store_vectors=true"
```

### Semantic Search

```bash
curl -X POST http://localhost:8000/api/v1/embeddings/search \
  -H "Content-Type: application/json" \
  -d '{"query": "financial planning strategies", "top_k": 5}'
```

### File Management

```bash
# List files
curl http://localhost:8000/api/v1/embeddings/files

# Delete file
curl -X DELETE http://localhost:8000/api/v1/embeddings/files/{file_id}

# Stats
curl http://localhost:8000/api/v1/embeddings/stats
```

## Supported File Types

| Category | Extensions |
|----------|-----------|
| Documents | `.pdf` `.docx` `.txt` `.md` |
| Data | `.csv` `.json` `.xml` `.yaml` `.yml` |
| Web | `.html` `.htm` |
| Code | `.py` `.js` `.ts` `.jsx` `.tsx` |
| Logs | `.log` |

## Project Structure

```
embedding-service/
├── app/
│   ├── __init__.py
│   ├── main.py          # FastAPI application + all endpoints
│   ├── config.py         # Environment config
│   ├── extractor.py      # Text extraction (PDF, DOCX, HTML, etc.)
│   ├── chunker.py        # Text chunking with overlap
│   ├── embedder.py       # Embedding generation (OpenAI / local)
│   ├── vector_store.py   # ChromaDB vector storage + search
│   └── models.py         # Pydantic request/response schemas
├── run.py                # Entry point
├── requirements.txt      # Python dependencies
├── .env.example          # Environment template
└── README.md             # This file
```

## How It Fits Into True North

This service extends the True North platform's file handling capabilities:

- **Current flow:** Files uploaded → Firebase Storage → `onFileUpload` Cloud Function → Claude Haiku summarization
- **With this service:** Files uploaded → Embedding Service → vector embeddings stored in ChromaDB → semantic search across all user documents

The Angular frontend can call this service to:
1. Generate embeddings when users upload documents during onboarding or in the Files page
2. Power semantic search across a user's uploaded documents
3. Provide context-aware RAG (Retrieval-Augmented Generation) for the chat agents

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDING_PROVIDER` | `local` | `openai` or `local` |
| `OPENAI_API_KEY` | — | Required if provider is `openai` |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | OpenAI model name |
| `LOCAL_MODEL_NAME` | `all-MiniLM-L6-v2` | Sentence-transformers model |
| `HOST` | `0.0.0.0` | Server host |
| `PORT` | `8000` | Server port |
| `CHUNK_SIZE` | `512` | Characters per chunk |
| `CHUNK_OVERLAP` | `64` | Overlap between chunks |
| `CHROMA_PERSIST_DIR` | `./chroma_data` | ChromaDB storage path |
| `MAX_FILE_SIZE_MB` | `50` | Max upload size |

"""
True North — Embedding Service Entry Point

Run with: python run.py
Or with: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""

import uvicorn
from app.config import HOST, PORT

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=HOST,
        port=PORT,
        reload=True,
        log_level="info",
    )

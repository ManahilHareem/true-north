"""
═══════════════════════════════════════════════════════════════════════════════
True North — Text Chunker

Splits extracted text into overlapping chunks optimized for embedding.
Uses a sliding window approach with configurable size and overlap.

Strategy:
  1. Split text into sentences (preserves semantic boundaries)
  2. Build chunks by accumulating sentences up to CHUNK_SIZE tokens
  3. Apply CHUNK_OVERLAP tokens of overlap between consecutive chunks
  4. Attach metadata (chunk_index, total_chunks, char_start, char_end)

This ensures each chunk is semantically coherent and embeddings capture
enough context for accurate retrieval.
═══════════════════════════════════════════════════════════════════════════════
"""

import re
from dataclasses import dataclass, field
from typing import Optional

from app.config import CHUNK_SIZE, CHUNK_OVERLAP


@dataclass
class TextChunk:
    """A single chunk of text with positional metadata."""
    text: str
    chunk_index: int
    total_chunks: int
    char_start: int
    char_end: int
    metadata: dict = field(default_factory=dict)


def chunk_text(
    text: str,
    chunk_size: int = CHUNK_SIZE,
    chunk_overlap: int = CHUNK_OVERLAP,
    file_name: Optional[str] = None,
) -> list[TextChunk]:
    """
    Split text into overlapping chunks.

    Args:
        text: The full text to chunk.
        chunk_size: Target number of characters per chunk.
        chunk_overlap: Number of overlapping characters between chunks.
        file_name: Optional filename to include in metadata.

    Returns:
        List of TextChunk objects.
    """
    if not text or not text.strip():
        return []

    # Normalize whitespace
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = text.strip()

    # If text is short enough, return as a single chunk
    if len(text) <= chunk_size:
        return [
            TextChunk(
                text=text,
                chunk_index=0,
                total_chunks=1,
                char_start=0,
                char_end=len(text),
                metadata={"file_name": file_name} if file_name else {},
            )
        ]

    # Split into sentences for semantic boundaries
    sentences = _split_sentences(text)

    chunks: list[TextChunk] = []
    current_chunk_chars: list[str] = []
    current_length = 0
    char_offset = 0

    for sentence in sentences:
        sentence_len = len(sentence)

        # If adding this sentence would exceed chunk_size, finalize current chunk
        if current_length + sentence_len > chunk_size and current_chunk_chars:
            chunk_text_str = " ".join(current_chunk_chars)
            chunk_start = char_offset
            chunk_end = chunk_start + len(chunk_text_str)

            chunks.append(
                TextChunk(
                    text=chunk_text_str,
                    chunk_index=len(chunks),
                    total_chunks=0,  # Will be set after all chunks are created
                    char_start=chunk_start,
                    char_end=chunk_end,
                    metadata={"file_name": file_name} if file_name else {},
                )
            )

            # Calculate how much to keep for overlap
            overlap_chars: list[str] = []
            overlap_length = 0
            for s in reversed(current_chunk_chars):
                if overlap_length + len(s) > chunk_overlap:
                    break
                overlap_chars.insert(0, s)
                overlap_length += len(s)

            # Advance char_offset past the non-overlapping part
            char_offset = chunk_end - overlap_length

            current_chunk_chars = overlap_chars
            current_length = overlap_length

        current_chunk_chars.append(sentence)
        current_length += sentence_len

    # Don't forget the last chunk
    if current_chunk_chars:
        chunk_text_str = " ".join(current_chunk_chars)
        chunks.append(
            TextChunk(
                text=chunk_text_str,
                chunk_index=len(chunks),
                total_chunks=0,
                char_start=char_offset,
                char_end=char_offset + len(chunk_text_str),
                metadata={"file_name": file_name} if file_name else {},
            )
        )

    # Set total_chunks on all chunks
    total = len(chunks)
    for chunk in chunks:
        chunk.total_chunks = total

    return chunks


def _split_sentences(text: str) -> list[str]:
    """
    Split text into sentence-like segments.

    Uses a regex that splits on sentence-ending punctuation followed by
    whitespace, while preserving abbreviations and decimal numbers.
    Falls back to splitting on double newlines if no sentences found.
    """
    # Split on sentence boundaries
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z])", text)

    # If we got very few splits, also try double-newline splitting
    if len(sentences) <= 2:
        alt_sentences = text.split("\n\n")
        if len(alt_sentences) > len(sentences):
            sentences = alt_sentences

    # Further split very long segments
    result = []
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        if len(sentence) > CHUNK_SIZE:
            # Split long segments on single newlines or periods
            sub_parts = re.split(r"\n|(?<=[.!?])\s+", sentence)
            result.extend(p.strip() for p in sub_parts if p.strip())
        else:
            result.append(sentence)

    return result

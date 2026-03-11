/**
 * EmbeddingService — client for the True North Embedding microservice.
 *
 * Routes all calls to the FastAPI embedding service running on localhost:8000
 * (or the URL set in environment.embeddingServiceUrl).
 *
 * Responsibilities:
 *   - indexFile()              → upload a file to the embedding service for indexing
 *   - deleteFileEmbeddings()   → remove a file's vectors when the file is deleted
 *   - searchDocuments()        → semantic search over a user's indexed files
 */
import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

export interface EmbeddingSearchResult {
  text: string;
  file_name: string;
  file_id: string;
  chunk_index: number;
  similarity_score: number;
}

@Injectable({ providedIn: 'root' })
export class EmbeddingService {
  private readonly baseUrl = environment.embeddingServiceUrl;

  /**
   * Index a file in the embedding service.
   * Uses the Firestore document ID as file_id so deletions stay in sync.
   */
  async indexFile(file: File, fileId: string, userId: string): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    form.append('file_id', fileId);
    form.append('user_id', userId);

    const res = await fetch(`${this.baseUrl}/api/v1/embeddings/upload`, {
      method: 'POST',
      body: form,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Embedding indexing failed: ${err}`);
    }
  }

  /**
   * Delete all vectors for a file (call when the file is deleted from Firestore).
   * Ignores 404 — if it was never indexed that's fine.
   */
  async deleteFileEmbeddings(fileId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/v1/embeddings/files/${fileId}`, {
      method: 'DELETE',
    });

    if (!res.ok && res.status !== 404) {
      const err = await res.text();
      throw new Error(`Embedding delete failed: ${err}`);
    }
  }

  /**
   * Semantic search over a user's indexed files.
   * Returns top matching chunks sorted by similarity score.
   */
  async searchDocuments(
    query: string,
    userId: string,
    topK = 5,
  ): Promise<EmbeddingSearchResult[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/embeddings/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, user_id: userId, top_k: topK }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Embedding search failed: ${err}`);
    }

    const data = await res.json();
    return data.results as EmbeddingSearchResult[];
  }
}

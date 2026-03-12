class EmbeddingServiceClient {
  constructor({ baseUrl, timeoutMs = 3000 }) {
    this.baseUrl = (baseUrl || "").replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
  }

  async searchUserDocuments({ userId, query, topK = 5 }) {
    if (!this.baseUrl) {
      throw new Error("EMBEDDING_SERVICE_URL is not configured.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/embeddings/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          user_id: userId,
          top_k: topK,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Embedding service search failed (${response.status}): ${errorText}`);
      }

      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = { EmbeddingServiceClient };

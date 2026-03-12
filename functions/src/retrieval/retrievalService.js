const { EmbeddingServiceClient } = require("./embeddingServiceClient");

function normalizeEvidence(payload) {
  if (!payload) return [];

  if (Array.isArray(payload.results)) {
    return payload.results.map((item) => ({
      documentId: String(item.documentId || item.file_id || item.id || ""),
      chunkId: String(item.chunkId || item.chunk_index || item.id || ""),
      text: String(item.text || item.content || ""),
      score: typeof item.score === "number" ? item.score : typeof item.similarity_score === "number" ? item.similarity_score : typeof item.distance === "number" ? 1 - item.distance : 0,
      sourceType: String(item.sourceType || "document"),
      sourceName: String(item.sourceName || item.file_name || item.metadata?.sourceName || item.metadata?.fileName || "Unknown source"),
      metadata: item.metadata || {
        fileId: item.file_id,
        fileName: item.file_name,
        chunkIndex: item.chunk_index,
      },
    })).filter((item) => item.documentId && item.chunkId && item.text);
  }

  const documents = Array.isArray(payload.documents) ? payload.documents[0] || [] : [];
  const metadatas = Array.isArray(payload.metadatas) ? payload.metadatas[0] || [] : [];
  const distances = Array.isArray(payload.distances) ? payload.distances[0] || [] : [];
  const ids = Array.isArray(payload.ids) ? payload.ids[0] || [] : [];

  return documents.map((text, index) => {
    const metadata = metadatas[index] || {};
    const distance = typeof distances[index] === "number" ? distances[index] : null;
    const id = ids[index] || metadata.chunkId || metadata.documentId || "";

    return {
      documentId: String(metadata.documentId || metadata.fileId || id),
      chunkId: String(metadata.chunkId || id),
      text: String(text || ""),
      score: distance === null ? 0 : 1 - distance,
      sourceType: String(metadata.sourceType || "document"),
      sourceName: String(metadata.sourceName || metadata.fileName || metadata.documentName || "Unknown source"),
      metadata,
    };
  }).filter((item) => item.documentId && item.chunkId && item.text);
}

async function retrieveEvidence({
  embeddingServiceUrl,
  userId,
  query,
  topK = 5,
  minScore = 0.2,
  timeoutMs = 3000,
}) {
  if (!query || !userId) {
    return { evidence: [], retrievalStatus: "empty" };
  }

  const client = new EmbeddingServiceClient({
    baseUrl: embeddingServiceUrl,
    timeoutMs,
  });

  try {
    const payload = await client.searchUserDocuments({
      userId,
      query,
      topK,
    });

    const evidence = normalizeEvidence(payload).filter((item) => item.score >= minScore).slice(0, topK);

    return {
      evidence,
      retrievalStatus: evidence.length > 0 ? "ok" : "empty",
    };
  } catch (error) {
    console.error("Chroma retrieval error:", error);
    return {
      evidence: [],
      retrievalStatus: "degraded",
    };
  }
}

module.exports = { retrieveEvidence };

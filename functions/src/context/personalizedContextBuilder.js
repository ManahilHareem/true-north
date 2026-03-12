const { getUserProfileBundle, getUserMemory, getRecentThreadMessages } = require("../shared/userData");
const { retrieveEvidence } = require("../retrieval/retrievalService");

function clipText(text, maxLength) {
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function formatMemory(memory) {
  if (!memory) return "No persistent memory available yet.";

  const lines = [];

  if (memory.coreInsights && memory.coreInsights.length) {
    lines.push("Core insights:");
    memory.coreInsights.forEach((item) => lines.push(`- ${item}`));
  }

  if (memory.activePatterns && memory.activePatterns.length) {
    lines.push("Active patterns:");
    memory.activePatterns.forEach((item) => lines.push(`- ${item.pattern} (${item.frequency || 1}x)`));
  }

  if (memory.avoidances && memory.avoidances.length) {
    lines.push("Avoidances:");
    memory.avoidances.forEach((item) => lines.push(`- ${item}`));
  }

  if (memory.currentEdge) {
    lines.push(`Current edge: ${memory.currentEdge}`);
  }

  return lines.join("\n") || "No persistent memory available yet.";
}

async function buildPersonalizedContext({
  userId,
  message,
  threadId,
  embeddingServiceUrl,
  topK = 5,
  maxEvidence = 3,
}) {
  const [userBundle, memory, threadMessages, retrieval] = await Promise.all([
    getUserProfileBundle(userId),
    getUserMemory(userId),
    getRecentThreadMessages(userId, threadId),
    retrieveEvidence({
      embeddingServiceUrl,
      userId,
      query: message,
      topK,
    }),
  ]);

  if (!userBundle) {
    throw new Error("User profile bundle not found.");
  }

  return {
    profile: userBundle.profile || null,
    onboarding: userBundle.onboarding || null,
    memory,
    memoryText: formatMemory(memory),
    threadMessages: threadMessages.slice(-12).map((item) => ({
      role: item.role,
      content: clipText(item.content, 800),
      agentId: item.agentId,
    })),
    evidence: retrieval.evidence.slice(0, maxEvidence).map((item) => ({
      ...item,
      text: clipText(item.text, 1000),
    })),
    retrievalStatus: retrieval.retrievalStatus,
  };
}

module.exports = { buildPersonalizedContext };

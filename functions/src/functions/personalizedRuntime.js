const { HttpsError } = require("firebase-functions/v2/https");
const { requireUserAccess } = require("../auth/requireUserAccess");
const { callText } = require("../shared/anthropic");
const { buildPersonalizedContext } = require("../context/personalizedContextBuilder");
const { runOrchestrator } = require("../orchestration/orchestrator");
const { listAgents } = require("../agents/registry");
const { mergeMemoryUpdate, saveResponseLog } = require("../shared/userData");

function getSecretValue(secret, secretName) {
  try {
    return process.env[secretName] || secret.value();
  } catch (error) {
    return process.env[secretName] || "";
  }
}

async function personalizedRespondHandler(request, deps) {
  const userId = requireUserAccess(request);
  const message = String(request.data.message || "").trim();

  if (!message) {
    throw new HttpsError("invalid-argument", "message is required.");
  }

  const context = await buildPersonalizedContext({
    userId,
    message,
    threadId: request.data.threadId,
    embeddingServiceUrl: process.env.EMBEDDING_SERVICE_URL || "http://127.0.0.1:8000",
  });

  const result = await runOrchestrator({
    mode: request.data.mode || "auto",
    preferredAgent: request.data.preferredAgent,
    task: message,
    context,
    callText,
    apiKey: getSecretValue(deps.anthropicSecret, deps.anthropicSecretName),
  });

  const memoryPromise = mergeMemoryUpdate(userId, result.memoryUpdate, result.selectedAgent).catch((error) => {
    console.error("Memory update failed:", error);
    return false;
  });

  await saveResponseLog(userId, {
    endpoint: "onPersonalizedRespond",
    selectedAgent: result.selectedAgent,
    retrievalStatus: context.retrievalStatus,
    evidenceCount: context.evidence.length,
    task: message,
  });

  memoryPromise.catch(() => undefined);

  return {
    response: result.output,
    selectedAgent: result.selectedAgent,
    evidence: result.citations,
    retrievalStatus: context.retrievalStatus,
    memoryUpdateQueued: true,
  };
}

async function runAgentTaskHandler(request, deps) {
  const userId = requireUserAccess(request);
  const task = String(request.data.task || "").trim();
  const agentType = String(request.data.agentType || "").trim();

  if (!task || !agentType) {
    throw new HttpsError("invalid-argument", "agentType and task are required.");
  }

  const context = await buildPersonalizedContext({
    userId,
    message: task,
    threadId: request.data.threadId,
    embeddingServiceUrl: process.env.EMBEDDING_SERVICE_URL || "http://127.0.0.1:8000",
  });

  const result = await runOrchestrator({
    mode: "direct",
    preferredAgent: agentType,
    task,
    context,
    callText,
    apiKey: getSecretValue(deps.anthropicSecret, deps.anthropicSecretName),
  });

  const memoryPromise = mergeMemoryUpdate(userId, result.memoryUpdate, result.selectedAgent).catch((error) => {
    console.error("Memory update failed:", error);
    return false;
  });

  await saveResponseLog(userId, {
    endpoint: "onRunAgentTask",
    selectedAgent: result.selectedAgent,
    retrievalStatus: context.retrievalStatus,
    evidenceCount: context.evidence.length,
    task,
  });

  memoryPromise.catch(() => undefined);

  return {
    result: result.output,
    agentType: result.selectedAgent,
    evidence: result.citations,
    retrievalStatus: context.retrievalStatus,
  };
}

async function listAgentsHandler(request) {
  requireUserAccess(request);
  return { agents: listAgents() };
}

module.exports = {
  personalizedRespondHandler,
  runAgentTaskHandler,
  listAgentsHandler,
};

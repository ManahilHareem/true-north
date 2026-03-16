const { HttpsError } = require("firebase-functions/v2/https");
const { requireFounderAccess, requireUserAccess } = require("../auth/requireUserAccess");
const { callText } = require("../shared/anthropic");
const { buildPersonalizedContext } = require("../context/personalizedContextBuilder");
const { runOrchestrator } = require("../orchestration/orchestrator");
const { listAgents } = require("../agents/registry");
const { getAgentPromptConfigs, mergeMemoryUpdate, saveAgentPromptConfig, saveResponseLog, saveRuntimeMessage } = require("../shared/userData");
const { getAgent, listAgents: listAgentDefinitions } = require("../agents/registry");

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
  const agentPromptConfigs = await getAgentPromptConfigs(userId);

  const result = await runOrchestrator({
    mode: request.data.mode || "auto",
    preferredAgent: request.data.preferredAgent,
    task: message,
    context,
    callText,
    apiKey: getSecretValue(deps.anthropicSecret, deps.anthropicSecretName),
    agentPromptConfigs,
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

  await saveRuntimeMessage(userId, request.data.threadId, {
    role: "assistant",
    content: result.output,
    mode: request.data.mode || "auto",
    agentType: result.selectedAgent,
    retrievalStatus: context.retrievalStatus,
    evidence: result.citations,
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
  const agentPromptConfigs = await getAgentPromptConfigs(userId);

  const result = await runOrchestrator({
    mode: "direct",
    preferredAgent: agentType,
    task,
    context,
    callText,
    apiKey: getSecretValue(deps.anthropicSecret, deps.anthropicSecretName),
    agentPromptConfigs,
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

  await saveRuntimeMessage(userId, request.data.threadId, {
    role: "assistant",
    content: result.output,
    mode: "direct",
    agentType: result.selectedAgent,
    retrievalStatus: context.retrievalStatus,
    evidence: result.citations,
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

async function getAgentPromptConfigsHandler(request) {
  const userId = await requireFounderAccess(request);
  const stored = await getAgentPromptConfigs(userId);
  const prompts = listAgentDefinitions().map((agent) => ({
    id: agent.id,
    name: agent.name,
    description: agent.description,
    editableLabel: agent.editableLabel,
    instructions: stored[agent.id]?.instructions || agent.defaultInstructions,
    defaultInstructions: agent.defaultInstructions,
    updatedAt: stored[agent.id]?.updatedAt || null,
  }));

  return { prompts };
}

async function saveAgentPromptConfigHandler(request) {
  const userId = await requireFounderAccess(request);
  const agentId = String(request.data.agentId || "").trim();
  const instructions = String(request.data.instructions || "").trim();

  if (!agentId || !instructions) {
    throw new HttpsError("invalid-argument", "agentId and instructions are required.");
  }

  if (!getAgent(agentId)) {
    throw new HttpsError("not-found", "Unknown agent.");
  }

  await saveAgentPromptConfig(userId, agentId, { instructions });

  return { success: true };
}

module.exports = {
  getAgentPromptConfigsHandler,
  personalizedRespondHandler,
  runAgentTaskHandler,
  saveAgentPromptConfigHandler,
  listAgentsHandler,
};

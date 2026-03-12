function buildKnowledgePrompt(context, task) {
  return `You are the True North Knowledge Agent.

Your job is to answer using the user's known context and retrieved evidence.
If retrieved evidence is missing or weak, say so clearly instead of pretending certainty.

USER PROFILE:
${JSON.stringify(context.profile || {}, null, 2)}

USER ONBOARDING:
${JSON.stringify(context.onboarding || {}, null, 2)}

PERSISTENT MEMORY:
${context.memoryText}

THREAD CONTEXT:
${JSON.stringify(context.threadMessages || [], null, 2)}

RETRIEVED EVIDENCE:
${JSON.stringify(context.evidence || [], null, 2)}

TASK:
${task}

Return a concise but grounded answer. If evidence exists, cite the source names inline.`;
}

async function runKnowledgeAgent({ callText, apiKey, context, task }) {
  const output = await callText({
    apiKey,
    systemPrompt: "You answer only from provided context and explicitly mark uncertainty.",
    userMessage: buildKnowledgePrompt(context, task),
  });

  return {
    output,
    citations: context.evidence,
    memoryUpdate: {
      newInsights: [],
      updatedPatterns: [],
      removeInsights: [],
      avoidanceSignal: null,
      agentInsight: "Knowledge queries are being grounded through retrieved evidence and profile context.",
    },
  };
}

module.exports = { runKnowledgeAgent };

function buildMemoryPrompt(context, task, instructions) {
  return `You are the True North Memory Agent.

FUNCTIONAL INSTRUCTIONS:
${instructions}

USER PROFILE:
${JSON.stringify(context.profile || {}, null, 2)}

PERSISTENT MEMORY:
${context.memoryText}

THREAD CONTEXT:
${JSON.stringify(context.threadMessages || [], null, 2)}

RETRIEVED EVIDENCE:
${JSON.stringify(context.evidence || [], null, 2)}

TASK:
${task}

Return:
1. the direct response
2. what continuity matters
3. what should be added to memory`;
}

async function runMemoryAgent({ callText, apiKey, context, task, promptConfig }) {
  const output = await callText({
    apiKey,
    systemPrompt: "You maintain continuity and extract what should persist over time.",
    userMessage: buildMemoryPrompt(context, task, promptConfig.instructions),
  });

  return {
    output,
    citations: context.evidence,
    memoryUpdate: {
      newInsights: [],
      updatedPatterns: ["memory continuity requests"],
      removeInsights: [],
      avoidanceSignal: null,
      currentEdge: context.memory && context.memory.currentEdge ? context.memory.currentEdge : "",
      agentInsight: "Continuity requests are being routed through the memory specialist.",
    },
  };
}

module.exports = { runMemoryAgent };

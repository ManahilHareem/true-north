function buildResearchPrompt(context, task, instructions) {
  return `You are the True North Research Agent.

FUNCTIONAL INSTRUCTIONS:
${instructions}

USER PROFILE:
${JSON.stringify(context.profile || {}, null, 2)}

PERSISTENT MEMORY:
${context.memoryText}

RETRIEVED INTERNAL EVIDENCE:
${JSON.stringify(context.evidence || [], null, 2)}

TASK:
${task}

Return:
1. short answer
2. what internal evidence supports it
3. what is still unknown`;
}

async function runResearchAgent({ callText, apiKey, context, task, promptConfig }) {
  const output = await callText({
    apiKey,
    systemPrompt: "You are a structured research synthesizer. Be explicit about knowns and unknowns.",
    userMessage: buildResearchPrompt(context, task, promptConfig.instructions),
  });

  return {
    output,
    citations: context.evidence,
    memoryUpdate: {
      newInsights: [],
      updatedPatterns: ["research oriented requests"],
      removeInsights: [],
      avoidanceSignal: null,
      agentInsight: "Research tasks benefit from structured known/unknown framing.",
    },
  };
}

module.exports = { runResearchAgent };

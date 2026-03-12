function buildResearchPrompt(context, task) {
  return `You are the True North Research Agent.

You synthesize what is already known internally and structure the answer like research notes.
Do not claim you performed external browsing unless it is explicitly provided in the context.

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

async function runResearchAgent({ callText, apiKey, context, task }) {
  const output = await callText({
    apiKey,
    systemPrompt: "You are a structured research synthesizer. Be explicit about knowns and unknowns.",
    userMessage: buildResearchPrompt(context, task),
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

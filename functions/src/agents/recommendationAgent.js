function buildRecommendationPrompt(context, task, instructions) {
  return `You are the True North Recommendation Agent.

FUNCTIONAL INSTRUCTIONS:
${instructions}

USER PROFILE:
${JSON.stringify(context.profile || {}, null, 2)}

USER ONBOARDING:
${JSON.stringify(context.onboarding || {}, null, 2)}

PERSISTENT MEMORY:
${context.memoryText}

RETRIEVED EVIDENCE:
${JSON.stringify(context.evidence || [], null, 2)}

TASK:
${task}

Return a ranked recommendation list with brief reasoning for each item.`;
}

async function runRecommendationAgent({ callText, apiKey, context, task, promptConfig }) {
  const output = await callText({
    apiKey,
    systemPrompt: "You give aligned recommendations rooted in known user context.",
    userMessage: buildRecommendationPrompt(context, task, promptConfig.instructions),
  });

  return {
    output,
    citations: context.evidence,
    memoryUpdate: {
      newInsights: [],
      updatedPatterns: ["recommendation seeking behavior"],
      removeInsights: [],
      avoidanceSignal: null,
      agentInsight: "Recommendations are being aligned to the user profile and memory.",
    },
  };
}

module.exports = { runRecommendationAgent };

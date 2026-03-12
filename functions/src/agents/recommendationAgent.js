function buildRecommendationPrompt(context, task) {
  return `You are the True North Recommendation Agent.

Give recommendations aligned with the user's priorities, patterns, and retrieved evidence.
Do not recommend anything that conflicts with the known profile without saying why.

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

async function runRecommendationAgent({ callText, apiKey, context, task }) {
  const output = await callText({
    apiKey,
    systemPrompt: "You give aligned recommendations rooted in known user context.",
    userMessage: buildRecommendationPrompt(context, task),
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

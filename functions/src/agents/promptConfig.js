const DEFAULT_AGENT_PROMPTS = {
  knowledge: {
    instructions: "Answer using the user's known context and retrieved evidence. Be clear when evidence is weak or missing, and keep the answer concise and grounded.",
  },
  research: {
    instructions: "Synthesize what is already known, organize it clearly, and separate supported conclusions from open questions or uncertainties.",
  },
  memory: {
    instructions: "Focus on continuity, summarization, and what should be remembered over time. Highlight what matters for future context.",
  },
  recommendation: {
    instructions: "Give recommendations aligned with the user's priorities, patterns, and evidence. Rank the recommendations and explain the reasoning briefly.",
  },
};

function getDefaultAgentPrompt(agentId) {
  return DEFAULT_AGENT_PROMPTS[agentId] || { instructions: "" };
}

function mergePromptConfig(agentId, storedConfig) {
  const defaults = getDefaultAgentPrompt(agentId);
  return {
    instructions: typeof storedConfig?.instructions === "string" && storedConfig.instructions.trim()
      ? storedConfig.instructions.trim()
      : defaults.instructions,
  };
}

module.exports = {
  DEFAULT_AGENT_PROMPTS,
  getDefaultAgentPrompt,
  mergePromptConfig,
};

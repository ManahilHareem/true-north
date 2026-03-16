const { getAgent } = require("../agents/registry");
const { routeTask } = require("./router");
const { mergePromptConfig } = require("../agents/promptConfig");

async function runOrchestrator({
  mode = "auto",
  preferredAgent,
  task,
  context,
  callText,
  apiKey,
  agentPromptConfigs = {},
}) {
  const selectedAgent = mode === "direct" && preferredAgent
    ? preferredAgent
    : preferredAgent || routeTask(task);

  const agent = getAgent(selectedAgent) || getAgent("knowledge");
  const promptConfig = mergePromptConfig(agent.id, agentPromptConfigs[agent.id]);

  const result = await agent.execute({
    callText,
    apiKey,
    context,
    task,
    promptConfig,
  });

  return {
    selectedAgent: agent.id,
    output: result.output,
    citations: result.citations || [],
    memoryUpdate: result.memoryUpdate || null,
  };
}

module.exports = { runOrchestrator };

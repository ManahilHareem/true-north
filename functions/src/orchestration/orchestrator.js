const { getAgent } = require("../agents/registry");
const { routeTask } = require("./router");

async function runOrchestrator({
  mode = "auto",
  preferredAgent,
  task,
  context,
  callText,
  apiKey,
}) {
  const selectedAgent = mode === "direct" && preferredAgent
    ? preferredAgent
    : preferredAgent || routeTask(task);

  const agent = getAgent(selectedAgent) || getAgent("knowledge");

  const result = await agent.execute({
    callText,
    apiKey,
    context,
    task,
  });

  return {
    selectedAgent: agent.id,
    output: result.output,
    citations: result.citations || [],
    memoryUpdate: result.memoryUpdate || null,
  };
}

module.exports = { runOrchestrator };

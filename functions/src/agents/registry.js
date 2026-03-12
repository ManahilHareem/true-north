const { runKnowledgeAgent } = require("./knowledgeAgent");
const { runResearchAgent } = require("./researchAgent");
const { runMemoryAgent } = require("./memoryAgent");
const { runRecommendationAgent } = require("./recommendationAgent");

const AGENTS = {
  knowledge: {
    id: "knowledge",
    name: "Knowledge Agent",
    description: "Grounded answers using retrieved user evidence and known context.",
    capabilities: ["retrieval", "grounded-answering", "document recall"],
    execute: runKnowledgeAgent,
  },
  research: {
    id: "research",
    name: "Research Agent",
    description: "Structured synthesis of known information and open questions.",
    capabilities: ["synthesis", "research-structuring", "gap-analysis"],
    execute: runResearchAgent,
  },
  memory: {
    id: "memory",
    name: "Memory Agent",
    description: "Continuity, summarization, and long-term memory shaping.",
    capabilities: ["continuity", "memory", "summarization"],
    execute: runMemoryAgent,
  },
  recommendation: {
    id: "recommendation",
    name: "Recommendation Agent",
    description: "Personalized recommendations aligned to user profile and evidence.",
    capabilities: ["recommendations", "ranking", "alignment"],
    execute: runRecommendationAgent,
  },
};

function listAgents() {
  return Object.values(AGENTS).map(({ execute, ...agent }) => agent);
}

function getAgent(agentType) {
  return AGENTS[agentType] || null;
}

module.exports = { listAgents, getAgent };

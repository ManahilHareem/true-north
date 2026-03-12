const Anthropic = require("@anthropic-ai/sdk");

function createAnthropicClient(apiKey) {
  if (!apiKey) {
    throw new Error("Anthropic API key is not configured.");
  }

  return new Anthropic({ apiKey });
}

async function callText({ apiKey, systemPrompt, userMessage, model = "claude-sonnet-4-5-20250929", maxTokens = 2048 }) {
  const client = createAnthropicClient(apiKey);
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  return response.content.map((block) => block.text || "").join("");
}

module.exports = { callText };

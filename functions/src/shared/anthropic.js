const Anthropic = require("@anthropic-ai/sdk");

function createAnthropicClient(apiKey) {
  if (!apiKey) {
    throw new Error("Anthropic API key is not configured.");
  }

  return new Anthropic({ apiKey });
}

async function callText({ apiKey, systemPrompt, userMessage, model = "claude-haiku-4-5-20251001", maxTokens = 2048 }) {
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

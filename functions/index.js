/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TRUE NORTH — CLOUD FUNCTIONS BACKEND
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This single file IS the entire backend. All 18 Cloud Functions + shared
 * helpers live here. There is no other backend code.
 *
 * KEY CONCEPTS:
 * - Every AI call goes through callClaude() or callClaudeJSON() below.
 *   TO SWAP LLM PROVIDERS: change only those two functions.
 * - Model strategy: Sonnet for complex reasoning, Haiku for fast/cheap ops.
 * - The "bidirectional memory pipeline" loads persistent memory INTO every
 *   prompt and extracts new insights OUT of every interaction (fire-and-forget).
 * - Game tile choices use HARDCODED frameworks (TILE_CHOICE_FRAMEWORKS) —
 *   the LLM personalizes descriptions but CANNOT change consequence types
 *   or score deltas. This prevents hallucination from breaking game mechanics.
 *
 * FUNCTIONS LIST:
 *  1. onProfileGenerate    — Generates user profile from onboarding data (Sonnet)
 *  2. onFileUpload         — Processes uploaded files: genome parsing or summarization (Haiku)
 *  3. onChatMessage        — Advisor chat with memory injection + insight extraction (Sonnet)
 *  4. onReframeSubmit      — Journal analysis: patterns, reframes, vocab upgrades (Sonnet)
 *  5. onLiveAnalyze        — Real-time speech gauge analysis (Haiku, polled every 8s)
 *  6. onPostCallSummary    — Post-conversation assessment (Sonnet)
 *  7. onGenerateFutures    — All 5 future visions in one call (Sonnet) [legacy]
 * 7b. onGenerateFutureVision — Single vision per category (Sonnet)
 * 7c. onFinalizeFutures    — Save visions + memory update (Haiku)
 *  8. onGenerateEditionItem — Single article via web search (Sonnet + web_search tool)
 *     onSaveEdition        — Save completed edition to Firestore
 *     onGenerateEdition    — All 5 articles in one call [legacy] (Sonnet + web_search)
 *  9. onTranscriptProcess  — Extract structured data from call transcripts (Sonnet)
 * 10. onTranscriptQuery    — Natural language query across transcript data (Sonnet)
 * 11. onDailyBriefingManual — Generate personalized daily briefing (Sonnet + web_search)
 * 12. onNewDay             — Game of Life: generate today's tile + choices (Sonnet)
 * 13. onChoosePath         — Game of Life: apply choice consequences + generate actions (Sonnet)
 * 14. onCompleteAction     — Game of Life: mark an action as done (no LLM)
 *
 * SECRETS:
 *   ANTHROPIC_API_KEY — Set via: firebase functions:secrets:set ANTHROPIC_API_KEY
 *   Must be set BEFORE deploying or all LLM calls will fail at runtime.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const Anthropic = require("@anthropic-ai/sdk");

admin.initializeApp();
const db = admin.firestore();
const storage = admin.storage();

// The only secret this backend needs. Set it with:
// firebase functions:secrets:set ANTHROPIC_API_KEY
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

// ── Shared Helpers ───────────────────────────────────────────

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY || ANTHROPIC_API_KEY.value();
  return new Anthropic({ apiKey });
}

/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║  LLM SWAP POINT — callClaude() and callClaudeJSON()     ║
 * ║                                                          ║
 * ║  These two functions are the ONLY place the Anthropic    ║
 * ║  SDK is invoked. To switch to a different LLM provider   ║
 * ║  (OpenAI, local model, custom endpoint), change ONLY     ║
 * ║  these two functions. Everything else calls through here. ║
 * ║                                                          ║
 * ║  Model defaults:                                         ║
 * ║  - Sonnet (claude-sonnet-4-5) = complex reasoning        ║
 * ║    Used for: chat, profile gen, reframes, game tiles,    ║
 * ║    future visions, articles, transcripts, briefings      ║
 * ║  - Haiku (claude-haiku-4-5) = fast + cheap               ║
 * ║    Used for: memory compaction, insight extraction,      ║
 * ║    file summarization, live gauges, futures memory       ║
 * ╚═══════════════════════════════════════════════════════════╝
 */
async function callClaude(systemPrompt, userMessage, model = "claude-sonnet-4-5-20250929") {
  const client = getClient();
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  const text = response.content.map((b) => b.text || "").join("");
  return text;
}

// Same as callClaude but parses the response as JSON.
// Strips markdown fences (```json ... ```) if the LLM wraps its output.
async function callClaudeJSON(systemPrompt, userMessage, model = "claude-sonnet-4-5-20250929") {
  const raw = await callClaude(systemPrompt, userMessage, model);
  const clean = raw.replace(/```json\s?/g, "").replace(/```/g, "").trim();
  return JSON.parse(clean);
}

async function getUserData(userId) {
  const snap = await db.collection("users").doc(userId).get();
  return snap.exists ? snap.data() : null;
}

// ── Memory Layer Helpers ─────────────────────────────────────
// THE BIDIRECTIONAL MEMORY PIPELINE:
// 1. INBOUND: getMemory() → formatMemoryForPrompt() → injected into every system prompt
// 2. OUTBOUND: After each interaction, extractChatInsights() or extractChoiceInsights()
//    runs fire-and-forget to extract new knowledge about the user
// 3. COMPACTION: mergeMemory() uses Haiku to deduplicate and compact with caps:
//    - Max 10 core insights
//    - Max 8 active patterns (with frequency + lastSeen tracking)
//    - Max 5 avoidances
//    - Max 5 strengths
// Memory doc lives at: users/{uid}/memory/core
async function getMemory(userId) {
  const snap = await db.collection("users").doc(userId).collection("memory").doc("core").get();
  return snap.exists ? snap.data() : null;
}

function formatMemoryForPrompt(memory) {
  if (!memory) return "No memory yet — this is early in the journey.";
  const lines = [];
  if (memory.coreInsights?.length) {
    lines.push("## Core Insights");
    memory.coreInsights.forEach((i) => lines.push(`- ${i}`));
  }
  if (memory.activePatterns?.length) {
    lines.push("## Active Patterns");
    memory.activePatterns.forEach((p) => lines.push(`- ${p.pattern} (seen ${p.frequency}x, last: ${p.lastSeen})`));
  }
  if (memory.avoidances?.length) {
    lines.push("## Avoidances");
    memory.avoidances.forEach((a) => lines.push(`- ${a}`));
  }
  if (memory.strengths?.length) {
    lines.push("## Observed Strengths");
    memory.strengths.forEach((s) => lines.push(`- ${s}`));
  }
  if (memory.agentInsights && Object.keys(memory.agentInsights).length) {
    lines.push("## Agent Insights");
    Object.entries(memory.agentInsights).forEach(([k, v]) => lines.push(`- ${k}: ${v}`));
  }
  if (memory.currentEdge) {
    lines.push(`## Current Edge\n${memory.currentEdge}`);
  }
  return lines.join("\n");
}

// Compacts memory using Haiku (fast + cheap). Merges new observations into
// existing memory, deduplicates, drops stale entries, enforces caps.
// Called fire-and-forget after every interaction — never blocks the user response.
async function mergeMemory(userId, currentMemory, memoryUpdate) {
  if (!memoryUpdate) return;
  try {
    const current = currentMemory || {
      coreInsights: [], activePatterns: [], avoidances: [],
      strengths: [], agentInsights: {}, currentEdge: "",
    };
    const prompt = `Current memory about this person:
${JSON.stringify(current, null, 2)}

New observations from latest interaction:
- New insights: ${JSON.stringify(memoryUpdate.newInsights || [])}
- Pattern updates: ${JSON.stringify(memoryUpdate.updatedPatterns || [])}
- Remove: ${JSON.stringify(memoryUpdate.removeInsights || [])}
- Avoidance signal: ${memoryUpdate.avoidanceSignal || "none"}

Produce an updated memory document. Rules:
- Max 10 core insights (merge/replace, don't append duplicates)
- Max 8 active patterns (increment frequency if repeated, add new ones, drop stale)
- Max 5 avoidances
- Max 5 strengths
- Keep agentInsights to 1-2 sentences each
- Today's date for lastSeen: ${new Date().toISOString().split("T")[0]}

Return ONLY valid JSON:
{
  "coreInsights": ["..."],
  "activePatterns": [{"pattern":"...","frequency":1,"lastSeen":"YYYY-MM-DD"}],
  "avoidances": ["..."],
  "strengths": ["..."],
  "agentInsights": {"agentId":"insight"},
  "currentEdge": "the one thing most worth watching"
}`;
    const merged = await callClaudeJSON("You are a memory compactor. Return only valid JSON.", prompt, "claude-haiku-4-5-20251001");
    merged.lastUpdated = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("users").doc(userId).collection("memory").doc("core").set(merged);
  } catch (e) {
    console.error(`Memory merge failed for ${userId}:`, e);
  }
}

// Runs AFTER chat response is returned (fire-and-forget). Asks Haiku to analyze
// the exchange and extract new insights about the user. Feeds mergeMemory().
async function extractChatInsights(userId, agentId, userMessage, assistantResponse, memory) {
  try {
    const prompt = `A user just had this exchange with the ${agentId} agent.

User said: "${userMessage.substring(0, 500)}"
Agent replied: "${assistantResponse.substring(0, 500)}"

What did you learn about this person? Return ONLY valid JSON:
{
  "newInsights": ["1-2 key things learned, or empty array if nothing new"],
  "updatedPatterns": ["behavioral patterns confirmed or new, or empty"],
  "removeInsights": [],
  "avoidanceSignal": "what they seem to be avoiding, or null",
  "agentInsight": "1 sentence summary of what this agent now understands about them"
}`;
    const update = await callClaudeJSON("Return only valid JSON.", prompt, "claude-haiku-4-5-20251001");
    if (update.agentInsight) {
      const agentInsights = { ...(memory?.agentInsights || {}), [agentId]: update.agentInsight };
      update.newInsights = update.newInsights || [];
      const memUpdate = { ...update, agentInsights };
      delete memUpdate.agentInsight;
      // Merge agentInsights into current memory before merging
      const currentWithAgent = { ...(memory || {}), agentInsights };
      await mergeMemory(userId, currentWithAgent, memUpdate);
    } else {
      await mergeMemory(userId, memory, update);
    }
  } catch (e) {
    console.error(`Chat insight extraction failed for ${userId}:`, e);
  }
}

// Runs AFTER game choice is confirmed (fire-and-forget). Asks Haiku what the
// user's choice reveals about them — especially avoidance patterns. Feeds mergeMemory().
async function extractChoiceInsights(userId, tileType, chosen, memory) {
  try {
    const prompt = `A user just made a choice in their Game of Life on a "${tileType}" tile.

They chose: "${chosen.label}" — ${chosen.description}
Consequence type: ${chosen.consequenceType}

What does this choice reveal about them? Return ONLY valid JSON:
{
  "newInsights": ["1-2 key things this choice reveals, or empty array"],
  "updatedPatterns": ["behavioral pattern this confirms or reveals, or empty"],
  "removeInsights": [],
  "avoidanceSignal": ${chosen.consequenceType === "avoid" ? '"what they may be avoiding based on this choice"' : "null"}
}`;
    const update = await callClaudeJSON("Return only valid JSON.", prompt, "claude-haiku-4-5-20251001");
    await mergeMemory(userId, memory, update);
  } catch (e) {
    console.error(`Choice insight extraction failed for ${userId}:`, e);
  }
}

// ═══════════════════════════════════════════════════════════════
// 1. PROFILE GENERATION
// Triggered by: onboarding completion (frontend calls after step 5)
// Input: { userId }
// Model: Sonnet (complex reasoning — generates archetype, Wheel of Life scores, personality)
// Output: { profile: GeneratedProfile } — saved to users/{uid}.profile
// Memory: No memory yet — this is the user's first interaction
// ═══════════════════════════════════════════════════════════════
exports.onProfileGenerate = onCall({ secrets: [ANTHROPIC_API_KEY] }, async (request) => {
  const { userId } = request.data;
  const userData = await getUserData(userId);
  if (!userData?.onboarding) throw new Error("No onboarding data found");

  const d = userData.onboarding;

  // Gather file summaries if any
  const uploadsSnap = await db.collection("users").doc(userId).collection("uploads").get();
  const fileSummaries = uploadsSnap.docs
    .map((doc) => doc.data().summary)
    .filter((s) => s && s !== "Processing...");

  const genomeData = userData.genomeData
    ? `User has ${userData.genomeData.length} SNPs stored from 23andMe data.`
    : "";

  const prompt = `You are a sacred intelligence system called True North. Given this person's complete data, generate their True North profile.

PERSON'S DATA:
Name: ${d.name}
Birth: ${d.birthDate} at ${d.birthTime} in ${d.birthLocation}
Strengths: ${(d.strengths || []).join(", ")}
Communication Style: ${d.communicationStyle}
Spiritual Orientation: ${d.spiritualOrientation}
Chronotype: ${d.chronotype}
Risk Tolerance: ${d.riskTolerance}/10
Health Priorities: ${(d.healthPriorities || []).join(", ")}
Financial Priorities: ${(d.financialPriorities || []).join(", ")}
Relationship Goals: ${(d.relationshipGoals || []).join(", ")}
Career Direction: ${d.careerDirection}
Tone Preference: ${d.tonePref}
${fileSummaries.length > 0 ? `\nUploaded Document Summaries:\n${fileSummaries.join("\n")}` : ""}
${genomeData ? `\nGenome Data: ${genomeData}` : ""}

Using their birth data, incorporate astrological insights (sun sign, moon sign, rising sign) and Human Design type insights. Weave these naturally into the profile.

Use language that feels sacred, empowering, deeply personal, and grounded. Never generic. Never clinical. Never new-age cliche. Make them feel truly seen.

Return ONLY valid JSON:
{
  "archetypeName": "unique 2-4 word archetype name",
  "coreStrength": "primary gift in 2-5 words",
  "shadowToTransmute": "growth edge in 2-5 words",
  "primaryExpressionMode": "how they create impact",
  "seasonalFocus": "what to focus on this season",
  "energyTheme": "one of: clarity, healing, heart, growth, activation",
  "colorKeyword": "one of: gold, teal, rose, emerald, amber",
  "wheelOfLife": { "spirit": 0-100, "body": 0-100, "relationships": 0-100, "wealth": 0-100, "creativeExpression": 0-100, "service": 0-100, "learning": 0-100, "environment": 0-100 },
  "dailyGuidance": { "alignedActions": ["action1","action2","action3"], "thingToRelease": "string" },
  "personalitySummary": "2-3 sentences for AI to understand this person"
}`;

  let profile;
  if (!process.env.ANTHROPIC_API_KEY && !ANTHROPIC_API_KEY.value()) {
    // Demo mode: return a mock profile when no API key is available
    profile = {
      archetypeName: "Visionary Pathfinder",
      coreStrength: "Intuitive clarity",
      shadowToTransmute: "Scattered focus",
      primaryExpressionMode: "Through deep insight and creative synthesis",
      seasonalFocus: "Building foundations for long-term vision",
      energyTheme: "clarity",
      colorKeyword: "gold",
      wheelOfLife: { spirit: 72, body: 65, relationships: 70, wealth: 58, creativeExpression: 80, service: 68, learning: 75, environment: 62 },
      dailyGuidance: { alignedActions: ["Spend 10 minutes in stillness each morning", "Write one bold idea per day", "Connect meaningfully with one person"], thingToRelease: "The need for external validation" },
      personalitySummary: `${d.name} is a natural visionary with a gift for seeing patterns others miss. They thrive when given space to explore and create, and find their greatest fulfillment at the intersection of ideas and impact.`,
    };
  } else {
    profile = await callClaudeJSON("You return only valid JSON. No other text.", prompt);
  }

  await db.collection("users").doc(userId).update({ profile });
  return { profile };
});

// ═══════════════════════════════════════════════════════════════
// 2. FILE UPLOAD PROCESSING
// Triggered by: onboarding file uploads or manual uploads
// Input: { userId, fileUrl, fileName, fileContent }
// Model: Haiku (fast — file summarization is a cheap op)
// Output: For genome files: { type: "genome", entries: count }
//         For other files: { summary, category, tags, keyFacts }
// Special: Detects 23andMe genome data (TSV format with rs IDs) and
//          stores parsed SNP entries on the user doc as genomeData[]
// ═══════════════════════════════════════════════════════════════
exports.onFileUpload = onCall({ secrets: [ANTHROPIC_API_KEY] }, async (request) => {
  const { userId, fileUrl, fileName, fileContent } = request.data;

  // Check if it's a genome file
  if (fileName.toLowerCase().includes("23andme") || fileName.endsWith(".txt")) {
    // Try to parse as genome data
    if (fileContent) {
      const lines = fileContent.split("\n").filter((l) => !l.startsWith("#") && l.trim());
      const genomeEntries = [];
      for (const line of lines) {
        const parts = line.split("\t");
        if (parts.length >= 4 && parts[0].startsWith("rs")) {
          genomeEntries.push({
            rsId: parts[0],
            chromosome: parts[1],
            position: parseInt(parts[2]),
            genotype: parts[3].trim(),
          });
        }
      }
      if (genomeEntries.length > 100) {
        await db.collection("users").doc(userId).update({ genomeData: genomeEntries });
        return { type: "genome", entries: genomeEntries.length };
      }
    }
  }

  // Otherwise summarize the file
  if (fileContent) {
    const summary = await callClaudeJSON(
      "You return only valid JSON.",
      `Summarize this uploaded document, assign category tags, and extract key facts.

File: ${fileName}
Content:
${fileContent.substring(0, 10000)}

Return ONLY valid JSON:
{
  "summary": "2-3 sentence summary",
  "category": "one of: health, finance, identity, legal, genome, correspondence, business, other",
  "tags": ["relevant","tags"],
  "keyFacts": ["important facts"]
}`,
      "claude-haiku-4-5-20251001"
    );

    // Update the upload record
    const uploadsSnap = await db
      .collection("users").doc(userId).collection("uploads")
      .where("fileName", "==", fileName).limit(1).get();

    if (!uploadsSnap.empty) {
      await uploadsSnap.docs[0].ref.update({
        summary: summary.summary,
        category: summary.category,
        tags: summary.tags || [],
      });
    }

    return summary;
  }

  return { status: "no content provided" };
});

// ═══════════════════════════════════════════════════════════════
// 3. CHAT MESSAGE
// Triggered by: user sends a message in any advisor chat
// Input: { userId, agentId, message, threadId? }
// Model: Sonnet (complex reasoning — multi-turn conversation with full context)
// Output: { response: string }
// Memory: INBOUND (memory injected into system prompt) +
//         OUTBOUND (extractChatInsights fires async after response)
// Chat history: loads last 20 messages from thread for conversation context.
// The 5 agents (financial, food-medicine, media, relationship, moonshot)
// each have unique system prompts personalized with user profile + memory.
// ═══════════════════════════════════════════════════════════════
exports.onChatMessage = onCall({ secrets: [ANTHROPIC_API_KEY] }, async (request) => {
  const { userId, agentId, message, threadId } = request.data;
  const [userData, memory] = await Promise.all([getUserData(userId), getMemory(userId)]);
  if (!userData?.profile || !userData?.onboarding) throw new Error("Profile not found");

  const p = userData.profile;
  const o = userData.onboarding;
  const memoryBlock = memory ? `\n\nPERSISTENT MEMORY — What the system knows about this person from all interactions:\n${formatMemoryForPrompt(memory)}` : "";

  const agentPrompts = {
    financial: `You are the Financial Steward — a conscious financial advisor. You know this person deeply:
Archetype: ${p.archetypeName}. Strength: ${p.coreStrength}. Shadow: ${p.shadowToTransmute}.
Financial Priorities: ${(o.financialPriorities || []).join(", ")}. Risk Tolerance: ${o.riskTolerance}/10.
Career: ${o.careerDirection}. Personality: ${p.personalitySummary}.
Be grounded, practical, aligned with their values. Never execute actions. Tone: ${o.tonePref}.${memoryBlock}`,

    "food-medicine": `You are the Food & Medicine Steward — a holistic health guide. You know this person deeply:
Archetype: ${p.archetypeName}. Health Priorities: ${(o.healthPriorities || []).join(", ")}. Chronotype: ${o.chronotype}.
Personality: ${p.personalitySummary}.
${userData.genomeData ? `They have ${userData.genomeData.length} SNPs from 23andMe. Reference relevant genetics when discussing health.` : ""}
Guide on nutrition, supplements, healing. Evidence-based but warm. Not diagnosis — empowered understanding. Tone: ${o.tonePref}.${memoryBlock}`,

    media: `You are the Media Intelligence agent — a conscious media curator. You know this person deeply:
Archetype: ${p.archetypeName}. Topics: ${(o.newsTopics || []).join(", ")}. Exclusions: ${(o.exclusions || []).join(", ")}.
Personality: ${p.personalitySummary}.
Protect attention. Filter noise. If they seem low, uplift. If sharp, go deep. Tone: ${o.tonePref}.${memoryBlock}`,

    relationship: `You are the Relationship Harmonizer — a relationship coach. You know this person deeply:
Archetype: ${p.archetypeName}. Shadow: ${p.shadowToTransmute}. Communication: ${o.communicationStyle}.
Relationship Goals: ${(o.relationshipGoals || []).join(", ")}. Personality: ${p.personalitySummary}.
Help with clarity, compassion, courage. Ask "Are you reacting from fear or clarity?" Shadow stays private. Tone: ${o.tonePref}.${memoryBlock}`,

    moonshot: `You are the Moonshot / Destiny agent — a growth coach. You know this person deeply:
Archetype: ${p.archetypeName}. Strength: ${p.coreStrength}. Seasonal Focus: ${p.seasonalFocus}.
Career: ${o.careerDirection}. Risk Tolerance: ${o.riskTolerance}/10. Personality: ${p.personalitySummary}.
Keep them on their highest trajectory. Ask "What would the extraordinary version of you do here?" Tone: ${o.tonePref}.${memoryBlock}`,
  };

  const systemPrompt = agentPrompts[agentId] || agentPrompts.financial;

  // Load recent chat history (thread-aware)
  const historyRef = threadId
    ? db.collection("users").doc(userId).collection("chat_history").doc(agentId).collection("threads").doc(threadId).collection("messages")
    : db.collection("users").doc(userId).collection("chat_history").doc(agentId).collection("messages");
  const historySnap = await historyRef.orderBy("timestamp", "desc").limit(20).get();

  const history = historySnap.docs
    .map((d) => d.data())
    .reverse()
    .map((m) => ({ role: m.role, content: m.content }));

  history.push({ role: "user", content: message });

  const client = getClient();
  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 2048,
    system: systemPrompt,
    messages: history,
  });

  const responseText = response.content.map((b) => b.text || "").join("");

  // Extract insights from this conversation async (don't block response)
  extractChatInsights(userId, agentId, message, responseText, memory).catch(console.error);

  return { response: responseText };
});

// ═══════════════════════════════════════════════════════════════
// 4. REFRAME SUBMIT (Communication Intelligence - Reflect Mode)
// Triggered by: user submits a journal entry in Communication > Reflect tab
// Input: { userId, text }
// Model: Sonnet (complex — language pattern analysis + reframe generation)
// Output: ReframeAnalysis { patternsDetected, scores, emotion, reframes, vocabularyUpgrades, genekeysAlignment }
// Memory: INBOUND (memory in prompt) + OUTBOUND (memoryUpdate extracted inline, merged async)
// ═══════════════════════════════════════════════════════════════
exports.onReframeSubmit = onCall({ secrets: [ANTHROPIC_API_KEY] }, async (request) => {
  const { userId, text } = request.data;
  const [userData, memory] = await Promise.all([getUserData(userId), getMemory(userId)]);
  if (!userData?.profile) throw new Error("Profile not found");

  const p = userData.profile;
  const memorySection = memory ? `\nPERSISTENT MEMORY:\n${formatMemoryForPrompt(memory)}\n` : "";
  const prompt = `This person's profile:
Archetype: ${p.archetypeName}. Shadow: ${p.shadowToTransmute}. Strength: ${p.coreStrength}.
Personality: ${p.personalitySummary}.
${memorySection}
Their journal entry:
"${text}"

Analyze their language. Return ONLY valid JSON:
{
  "patternsDetected": ["limiting patterns found"],
  "scores": { "agency": 0-100, "blame": 0-100, "certainty": 0-100, "futureOrientation": 0-100, "emotionalPolarity": -100 to 100 },
  "emotion": { "primary": "string", "secondary": "string or null", "intensity": 0-100 },
  "reframes": [{ "title": "short title", "reframeText": "agency-based reframe", "whyItWorks": "explanation", "nextAction": "specific action" }],
  "vocabularyUpgrades": [{ "weakPhrase": "from their text", "strongReplacement": "empowered version", "rationale": "why stronger" }],
  "genekeysAlignment": [{ "geneKey": "theme", "frequencyDetected": "shadow/gift/siddhi/mixed", "languageEvidence": ["phrases"], "suggestedGiftReframe": "gift-level reframe" }],
  "memoryUpdate": { "newInsights": ["anything new about this person from their language"], "updatedPatterns": ["patterns confirmed"], "removeInsights": [], "avoidanceSignal": "or null" }
}
Generate 3-5 reframes and 2-4 vocabulary upgrades.`;

  const analysis = await callClaudeJSON("You are a narrative intelligence analyst. Return only valid JSON.", prompt);

  // Merge memory async
  if (analysis.memoryUpdate) {
    mergeMemory(userId, memory, analysis.memoryUpdate).catch(console.error);
    delete analysis.memoryUpdate;
  }

  return analysis;
});

// ═══════════════════════════════════════════════════════════════
// 5. LIVE ANALYZE (Communication Intelligence - Live Mode)
// Triggered by: frontend polls every 8 seconds during a live speech session
// Input: { transcript (rolling 500-char window), intentSliders }
// Model: Haiku (speed critical — real-time gauge updates, must respond fast)
// Output: LiveGauges { volumeLevel, pace, talkTimeRatio, emotionalIntensity, etc. + microPrompt }
// No memory: stateless — each call analyzes the current transcript window independently
// ═══════════════════════════════════════════════════════════════
exports.onLiveAnalyze = onCall({ secrets: [ANTHROPIC_API_KEY] }, async (request) => {
  const { transcript, intentSliders } = request.data;

  const sliderContext = Object.entries(intentSliders || {})
    .filter(([_, v]) => v > 50)
    .map(([k, v]) => `${k}: ${v}/100`)
    .join(", ");

  const prompt = `Analyze the last 30-60 seconds of speech:
"${transcript}"
${sliderContext ? `Speaker wants to adjust: ${sliderContext}. Bias coaching accordingly.` : ""}

Return ONLY valid JSON:
{ "volumeLevel": 1-10, "pace": 1-10, "talkTimeRatio": 0-100, "interruptionCount": 0, "emotionalIntensity": 1-10, "empathySignals": 1-10, "angerEdge": 1-10, "clarity": 1-10, "overallAlignment": 1-10, "microPrompt": "short coaching nudge or null" }`;

  // Use Haiku for speed and cost
  const gauges = await callClaudeJSON("You are a real-time communication coach. Return only valid JSON.", prompt, "claude-haiku-4-5-20251001");
  return gauges;
});

// ═══════════════════════════════════════════════════════════════
// 6. POST-CALL SUMMARY
// Triggered by: user stops a Live Mode session (stopLive in communication component)
// Input: { userId, fullTranscript }
// Model: Sonnet (complex — full session analysis with wins/improvements)
// Output: { topMomentsToImprove, wins, overallScore, summary }
// Memory: INBOUND + OUTBOUND (communication patterns feed memory)
// Saved to: users/{uid}/call_summaries/{auto-id}
// ═══════════════════════════════════════════════════════════════
exports.onPostCallSummary = onCall({ secrets: [ANTHROPIC_API_KEY] }, async (request) => {
  const { userId, fullTranscript } = request.data;
  const memory = await getMemory(userId);
  const memorySection = memory ? `\nPERSISTENT MEMORY:\n${formatMemoryForPrompt(memory)}\n` : "";

  const prompt = `${memorySection}Analyze this conversation session:
"${fullTranscript}"

Return ONLY valid JSON:
{ "topMomentsToImprove": ["moment 1","moment 2","moment 3"], "wins": ["win 1","win 2","win 3"], "overallScore": 1-10, "summary": "2-3 sentence assessment", "memoryUpdate": { "newInsights": ["communication patterns observed"], "updatedPatterns": [], "removeInsights": [], "avoidanceSignal": null } }`;

  const summary = await callClaudeJSON("You are a communication coach. Return only valid JSON.", prompt);

  const memUpdate = summary.memoryUpdate;
  delete summary.memoryUpdate;

  // Save to Firestore
  await db.collection("users").doc(userId).collection("call_summaries").add({
    ...summary,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (memUpdate) mergeMemory(userId, memory, memUpdate).catch(console.error);
  return summary;
});

// ═══════════════════════════════════════════════════════════════
// 7. GENERATE FUTURE VISIONS (legacy — generates all 5 in one call)
// Triggered by: [legacy] — frontend now uses onGenerateFutureVision per-category
// Input: { userId }
// Model: Sonnet (complex — deeply personalized future projections)
// Output: { visions: FutureVision[] } — saved to users/{uid}/future_visions/current
// Memory: INBOUND + OUTBOUND
// Also loads: calibration answers, dimension scores, recent game history
// ═══════════════════════════════════════════════════════════════
exports.onGenerateFutures = onCall({ secrets: [ANTHROPIC_API_KEY] }, async (request) => {
  const { userId } = request.data;
  const [userData, memory, calibrationSnap, scoresSnap, historySnap] = await Promise.all([
    getUserData(userId),
    getMemory(userId),
    db.collection("users").doc(userId).collection("game_meta").doc("calibration").get(),
    db.collection("users").doc(userId).collection("scores").doc("current").get(),
    db.collection("users").doc(userId).collection("game_days").orderBy("date", "desc").limit(5).get(),
  ]);
  if (!userData?.profile || !userData?.onboarding) throw new Error("Profile not found");

  const p = userData.profile;
  const o = userData.onboarding;
  const calibration = calibrationSnap.exists ? calibrationSnap.data() : null;
  const scores = scoresSnap.exists ? scoresSnap.data() : null;
  const gameHistory = historySnap.docs.map((d) => {
    const data = d.data();
    return { date: data.date, type: data.tileType, choice: data.chosenPath !== null ? data.choices?.[data.chosenPath]?.consequenceType : null };
  });
  const memorySection = memory ? `\nPERSISTENT MEMORY:\n${formatMemoryForPrompt(memory)}\n` : "";

  const prompt = `Profile:
Archetype: ${p.archetypeName}. Strength: ${p.coreStrength}. Shadow: ${p.shadowToTransmute}.
Health: ${(o.healthPriorities || []).join(", ")}. Financial: ${(o.financialPriorities || []).join(", ")}.
Relationships: ${(o.relationshipGoals || []).join(", ")}. Career: ${o.careerDirection}.
Personality: ${p.personalitySummary}.
${memorySection}
${calibration ? `CALIBRATION (what they stated about themselves):
- Wants more of: ${calibration.wantMore}
- Drains: ${calibration.drains}
- Afraid to risk: ${calibration.afraidToRisk}
- Alive but uncertain: ${calibration.aliveButUncertain}\n` : ""}
${scores ? `DIMENSION SCORES (current Wheel of Life):\n${JSON.stringify(scores)}\n` : ""}
${gameHistory.length > 0 ? `RECENT GAME CHOICES:\n${JSON.stringify(gameHistory)}\n` : ""}
Generate 5 positive future visions — one per category: Food, Money, Medicine, Media, Relationships.
Each: 2-3 paragraphs of their best, most aligned life. Grounded elevation. Realistic but aspirational. Subtle humor welcome.
Use what you know from memory, calibration answers, game choices, and dimension scores to make these deeply specific and personal.
Reference their actual patterns and growth edges. If they've been avoiding something, show a future where they've transmuted it.

Return ONLY valid JSON:
{
  "visions": [{ "category": "food", "title": "evocative title", "visionText": "2-3 paragraphs" }, ...],
  "memoryUpdate": {
    "newInsights": ["anything new learned from generating these visions"],
    "updatedPatterns": [],
    "removeInsights": [],
    "avoidanceSignal": null
  }
}`;

  const result = await callClaudeJSON("You return only valid JSON.", prompt);
  const visions = result.visions || result;

  await db.collection("users").doc(userId).collection("future_visions").doc("current").set({
    visions,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Self-learning: merge memory
  if (result.memoryUpdate) {
    mergeMemory(userId, memory, result.memoryUpdate).catch(console.error);
  }

  return { visions };
});

// ═══════════════════════════════════════════════════════════════
// 7b. GENERATE SINGLE FUTURE VISION (called sequentially per-category by frontend)
// Triggered by: Inspiration page generates one vision at a time for streaming UX
// Input: { userId, category } — category is one of: food, money, medicine, media, relationships
// Model: Sonnet (complex — personalized with profile + memory + calibration + scores + game history)
// Output: FutureVision { category, title, visionText }
// ═══════════════════════════════════════════════════════════════
exports.onGenerateFutureVision = onCall({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 30 }, async (request) => {
  const { userId, category } = request.data;
  if (!category) throw new Error("Category is required");

  const [userData, memory, calibrationSnap, scoresSnap, historySnap] = await Promise.all([
    getUserData(userId),
    getMemory(userId),
    db.collection("users").doc(userId).collection("game_meta").doc("calibration").get(),
    db.collection("users").doc(userId).collection("scores").doc("current").get(),
    db.collection("users").doc(userId).collection("game_days").orderBy("date", "desc").limit(5).get(),
  ]);
  if (!userData?.profile || !userData?.onboarding) throw new Error("Profile not found");

  const p = userData.profile;
  const o = userData.onboarding;
  const calibration = calibrationSnap.exists ? calibrationSnap.data() : null;
  const scores = scoresSnap.exists ? scoresSnap.data() : null;
  const gameHistory = historySnap.docs.map((d) => {
    const data = d.data();
    return { date: data.date, type: data.tileType, choice: data.chosenPath !== null ? data.choices?.[data.chosenPath]?.consequenceType : null };
  });
  const memorySection = memory ? `\nPERSISTENT MEMORY:\n${formatMemoryForPrompt(memory)}\n` : "";

  const prompt = `Profile:
Archetype: ${p.archetypeName}. Strength: ${p.coreStrength}. Shadow: ${p.shadowToTransmute}.
Health: ${(o.healthPriorities || []).join(", ")}. Financial: ${(o.financialPriorities || []).join(", ")}.
Relationships: ${(o.relationshipGoals || []).join(", ")}. Career: ${o.careerDirection}.
Personality: ${p.personalitySummary}.
${memorySection}
${calibration ? `CALIBRATION:
- Wants more of: ${calibration.wantMore}
- Drains: ${calibration.drains}
- Afraid to risk: ${calibration.afraidToRisk}
- Alive but uncertain: ${calibration.aliveButUncertain}\n` : ""}
${scores ? `DIMENSION SCORES:\n${JSON.stringify(scores)}\n` : ""}
${gameHistory.length > 0 ? `RECENT GAME CHOICES:\n${JSON.stringify(gameHistory)}\n` : ""}
Generate ONE positive future vision for the category: ${category}.
2-3 paragraphs of their best, most aligned life in this area. Grounded elevation. Realistic but aspirational. Subtle humor welcome.
Use memory, calibration, game choices, and scores to make this deeply specific and personal.

Return ONLY valid JSON:
{ "category": "${category}", "title": "evocative title", "visionText": "2-3 paragraphs" }`;

  const vision = await callClaudeJSON("You return only valid JSON.", prompt);
  vision.category = vision.category || category;
  return vision;
});

// ═══════════════════════════════════════════════════════════════
// 7c. FINALIZE FUTURES (save all visions + memory update)
// Triggered by: frontend calls after all 5 visions have been generated
// Input: { userId, visions: FutureVision[] }
// Model: Haiku (cheap — just extracting memory insights from vision titles)
// Output: { ok: true }
// Saves to: users/{uid}/future_visions/current
// ═══════════════════════════════════════════════════════════════
exports.onFinalizeFutures = onCall({ secrets: [ANTHROPIC_API_KEY] }, async (request) => {
  const { userId, visions } = request.data;
  if (!visions || !Array.isArray(visions)) throw new Error("Visions array required");

  // Save to Firestore
  await db.collection("users").doc(userId).collection("future_visions").doc("current").set({
    visions,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Memory update via Haiku (fast + cheap)
  try {
    const memory = await getMemory(userId);
    const prompt = `These 5 future visions were just generated for a user:
${JSON.stringify(visions.map((v) => ({ category: v.category, title: v.title })))}

Based on these visions, return a memory update:
{ "newInsights": ["anything worth remembering"], "updatedPatterns": [], "removeInsights": [], "avoidanceSignal": null }`;
    const memUpdate = await callClaudeJSON("Return only valid JSON.", prompt, "claude-haiku-4-5-20251001");
    if (memUpdate) mergeMemory(userId, memory, memUpdate).catch(console.error);
  } catch (e) {
    console.error("Futures memory update failed:", e);
  }

  return { ok: true };
});

// ═══════════════════════════════════════════════════════════════
// 8. GENERATE SIGNAL STREAM EDITION (single article per call)
// Triggered by: Articles page fires 5 of these in PARALLEL (one per user topic)
// Input: { userId, topic, itemIndex, exclusions }
// Model: Sonnet + web_search tool (web_search_20250305, max_uses: 1)
// Output: EditionItem { id, title, url, source, summary, category }
// NOTE: Requires an Anthropic plan that supports tool use + web search.
//       The web_search tool finds REAL current articles — not hallucinated URLs.
// ═══════════════════════════════════════════════════════════════
exports.onGenerateEditionItem = onCall({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60 }, async (request) => {
  const { userId, topic, itemIndex, exclusions: excl } = request.data;
  if (!topic) throw new Error("Topic is required");

  // Load profile + memory for personalized article selection
  const [userData, memory] = await Promise.all([getUserData(userId), getMemory(userId)]);
  const p = userData?.profile || {};
  const o = userData?.onboarding || {};

  const client = getClient();
  const exclusionLine = excl && excl.length > 0 ? `\nEXCLUDE topics about: ${excl.join(", ")}` : "";
  const memoryContext = memory ? `\nPERSISTENT MEMORY:\n${formatMemoryForPrompt(memory)}` : "";
  const profileContext = p.archetypeName ? `\nThe reader's profile: Archetype: ${p.archetypeName}, Strength: ${p.coreStrength}, Career: ${o.careerDirection || "unknown"}, Interests: ${(o.newsTopics || []).join(", ") || "general"}.${memoryContext}\nFind an article that would be especially relevant and meaningful to someone with this profile.` : "";

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }],
    messages: [{
      role: "user",
      content: `Search the web for one current, real news article about: ${topic}${exclusionLine}${profileContext}

Return ONLY a valid JSON object (no markdown, no explanation):
{ "id": "item_${itemIndex || 0}", "title": "actual headline", "url": "actual URL from search", "source": "publication name", "summary": "1-2 sentence summary", "category": "${topic}" }`,
    }],
  });

  const textBlocks = response.content.filter((b) => b.type === "text");
  const raw = textBlocks.map((b) => b.text).join("");
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Failed to parse article result");
  const item = JSON.parse(jsonMatch[0]);
  item.id = item.id || `item_${itemIndex || 0}`;
  item.category = item.category || topic;

  return item;
});

// Save a completed edition to Firestore (no LLM call — just persistence)
// Triggered by: frontend after all 5 articles have arrived
// Saved to: users/{uid}/editions/{date}
exports.onSaveEdition = onCall(async (request) => {
  const { userId, localDate, items } = request.data;
  if (!userId || !items) throw new Error("Missing userId or items");

  const today = localDate || new Date().toISOString().split("T")[0];
  const edition = { editionId: `${userId}_${today}`, userId, date: today, items };

  await db.collection("users").doc(userId).collection("editions").doc(today).set({
    ...edition,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return edition;
});

// Legacy: generates all 5 articles in one call. Frontend now uses onGenerateEditionItem instead.
// Kept for backward compatibility. Uses web_search with max_uses: 5.
exports.onGenerateEdition = onCall({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120 }, async (request) => {
  const { userId, localDate } = request.data;
  const userData = await getUserData(userId);
  if (!userData?.onboarding) throw new Error("Onboarding data not found");

  const o = userData.onboarding;
  const topics = o.newsTopics || [];
  const exclusions = o.exclusions || [];

  const client = getClient();
  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    messages: [{
      role: "user",
      content: `You are a media intelligence agent. Search the web and find 5 real, current articles for someone interested in: ${topics.join(", ")}.
${exclusions.length > 0 ? `EXCLUDE topics about: ${exclusions.join(", ")}` : ""}

Search the web for relevant current news and articles, then return ONLY a valid JSON array of exactly 5 items:
[{ "id": "item_1", "title": "actual headline", "url": "actual URL from search results", "source": "publication name", "summary": "1-2 sentence summary", "category": "matching interest category" }]`,
    }],
  });

  const textBlocks = response.content.filter((b) => b.type === "text");
  const raw = textBlocks.map((b) => b.text).join("");
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("Failed to parse edition results");
  const items = JSON.parse(jsonMatch[0]);

  const today = localDate || new Date().toISOString().split("T")[0];
  const edition = { editionId: `${userId}_${today}`, userId, date: today, items: items.slice(0, 5) };

  await db.collection("users").doc(userId).collection("editions").doc(today).set({
    ...edition,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return edition;
});

// ═══════════════════════════════════════════════════════════════
// 9. PROCESS TRANSCRIPT (Intelligence Agent — Founders Only)
// Triggered by: Intelligence page > Upload tab > Process button
// Input: { userId, fileUrl, fileName, fileContent? }
// Model: Sonnet (complex — structured data extraction from unstructured transcripts)
// Output: { extraction: TranscriptExtraction, transcriptId }
// Two-step process:
//   Step 1: Extract structured data (summary, nuggets, decisions, open loops, entities)
//   Step 2: Match extracted topics against existing threads, create new threads
// Saved to: users/{uid}/transcript_extractions/{auto-id}
//           users/{uid}/threads/{auto-id} (created/updated)
// ═══════════════════════════════════════════════════════════════
exports.onTranscriptProcess = onCall({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120 }, async (request) => {
  const { userId, fileUrl, fileName } = request.data;

  // In production: fetch the file from Storage and extract text.
  // For V1, the frontend can send the text content directly.
  const fileContent = request.data.fileContent || "Transcript content would be extracted from the uploaded file.";

  // Step 1: Extract structured data
  const extractPrompt = `Extract structured data from this call transcript:

TRANSCRIPT:
${fileContent.substring(0, 30000)}

Return ONLY valid JSON:
{
  "executiveSummary": "1 paragraph",
  "nuggets": ["top 10 insights"],
  "decisionsMade": [{"decision":"what","context":"context"}],
  "openLoops": [{"question":"q","whoOwesAnswer":"who","priority":"high/medium/low"}],
  "actionItems": [{"action":"what","suggestedOwner":"who","urgency":"immediate/this-week/soon/backlog"}],
  "entitiesMentioned": [{"name":"name","type":"person/org/project/asset","context":"how discussed"}],
  "risks": ["risks mentioned"],
  "threadUpdates": ["topic names to track"]
}`;

  const extraction = await callClaudeJSON("You are a founder intelligence analyst. Return only valid JSON.", extractPrompt);

  // Save extraction
  const extRef = await db.collection("users").doc(userId).collection("transcript_extractions").add({
    ...extraction,
    transcriptFileUrl: fileUrl,
    fileName,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Step 2: Match and update threads
  const threadsSnap = await db.collection("users").doc(userId).collection("threads").get();
  const existingThreads = threadsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (extraction.threadUpdates && extraction.threadUpdates.length > 0) {
    const threadPrompt = `Existing threads: ${JSON.stringify(existingThreads.map((t) => ({ id: t.id, title: t.title, summary: t.summaryCurrent, status: t.status })))}

New topics: ${extraction.threadUpdates.join(", ")}

Return ONLY valid JSON:
{
  "updatedThreads": [{"threadId":"id","newEvent":"what happened"}],
  "newThreads": [{"title":"title","summary":"state","status":"active"}],
  "contradictions": [{"threadId":"id","oldPosition":"before","newPosition":"now"}]
}`;

    const threadUpdates = await callClaudeJSON("Return only valid JSON.", threadPrompt);

    // Apply updates
    for (const ut of threadUpdates.updatedThreads || []) {
      const threadRef = db.collection("users").doc(userId).collection("threads").doc(ut.threadId);
      const threadDoc = await threadRef.get();
      if (threadDoc.exists) {
        const data = threadDoc.data();
        await threadRef.update({
          keyEvents: [...(data.keyEvents || []), { transcriptId: extRef.id, summary: ut.newEvent, date: admin.firestore.FieldValue.serverTimestamp() }],
          lastMentionedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    // Create new threads
    for (const nt of threadUpdates.newThreads || []) {
      await db.collection("users").doc(userId).collection("threads").add({
        title: nt.title,
        summaryCurrent: nt.summary,
        status: nt.status,
        keyEvents: [{ transcriptId: extRef.id, summary: nt.summary, date: admin.firestore.FieldValue.serverTimestamp() }],
        openLoops: [],
        nextBestActions: [],
        relatedEntities: [],
        lastMentionedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  return { extraction, transcriptId: extRef.id };
});

// ═══════════════════════════════════════════════════════════════
// 10. QUERY TRANSCRIPTS (Intelligence Agent — Founders Only)
// Triggered by: Intelligence page > Query tab
// Input: { userId, question }
// Model: Sonnet (complex — reasoning across all extracted transcript data)
// Output: { answer: string }
// Gathers ALL transcript extractions, threads, decisions, open loops, entities
// and provides them as context. Answers must cite sources.
// ═══════════════════════════════════════════════════════════════
exports.onTranscriptQuery = onCall({ secrets: [ANTHROPIC_API_KEY] }, async (request) => {
  const { userId, question } = request.data;

  // Gather all extracted data
  const extractionsSnap = await db.collection("users").doc(userId).collection("transcript_extractions").orderBy("createdAt", "desc").limit(50).get();
  const threadsSnap = await db.collection("users").doc(userId).collection("threads").get();

  const extractions = extractionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const threads = threadsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const allDecisions = extractions.flatMap((e) => (e.decisionsMade || []).map((d) => ({ ...d, source: e.fileName })));
  const allLoops = extractions.flatMap((e) => (e.openLoops || []).map((l) => ({ ...l, source: e.fileName })));
  const allEntities = extractions.flatMap((e) => (e.entitiesMentioned || []).map((ent) => ({ ...ent, source: e.fileName })));

  const systemPrompt = `You are a founder intelligence agent. Answer ONLY from the data below. Always cite sources. If inferring, say so.

THREADS: ${JSON.stringify(threads.map((t) => ({ title: t.title, summary: t.summaryCurrent, status: t.status })))}
DECISIONS: ${JSON.stringify(allDecisions)}
OPEN LOOPS: ${JSON.stringify(allLoops)}
ENTITIES: ${JSON.stringify(allEntities)}
TRANSCRIPT SUMMARIES: ${JSON.stringify(extractions.map((e) => ({ file: e.fileName, summary: e.executiveSummary })))}`;

  const answer = await callClaude(systemPrompt, question);
  return { answer };
});

// ═══════════════════════════════════════════════════════════════
// 11. DAILY BRIEFING
// Triggered by: Dashboard > "Tap to generate" or "Refresh" button
// Input: { userId, localDate }
// Model: Sonnet (briefing content) + Sonnet with web_search (real headlines)
// Output: DailyBriefing { financialInsight, healthSuggestion, headlines[], relationshipReflection, growthReminder }
// Memory: INBOUND + OUTBOUND
// Runs two parallel calls: one for personalized content, one for real news via web search.
// Headlines are REAL URLs from web search, not hallucinated.
// Saved to: users/{uid}/daily_briefings/{date}
// ═══════════════════════════════════════════════════════════════
exports.onDailyBriefingManual = onCall({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60 }, async (request) => {
  const { userId, localDate } = request.data;
  return await generateBriefingForUser(userId, localDate);
});

// Shared briefing generator
async function generateBriefingForUser(userId, dateOverride) {
  const [userData, memory] = await Promise.all([getUserData(userId), getMemory(userId)]);
  if (!userData?.profile || !userData?.onboarding) return null;

  const p = userData.profile;
  const o = userData.onboarding;
  const memorySection = memory ? `\nPERSISTENT MEMORY:\n${formatMemoryForPrompt(memory)}\n` : "";
  const topics = (o.newsTopics || []).join(", ");
  const exclusions = (o.exclusions || []).join(", ");

  // Generate personalized briefing content (non-headline sections)
  const briefingPrompt = `Generate today's True North briefing.

Profile: ${p.archetypeName}. Financial: ${(o.financialPriorities || []).join(", ")}. Health: ${(o.healthPriorities || []).join(", ")}.
Topics: ${topics}. Relationships: ${(o.relationshipGoals || []).join(", ")}.
Career: ${o.careerDirection}. Tone: ${o.tonePref}. Personality: ${p.personalitySummary}.
${memorySection}
Use what you know from memory to make each section deeply personal and specific to their current patterns.

Return ONLY valid JSON:
{
  "financialInsight": "1 paragraph financial guidance",
  "healthSuggestion": "1 specific health action",
  "relationshipReflection": "1 reflective prompt",
  "growthReminder": "1 motivational push",
  "memoryUpdate": { "newInsights": [], "updatedPatterns": [], "removeInsights": [], "avoidanceSignal": null }
}
Keep each 2-4 sentences. Personal. Grounded. Empowering.`;

  // Fetch real headlines via web search in parallel with briefing generation
  const client = getClient();
  const profileContext = p.archetypeName ? `\nThe reader's profile: Archetype: ${p.archetypeName}, Strength: ${p.coreStrength}, Career: ${o.careerDirection || "unknown"}.` : "";
  const exclusionLine = exclusions ? `\nEXCLUDE topics about: ${exclusions}` : "";

  const [briefing, headlinesResponse] = await Promise.all([
    callClaudeJSON("Return only valid JSON.", briefingPrompt),
    client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2048,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [{
        role: "user",
        content: `Search the web for 3-5 current, real news articles relevant to someone interested in: ${topics}${exclusionLine}${profileContext}

Return ONLY a valid JSON array (no markdown, no explanation):
[{"title": "actual headline", "source": "publication name", "url": "actual URL from search results"}]`,
      }],
    }),
  ]);

  // Parse real headlines from web search response
  const textBlocks = headlinesResponse.content.filter((b) => b.type === "text");
  const rawHeadlines = textBlocks.map((b) => b.text).join("");
  const headlinesMatch = rawHeadlines.match(/\[[\s\S]*\]/);
  let headlines = [];
  try {
    headlines = headlinesMatch ? JSON.parse(headlinesMatch[0]) : [];
  } catch (e) {
    console.error("Failed to parse headlines:", e);
  }

  const today = dateOverride || new Date().toISOString().split("T")[0];

  const memUpdate = briefing.memoryUpdate;
  delete briefing.memoryUpdate;

  const fullBriefing = { ...briefing, headlines };

  await db.collection("users").doc(userId).collection("daily_briefings").doc(today).set({
    ...fullBriefing,
    date: today,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (memUpdate) mergeMemory(userId, memory, memUpdate).catch(console.error);
  return fullBriefing;
}

// ═══════════════════════════════════════════════════════════════
// 12. GAME OF LIFE — NEW DAY
// Triggered by: Game page > "I'M READY TO PLAY" button
// Input: { userId, yesterdaySnapshot, entryCalibration?, localDate? }
// Model: Sonnet (complex — analyzes patterns, selects tile type, personalizes challenge)
// Output: GameDay { date, tileType, tilePrompt, choices, state: "pending_choice", yesterdayAnalysis }
// Memory: INBOUND + OUTBOUND
// ═══════════════════════════════════════════════════════════════

// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  CRITICAL DESIGN DECISION: HARDCODED CHOICE FRAMEWORKS              ║
// ║                                                                      ║
// ║  Each tile type has fixed choices with fixed consequenceType values. ║
// ║  The LLM only fills in personalized descriptions — it CANNOT change ║
// ║  the consequence types or the score deltas they produce.            ║
// ║                                                                      ║
// ║  This is intentional: it prevents LLM hallucination from breaking   ║
// ║  the game's scoring mechanics. The consequence deltas are:          ║
// ║    avoid = -3, explore = +2, act = +4, transmute = +5              ║
// ║  (defined in onChoosePath and in scoring.service.ts on frontend)    ║
// ║                                                                      ║
// ║  DO NOT let the LLM generate consequence types dynamically.         ║
// ╚═══════════════════════════════════════════════════════════════════════╝
const TILE_CHOICE_FRAMEWORKS = {
  mirror: [
    { label: "Avoid it", consequenceType: "avoid" },
    { label: "Explore it", consequenceType: "explore" },
    { label: "Take one corrective action", consequenceType: "act" },
  ],
  risk: [
    { label: "Stay safe", consequenceType: "avoid" },
    { label: "Take the risk", consequenceType: "act" },
  ],
  shadow: [
    { label: "Defend the shadow", consequenceType: "avoid" },
    { label: "Observe it", consequenceType: "explore" },
    { label: "Transmute it", consequenceType: "transmute" },
  ],
  vitality: [
    { label: "Ignore body", consequenceType: "avoid" },
    { label: "Support body", consequenceType: "act" },
  ],
  relationship: [
    { label: "Contract", consequenceType: "avoid" },
    { label: "Clarify", consequenceType: "explore" },
    { label: "Release", consequenceType: "act" },
    { label: "Lean in", consequenceType: "transmute" },
  ],
  unknown: [
    { label: "Seek certainty", consequenceType: "avoid" },
    { label: "Take intuitive step", consequenceType: "act" },
    { label: "Pause in stillness", consequenceType: "explore" },
  ],
};

exports.onNewDay = onCall({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60, cors: true }, async (request) => {
  const { userId, yesterdaySnapshot, entryCalibration, localDate } = request.data;
  if (!userId) throw new HttpsError("invalid-argument", "userId is required");
  const [userData, memory] = await Promise.all([getUserData(userId), getMemory(userId)]);
  if (!userData?.profile || !userData?.onboarding) throw new HttpsError("not-found", "Profile not found");

  const p = userData.profile;
  const o = userData.onboarding;

  // Load board level & coherence
  const coherenceSnap = await db.collection("users").doc(userId)
    .collection("game_meta").doc("coherence").get();
  const coherence = coherenceSnap.exists ? coherenceSnap.data() : { streak: 0, totalChoices: 0, courageChoices: 0, transmutations: 0, boardLevel: 1 };

  // Save entry calibration if first time
  if (entryCalibration) {
    await db.collection("users").doc(userId).collection("game_meta").doc("calibration").set({
      ...entryCalibration, savedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  // Load calibration for prompt context
  const calibrationSnap = await db.collection("users").doc(userId)
    .collection("game_meta").doc("calibration").get();
  const calibration = calibrationSnap.exists ? calibrationSnap.data() : null;

  // Load last 7 game days for history context
  const historySnap = await db.collection("users").doc(userId)
    .collection("game_days").orderBy("date", "desc").limit(7).get();
  const tileHistory = historySnap.docs.map((d) => {
    const data = d.data();
    return { date: data.date, type: data.tileType, chosenPath: data.chosenPath, consequenceType: data.choices?.[data.chosenPath]?.consequenceType || null, actionsCompleted: (data.actions || []).filter((a) => a.completed).length, actionsTotal: (data.actions || []).length };
  });

  const prompt = `You are the Game of Life initiation engine for TrueNorth. This is NOT entertainment. It is interactive evolution architecture.

PLAYER'S COMPASS (from onboarding):
- Name: ${o.name}
- Career/Purpose: ${o.careerDirection}
- Health priorities: ${(o.healthPriorities || []).join(", ")}
- Relationship goals: ${(o.relationshipGoals || []).join(", ")}
- Financial priorities: ${(o.financialPriorities || []).join(", ")}
- Risk tolerance: ${o.riskTolerance}/10
- Archetype: ${p.archetypeName}
- Shadow: ${p.shadowToTransmute}
- Strength: ${p.coreStrength}

${calibration ? `ENTRY CALIBRATION (what they stated when entering the game):
- Wants more of: ${calibration.wantMore}
- What drains them: ${calibration.drains}
- Afraid to risk: ${calibration.afraidToRisk}
- Feels alive but uncertain: ${calibration.aliveButUncertain}` : "No entry calibration yet."}

CURRENT DIMENSION SCORES:
${yesterdaySnapshot?.scores ? JSON.stringify(yesterdaySnapshot.scores) : "No scores yet — first day."}

COHERENCE LEVEL:
- Board level: ${coherence.boardLevel}/4
- Streak: ${coherence.streak} days
- Courage ratio: ${coherence.totalChoices > 0 ? Math.round((coherence.courageChoices / coherence.totalChoices) * 100) : 0}%
- Transmutations: ${coherence.transmutations}

PERSISTENT MEMORY:
${formatMemoryForPrompt(memory)}

TILE HISTORY (last 7 days — includes what they CHOSE, not just what was served):
${tileHistory.length > 0 ? JSON.stringify(tileHistory) : "No history yet — this is their first day."}

YESTERDAY'S RESULTS:
${yesterdaySnapshot ? `- Tile type: ${yesterdaySnapshot.tileType || "none"}\n- Choice made: ${yesterdaySnapshot.consequenceType || "none"}\n- Actions completed: ${yesterdaySnapshot.actionsCompleted}/${yesterdaySnapshot.actionsServed}` : "No yesterday data — first day."}

TILE TYPE DEFINITIONS:
- mirror: Self-honesty. Surface gaps between stated desires and actual behavior. Choices: Avoid it / Explore it / Take one corrective action.
- risk: Micro-courage. A small dare toward authenticity. Choices: Stay safe / Take the risk.
- shadow: Pattern transmutation (Gene Keys dynamic). Identify shadow → name the gift → name the siddhi. Choices: Defend the shadow / Observe it / Transmute it.
- vitality: Body intelligence. Energy, movement, breath, rest. Choices: Ignore body / Support body.
- relationship: Resonance & nervous system awareness. Present a specific relational dynamic. Choices: Contract / Clarify / Release / Lean in.
- unknown: Trust field expansion. Deliberate ambiguity. The initiation IS not knowing. Choices: Seek certainty / Take intuitive step / Pause in stillness.

RULES:
- Lowest-scoring dimensions get weighted higher (push toward balance)
- Avoided tile types MUST return eventually — avoidance always comes back as a mirror or shadow
- If memory shows repeated avoidance of a topic, serve a shadow tile about it
- Don't serve the same tile type two days in a row unless avoidance demands it
- Compass/calibration answers vs actual behavior gaps = mirror tile
- For shadow tiles: you MUST identify the specific shadow pattern, name the gift it compresses, and name the siddhi (fully expressed version)
- For relationship tiles: ground the challenge in a SPECIFIC relational dynamic from their memory or stated goals
- For unknown tiles: be genuinely ambiguous — do NOT give clear instructions. The uncertainty IS the initiation.

DO NOT generate actions. Only generate the tile, challenge prompt, choice descriptions, and yesterday analysis.

Return ONLY valid JSON:
{
  "tileType": "one of: mirror, risk, shadow, vitality, relationship, unknown",
  "tilePrompt": "2-4 sentences — the growth challenge for today. Personal. Direct. Reference their specific situation from memory and calibration. Not generic. For shadow tiles, weave in the shadow→gift→siddhi arc.",
  "choiceDescriptions": ["A personalized 1-sentence description for each choice, in the SAME ORDER as the tile's fixed choice framework. Make each description specific to TODAY'S challenge, not generic."],
  "linkedDimension": "the primary dimension this tile targets: spirit, body, relationships, wealth, creativeExpression, service, learning, or environment",
  "shadowProgression": { "shadow": "the shadow pattern name", "gift": "the gift it compresses", "siddhi": "the fully expressed version" },
  "yesterdayAnalysis": "2-4 sentences reflecting on yesterday. Reference their CHOICE (not just actions). What pattern does their choice reveal? What's improving? What's being avoided? Honest but encouraging. If first day, welcome them to the game.",
  "memoryUpdate": {
    "newInsights": ["anything new learned from analyzing their patterns and choices"],
    "updatedPatterns": ["patterns confirmed or shifted by their choices"],
    "removeInsights": ["outdated observations"],
    "avoidanceSignal": "what they seem to be avoiding based on choice history, or null"
  }
}
Note: "shadowProgression" is ONLY required for shadow tiles. Omit it for other tile types.`;

  const result = await callClaudeJSON("You return only valid JSON.", prompt);

  const tileType = result.tileType || "mirror";
  const framework = TILE_CHOICE_FRAMEWORKS[tileType] || TILE_CHOICE_FRAMEWORKS.mirror;
  const choiceDescriptions = result.choiceDescriptions || [];
  const linkedDim = result.linkedDimension || "spirit";

  // Build choices by merging fixed framework with LLM-personalized descriptions
  const choices = framework.map((f, i) => ({
    label: f.label,
    description: choiceDescriptions[i] || f.label,
    consequenceType: f.consequenceType,
    linkedDimension: linkedDim,
  }));

  const today = localDate || new Date().toISOString().split("T")[0];

  // Guard: don't overwrite an active or completed game day
  const existingSnap = await db.collection("users").doc(userId).collection("game_days").doc(today).get();
  if (existingSnap.exists) {
    const existing = existingSnap.data();
    if (existing.state !== "pending_choice" || (existing.actions && existing.actions.length > 0)) {
      return existing;
    }
  }

  const gameDay = {
    date: today,
    tileType,
    tilePrompt: result.tilePrompt,
    choices,
    chosenPath: null,
    choiceConsequences: null,
    state: "pending_choice",
    actions: [],
    yesterdayAnalysis: result.yesterdayAnalysis || "",
    ...(tileType === "shadow" && result.shadowProgression ? { shadowProgression: result.shadowProgression } : {}),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Save game day
  await db.collection("users").doc(userId).collection("game_days").doc(today).set(gameDay);

  // Save yesterday's snapshot
  if (yesterdaySnapshot?.date) {
    await db.collection("users").doc(userId).collection("day_snapshots")
      .doc(yesterdaySnapshot.date).set(yesterdaySnapshot);
  }

  // Merge memory async
  if (result.memoryUpdate) {
    if (memory) {
      mergeMemory(userId, memory, result.memoryUpdate).catch(console.error);
    } else {
      db.collection("users").doc(userId).collection("memory").doc("core").set({
        coreInsights: result.memoryUpdate.newInsights || [],
        activePatterns: (result.memoryUpdate.updatedPatterns || []).map((pt) => ({
          pattern: pt, frequency: 1, lastSeen: today,
        })),
        avoidances: result.memoryUpdate.avoidanceSignal ? [result.memoryUpdate.avoidanceSignal] : [],
        strengths: [],
        agentInsights: {},
        currentEdge: "",
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(console.error);
    }
  }

  return gameDay;
});

// ═══════════════════════════════════════════════════════════════
// 13. GAME OF LIFE — CHOOSE PATH
// Triggered by: user taps "Commit to This Path" on a tile choice
// Input: { userId, date, choiceIndex }
// Model: Sonnet (generates 2-4 personalized daily actions based on the choice)
// Output: { chosenPath, choiceConsequences, actions, scores, coherence }
// This function does several things in sequence:
//   1. Applies score consequence (delta) to the linked dimension
//   2. Updates coherence metrics (streak, courage ratio, transmutations, board level)
//   3. Generates path-specific daily actions via Sonnet
//   4. Fires extractChoiceInsights() (fire-and-forget) to feed memory
// Saved to: users/{uid}/game_days/{date} (updated), users/{uid}/scores/current,
//           users/{uid}/game_meta/coherence
// ═══════════════════════════════════════════════════════════════
exports.onChoosePath = onCall({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60, cors: true }, async (request) => {
  const { userId, date, choiceIndex } = request.data;
  if (!userId || !date || choiceIndex === undefined) throw new HttpsError("invalid-argument", "userId, date, and choiceIndex are required");

  const dayRef = db.collection("users").doc(userId).collection("game_days").doc(date);
  const daySnap = await dayRef.get();
  if (!daySnap.exists) throw new HttpsError("not-found", "Game day not found");

  const dayData = daySnap.data();
  if (dayData.state !== "pending_choice") throw new HttpsError("failed-precondition", "Choice already made");

  const chosen = dayData.choices[choiceIndex];
  if (!chosen) throw new HttpsError("invalid-argument", "Invalid choice index");

  // ── Apply score consequences immediately ──
  const consequenceDeltas = { avoid: -3, explore: 2, act: 4, transmute: 5 };
  const delta = consequenceDeltas[chosen.consequenceType] || 0;
  const dim = chosen.linkedDimension;

  const scoresSnap = await db.collection("users").doc(userId).collection("scores").doc("current").get();
  const scores = scoresSnap.exists ? scoresSnap.data() : null;

  const choiceConsequences = {};
  if (scores && dim && scores[dim] !== undefined) {
    const oldScore = scores[dim];
    const newScore = Math.max(5, Math.min(100, oldScore + delta));
    choiceConsequences[dim] = delta;
    scores[dim] = newScore;
    scores.lastActivity = { ...(scores.lastActivity || {}), [dim]: date };
    await db.collection("users").doc(userId).collection("scores").doc("current").set(scores);
  }

  // ── Update coherence metrics ──
  const coherenceRef = db.collection("users").doc(userId).collection("game_meta").doc("coherence");
  const coherenceSnap = await coherenceRef.get();
  const coherence = coherenceSnap.exists ? coherenceSnap.data() : { streak: 0, totalChoices: 0, courageChoices: 0, transmutations: 0, boardLevel: 1 };

  coherence.totalChoices = (coherence.totalChoices || 0) + 1;
  if (chosen.consequenceType === "act" || chosen.consequenceType === "transmute" || chosen.consequenceType === "explore") {
    coherence.courageChoices = (coherence.courageChoices || 0) + 1;
  }
  if (chosen.consequenceType === "transmute") {
    coherence.transmutations = (coherence.transmutations || 0) + 1;
  }

  // Update streak
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];
  const yesterdayDaySnap = await db.collection("users").doc(userId).collection("game_days").doc(yesterdayStr).get();
  if (yesterdayDaySnap.exists && yesterdayDaySnap.data().chosenPath !== null) {
    coherence.streak = (coherence.streak || 0) + 1;
  } else {
    coherence.streak = 1;
  }

  // Recalculate board level
  const courageRatio = coherence.totalChoices > 0 ? coherence.courageChoices / coherence.totalChoices : 0;
  // Simple board level: based on streak + courage + transmutations
  const coherenceScore = Math.min(1, coherence.streak / 14) * 25 + courageRatio * 35 + Math.min(1, coherence.transmutations / 10) * 20 + 20; // +20 baseline for dimension balance (simplified)
  coherence.boardLevel = coherenceScore >= 80 ? 4 : coherenceScore >= 60 ? 3 : coherenceScore >= 35 ? 2 : 1;

  await coherenceRef.set(coherence);

  // ── Generate path-specific actions via Claude ──
  const [userData, memory] = await Promise.all([getUserData(userId), getMemory(userId)]);
  const o = userData?.onboarding || {};
  const p = userData?.profile || {};

  const actionPrompt = `You are the Game of Life action generator for TrueNorth.

The player just made a choice on their ${dayData.tileType} tile.

TILE CHALLENGE: ${dayData.tilePrompt}

CHOICE MADE: "${chosen.label}" — ${chosen.description}
CONSEQUENCE TYPE: ${chosen.consequenceType} (${chosen.consequenceType === "avoid" ? "they chose safety — actions should gently confront this" : chosen.consequenceType === "explore" ? "they chose curiosity — actions should deepen awareness" : chosen.consequenceType === "act" ? "they chose courage — actions should be concrete and bold" : "they chose transmutation — actions should transform the pattern"})

PLAYER CONTEXT:
- Name: ${o.name || "Unknown"}
- Archetype: ${p.archetypeName || "Unknown"}
- Shadow: ${p.shadowToTransmute || "Unknown"}
${dayData.shadowProgression ? `- Shadow progression: ${dayData.shadowProgression.shadow} → ${dayData.shadowProgression.gift} → ${dayData.shadowProgression.siddhi}` : ""}

MEMORY: ${formatMemoryForPrompt(memory)}

RULES FOR ACTION GENERATION:
- Generate 2-4 actions that are SPECIFIC to the choice they made
- If they chose avoidance: actions should be gentle but still move them toward the truth. Don't punish. Mirror back what avoidance costs.
- If they chose exploration: actions should deepen self-awareness — journaling, reflection, observation tasks
- If they chose action/courage: actions should be concrete, real-world, slightly uncomfortable — the kind of thing that changes something today
- If they chose transmutation: actions should involve active pattern-breaking, creative reframing, or service to others
- Each action links to a life dimension: spirit, body, relationships, wealth, creativeExpression, service, learning, environment

Return ONLY valid JSON:
{
  "actions": [
    {
      "id": "action_1",
      "title": "short action title",
      "description": "1-2 sentences — specific, personal, actionable",
      "tileType": "${dayData.tileType}",
      "linkedDimension": "one of: spirit, body, relationships, wealth, creativeExpression, service, learning, environment",
      "completed": false
    }
  ]
}`;

  const actionResult = await callClaudeJSON("You return only valid JSON.", actionPrompt);

  // ── Update game day with choice and actions ──
  await dayRef.update({
    chosenPath: choiceIndex,
    choiceConsequences,
    state: "in_progress",
    actions: actionResult.actions || [],
  });

  // Extract choice pattern insights async (fire-and-forget)
  extractChoiceInsights(userId, dayData.tileType, chosen, memory).catch(console.error);

  return {
    chosenPath: choiceIndex,
    choiceConsequences,
    actions: actionResult.actions || [],
    scores: scores || null,
    coherence,
  };
});

// ═══════════════════════════════════════════════════════════════
// 14. GAME OF LIFE — COMPLETE ACTION
// Triggered by: user taps the checkbox on a daily action
// Input: { userId, date, actionId }
// Model: NONE — this is pure Firestore update, no LLM call
// Output: { success: true, allDone: boolean }
// When all actions are completed, sets game day state to "completed".
// Score updates for action completion happen on the FRONTEND (scoring.service.ts)
// to keep the UI responsive — this just persists the completion state.
// ═══════════════════════════════════════════════════════════════
exports.onCompleteAction = onCall({ cors: true }, async (request) => {
  const { userId, date, actionId } = request.data;
  if (!userId || !date || !actionId) throw new HttpsError("invalid-argument", "userId, date, and actionId are required");

  const dayRef = db.collection("users").doc(userId).collection("game_days").doc(date);
  const daySnap = await dayRef.get();
  if (!daySnap.exists) throw new HttpsError("not-found", "Game day not found");

  const dayData = daySnap.data();
  const actions = (dayData.actions || []).map((a) =>
    a.id === actionId ? { ...a, completed: true, completedAt: admin.firestore.Timestamp.now() } : a
  );

  const allDone = actions.every((a) => a.completed);
  await dayRef.update({ actions, ...(allDone ? { state: "completed" } : {}) });
  return { success: true, allDone };
});

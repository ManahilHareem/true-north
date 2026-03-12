const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

const db = admin.firestore();

async function getUserProfileBundle(userId) {
  const snap = await db.collection("users").doc(userId).get();
  return snap.exists ? snap.data() : null;
}

async function getUserMemory(userId) {
  const snap = await db.collection("users").doc(userId).collection("memory").doc("core").get();
  return snap.exists ? snap.data() : null;
}

async function getRecentThreadMessages(userId, threadId, limit = 12) {
  if (!threadId) return [];

  const agentIds = ["financial", "food-medicine", "media", "relationship", "moonshot"];
  const lookups = await Promise.all(
    agentIds.map(async (agentId) => {
      const snap = await db.collection("users").doc(userId)
        .collection("chat_history").doc(agentId)
        .collection("threads").doc(threadId)
        .collection("messages")
        .orderBy("timestamp", "desc")
        .limit(limit)
        .get();

      return snap.docs.map((doc) => ({ agentId, ...doc.data() }));
    })
  );

  const flat = lookups.flat();
  flat.sort((a, b) => {
    const aTime = a.timestamp && a.timestamp.toDate ? a.timestamp.toDate().getTime() : 0;
    const bTime = b.timestamp && b.timestamp.toDate ? b.timestamp.toDate().getTime() : 0;
    return aTime - bTime;
  });

  return flat.slice(-limit).map((msg) => ({
    role: msg.role,
    content: msg.content,
    agentId: msg.agentId,
  }));
}

async function saveResponseLog(userId, payload) {
  await db.collection("users").doc(userId).collection("agent_runs").add({
    ...payload,
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function mergeMemoryUpdate(userId, memoryUpdate, agentId) {
  if (!memoryUpdate) return false;

  const ref = db.collection("users").doc(userId).collection("memory").doc("core");
  const snap = await ref.get();
  const current = snap.exists ? snap.data() : {
    coreInsights: [],
    activePatterns: [],
    avoidances: [],
    strengths: [],
    agentInsights: {},
    currentEdge: "",
  };

  const dedupe = (items) => Array.from(new Set((items || []).filter(Boolean)));
  const today = new Date().toISOString().split("T")[0];

  const activePatternMap = new Map(
    (current.activePatterns || []).map((pattern) => [pattern.pattern, pattern])
  );

  for (const pattern of memoryUpdate.updatedPatterns || []) {
    const existing = activePatternMap.get(pattern);
    activePatternMap.set(pattern, {
      pattern,
      frequency: existing ? (existing.frequency || 0) + 1 : 1,
      lastSeen: today,
    });
  }

  const nextAgentInsights = { ...(current.agentInsights || {}) };
  if (agentId && memoryUpdate.agentInsight) {
    nextAgentInsights[agentId] = memoryUpdate.agentInsight;
  }

  const nextMemory = {
    coreInsights: dedupe([...(current.coreInsights || []), ...(memoryUpdate.newInsights || [])]).slice(-10),
    activePatterns: Array.from(activePatternMap.values()).slice(-8),
    avoidances: dedupe([
      ...(current.avoidances || []),
      ...(memoryUpdate.avoidanceSignal ? [memoryUpdate.avoidanceSignal] : []),
    ]).slice(-5),
    strengths: dedupe([...(current.strengths || []), ...(memoryUpdate.newStrengths || [])]).slice(-5),
    agentInsights: nextAgentInsights,
    currentEdge: memoryUpdate.currentEdge || current.currentEdge || "",
    lastUpdated: FieldValue.serverTimestamp(),
  };

  await ref.set(nextMemory, { merge: true });
  return true;
}

module.exports = {
  getUserProfileBundle,
  getUserMemory,
  getRecentThreadMessages,
  saveResponseLog,
  mergeMemoryUpdate,
};

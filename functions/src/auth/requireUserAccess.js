const { HttpsError } = require("firebase-functions/v2/https");
const { getUserRole } = require("../shared/userData");

function requireUserAccess(request) {
  const authUid = request.auth && request.auth.uid;
  const requestedUserId = request.data && request.data.userId;

  if (!authUid) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }

  if (!requestedUserId) {
    throw new HttpsError("invalid-argument", "userId is required.");
  }

  if (authUid !== requestedUserId) {
    throw new HttpsError("permission-denied", "Cross-user access is not allowed.");
  }

  return authUid;
}

async function requireFounderAccess(request) {
  const userId = requireUserAccess(request);
  const role = await getUserRole(userId);

  if (role !== "founder" && role !== "admin") {
    throw new HttpsError("permission-denied", "Founder or admin access is required.");
  }

  return userId;
}

module.exports = { requireUserAccess, requireFounderAccess };

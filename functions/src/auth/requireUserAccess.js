const { HttpsError } = require("firebase-functions/v2/https");

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

module.exports = { requireUserAccess };

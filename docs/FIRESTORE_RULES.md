# True North — Firestore Security Rules

## Current State: WIDE OPEN (Must Fix Before Launch)

The current `firestore.rules` allows **all reads and writes** to the entire database with a time-based expiration:

```
allow read, write: if request.time < timestamp.date(2026, 4, 2);
```

This is the default Firebase "test mode" rule. **Any authenticated user can read/modify any other user's data.** This must be replaced before any real users are on the platform.

## Recommended Production Rules

Replace the contents of `firestore.rules` with:

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // Users can only access their own document and subcollections
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;

      // All subcollections follow the same ownership rule
      match /{subcollection=**} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }

    // Cloud Functions use the Admin SDK which bypasses rules,
    // so no special rules needed for backend writes.

    // Deny everything else
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### What This Does
- Users can only read/write their own data (`request.auth.uid == userId`)
- All subcollections (chat_history, game_days, memory, etc.) inherit the same rule
- Cloud Functions use the Firebase Admin SDK, which bypasses security rules entirely — so backend writes still work
- Everything else is denied

### What This Doesn't Cover (Future Enhancements)
- **Admin role access**: If you need admins to read other users' data from the frontend, add a role check:
  ```
  allow read: if request.auth != null && (
    request.auth.uid == userId ||
    get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['admin']
  );
  ```
- **Data validation**: You could add `request.resource.data` checks to enforce schema (e.g., role must be one of 'member', 'founder', 'admin')
- **Rate limiting**: Firestore rules don't support rate limiting — use Cloud Functions for that

## Deploying Rules

```bash
firebase deploy --only firestore:rules
```

## Testing Rules

Use the Firebase Console's Rules Playground (Firestore → Rules tab → "Rules Playground") to test scenarios:
1. Authenticated user reading their own profile → should ALLOW
2. Authenticated user reading another user's profile → should DENY
3. Unauthenticated request → should DENY
4. User writing to their own subcollection → should ALLOW

## Storage Rules

The `storage.rules` file should follow the same pattern:

```
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

This ensures users can only upload to and read from their own storage path.

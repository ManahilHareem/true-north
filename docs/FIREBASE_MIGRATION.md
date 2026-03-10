# True North — Firebase Migration Guide

## Moving to a New Firebase Project

If you need to set up True North on a new Firebase project (different GCP account, fresh environment, etc.), follow these steps.

### 1. Create a New Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project
3. Enable these services:
   - **Authentication** → Sign-in providers: Google, Email/Password
   - **Firestore Database** → Start in test mode (update rules after)
   - **Storage** → Start in test mode
   - **Functions** → Requires Blaze (pay-as-you-go) billing plan
   - **Hosting** → Set up a hosting site

### 2. Get the New Firebase Config

In Firebase Console → Project Settings → Your Apps → Web App:
- Click "Add app" (Web) if no web app exists
- Copy the `firebaseConfig` object

### 3. Update Frontend Config

Edit `src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  firebase: {
    apiKey: 'YOUR_NEW_API_KEY',
    authDomain: 'YOUR_PROJECT.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT.firebasestorage.app',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID',
  },
  anthropicFunctionUrl: 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net',
};
```

### 4. Update firebase.json

Edit the `hosting.site` field to match your new hosting site name:

```json
{
  "hosting": {
    "site": "your-new-site-name",
    ...
  }
}
```

### 5. Set Up Firebase CLI

```bash
firebase login
firebase use YOUR_PROJECT_ID
```

### 6. Set the Anthropic API Key

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
```

Paste your Anthropic API key when prompted.

### 7. Deploy Firestore Rules

```bash
firebase deploy --only firestore:rules
```

### 8. Deploy Storage Rules

```bash
firebase deploy --only storage
```

### 9. Deploy Cloud Functions

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

**Important**: The first deploy may take several minutes as it provisions the Cloud Functions infrastructure.

### 10. Deploy Frontend

```bash
npm run build
firebase deploy --only hosting
```

### 11. Configure Auth Providers

In Firebase Console → Authentication → Sign-in method:
- Enable **Google** sign-in
- Enable **Email/Password** sign-in
- Add your hosting domain to **Authorized domains**

## Data Migration

### Exporting Data from Old Project

There is no built-in data export tool for this app. Options:

1. **Firestore Export** (GCP Console): Use `gcloud firestore export` to export all collections to a GCS bucket, then import into the new project with `gcloud firestore import`.

2. **Manual Script**: Write a Node.js script that reads all documents from the old project and writes them to the new one. Since all data is under `users/{uid}/`, you'd iterate users and their subcollections.

### User Authentication Migration
Firebase Auth users are per-project. Users will need to re-authenticate on the new project. Their Firestore data will still be accessible if you migrate it (the UIDs stay the same if you use the Firebase Admin SDK to import users).

## Anthropic API Requirements

The Cloud Functions use these Anthropic features:
- **Messages API** with `claude-sonnet-4-5-20250929` and `claude-haiku-4-5-20251001`
- **Web Search tool** (`web_search_20250305`) — used in daily briefings and Signal Stream articles
- **Tool use** (extended thinking not used, but web_search counts as a tool)

Your Anthropic plan must support tool use and web search. Check your plan's capabilities at [console.anthropic.com](https://console.anthropic.com).

## Billing Considerations

- **Firebase Functions**: Requires Blaze plan. Costs are per-invocation + compute time.
- **Anthropic API**: Billed per token. Sonnet is more expensive than Haiku.
  - Typical daily cost per active user: ~$0.10-0.50 depending on feature usage
  - Heaviest calls: profile generation, game tiles, chat (long context), Signal Stream (web search)
- **Firestore**: Billed per read/write/delete. The app does moderate reads (loading user data per page).
- **Firebase Storage**: Billed per GB stored + bandwidth. Minimal unless users upload many files.

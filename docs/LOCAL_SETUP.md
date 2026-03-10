# True North — Local Development Setup

## Prerequisites

- **Node.js** 20 (required by `functions/package.json` engines field)
- **npm** 10+ (ships with Node 18+)
- **Firebase CLI**: `npm install -g firebase-tools`
- **Angular CLI**: `npm install -g @angular/cli` (optional — `npx ng` works too)

## First-Time Setup

### 1. Clone and Install

```bash
git clone <repo-url>
cd True-North

# Frontend dependencies
npm install

# Backend dependencies
cd functions
npm install
cd ..
```

### 2. Firebase Login

```bash
firebase login
```

This opens a browser for Google OAuth. You need access to your Firebase project.

### 3. Set the Anthropic API Key (Cloud Functions Secret)

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
```

You'll be prompted to paste the key. This is stored securely in Google Secret Manager and injected into Cloud Functions at runtime. You only need to do this once per project.

### 4. Verify Firebase Project

```bash
firebase projects:list
```

Make sure your project ID is listed. If you need to switch:

```bash
firebase use YOUR_PROJECT_ID
```

## Running Locally

### Frontend Dev Server

```bash
npm start
# or: ng serve
```

Opens at `http://localhost:4200`. Hot-reloads on file changes.

**Note**: The local frontend still calls the PRODUCTION Cloud Functions and Firestore. There is no emulator setup yet.

### Building for Production

```bash
npm run build
```

Output goes to `dist/truenorth/browser/`. This is what Firebase Hosting serves.

## Deploying

### Deploy Everything

```bash
firebase deploy
```

### Deploy Only Frontend

```bash
npm run build
firebase deploy --only hosting
```

### Deploy Only Cloud Functions

```bash
firebase deploy --only functions
```

### Deploy Only Firestore Rules

```bash
firebase deploy --only firestore:rules
```

## Project Structure

```
True-North/
├── src/                    ← Angular frontend source
│   ├── app/
│   │   ├── pages/          ← 9 page components
│   │   ├── services/       ← 5 Angular services
│   │   ├── models/         ← TypeScript interfaces
│   │   ├── prompts/        ← Prompt templates (reference)
│   │   ├── guards/         ← Route guards
│   │   ├── app.config.ts   ← Bootstrap config
│   │   └── app.routes.ts   ← Route definitions
│   ├── environments/       ← Firebase config
│   └── styles.scss         ← Global styles
├── functions/              ← Cloud Functions backend
│   ├── index.js            ← THE ENTIRE BACKEND
│   └── package.json        ← Backend dependencies
├── firestore.rules         ← Firestore security rules
├── storage.rules           ← Storage security rules
├── firebase.json           ← Firebase project config
├── angular.json            ← Angular CLI config
├── CLAUDE.md               ← Instructions for Claude Code
└── docs/                   ← Documentation
```

## Common Issues

### "Cannot read property of undefined" in Firestore calls
Firestore SDK calls must be inside `runInInjectionContext()`. Use the existing wrappers in `UserDataService.firestoreCall()` and `ApiService.call()`.

### Cloud Functions not updating after deploy
Functions can take 1-2 minutes to propagate after deployment. Check the Firebase Console > Functions to verify the deploy completed.

### "Missing or insufficient permissions" from Firestore
The current rules are time-limited (expire April 2, 2026). If expired, update the timestamp in `firestore.rules` or implement proper rules (see `docs/FIRESTORE_RULES.md`).

### ANTHROPIC_API_KEY not found
Set it with: `firebase functions:secrets:set ANTHROPIC_API_KEY`. This must be done before the first deployment of functions.

### Web Speech API not working (Live Mode)
The Web Speech API only works in Chrome and Edge. Safari and Firefox do not support `SpeechRecognition`. The app checks for browser support and shows a message.

/**
 * Firebase project config.
 *
 * SETUP: Copy environment.example.ts to environment.ts and fill in your
 * Firebase project values from Firebase Console → Project Settings → Your Apps.
 *
 * The Anthropic API key is NOT here — it's a Cloud Functions secret.
 * Set it with: firebase functions:secrets:set ANTHROPIC_API_KEY
 *
 * anthropicFunctionUrl is unused (all calls go through Angular Fire's
 * httpsCallable which auto-discovers the function URL from the project config).
 */
export const environment = {
  production: false,
  firebase: {
    apiKey: 'YOUR_FIREBASE_API_KEY',
    authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT_ID.firebasestorage.app',
    messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
    appId: 'YOUR_APP_ID',
  },
  anthropicFunctionUrl: 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net',
};

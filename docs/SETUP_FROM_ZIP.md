# True North — From "I Just Got a Zip File" to "The App Is Live"

## PART 1: ACCOUNTS YOU NEED

Before touching any code, you need these 3 accounts:

### 1. Google Account
- Needed for Firebase (Firebase is owned by Google)
- Any Gmail works, or you can use Google Workspace

### 2. Firebase
- Go to [console.firebase.google.com](https://console.firebase.google.com)
- Sign in with your Google account
- You'll need to upgrade to **Blaze plan** (pay-as-you-go) to use Cloud Functions
- Blaze has a generous free tier — you won't pay anything unless you get real traffic

### 3. Anthropic Account
- Go to [console.anthropic.com](https://console.anthropic.com)
- Sign up and add a payment method
- Your plan must support **tool use** and **web search** (needed for daily briefings and Signal Stream)
- Generate an API key — you'll need it in Part 9

---

## PART 2: INSTALL PREREQUISITES

You need these installed on your machine:

1. **Node.js 20** — download from [nodejs.org](https://nodejs.org)
2. **npm 10+** — comes with Node.js automatically
3. **Firebase CLI** — open a terminal and run: `npm install -g firebase-tools`
4. **VS Code** (or any code editor) — download from [code.visualstudio.com](https://code.visualstudio.com)

---

## PART 3: CREATE THE FIREBASE PROJECT

1. Go to Firebase Console
2. Click **"Create a project"**
3. Name it whatever you want (e.g. `truenorth-dev`)
4. Enable these services inside the console:

| Service | Where to enable | Settings |
|---------|----------------|----------|
| **Authentication** | Build → Authentication → Sign-in method | Enable **Google** and **Email/Password** |
| **Firestore** | Build → Firestore Database | Click "Create database" → Start in test mode |
| **Storage** | Build → Storage | Click "Get started" → Start in test mode |
| **Functions** | Build → Functions | Requires Blaze plan upgrade |
| **Hosting** | Build → Hosting | Click "Get started" → Pick a site name (remember this — it's your `HOSTING_SITE`) |

5. **Get the Firebase config values:**
   - Go to Project Settings (gear icon top-left) → Your Apps → click **"Add app"** → choose **Web** (</>)
   - Register the app (name doesn't matter)
   - Firebase shows a config object with 6 values — **copy all of them**

---

## PART 4: DOWNLOAD AND UNZIP

1. Download the zip file
2. Unzip it
3. Open VS Code
4. File → Open Folder → select the `True-North` folder

---

## PART 5: OPEN THE TERMINAL IN VS CODE

- In VS Code: **Terminal → New Terminal** (or press `Ctrl+backtick`)
- This opens a terminal at the bottom of VS Code, already inside the project folder
- All commands from here on go in this terminal

---

## PART 6: INSTALL DEPENDENCIES

Run these in the VS Code terminal:

```bash
npm install

cd functions
npm install
cd ..
```

Two npm installs — one for frontend, one for backend.

---

## PART 7: FILL IN THE PLACEHOLDERS

There are **3 files** with placeholders. All values come from Part 3.

### File 1: `src/environments/environment.ts`

In the VS Code terminal, run:

```bash
cp src/environments/environment.example.ts src/environments/environment.ts
```

Then open `src/environments/environment.ts` in VS Code (click it in the file explorer on the left) and replace:

| Placeholder | Replace with |
|------------|-------------|
| `YOUR_FIREBASE_API_KEY` | `apiKey` from Firebase console |
| `YOUR_PROJECT_ID` (appears 4 times) | `projectId` from Firebase console |
| `YOUR_MESSAGING_SENDER_ID` | `messagingSenderId` from Firebase console |
| `YOUR_APP_ID` | `appId` from Firebase console |

Save the file (`Ctrl+S`).

### File 2: `.firebaserc`

Open `.firebaserc` in VS Code. Replace `YOUR_PROJECT_ID` with your Firebase project ID. Save.

### File 3: `firebase.json`

Open `firebase.json` in VS Code. Replace `YOUR_HOSTING_SITE` with the hosting site name you picked in Part 3. Save.

---

## PART 8: CONNECT FIREBASE CLI

In the VS Code terminal:

```bash
firebase login
```

This opens a browser — sign in with the same Google account that owns the Firebase project.

Then:

```bash
firebase use your-project-id
```

---

## PART 9: SET THE ANTHROPIC API KEY

In the VS Code terminal:

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
```

It prompts you to paste your Anthropic API key (from Part 1, Step 3). This is stored securely in Google Secret Manager — it never goes in the code.

---

## PART 10: DEPLOY

In the VS Code terminal, run these one at a time:

```bash
firebase deploy --only firestore:rules
firebase deploy --only storage
firebase deploy --only functions
npm run build
firebase deploy --only hosting
```

- Rules deploy instantly
- Functions first deploy takes 3-5 minutes (provisioning infrastructure)
- Frontend build takes ~30 seconds, hosting deploy takes ~10 seconds

---

## PART 11: CONFIGURE AUTH DOMAINS

Back in Firebase Console → Authentication → Settings → **Authorized domains**:
- Add your hosting domain (e.g. `your-site.web.app`)
- `localhost` should already be there (for local dev)

---

## PART 12: RUN LOCALLY (Development)

In the VS Code terminal:

```bash
npm start
```

Opens at `http://localhost:4200`. The local dev server talks to your production Firebase project.

---

## PART 13: PUSH TO YOUR OWN GITHUB (Optional)

Since the zip has no git history, in the VS Code terminal:

```bash
git init
git add -A
git commit -m "Initial commit"
```

Then create a new repo on GitHub (public or private), and:

```bash
git remote add origin https://github.com/your-username/your-repo.git
git branch -M main
git push -u origin main
```

---

## QUICK REFERENCE — All Placeholders

| Placeholder | Where | What to put |
|------------|-------|------------|
| `YOUR_FIREBASE_API_KEY` | `environment.ts` | Firebase Console → Project Settings → Web App |
| `YOUR_PROJECT_ID` | `environment.ts`, `.firebaserc` | Firebase Console → Project Settings → Web App |
| `YOUR_MESSAGING_SENDER_ID` | `environment.ts` | Firebase Console → Project Settings → Web App |
| `YOUR_APP_ID` | `environment.ts` | Firebase Console → Project Settings → Web App |
| `YOUR_HOSTING_SITE` | `firebase.json` | Firebase Console → Hosting (you pick it) |
| `ANTHROPIC_API_KEY` | Firebase Secrets (not in code) | console.anthropic.com → API Keys |

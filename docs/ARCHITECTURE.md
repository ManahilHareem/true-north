# True North — Architecture Guide

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (Angular 20)                  │
│                                                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │  Pages   │  │ Services │  │  Guards  │               │
│  │ (9 pages)│→ │ (5 svcs) │→ │(auth/    │               │
│  │          │  │          │  │ founder) │               │
│  └──────────┘  └──────────┘  └──────────┘               │
│       │              │                                    │
│       │         ApiService ──→ httpsCallable()            │
│       │         UserDataService ──→ Firestore SDK         │
│       │         AuthService ──→ Firebase Auth              │
│       │         ScoringService ──→ local math              │
│       │         ThemeService ──→ CSS custom properties     │
└───────┼──────────────┼───────────────────────────────────┘
        │              │
   ┌────▼──────────────▼────────────────────────────────┐
   │              FIREBASE PLATFORM                      │
   │                                                      │
   │  ┌──────────────────────────────────────────────┐   │
   │  │     Cloud Functions v2 (functions/index.js)   │   │
   │  │                                                │   │
   │  │  14 callable functions + shared helpers        │   │
   │  │  ┌────────────┐  ┌─────────────────────────┐  │   │
   │  │  │ callClaude │  │  Memory Pipeline         │  │   │
   │  │  │ callClaudeJ│  │  getMemory()             │  │   │
   │  │  │            │→ │  mergeMemory()            │  │   │
   │  │  │ (LLM SWAP  │  │  extractChatInsights()   │  │   │
   │  │  │  POINT)    │  │  extractChoiceInsights()  │  │   │
   │  │  └──────┬─────┘  └─────────────────────────┘  │   │
   │  │         │                                       │   │
   │  └─────────┼───────────────────────────────────────┘   │
   │            │                                            │
   │  ┌────────▼──────┐  ┌───────────┐  ┌────────────┐    │
   │  │  Anthropic    │  │ Firestore │  │  Storage   │    │
   │  │  Claude API   │  │           │  │            │    │
   │  │  (Sonnet/     │  │ users/    │  │ users/     │    │
   │  │   Haiku)      │  │  {uid}/   │  │  {uid}/    │    │
   │  └───────────────┘  │   ...     │  │  uploads/  │    │
   │                      └───────────┘  └────────────┘    │
   └────────────────────────────────────────────────────────┘
```

## Frontend Architecture

### Component Model
- **Standalone components** (Angular 20, no NgModule)
- **Inline templates** — each component has its template and styles in the same .ts file
- **Lazy-loaded routes** — all pages use `loadComponent()` with dynamic imports
- **No state management library** — state lives in component properties, fetched from Firestore on init

### Service Layer
| Service | Purpose | Talks To |
|---------|---------|----------|
| `ApiService` | Wraps all Cloud Function calls | Cloud Functions (httpsCallable) |
| `UserDataService` | All Firestore CRUD operations | Firestore SDK |
| `AuthService` | Login/signup/logout + post-login routing | Firebase Auth + Firestore |
| `ScoringService` | Score math (decay, input, consequences, coherence) | Pure computation (no I/O) |
| `ThemeService` | Archetype color → CSS custom properties | DOM (document.documentElement) |

### Critical Pattern: runInInjectionContext
Angular Fire's SDK requires an injection context for its internal DI. Async callbacks (setTimeout, .then, etc.) lose this context. Both `ApiService.call()` and `UserDataService.firestoreCall()` wrap operations in `runInInjectionContext()` to solve this.

**If you add a new Firestore or Functions call, always use the existing wrappers.**

## Backend Architecture

### Single File Design
The entire backend is `functions/index.js`. This is intentional:
- Easy to search and understand the complete API surface
- No import resolution issues
- Simple deployment
- All shared helpers (memory, LLM) are co-located

### Model Strategy
| Model | Use Cases | Why |
|-------|----------|-----|
| Sonnet (claude-sonnet-4-5) | Chat, profiles, reframes, game tiles, visions, articles, transcripts, briefings | Complex reasoning, personalization |
| Haiku (claude-haiku-4-5) | Memory compaction, insight extraction, file summaries, live gauges, futures memory | Speed + cost (real-time operations) |

### LLM Swap Point
To change LLM providers, modify ONLY `callClaude()` and `callClaudeJSON()` in functions/index.js. Everything else calls through these two functions.

### Memory Pipeline

```
Every Interaction:

  [User Request]
       │
       ▼
  Load memory ──→ Inject into system prompt
       │
       ▼
  Call Claude (Sonnet)
       │
       ▼
  Return response to user ──→ [User sees response immediately]
       │
       ▼ (fire-and-forget, async)
  Extract insights (Haiku) ──→ Merge into memory (Haiku)
                                    │
                                    ▼
                              Save to Firestore
                              users/{uid}/memory/core
```

Memory caps: 10 core insights, 8 active patterns, 5 avoidances, 5 strengths.

## Data Flow Examples

### Game of Life: Full Day Flow
```
1. User opens Game page
2. Frontend loads: profile, scores, today's game day, coherence, calibration
3. User taps "I'M READY TO PLAY"
4. Frontend calls onNewDay → generates tile + choices
5. User selects a choice
6. Frontend calls onChoosePath → applies score delta, generates actions
7. Frontend optimistically updates scores in UI
8. User completes actions (onCompleteAction per action)
9. Frontend updates scores per completed action
```

### Chat: Full Message Flow
```
1. User types message
2. Frontend saves user message to Firestore
3. Frontend calls onChatMessage (with userId, agentId, message, threadId)
4. Backend loads: profile, onboarding, memory, last 20 messages
5. Backend builds system prompt with agent persona + user context + memory
6. Backend calls Claude (Sonnet)
7. Backend returns response
8. Frontend saves assistant message to Firestore
9. Backend (fire-and-forget): extracts insights → merges memory
```

## Deployment

```bash
# Frontend
ng build
firebase deploy --only hosting

# Backend
cd functions && npm install
firebase deploy --only functions

# Everything
firebase deploy

# Set API key (one-time)
firebase functions:secrets:set ANTHROPIC_API_KEY
```

The hosting site is configured in firebase.json (`hosting.site` field), serving from `dist/truenorth/browser` with SPA rewrites.

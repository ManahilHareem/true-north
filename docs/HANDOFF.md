# True North — Developer Handoff Guide

## What Is This?
True North is an AI-powered personal growth platform. Think: a daily intelligence companion that knows you deeply and evolves with you. It combines personality profiling, AI advisors, communication coaching, a daily growth game, personalized news, and persistent memory.

## Tech Stack
| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Angular 20 | Standalone components, inline templates, no NgModule |
| Backend | Firebase Cloud Functions (v2) | Single file: `functions/index.js` |
| Database | Firestore | All user data under `users/{uid}/` |
| Auth | Firebase Auth | Google sign-in + email/password |
| Storage | Firebase Storage | User file uploads |
| LLM | Anthropic Claude API | Sonnet (complex) + Haiku (fast) via `@anthropic-ai/sdk` |
| Hosting | Firebase Hosting | SPA with rewrite rules |
| Styling | Custom SCSS | Dark theme, CSS custom properties for accent colors |

## How Everything Connects

```
User → Angular App → Firebase Auth (login)
                   → Firestore (read/write data)
                   → Cloud Functions (all AI features)
                        → Anthropic Claude API (LLM calls)
                        → Firestore (persist results + memory)
```

Every AI feature follows the same pattern:
1. Frontend calls `ApiService.methodName()` which wraps `httpsCallable()`
2. Cloud Function receives the call, loads user data + memory from Firestore
3. Builds a prompt with user context + memory injected
4. Calls Claude via `callClaude()` or `callClaudeJSON()`
5. Saves results to Firestore
6. Returns response to frontend
7. **Fire-and-forget**: extracts insights from the interaction and merges into memory

## Features Overview

### 1. Onboarding (6 steps → profile generation)
Six-step wizard: Identity (step 0) → Personality & Values (step 1) → Life Priorities (step 2) → Preferences (step 3) → Optional File Uploads (step 4) → Profile Generation (step 5, animated loading while Sonnet generates the archetype). Backend generates a personalized archetype profile with Wheel of Life scores.

### 2. Dashboard
Central hub showing archetype card, Wheel of Life (8 animated arcs), daily briefing, game tile summary, and navigation to all features.

### 3. AI Advisors (5 agents)
- **Financial Steward** — wealth allocation, investment ideas, tax awareness
- **Food & Medicine** — nutrition, supplements, health protocols (uses genome data if available)
- **Media Intelligence** — conscious content curation, attention protection
- **Relationship Harmonizer** — conflict resolution, emotional framing, shadow work
- **Moonshot / Destiny** — career trajectory, bold moves, skill stacking

Each agent has a unique system prompt personalized with user profile + persistent memory. Chat supports multi-threaded conversations.

### 4. Communication Intelligence
- **Live Mode** — Real-time speech analysis via Web Speech API + Haiku (polled every 8s). Shows gauges for pace, clarity, empathy, emotional intensity.
- **Reflect** — Journal entry → language pattern analysis → reframes + vocabulary upgrades
- **Lexicon** — Personal vocabulary upgrade library
- **Insights** — Historical journal entries

### 5. Game of Life
Daily growth game with 6 tile types (mirror, risk, shadow, vitality, relationship, unknown). Each tile presents a personalized challenge with fixed choice frameworks. Choices affect Wheel of Life scores.

State machine: no_game → pending_choice → in_progress → completed

### 6. Positive Futures (Inspiration)
5 personalized future visions (food, money, medicine, media, relationships).

### 7. Signal Stream (Articles)
5 daily articles from web search, personalized to user interests.

### 8. Intelligence Agent (Founders Only)
Transcript upload → structured data extraction → thread tracking → natural language queries.

### 9. Daily Briefing
Personalized morning brief with financial insight, health suggestion, relationship reflection, growth reminder, and real news headlines via web search.

## The Memory System
The "bidirectional memory pipeline" is the most important architectural concept:

1. **INBOUND**: Before every LLM call, persistent memory is loaded and injected into the system prompt
2. **OUTBOUND**: After every interaction, a fire-and-forget Haiku call extracts new insights
3. **COMPACTION**: `mergeMemory()` deduplicates, enforces caps (10 insights, 8 patterns, 5 avoidances, 5 strengths)

Memory lives at `users/{uid}/memory/core`.

## Critical Things to Know

### Score Deltas Must Match
The consequence deltas in `functions/index.js` (onChoosePath) and `src/app/services/scoring.service.ts` MUST stay in sync:
- avoid = -3, explore = +2, act = +4, transmute = +5

### NgZone / Injection Context
All Firebase SDK calls in Angular must be wrapped in `runInInjectionContext()`. This is already done via `firestoreCall()` in UserDataService and the `call()` wrapper in ApiService. Don't bypass these wrappers.

### Hardcoded Choice Frameworks
The `TILE_CHOICE_FRAMEWORKS` in functions/index.js define fixed choices per tile type. The LLM personalizes descriptions but CANNOT change consequence types. This prevents hallucination from breaking game mechanics.

### No Tests
There are currently no automated tests. The project uses Angular's test setup but no test files have been written.

### Firestore Rules Are Wide Open
The current rules allow all reads/writes with a time-based expiration. This MUST be replaced with proper per-user rules before any real launch. See `docs/FIRESTORE_RULES.md`.

# True North — Master Documentation Index

## What This Product Is

True North is an AI-powered personal evolution platform. It's not a chatbot. It's not a dashboard. It's an **LLM information highway** — a system where every interaction the user has with the platform makes the next interaction smarter, more personal, and more precise.

The core idea: every time a user chats with an advisor, journals a thought, makes a game choice, or even just opens their daily briefing — the system is quietly doing two things:

1. **Pulling in** everything it knows about this person (their profile, their patterns, their avoidance behaviors, their stated goals vs actual choices) and injecting that context into the prompt
2. **Pushing out** new observations extracted from the interaction (what did this conversation reveal? what pattern just repeated? what are they avoiding?) and folding those back into a persistent memory layer

The result is a compounding intelligence loop. The 50th interaction isn't just 50x more data — it's qualitatively different. The system knows the user's shadow patterns, tracks contradictions between what they say they want and what they actually choose, remembers which topics trigger avoidance, and adjusts its approach accordingly.

## How the LLM Information Highway Works

```
                    ┌─────────────────────────────────────────┐
                    │         USER'S GROWING PROFILE           │
                    │                                           │
                    │  Onboarding data (static)                │
                    │  + Generated archetype (static)           │
                    │  + Dimension scores (dynamic, decaying)   │
                    │  + Persistent memory (growing):           │
                    │      - Core insights (max 10)             │
                    │      - Active patterns (max 8)            │
                    │      - Avoidances (max 5)                 │
                    │      - Strengths (max 5)                  │
                    │      - Agent-specific insights            │
                    │      - Current growth edge                │
                    │  + Game choice history                    │
                    │  + Chat thread history                    │
                    │  + Journal/reframe history                │
                    └──────────────┬────────────────────────────┘
                                   │
                    ┌──────────────▼────────────────────────────┐
                    │         EVERY LLM CALL                    │
                    │                                           │
                    │  1. Load user profile + memory            │
                    │  2. Build prompt with full personal       │
                    │     context injected                      │
                    │  3. Call Claude (Sonnet or Haiku)          │
                    │  4. Return response to user               │
                    │  5. ASYNC: Extract new insights           │
                    │     from the interaction (Haiku)           │
                    │  6. ASYNC: Merge new insights into        │
                    │     persistent memory (Haiku compaction)   │
                    │                                           │
                    │  The user never waits for steps 5-6.      │
                    │  They happen fire-and-forget.             │
                    └───────────────────────────────────────────┘
```

### What Makes Each Hit Smarter

Every feature feeds the same memory layer, and every feature reads from it:

| Feature | What It Sends to Memory | What It Gets From Memory |
|---------|------------------------|-------------------------|
| **Chat (5 advisors)** | "User is worried about X", "Avoids discussing Y" | Personalized advice referencing past conversations and patterns |
| **Journal/Reframes** | Language patterns, emotional states, shadow frequencies | Reframes calibrated to their specific growth edge |
| **Game of Life** | Choice patterns (courage vs avoidance), tile history | Tiles that target their weakest dimensions and repeat avoided topics |
| **Daily Briefing** | (reads only) | Financial/health/relationship guidance based on evolving patterns |
| **Future Visions** | Aspirational themes, what resonates | Visions grounded in their actual trajectory, not generic inspiration |
| **Signal Stream** | (reads only) | News filtered through their interests + exclusions |
| **Intelligence** | Business decisions, entities, threads | Cross-transcript pattern recognition |

The memory layer has **hard caps** (10 insights, 8 patterns, 5 avoidances, 5 strengths) enforced by a Haiku compaction step. This keeps prompts from bloating while preserving the most signal-dense observations. Old patterns get replaced by newer, more relevant ones. The system forgets what doesn't matter and sharpens what does.

### The Game as a Behavioral Data Engine

The Game of Life isn't decoration — it's the richest data source in the system. Every day the user faces a tile (mirror, risk, shadow, vitality, relationship, unknown) with fixed choice frameworks:

- **Avoid** (safety, -3 points) — the system logs this as avoidance
- **Explore** (curiosity, +2 points) — the system logs awareness
- **Act** (courage, +4 points) — the system logs growth
- **Transmute** (transformation, +5 points) — the system logs pattern-breaking

The LLM can see their choice history. If someone says "I want to take more risks" in onboarding but consistently chooses "Stay safe" on risk tiles — the system notices that contradiction and will serve a **mirror tile** that surfaces the gap between stated desires and actual behavior. Avoidance always comes back as a shadow or mirror tile. You can't hide from the system; it just gets more specific about where you're stuck.

## The Architecture in Plain English

**One backend file.** All 18 Cloud Functions live in `functions/index.js`. Every AI feature is a callable function that loads user data, builds a prompt, calls Claude, saves the result, and fires off a memory update. To swap LLM providers, you change two functions (`callClaude` and `callClaudeJSON`) and nothing else.

**One data tree.** All user data lives under `users/{uid}/` in Firestore. There is no shared/global data. Each user is a self-contained universe of subcollections: chat threads, game days, journal entries, memory, scores, briefings, visions, editions, transcripts.

**One frontend pattern.** Every page component follows the same lifecycle: subscribe to auth → load user profile → apply theme → fetch page-specific data → render. All Firebase calls go through service wrappers that handle Angular's injection context issues.

**Two LLM models.** Sonnet for anything that requires deep reasoning (chat, profiles, game tiles, reframes). Haiku for anything that needs to be fast or cheap (memory compaction, insight extraction, live speech gauges, file summaries). The model choice is deliberate per-function, not arbitrary.

## Documentation Guide

| Document | What It's For | When to Read It |
|----------|--------------|-----------------|
| **[CLAUDE.md](../CLAUDE.md)** | Quick-reference rules for Claude Code / AI assistants | Before any AI-assisted coding session |
| **[HANDOFF.md](HANDOFF.md)** | Complete developer onboarding | First day on the project — read this end to end |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | System diagrams, service layer, data flow examples | When you need to understand how pieces connect |
| **[DATA_MODEL.md](DATA_MODEL.md)** | Full Firestore document tree with types | When adding new data or debugging data issues |
| **[LOCAL_SETUP.md](LOCAL_SETUP.md)** | Prerequisites, installation, running locally | Setting up your dev environment |
| **[FIREBASE_MIGRATION.md](FIREBASE_MIGRATION.md)** | Moving to a new Firebase project | When deploying to a different GCP account |
| **[FIRESTORE_RULES.md](FIRESTORE_RULES.md)** | Production security rules (current ones are wide open) | Before any real user launch |
| **[GITHUB_GUIDE.md](GITHUB_GUIDE.md)** | Branch strategy, deployment workflow | Day-to-day git operations |

## How the Pieces Fit Together

```
USER JOURNEY:

  Sign Up → Onboarding (6 steps) → Profile Generated → Dashboard
                                         │
                    ┌────────────────────┼────────────────────────┐
                    │                    │                         │
              Daily Loop           On-Demand               Founders Only
                    │                    │                         │
         ┌─────────┼─────────┐    ┌─────┼──────┐           ┌─────┼──────┐
         │         │         │    │     │      │           │            │
     Briefing   Game of   Signal  Chat  Comms  Futures   Intelligence
     (morning)   Life    Stream   (5    Intel   (visions)  (transcripts)
                 (tile)  (news)  agents) (speech)
         │         │         │    │     │      │           │
         └─────────┼─────────┘    └─────┼──────┘           │
                    │                    │                   │
                    └────────────────────┼───────────────────┘
                                         │
                                         ▼
                              PERSISTENT MEMORY
                            (enriched after every
                             interaction, compacted
                             by Haiku, capped at
                             10+8+5+5 entries)
                                         │
                                         ▼
                              NEXT INTERACTION
                              IS SMARTER
```

## What's Not Built Yet

- **Automated tests** — No test files exist. Angular's test infrastructure is set up but unused.
- **CI/CD pipeline** — Deployment is manual via Firebase CLI.
- **Proper Firestore rules** — Currently wide open with a time-based expiration. Production rules are documented in `FIRESTORE_RULES.md` but not deployed.
- **Feedback loop for Signal Stream** — Users can up/down vote articles, but votes aren't used to improve future editions yet.
- **Scheduled briefings** — Daily briefing is manual (tap to generate). Could be a scheduled Cloud Function.
- **Advanced tile types** — The `AdvancedTileType` interface defines 7 additional tile types (co-creation, wealth-energy, service-mission, etc.) that aren't implemented yet.
- **Multi-user features** — The data model is entirely per-user. No shared spaces, teams, or social features.

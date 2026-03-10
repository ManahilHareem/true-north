# True North — Claude Code Instructions

## Project Overview
True North is an AI-powered personal growth platform built with Angular 20 + Firebase + Anthropic Claude.
- **Frontend**: Angular 20 standalone components (no NgModule), inline templates, SCSS
- **Backend**: Single `functions/index.js` file with 18 Cloud Functions (Firebase callable)
- **Database**: Firestore (all data under `users/{uid}/`)
- **Auth**: Firebase Auth (Google + email/password)
- **LLM**: Anthropic Claude via `@anthropic-ai/sdk` (Sonnet for complex, Haiku for fast)

## Key Architecture Rules
- ALL Firebase/Firestore calls must be wrapped in `runInInjectionContext()` to avoid NgZone errors
- ALL LLM calls go through `callClaude()` or `callClaudeJSON()` in functions/index.js — to swap providers, change only those two functions
- Game tile choice frameworks are HARDCODED in `TILE_CHOICE_FRAMEWORKS` — the LLM only personalizes descriptions, never consequence types or score deltas
- Score deltas: avoid=-3, explore=+2, act=+4, transmute=+5 (must match in both functions/index.js AND scoring.service.ts)
- Memory pipeline is bidirectional: loaded INTO every prompt, extracted OUT after every interaction (fire-and-forget)

## File Structure
```
functions/index.js          — THE ENTIRE BACKEND (all 18 Cloud Functions + helpers)
src/app/services/           — 5 Angular services (api, auth, scoring, theme, user-data)
src/app/models/interfaces.ts — ALL TypeScript interfaces
src/app/prompts/templates.ts — Prompt templates + agent metadata (reference only; backend has its own copies)
src/app/pages/              — 9 page components (login, onboarding, dashboard, chat, communication, inspiration, intelligence, articles, game-of-life)
src/app/guards/auth.guard.ts — authGuard + founderGuard
src/environments/environment.ts — Firebase config
docs/                       — Developer documentation (handoff, architecture, data model, setup, etc.)
```

## Commands
- `npm start` — Dev server (localhost:4200)
- `npm run build` — Production build (output: dist/truenorth/browser)
- `cd functions && npm install` — Install backend dependencies
- `firebase deploy --only functions` — Deploy Cloud Functions
- `firebase deploy --only hosting` — Deploy frontend
- `firebase deploy` — Deploy everything

## Secrets
- `ANTHROPIC_API_KEY` — Set via: `firebase functions:secrets:set ANTHROPIC_API_KEY`

## Roles
- `member` — Standard user (all features except Intelligence page)
- `founder` — Access to Intelligence page (founderGuard)
- `admin` — Same as founder

## Common Patterns
- Services use `inject()` not constructor injection
- All components are standalone with inline templates
- Theme colors are set via CSS custom properties (--accent-primary, etc.)
- NgZone.run() is used after async operations to trigger change detection

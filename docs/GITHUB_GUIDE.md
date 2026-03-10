# True North — GitHub & Git Guide

## Branch Strategy

- `main` — production branch, always deployable
- Feature branches: `feature/description` or `claude/description-sessionId`
- Bug fixes: `fix/description`

## Development Workflow

```bash
# Start a new feature
git checkout main
git pull origin main
git checkout -b feature/my-feature

# Make changes, commit
git add -A
git commit -m "Add feature description"

# Push and create PR
git push -u origin feature/my-feature
# Then create PR on GitHub
```

## Deploying

Deployment is manual via Firebase CLI (no CI/CD pipeline yet):

```bash
# Build frontend
npm run build

# Deploy everything
firebase deploy

# Or deploy selectively
firebase deploy --only hosting    # frontend only
firebase deploy --only functions  # backend only
firebase deploy --only firestore:rules  # rules only
```

## What to Commit

### Always commit:
- All source code (`src/`, `functions/`)
- Config files (`angular.json`, `firebase.json`, `package.json`, `tsconfig*.json`)
- Rules files (`firestore.rules`, `storage.rules`)
- Documentation (`docs/`, `CLAUDE.md`)

### Never commit:
- `node_modules/` (in .gitignore)
- `dist/` (build output)
- `.firebase/` (Firebase cache)
- `.env` files (no .env files exist in this project)
- `functions/node_modules/` (in .gitignore)

### Safe to commit:
- `src/environments/environment.ts` — Contains Firebase client config (API keys that are public by design, they identify the project but can't access data without auth)

## Key Files to Review in PRs

When reviewing PRs, pay special attention to:

1. **`functions/index.js`** — The entire backend. Any change here affects all AI features.
2. **`src/app/services/scoring.service.ts`** — Score math must stay in sync with backend.
3. **`src/app/models/interfaces.ts`** — Interface changes can break frontend/backend contract.
4. **`firestore.rules`** — Security-critical.
5. **`src/environments/environment.ts`** — Should never contain secrets.

## Useful Commands

```bash
# Check what's changed
git status
git diff

# See recent commits
git log --oneline -10

# Undo uncommitted changes to a file
git checkout -- path/to/file

# Stash work in progress
git stash
git stash pop
```

## No CI/CD Yet

There is no automated CI/CD pipeline. Tests, builds, and deployments are all manual. A future enhancement would be:
- GitHub Actions for CI (lint, build, test on PR)
- Auto-deploy to Firebase Hosting on merge to main
- Deploy preview channels for PRs

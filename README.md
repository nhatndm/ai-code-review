# AI Code Review — Bitbucket PR Webhook

Automatically reviews pull requests when they are opened in Bitbucket, using Claude AI and skill guidelines from the `product-blueprint` repository.

## How it works

1. Bitbucket sends a `pullrequest:created` webhook to this server.
2. The server looks up the correct access token for that repository.
3. It fetches the PR diff via the Bitbucket API.
4. It loads the relevant skill files from `product-blueprint/04-skills` on the `master` branch:
   - **Frontend repos** (`health-crm`, `consumer-web`, `voms-micro-fe`, `profile-micro-fe`): uses `fe-*` skill files
   - **Backend repos** (everything else): uses `be-*` skill files
5. Claude reviews the diff against those skills and posts the feedback as a PR comment.

## Setup

```bash
cp .env.example .env
# Edit .env and fill in all tokens
npm install
npm run build
npm start
```

## Environment variables

| Variable | Description |
|---|---|
| `PORT` | HTTP port (default `3000`) |
| `ANTHROPIC_API_KEY` | Your Claude API key |
| `PRODUCT_BLUEPRINT_TOKEN` | Bitbucket token for the product-blueprint repo |
| `BITBUCKET_WORKSPACE` | Bitbucket workspace slug (default `ntuclink`) |
| `BITBUCKET_TOKEN_<REPO>` | Per-repo token, e.g. `BITBUCKET_TOKEN_HEALTH_CRM` |
| `SKILLS_REPO_PATH` | Local path to cache the cloned skills repo (default `./skills-repo`) |

## Adding a new repository

1. Create a Bitbucket access token for the repo.
2. Add `BITBUCKET_TOKEN_<REPO_SLUG_UPPER_SNAKE>=<token>` to `.env`.
3. Configure the Bitbucket webhook for that repo to point to `POST https://<your-host>/webhook/bitbucket` with event `Pull request → Created`.

No code changes needed.

## Webhook endpoint

```
POST /webhook/bitbucket
GET  /health
```

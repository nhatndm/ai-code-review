# AI Code Review — Bitbucket PR Webhook

Automatically reviews pull requests when they are opened in Bitbucket, using Claude or Gemini (via Google Vertex AI) and skill guidelines from the `product-blueprint` repository.

## How it works

1. Bitbucket sends a `pullrequest:created` webhook to this server.
2. The server authenticates to the Bitbucket API using a single Atlassian API token (HTTP Basic auth) — the same token is used for every repository the account can access.
3. It fetches the PR diff via the Bitbucket API.
4. It loads the relevant skill files from `product-blueprint/04-skills` on the `master` branch:
   - **Frontend repos** (`health-crm`, `consumer-web`, `voms-micro-fe`, `profile-micro-fe`): uses `fe-*` skill files
   - **Backend repos** (everything else): uses `be-*` skill files
5. Claude or Gemini (selected via `AI_PROVIDER`, both called through Vertex AI) reviews the diff against those skills and posts the feedback as a PR comment.
6. All sensitive credentials are read from AWS Secrets Manager at startup, not from plain environment variables.

## Local development setup

```bash
cp .env.example .env
# Edit .env: set ATLASSIAN_EMAIL / ATLASSIAN_API_TOKEN, GCP_PROJECT_ID, etc.
# Leave AWS_SECRET_ID unset for local dev — secrets are read straight from .env.
gcloud auth application-default login   # Vertex AI credentials for your user account
npm install
npm run build
npm start
```

For iterative development: `npm run dev` (ts-node-dev, auto-restarts on change).

## Authentication

### Bitbucket — one Atlassian API token

There is no more per-repository token. Create a single [Atlassian API token](https://id.atlassian.com/manage-profile/security/api-tokens) for an account that has access to every repo you want reviewed (plus the `product-blueprint` repo), and configure:

- `ATLASSIAN_EMAIL` — the Atlassian account email the token belongs to
- `ATLASSIAN_API_TOKEN` — the token itself

The server sends `Authorization: Basic base64(email:token)` on every Bitbucket API call, and uses the same credentials to clone `product-blueprint` over HTTPS.

### AI providers — Google Vertex AI

Both Claude and Gemini are called through Vertex AI, not the direct Anthropic/Google AI Studio APIs — no `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` is used.

- `AI_PROVIDER` — `gemini` or `anthropic`
- `GCP_PROJECT_ID` — the GCP project with the Vertex AI API enabled
- `GCP_LOCATION` — Vertex AI region (default `us-central1`)

The calling service account needs:
- The Vertex AI API enabled on the project
- The `roles/aiplatform.user` IAM role (or narrower, model-specific permissions)
- For Claude: the Claude models enabled in [Vertex AI Model Garden](https://console.cloud.google.com/vertex-ai/publishers/anthropic) for that project

Authentication:
- Locally: standard Google Application Default Credentials via `gcloud auth application-default login`.
- In production: a service account key delivered via AWS Secrets Manager (see below), passed directly in memory to the Vertex AI clients — this is the only supported production credential source; there is no ADC/Workload Identity fallback, and the key is never written to disk.

## Secrets management (AWS Secrets Manager)

In production, set `AWS_SECRET_ID` (name or ARN) and `AWS_REGION`. At startup the server fetches that secret and overrides the sensitive config values — nothing sensitive needs to live in plain env vars or `.env` files on the host. The task role / instance role running the container needs `secretsmanager:GetSecretValue` on that secret.

The secret must be a JSON object:

```json
{
  "webhookSecret": "your_bitbucket_webhook_secret",
  "atlassianEmail": "you@example.com",
  "atlassianApiToken": "your_atlassian_api_token",
  "gcpServiceAccountJson": "{\"type\":\"service_account\", ... }"
}
```

- `gcpServiceAccountJson` is **required** — it's the only source of Vertex AI credentials in production, and `loadSecrets()` throws at startup if it's missing from the secret. The parsed credentials are held in memory and passed directly to the Vertex AI clients (`googleAuth` / `googleAuthOptions`) — there's no `GOOGLE_APPLICATION_CREDENTIALS` file to manage, and the key is never written to disk.
- Non-sensitive configuration (`PORT`, `AI_PROVIDER`, `GCP_PROJECT_ID`, `GCP_LOCATION`, `BITBUCKET_WORKSPACE`, `SKILLS_REPO_PATH`) stays as plain environment variables — see `.env.example`.

If `AWS_SECRET_ID` is unset, the server falls back to reading `WEBHOOK_SECRET`, `ATLASSIAN_EMAIL`, and `ATLASSIAN_API_TOKEN` straight from the environment — this is the local-development path only.

## Environment variables

| Variable | Description |
|---|---|
| `PORT` | HTTP port (default `3000`) |
| `AWS_SECRET_ID` | Name/ARN of the AWS Secrets Manager secret holding sensitive values (production) |
| `AWS_REGION` | AWS region for the Secrets Manager client |
| `WEBHOOK_SECRET` | Bitbucket webhook HMAC secret (local-dev fallback; production value comes from the AWS secret) |
| `ATLASSIAN_EMAIL` | Atlassian account email for the API token (local-dev fallback) |
| `ATLASSIAN_API_TOKEN` | Atlassian API token, used for all repos (local-dev fallback) |
| `AI_PROVIDER` | `gemini` or `anthropic` |
| `GCP_PROJECT_ID` | GCP project with Vertex AI enabled |
| `GCP_LOCATION` | Vertex AI region (default `us-central1`) |
| `BITBUCKET_WORKSPACE` | Bitbucket workspace slug (default `ntuclink`) |
| `SKILLS_REPO_PATH` | Local path to cache the cloned skills repo (default `./skills-repo`) |

## Adding a new repository

Nothing to configure — the Atlassian API token already covers every repo the account has access to. Just configure the Bitbucket webhook for the new repo to point to `POST https://<your-host>/webhook/bitbucket` with event `Pull request → Created`. If the repo is a frontend repo, add its slug to `FRONTEND_REPOS` in [src/config.ts](src/config.ts) so it picks up `fe-*` skills instead of `be-*`.

## Webhook endpoint

```
POST /webhook/bitbucket
GET  /health
```

## Deployment (Docker)

Build and run the container:

```bash
docker build -t ai-code-review .
docker run -p 3000:3000 \
  -e AWS_SECRET_ID=ai-code-review/prod \
  -e AWS_REGION=ap-southeast-1 \
  -e AI_PROVIDER=gemini \
  -e GCP_PROJECT_ID=your-gcp-project-id \
  -e GCP_LOCATION=us-central1 \
  -e BITBUCKET_WORKSPACE=ntuclink \
  ai-code-review
```

The container needs outbound network access to `api.bitbucket.org`, `bitbucket.org` (git clone), the AWS Secrets Manager endpoint, and the Vertex AI endpoint for `GCP_LOCATION`.

### Running on AWS (ECS/Fargate or similar)

1. Push the image to ECR.
2. Create the secret in AWS Secrets Manager (see JSON shape above) and grant the task's IAM role `secretsmanager:GetSecretValue` on it.
3. Set the non-sensitive environment variables (`AI_PROVIDER`, `GCP_PROJECT_ID`, `GCP_LOCATION`, `BITBUCKET_WORKSPACE`, `AWS_SECRET_ID`, `AWS_REGION`) on the task definition.
4. Expose port 3000 behind a load balancer / API Gateway and point the Bitbucket webhook at it.
5. Make sure the `gcpServiceAccountJson` secret value belongs to a service account with Vertex AI access to `GCP_PROJECT_ID` — this is how the AWS-hosted container authenticates to Google Cloud.

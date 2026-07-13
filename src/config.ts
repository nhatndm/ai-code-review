import dotenv from 'dotenv';
dotenv.config();

export const FRONTEND_REPOS = new Set([
  'health-crm',
  'consumer-web',
  'voms-micro-fe',
  'profile-micro-fe',
]);

export const BACKEND_REPOS = new Set([
  'profile-service',
]);

export type RepoType = 'frontend' | 'backend';

export function getRepoType(repoSlug: string): RepoType {
  return FRONTEND_REPOS.has(repoSlug) ? 'frontend' : 'backend';
}

export type AiProvider = 'gemini' | 'anthropic';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),

  // Sensitive values below are placeholders — loadSecrets() (src/secrets.ts)
  // overwrites them from AWS Secrets Manager at startup. The env vars remain
  // as a local-development fallback when AWS_SECRET_ID isn't set.
  webhookSecret: process.env.WEBHOOK_SECRET || '',

  // Single Atlassian API token (https://id.atlassian.com/manage-profile/security/api-tokens),
  // used with HTTP Basic auth (email + token) for every Bitbucket repo this
  // account can access — both the review API calls and cloning product-blueprint.
  atlassianEmail: process.env.ATLASSIAN_EMAIL || '',
  atlassianApiToken: process.env.ATLASSIAN_API_TOKEN || '',

  aiProvider: (process.env.AI_PROVIDER || 'gemini') as AiProvider,

  // Google Cloud project/region used to reach Claude and Gemini through Vertex AI.
  gcpProjectId: process.env.GCP_PROJECT_ID || '',
  gcpLocation: process.env.GCP_LOCATION || 'us-central1',

  // Parsed GCP service account key, populated by loadSecrets() from AWS
  // Secrets Manager. Passed directly to the Vertex AI clients in-memory —
  // never written to disk, so no GOOGLE_APPLICATION_CREDENTIALS file needed.
  gcpCredentials: null as Record<string, unknown> | null,

  bitbucketWorkspace: process.env.BITBUCKET_WORKSPACE || 'ntuclink',
  skillsRepoPath: process.env.SKILLS_REPO_PATH || './skills-repo',
  productBlueprintRepoUrl: '',
};

// Build the authenticated clone URL from the Atlassian credentials so the
// token isn't hard-coded anywhere else. Re-run after loadSecrets() populates
// atlassianEmail/atlassianApiToken from AWS Secrets Manager.
export function buildProductBlueprintUrl(): string {
  const { atlassianEmail, atlassianApiToken, bitbucketWorkspace } = config;
  return `https://${encodeURIComponent(atlassianEmail)}:${encodeURIComponent(atlassianApiToken)}@bitbucket.org/${bitbucketWorkspace}/product-blueprint.git`;
}

config.productBlueprintRepoUrl = buildProductBlueprintUrl();

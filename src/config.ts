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

/**
 * Resolve an access token for the given repo slug.
 * Env var convention: BITBUCKET_TOKEN_<SLUG_UPPER_SNAKE>
 * e.g. health-crm → BITBUCKET_TOKEN_HEALTH_CRM
 */
export function getAccessToken(repoSlug: string): string {
  const envKey = `BITBUCKET_TOKEN_${repoSlug.toUpperCase().replace(/-/g, '_')}`;
  const token = process.env[envKey];
  if (!token) {
    throw new Error(
      `No access token configured for repo "${repoSlug}". ` +
        `Set the environment variable ${envKey}.`
    );
  }
  return token;
}

export type AiProvider = 'gemini' | 'anthropic';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  webhookSecret: process.env.WEBHOOK_SECRET || '',
  aiProvider: (process.env.AI_PROVIDER || 'gemini') as AiProvider,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  productBlueprintToken: process.env.PRODUCT_BLUEPRINT_TOKEN,
  bitbucketWorkspace: process.env.BITBUCKET_WORKSPACE || 'ntuclink',
  skillsRepoPath: process.env.SKILLS_REPO_PATH || './skills-repo',
  productBlueprintRepoUrl: '',
};

// Build the authenticated clone URL at runtime so the token isn't hard-coded in non-.env code
config.productBlueprintRepoUrl = `https://x-token-auth:${config.productBlueprintToken}@bitbucket.org/${config.bitbucketWorkspace}/product-blueprint.git`;

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { config, buildProductBlueprintUrl } from './config';
import { logger } from './logger';

interface SecretPayload {
  webhookSecret?: string;
  atlassianEmail?: string;
  atlassianApiToken?: string;
  // Stringified GCP service account JSON key used to authenticate to Vertex AI.
  // Always required — this is the only source of Vertex AI credentials in
  // production, so loadSecrets() throws if it's missing from the secret.
  gcpServiceAccountJson?: string;
}

/**
 * Fetches secrets from AWS Secrets Manager (secret name/ARN in AWS_SECRET_ID)
 * and overwrites the corresponding config values. If AWS_SECRET_ID isn't set,
 * the plain environment variables loaded by config.ts are used as-is —
 * this keeps local development working without an AWS account.
 */
export async function loadSecrets(): Promise<void> {
  const secretId = process.env.AWS_SECRET_ID;
  if (!secretId) {
    logger.warn('AWS_SECRET_ID not set — using plain environment variables for secrets (local/dev mode).');
    return;
  }

  const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));

  if (!response.SecretString) {
    throw new Error(`Secret "${secretId}" has no SecretString payload`);
  }

  const secrets: SecretPayload = JSON.parse(response.SecretString);

  if (secrets.webhookSecret) config.webhookSecret = secrets.webhookSecret;
  if (secrets.atlassianEmail) config.atlassianEmail = secrets.atlassianEmail;
  if (secrets.atlassianApiToken) config.atlassianApiToken = secrets.atlassianApiToken;
  config.productBlueprintRepoUrl = buildProductBlueprintUrl();

  if (!secrets.gcpServiceAccountJson) {
    throw new Error(
      `Secret "${secretId}" is missing "gcpServiceAccountJson" — Vertex AI credentials must come from AWS Secrets Manager.`
    );
  }

  // Kept in memory only and passed directly to the Vertex AI clients — never
  // written to disk, so there's no GOOGLE_APPLICATION_CREDENTIALS file to manage.
  config.gcpCredentials = JSON.parse(secrets.gcpServiceAccountJson);

  logger.info(`Secrets loaded from AWS Secrets Manager (${secretId}) ✓`);
}

import axios, { AxiosInstance } from 'axios';
import { logger } from './logger';

export interface PullRequest {
  id: number;
  title: string;
  description: string;
  source: {
    branch: { name: string };
    commit: { hash: string };
    repository: { full_name: string; slug: string };
  };
  destination: {
    branch: { name: string };
    commit: { hash: string };
    repository: { full_name: string; slug: string };
  };
  author: { display_name: string; nickname: string };
  links: { html: { href: string } };
}

export interface BitbucketWebhookPayload {
  pullrequest: PullRequest;
  repository: {
    slug?: string;   // present in newer event schemas
    full_name: string;
    name: string;    // human-readable name, may differ from slug
  };
}

export interface FileDiff {
  path: string;
  diff: string;
}

export class BitbucketClient {
  private client: AxiosInstance;
  private workspace: string;

  /**
   * Authenticates with a single Atlassian API token (email + token) via HTTP
   * Basic auth, per https://support.atlassian.com/bitbucket-cloud/docs/using-api-tokens/.
   * One token covers every repo the account has access to — no per-repo tokens.
   */
  constructor(email: string, apiToken: string, workspace: string) {
    this.workspace = workspace;
    const basicAuth = Buffer.from(`${email}:${apiToken}`).toString('base64');
    this.client = axios.create({
      baseURL: 'https://api.bitbucket.org/2.0',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async getPRDiff(repoSlug: string, prId: number): Promise<string> {
    const url = `/repositories/${this.workspace}/${repoSlug}/pullrequests/${prId}/diff`;
    logger.info(`Fetching PR diff from ${url}`);
    const response = await this.client.get<string>(url, {
      headers: { Accept: 'text/plain' },
      responseType: 'text',
    });
    return response.data;
  }

  async getPRFiles(repoSlug: string, prId: number): Promise<string[]> {
    const url = `/repositories/${this.workspace}/${repoSlug}/pullrequests/${prId}/diffstat`;
    logger.info(`Fetching PR diffstat from ${url}`);
    const response = await this.client.get<{
      values: Array<{ new?: { path: string }; old?: { path: string } }>;
    }>(url);
    return response.data.values
      .map((f) => f.new?.path || f.old?.path || '')
      .filter(Boolean);
  }

  async postComment(
    repoSlug: string,
    prId: number,
    comment: string
  ): Promise<void> {
    const url = `/repositories/${this.workspace}/${repoSlug}/pullrequests/${prId}/comments`;
    logger.info(`Posting review comment to PR #${prId}`);
    await this.client.post(url, { content: { raw: comment } });
  }

  async postInlineComment(
    repoSlug: string,
    prId: number,
    filePath: string,
    line: number,
    comment: string
  ): Promise<void> {
    const url = `/repositories/${this.workspace}/${repoSlug}/pullrequests/${prId}/comments`;
    await this.client.post(url, {
      content: { raw: comment },
      inline: { path: filePath, to: line },
    });
  }
}

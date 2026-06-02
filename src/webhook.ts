import { Request, Response } from 'express';
import { BitbucketClient, BitbucketWebhookPayload } from './bitbucket';
import { reviewPullRequest } from './reviewer';
import { getAccessToken, getRepoType, config } from './config';
import { logger } from './logger';

export async function handlePullRequestWebhook(
  req: Request,
  res: Response
): Promise<void> {
  const eventKey = req.headers['x-event-key'] as string;

  // Only process PR opened events
  if (eventKey !== 'pullrequest:created' && eventKey !== 'pullrequest:updated') {
    res.status(200).json({ message: 'Event ignored', eventKey });
    return;
  }

  const payload = req.body as BitbucketWebhookPayload;

  // Log the raw structure once so we can verify field names
  logger.debug('Webhook payload keys: ' + JSON.stringify(Object.keys(payload || {})));
  logger.debug('repository fields: ' + JSON.stringify(payload?.repository));

  if (!payload?.pullrequest || !payload?.repository) {
    res.status(400).json({ error: 'Invalid webhook payload' });
    return;
  }

  const pr = payload.pullrequest;
  // Bitbucket sends the slug in different places depending on event version;
  // prefer repository.slug → repository.name → source repository slug
  const repoSlug =
    payload.repository.slug ||
    payload.repository.name ||
    pr.source?.repository?.slug ||
    (payload.repository.full_name ? payload.repository.full_name.split('/').pop() : undefined);

  if (!repoSlug) {
    logger.error('Could not determine repo slug from payload', payload.repository);
    res.status(400).json({ error: 'Cannot determine repository slug' });
    return;
  }

  const prId = pr.id;

  logger.info(`Received ${eventKey} for ${repoSlug} PR #${prId}: "${pr.title}"`);

  // Respond immediately so Bitbucket doesn't time out
  res.status(202).json({ message: 'Review started', repo: repoSlug, pr: prId });

  // Run the review asynchronously
  setImmediate(async () => {
    try {
      const accessToken = getAccessToken(repoSlug);
      const repoType = getRepoType(repoSlug);
      const bbClient = new BitbucketClient(accessToken, config.bitbucketWorkspace);

      const diff = await bbClient.getPRDiff(repoSlug, prId);

      const { fullReview } = await reviewPullRequest(
        repoSlug,
        prId,
        pr.title,
        pr.description,
        diff,
        repoType
      );

      const providerLabel = config.aiProvider === 'gemini' ? 'Gemini' : 'Claude';
      const comment =
        `🤖 **AI Code Review** (powered by ${providerLabel})\n\n` +
        fullReview;

      await bbClient.postComment(repoSlug, prId, comment);
      logger.info(`Review posted successfully for ${repoSlug} PR #${prId}`);
    } catch (err) {
      logger.error(`Failed to review ${repoSlug} PR #${prId}:`, err);
    }
  });
}

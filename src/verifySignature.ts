import * as crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { logger } from './logger';

/**
 * Bitbucket webhook signature verification middleware.
 *
 * Bitbucket signs every webhook request with HMAC-SHA256 using the secret
 * configured on the webhook. The signature is sent in the header:
 *   X-Hub-Signature: sha256=<hex-digest>
 *
 * We recompute the HMAC over the raw request body and compare with
 * crypto.timingSafeEqual to prevent timing attacks.
 *
 * Ref: https://support.atlassian.com/bitbucket-cloud/docs/manage-webhooks/#Secure-webhooks
 */
export function verifyBitbucketSignature(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // If no secret is configured, skip verification (dev/local mode)
  if (!config.webhookSecret) {
    logger.warn('WEBHOOK_SECRET is not set — skipping signature verification!');
    next();
    return;
  }

  const signatureHeader = req.headers['x-hub-signature'] as string | undefined;

  if (!signatureHeader) {
    logger.warn('Rejected webhook: missing X-Hub-Signature header');
    res.status(401).json({ error: 'Missing X-Hub-Signature header' });
    return;
  }

  // Header format: "sha256=<hex>"
  const [method, signature] = signatureHeader.split('=');

  if (method !== 'sha256' || !signature) {
    logger.warn(`Rejected webhook: unsupported signature method "${method}"`);
    res.status(401).json({ error: `Unsupported signature method: ${method}` });
    return;
  }

  // Raw body is available because we used express.raw() for this route
  const rawBody: Buffer = (req as any).rawBody;

  if (!rawBody) {
    logger.error('Raw body not available for signature verification');
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  const expected = crypto
    .createHmac('sha256', config.webhookSecret)
    .update(rawBody)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const receivedBuf = Buffer.from(signature, 'hex');

  if (
    expectedBuf.length !== receivedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, receivedBuf)
  ) {
    logger.warn('Rejected webhook: signature mismatch');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  logger.debug('Webhook signature verified ✓');
  next();
}

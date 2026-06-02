import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { handlePullRequestWebhook } from './webhook';
import { ensureSkillsRepo } from './skills';
import { verifyBitbucketSignature } from './verifySignature';
import { logger } from './logger';

const app = express();

// Capture the raw body buffer BEFORE any body-parser runs.
// This is required for HMAC-SHA256 signature verification — Bitbucket signs
// the exact raw bytes of the payload, so we must not parse/re-serialize it.
app.use((req: Request, _res: Response, next: NextFunction) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    (req as any).rawBody = Buffer.concat(chunks);
    next();
  });
});

// Parse JSON body for all routes (uses rawBody captured above)
app.use((req: Request, res: Response, next: NextFunction) => {
  const rawBody: Buffer = (req as any).rawBody;
  if (!rawBody || rawBody.length === 0) {
    next();
    return;
  }
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('application/json')) {
    try {
      req.body = JSON.parse(rawBody.toString('utf-8'));
    } catch {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }
  }
  next();
});

// Health check (no auth required)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Bitbucket webhook — verify signature first, then handle
app.post('/webhook/bitbucket', verifyBitbucketSignature, handlePullRequestWebhook);

async function main() {
  try {
    await ensureSkillsRepo();
  } catch (err) {
    logger.warn('Could not pre-fetch skills repo at startup:', err);
    logger.warn('Skills will be fetched on first request.');
  }

  app.listen(config.port, () => {
    logger.info(`AI Code Review server listening on port ${config.port}`);
    logger.info(`Webhook endpoint: POST /webhook/bitbucket`);
    if (!config.webhookSecret) {
      logger.warn('⚠️  WEBHOOK_SECRET is not set — requests are NOT verified!');
    } else {
      logger.info('Webhook signature verification enabled (HMAC-SHA256) ✓');
    }
  });
}

main().catch((err) => {
  logger.error('Fatal startup error:', err);
  process.exit(1);
});

import 'dotenv/config';
import express from 'express';
import { config } from './config';
import { handlePullRequestWebhook } from './webhook';
import { ensureSkillsRepo } from './skills';
import { logger } from './logger';

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Bitbucket webhook endpoint
app.post('/webhook/bitbucket', handlePullRequestWebhook);

async function main() {
  try {
    // Warm up: clone/pull the skills repo before accepting traffic
    await ensureSkillsRepo();
  } catch (err) {
    logger.warn('Could not pre-fetch skills repo at startup:', err);
    logger.warn('Skills will be fetched on first request.');
  }

  app.listen(config.port, () => {
    logger.info(`AI Code Review server listening on port ${config.port}`);
    logger.info(`Webhook endpoint: POST /webhook/bitbucket`);
  });
}

main().catch((err) => {
  logger.error('Fatal startup error:', err);
  process.exit(1);
});

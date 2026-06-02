import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config, RepoType, AiProvider } from './config';
import { loadSkills } from './skills';
import { logger } from './logger';

const SYSTEM_PROMPT = `You are an expert code reviewer. You will be given a set of review skills/guidelines and a pull request diff.
Your job is to review the code thoroughly based on the provided skills and guidelines.

When reviewing:
- Be specific and actionable in your feedback
- Reference the exact file path and line numbers when pointing out issues
- Distinguish between critical issues (must fix), warnings (should fix), and suggestions (nice to have)
- Acknowledge good practices you observe
- Format your response in clear Markdown

IMPORTANT formatting rules:
- Do NOT include any diff blocks, git diff output, or raw code patches in your response
- Do NOT reproduce large chunks of the original code
- When referencing code, quote only the specific expression or line (inline backticks), never a full diff hunk
- Keep recommendations as plain English descriptions of what to change and why

Output format:
## Code Review Summary
<brief overall assessment>

## Critical Issues 🔴
<list any blocking issues — describe the fix in plain text, no diff blocks>

## Warnings ⚠️
<list issues that should be addressed>

## Suggestions 💡
<list optional improvements>

## Positive Observations ✅
<list good practices observed>`;

export interface ReviewResult {
  summary: string;
  fullReview: string;
}

async function reviewWithAnthropic(userMessage: string): Promise<string> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });
  return response.content[0].type === 'text' ? response.content[0].text : '';
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 4,
  delayMs = 5000
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isRetryable = err?.status === 503 || err?.status === 429;
      if (!isRetryable || attempt === retries) throw err;
      const wait = delayMs * attempt;
      logger.warn(`Gemini ${err.status} on attempt ${attempt}/${retries}, retrying in ${wait}ms…`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error('Unreachable');
}

async function reviewWithGemini(userMessage: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_PROMPT,
  });
  const result = await withRetry(() => model.generateContent(userMessage));
  return result.response.text();
}

function removeDiffBlocks(text: string): string {
  // Remove fenced code blocks that contain diff/git content
  return text.replace(/```(?:diff|git)?[\s\S]*?```/g, (match) => {
    // Keep non-diff code blocks (e.g. short inline examples)
    if (match.includes('diff --git') || match.includes('@@') || match.includes('--- a/') || match.includes('+++ b/')) {
      return '_[diff removed for readability]_';
    }
    return match;
  });
}

export async function reviewPullRequest(
  repoSlug: string,
  prId: number,
  prTitle: string,
  prDescription: string,
  diff: string,
  repoType: RepoType
): Promise<ReviewResult> {
  const provider: AiProvider = config.aiProvider;
  logger.info(`Starting AI review for ${repoSlug} PR #${prId} (${repoType}) using ${provider}`);

  const skills = await loadSkills(repoType);

  const userMessage = `## Repository: ${repoSlug}
## PR #${prId}: ${prTitle}

### Description
${prDescription || '_No description provided_'}

---

## Review Guidelines / Skills
${skills}

---

## Pull Request Diff
\`\`\`diff
${diff.slice(0, 80000)}
\`\`\`

Please review this pull request based on the guidelines above.`;

  let fullReview: string;
  if (provider === 'anthropic') {
    fullReview = await reviewWithAnthropic(userMessage);
  } else {
    fullReview = await reviewWithGemini(userMessage);
  }

  const cleanedReview = removeDiffBlocks(fullReview);
  const summaryMatch = cleanedReview.match(/## Code Review Summary\n+([\s\S]+?)(?=\n##|$)/);
  const summary = summaryMatch ? summaryMatch[1].trim() : 'Code review completed.';

  logger.info(`Review complete for ${repoSlug} PR #${prId}`);
  return { summary, fullReview: cleanedReview };
}

import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import { VertexAI } from '@google-cloud/vertexai';
import { GoogleAuth } from 'google-auth-library';
import { config, RepoType, AiProvider } from './config';
import { loadSkills } from './skills';
import { logger } from './logger';

const GOOGLE_AUTH_SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];

// Wrap the in-memory service account credentials loaded from AWS Secrets
// Manager (see src/secrets.ts) so neither Vertex AI client needs to read
// GOOGLE_APPLICATION_CREDENTIALS or any file from disk.
function googleAuthOptions() {
  return config.gcpCredentials
    ? { credentials: config.gcpCredentials, scopes: GOOGLE_AUTH_SCOPES }
    : undefined;
}

function buildSystemPrompt(skillFileNames: string[]): string {
  const skillList = skillFileNames.map((f) => `- ${f}`).join('\n');

  return `You are an expert code reviewer with deep knowledge of software engineering best practices, performance patterns, and security standards.
You will be given a set of review skills/guidelines and a pull request diff.

IMPORTANT formatting rules:
- Do NOT include diff blocks, git diff output, or raw code patches
- Do NOT reproduce large chunks of code
- Inline backticks for short snippets only (single expression or line)
- Every finding must name the exact file, class, or method it applies to
- Be concise but complete — a developer must know exactly what to fix and how without needing further context

The skills being applied in this review are:
${skillList}

Output MUST follow this EXACT structure:

---

## PR Summary
2–3 sentences max. What this PR does, which feature/fix/ticket it covers.

---

## 📊 Skills Report

| Skill | Severity | Issues | Core Action |
|---|---|---|---|
| <exact skill filename, e.g. branch-naming.md> | 🔴 Critical / ⚠️ Warning / ✅ Pass | <count> | <≤10 words: the top action needed> |

One row per skill file. Use the exact filename as the Skill value.

---

## 🔴 Critical Fixes

Group by skill filename. For each group header use:
### 📁 <exact-skill-filename.md>

For each issue:
**N. Title** (\`ClassName#method\`): One sentence — the problem and why it matters.

\`\`\`
// file: path/to/File.ts (or .java, .tsx, etc.) — line N
<the exact problematic code snippet, 1–4 lines max>
\`\`\`

↳ **Fix:** One sentence — exactly what to change.

(if none → "None")

---

## ⚠️ Stability & Performance Warnings

Include two sources:
1. Issues from the skill guidelines
2. Any general best-practice concerns you observe in the diff (e.g. N+1 queries, missing indexes, unbounded loops, missing cache invalidation, thread-safety, memory leaks, missing timeouts, unhandled promise rejections, etc.) — label these with ⚡ to distinguish from skill-based findings

Format per issue:
**N. Title** (\`ClassName\` / skill or ⚡ Best Practice): One sentence — the risk.

\`\`\`
// file: path/to/File.ts (or .java, .tsx, etc.) — line N
<the exact problematic code snippet, 1–4 lines max>
\`\`\`

↳ **Fix:** One sentence — exactly what to do.

(if none → "None")

---

## ✅ Positive Observations

Numbered list. One line each. Name the specific class/pattern/decision that is good.`;
}

export interface ReviewResult {
  summary: string;
  fullReview: string;
}

async function reviewWithAnthropic(systemPrompt: string, userMessage: string): Promise<string> {
  // Claude via Vertex AI — auth is the service account credentials loaded
  // from AWS Secrets Manager, not an Anthropic API key. Vertex model IDs for
  // current-generation models take no provider prefix or date suffix
  // (e.g. "claude-opus-4-7").
  const authOptions = googleAuthOptions();
  const client = new AnthropicVertex({
    projectId: config.gcpProjectId,
    region: config.gcpLocation,
    googleAuth: authOptions ? new GoogleAuth(authOptions) : undefined,
  });
  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4096,
    system: systemPrompt,
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
      logger.warn(`AI provider ${err.status} on attempt ${attempt}/${retries}, retrying in ${wait}ms…`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error('Unreachable');
}

async function reviewWithGemini(systemPrompt: string, userMessage: string): Promise<string> {
  // Gemini via Vertex AI — same in-memory service account credentials as Claude.
  const vertexAI = new VertexAI({
    project: config.gcpProjectId,
    location: config.gcpLocation,
    googleAuthOptions: googleAuthOptions(),
  });
  const model = vertexAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: systemPrompt,
  });
  const result = await withRetry(() => model.generateContent(userMessage));
  const parts = result.response.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || '').join('');
}

function removeDiffBlocks(text: string): string {
  return text.replace(/```(?:diff|git)?[\s\S]*?```/g, (match) => {
    if (
      match.includes('diff --git') ||
      match.includes('@@') ||
      match.includes('--- a/') ||
      match.includes('+++ b/')
    ) {
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

  const { content: skillsContent, fileNames: skillFileNames } = await loadSkills(repoType);
  const systemPrompt = buildSystemPrompt(skillFileNames);

  const userMessage = `## Repository: ${repoSlug}
## PR #${prId}: ${prTitle}

### Description
${prDescription || '_No description provided_'}

---

## Review Guidelines / Skills
${skillsContent}

---

## Pull Request Diff
\`\`\`diff
${diff.slice(0, 80000)}
\`\`\`

Please review this pull request following the exact output structure defined in your instructions. Fill in the Skills Report table with the exact issue count and severity per skill. In the Critical Fixes and Warnings sections, be as detailed as possible — name specific classes, methods, and files. Do not skip any section even if empty.`;

  let fullReview: string;
  if (provider === 'anthropic') {
    fullReview = await reviewWithAnthropic(systemPrompt, userMessage);
  } else {
    fullReview = await reviewWithGemini(systemPrompt, userMessage);
  }

  const cleanedReview = removeDiffBlocks(fullReview);
  const summaryMatch = cleanedReview.match(/## PR Summary\n+([\s\S]+?)(?=\n---|\n##|$)/);
  const summary = summaryMatch ? summaryMatch[1].trim() : 'Code review completed.';

  logger.info(`Review complete for ${repoSlug} PR #${prId}`);
  return { summary, fullReview: cleanedReview };
}

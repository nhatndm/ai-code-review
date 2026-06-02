import simpleGit from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import { config, RepoType } from './config';
import { logger } from './logger';

const SKILLS_SUBDIR = '04-skills';

let skillsSynced = false;

export async function ensureSkillsRepo(): Promise<void> {
  const repoPath = path.resolve(config.skillsRepoPath);

  if (!fs.existsSync(repoPath)) {
    logger.info(`Cloning product-blueprint into ${repoPath}…`);
    await simpleGit().clone(config.productBlueprintRepoUrl, repoPath, [
      '--branch',
      'master',
      '--depth',
      '1',
      '--filter=blob:none',
      '--sparse',
    ]);
    const git = simpleGit(repoPath);
    await git.raw(['sparse-checkout', 'set', SKILLS_SUBDIR]);
    skillsSynced = true;
    logger.info('product-blueprint cloned (sparse, skills only).');
  } else if (!skillsSynced) {
    logger.info('Pulling latest product-blueprint skills…');
    const git = simpleGit(repoPath);
    await git.pull('origin', 'master');
    skillsSynced = true;
    logger.info('product-blueprint up-to-date.');
  }
}

const GLOBAL_SKILLS = ['branch-naming.md'];

export interface LoadedSkills {
  content: string;
  fileNames: string[];
}

export async function loadSkills(repoType: RepoType): Promise<LoadedSkills> {
  await ensureSkillsRepo();

  const skillsDir = path.resolve(config.skillsRepoPath, SKILLS_SUBDIR);
  if (!fs.existsSync(skillsDir)) {
    throw new Error(`Skills directory not found at ${skillsDir}`);
  }

  // Always-included skills (apply to every repo regardless of type)
  const globalFiles = GLOBAL_SKILLS.filter((f) => fs.existsSync(path.join(skillsDir, f)));

  // Repo-type-specific skills
  const prefix = repoType === 'frontend' ? 'fe-' : 'be-';
  const typedFiles = fs
    .readdirSync(skillsDir)
    .filter((f) => f.startsWith(prefix) && (f.endsWith('.md') || f.endsWith('.txt')))
    .sort();

  if (typedFiles.length === 0) {
    logger.warn(`No skill files found with prefix "${prefix}" in ${skillsDir}`);
  }

  // Merge: global first, then type-specific (deduplicate)
  const allFiles = [...new Set([...globalFiles, ...typedFiles])];

  logger.info(`Loaded ${allFiles.length} skill(s) for ${repoType}: ${allFiles.join(', ')}`);

  const content = allFiles
    .map((file) => {
      const fileContent = fs.readFileSync(path.join(skillsDir, file), 'utf-8');
      return `### Skill: ${file}\n\n${fileContent}`;
    })
    .join('\n\n---\n\n');

  return { content, fileNames: allFiles };
}

// Reset sync flag so next request pulls latest skills
export function resetSkillsSync(): void {
  skillsSynced = false;
}

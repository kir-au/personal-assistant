import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';

const VAULT_ROOT = path.join(process.env.HOME || '', 'personal-vault');

type ProjectRecord = {
  id: string;
  title: string;
  status?: string;
  summary?: string;
  next?: string;
  archived?: boolean;
};

type CaptureEntry = {
  created?: string;
  intent?: string;
  projectId?: string | null;
  path?: string;
  title?: string;
};

type ProjectConversation = {
  project?: string;
  projectTitle?: string;
  title?: string;
  snippetFromProjectUi?: string;
  rawPath?: string;
  capturedAt?: string;
  updated?: string;
  created?: string;
  messageCount?: number;
};

type ReviewCard = {
  projectId: string;
  projectTitle: string;
  status: 'active' | 'needs-review' | 'watch' | 'reference';
  priority: number;
  title: string;
  reason: string;
  suggestedAction: string;
  evidencePath?: string;
  evidenceLabel?: string;
  questions?: string[];
  recentCaptures: number;
  linkedSources: number;
};

type DataQualityReview = {
  id?: string;
  updatedAt?: string;
  projectId?: string;
  projectTitle?: string;
  status?: 'open' | 'needs-input' | 'resolved' | 'dismissed';
  priority?: number;
  title?: string;
  interpretation?: string;
  questions?: string[];
  suggestedAction?: string;
  evidencePath?: string;
};

function parseJsonLine<T>(line: string): T | null {
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

async function readJsonl<T>(relativePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(path.join(VAULT_ROOT, relativePath), 'utf-8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseJsonLine<T>)
      .filter((entry): entry is T => Boolean(entry));
  } catch {
    return [];
  }
}

async function readRegistry(): Promise<ProjectRecord[]> {
  try {
    const raw = await fs.readFile(path.join(VAULT_ROOT, 'structured', 'projects', 'registry.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.projects) ? parsed.projects.filter((project: ProjectRecord) => !project.archived) : [];
  } catch {
    return [];
  }
}

function daysAgo(dateValue?: string) {
  if (!dateValue) return Number.POSITIVE_INFINITY;
  const time = new Date(dateValue).getTime();
  if (Number.isNaN(time)) return Number.POSITIVE_INFINITY;
  return (Date.now() - time) / 86_400_000;
}

function textIncludesAny(text: string, words: string[]) {
  const normalized = text.toLowerCase();
  return words.some((word) => normalized.includes(word));
}

function inferProjectId(entry: CaptureEntry, projects: ProjectRecord[]) {
  if (entry.projectId) return entry.projectId;

  const text = `${entry.title ?? ''} ${entry.path ?? ''}`.toLowerCase();
  const keywordMap: Record<string, string[]> = {
    health: ['health', 'workout', 'exercise', 'walk', 'run', 'weight', 'shoulder', 'kettlebell'],
    ai: ['ai', 'mcp', 'codex', 'chatgpt', 'vault', 'dashboard', 'capture', 'model', 'api'],
    wealth: ['wealth', 'superannuation', 'tax', 'dividend', 'stock', 'wise', 'investment'],
    trading: ['trading', 'binance', 'exchange', 'strategy', 'position', 'dry-run'],
    routine: ['routine', 'morning', 'check-in', 'daily', 'food', 'hydration', 'sleep'],
    family: ['family', 'school', 'daughter', 'parenting'],
    travel: ['travel', 'hotel', 'flight', 'vietnam', 'da nang', 'bali'],
  };

  for (const project of projects) {
    const keywords = keywordMap[project.id] ?? [project.id];
    if (textIncludesAny(text, keywords)) return project.id;
  }

  return 'inbox';
}

async function readProjectDetail(projectId: string) {
  const dir = path.join(VAULT_ROOT, 'structured', 'projects');
  try {
    const entries = await fs.readdir(dir);
    const matches = entries.filter((entry) => entry.endsWith('.md') || entry.endsWith('.json'));

    for (const file of matches) {
      const fullPath = path.join(dir, file);
      const raw = await fs.readFile(fullPath, 'utf-8');

      if (file.endsWith('.json')) {
        const parsed = JSON.parse(raw);
        const fileMatches = file === `${projectId}.json` || file.startsWith(`${projectId}-`) || file.includes(`-${projectId}-`);
        const projectMatches = parsed.project === projectId || parsed.id === projectId || parsed.area === projectId;
        if (!fileMatches && !projectMatches) continue;

        const suggested = Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions[0] : null;
        return {
          title: parsed.currentFocus || parsed.title || file,
          suggestedAction: suggested?.title || suggested?.description || parsed.nextStep || '',
          evidencePath: `structured/projects/${file}`,
          importance: Number(parsed.importance ?? 0),
        };
      }

      const parsed = matter(raw);
      const fileMatches = file === `${projectId}.md` || file.startsWith(`${projectId}-`) || file.includes(`-${projectId}-`);
      const topics = Array.isArray(parsed.data.topics) ? parsed.data.topics : [];
      const projectMatches =
        parsed.data.project === projectId ||
        parsed.data.area === projectId ||
        topics.includes(projectId);
      if (!fileMatches && !projectMatches) continue;

      const body = parsed.content;
      const nextLine =
        body.match(/## Tomorrow's working block\s+([\s\S]*?)(?:\n## |\n# |$)/i)?.[1]?.trim().split('\n').find(Boolean) ??
        body.match(/## Current Plan\s+([\s\S]*?)(?:\n## |\n# |$)/i)?.[1]?.trim().split('\n').find(Boolean) ??
        body.match(/## Commitment\s+([\s\S]*?)(?:\n## |\n# |$)/i)?.[1]?.trim().split('\n').find(Boolean) ??
        '';

      return {
        title: String(parsed.data.title || file.replace(/\.md$/, '')),
        suggestedAction: nextLine.replace(/^[-*]\s+/, ''),
        evidencePath: `structured/projects/${file}`,
        importance: Number(parsed.data.importance ?? 0),
      };
    }
  } catch {
    return null;
  }

  return null;
}

function newestConversation(conversations: ProjectConversation[]) {
  return conversations
    .slice()
    .sort((a, b) => {
      const aTime = new Date(a.capturedAt || a.updated || a.created || 0).getTime();
      const bTime = new Date(b.capturedAt || b.updated || b.created || 0).getTime();
      return bTime - aTime;
    })[0];
}

function sourceReason(source?: ProjectConversation) {
  if (!source) return '';
  const snippet = source.snippetFromProjectUi ? `: ${source.snippetFromProjectUi}` : '';
  return `${source.title}${snippet}`;
}

export async function GET() {
  const [projects, captures, projectConversations, dataQualityReviews] = await Promise.all([
    readRegistry(),
    readJsonl<CaptureEntry>('indexes/captures.jsonl'),
    readJsonl<ProjectConversation>('indexes/project-conversations.jsonl'),
    readJsonl<DataQualityReview>('indexes/data-quality-reviews.jsonl'),
  ]);

  const recentCaptures = captures.filter((capture) => daysAgo(capture.created) <= 30);
  const recentByProject = new Map<string, CaptureEntry[]>();
  for (const capture of recentCaptures) {
    const projectId = inferProjectId(capture, projects);
    const list = recentByProject.get(projectId) ?? [];
    list.push(capture);
    recentByProject.set(projectId, list);
  }

  const sourceByProject = new Map<string, ProjectConversation[]>();
  for (const source of projectConversations) {
    if (!source.project) continue;
    const list = sourceByProject.get(source.project) ?? [];
    list.push(source);
    sourceByProject.set(source.project, list);
  }

  const cards: ReviewCard[] = [];
  for (const project of projects) {
    if (['travel', 'car', 'work', 'politics', 'startup'].includes(project.id)) continue;

    const capturesForProject = recentByProject.get(project.id) ?? [];
    const sourcesForProject = sourceByProject.get(project.id) ?? [];
    const latestCapture = capturesForProject[capturesForProject.length - 1];
    const latestSource = newestConversation(sourcesForProject);
    const detail = project.id === 'health' ? null : await readProjectDetail(project.id);

    const status: ReviewCard['status'] =
      capturesForProject.length > 0
        ? 'active'
        : sourcesForProject.length > 0
          ? 'needs-review'
          : project.status === 'daily'
            ? 'active'
            : 'watch';

    const priority =
      (detail?.importance ?? 0) +
      capturesForProject.length * 2 +
      Math.min(sourcesForProject.length, 8) +
      (project.status === 'active' ? 4 : 0) +
      (project.status === 'daily' ? 3 : 0);

    const evidencePath = latestCapture?.path ?? detail?.evidencePath ?? latestSource?.rawPath;
    const sourceText = sourceReason(latestSource);
    const defaultAction = project.next || 'Review recent vault context and decide the next useful action.';
    const suggestedAction = detail?.suggestedAction || defaultAction;

    cards.push({
      projectId: project.id,
      projectTitle: project.title,
      status,
      priority,
      title:
        capturesForProject.length > 0
          ? `${project.title}: recent vault updates`
          : detail?.title || project.summary || project.title,
      reason:
        capturesForProject.length > 0
          ? `${capturesForProject.length} recent capture(s) plus ${sourcesForProject.length} linked source(s).`
          : sourceText
            ? `Linked source waiting for extraction: ${sourceText}`
            : project.summary || 'Project exists in the vault registry.',
      suggestedAction,
      evidencePath,
      evidenceLabel: latestCapture?.title ?? latestSource?.title ?? detail?.title,
      recentCaptures: capturesForProject.length,
      linkedSources: sourcesForProject.length,
    });
  }

  const latestQualityReviews = new Map<string, DataQualityReview>();
  for (const review of dataQualityReviews) {
    if (!review.id) continue;
    const current = latestQualityReviews.get(review.id);
    if (!current || String(review.updatedAt || '') >= String(current.updatedAt || '')) {
      latestQualityReviews.set(review.id, review);
    }
  }

  const qualityCards: ReviewCard[] = [...latestQualityReviews.values()]
    .filter((review) => !['resolved', 'dismissed'].includes(String(review.status || 'open')))
    .map((review) => ({
      projectId: review.projectId || 'inbox',
      projectTitle: review.projectTitle || 'Data quality',
      status: 'needs-review',
      priority: review.priority ?? 100,
      title: review.title || 'Review a questionable source claim',
      reason: review.interpretation || 'The assistant found a claim that should not be accepted without review.',
      suggestedAction: review.suggestedAction || 'Review the evidence and provide the missing context.',
      evidencePath: review.evidencePath,
      evidenceLabel: 'Evidence',
      questions: review.questions,
      recentCaptures: 0,
      linkedSources: 1,
    }));

  const sortedCards = [...qualityCards, ...cards]
    .filter((card) => card.priority > 0 || ['health', 'ai', 'business', 'wealth', 'trading', 'routine'].includes(card.projectId))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 8);

  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    windowDays: 30,
    source: 'vault-derived-review',
    cards: sortedCards,
  });
}

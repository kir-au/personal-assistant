import { NextRequest, NextResponse } from 'next/server';
import fsp from 'fs/promises';
import path from 'path';

const VAULT_ROOT = path.join(process.env.HOME || '', 'personal-vault');
const PROJECT_REGISTRY_PATH = path.join(VAULT_ROOT, 'structured', 'projects', 'registry.json');
const CAPTURE_INDEX_PATH = path.join(VAULT_ROOT, 'indexes', 'captures.jsonl');

type CaptureSource = 'manual' | 'voice' | 'chat' | 'email' | 'file' | 'api';
type CaptureIntent = 'note' | 'achievement' | 'workout' | 'task' | 'decision' | 'question' | 'replan';

interface CaptureRequest {
  input: string;
  source?: CaptureSource;
  intent?: CaptureIntent;
  projectId?: string;
  createdAt?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

interface ProjectRecord {
  id: string;
  title: string;
  area?: string;
  archived?: boolean;
}

interface CaptureAction {
  id: string;
  label: string;
  description: string;
  processorId?: string;
  recordType?: string;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72) || 'capture';
}

function safeId(value?: string) {
  if (!value) return undefined;
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return normalized || undefined;
}

async function readProjects(): Promise<ProjectRecord[]> {
  try {
    const raw = await fsp.readFile(PROJECT_REGISTRY_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.projects)
      ? parsed.projects.filter((project: ProjectRecord) => !project.archived)
      : [];
  } catch {
    return [];
  }
}

function inferIntent(input: string, explicit?: CaptureIntent): CaptureIntent {
  if (explicit) return explicit;
  const lower = input.toLowerCase();
  if (/(workout|gym|rehab|sets?|reps?|kg|килограмм|упражнен|трениров|csr|scr|face pull|walk)/.test(lower)) return 'workout';
  if (/(done|finished|completed|сделал|закрыл|готово|выполн)/.test(lower)) return 'achievement';
  if (/(move|перенес|перенести|replan|not in the right state|rest day)/.test(lower)) return 'replan';
  if (/(need to|todo|task|надо|нужно|должен)/.test(lower)) return 'task';
  if (/(decided|decision|решил|решение)/.test(lower)) return 'decision';
  if (/\?$/.test(input.trim())) return 'question';
  return 'note';
}

function scoreProject(input: string, project: ProjectRecord) {
  const lower = input.toLowerCase();
  const haystack = [project.id, project.title, project.area].filter(Boolean).join(' ').toLowerCase();
  let score = 0;

  for (const token of haystack.split(/[^a-z0-9а-яё]+/i).filter(Boolean)) {
    if (token.length > 2 && lower.includes(token)) score += 3;
  }

  const keywordMap: Record<string, string[]> = {
    health: ['health', 'shoulder', 'rehab', 'gym', 'workout', 'pain', 'sleep', 'energy', 'walk', 'csr', 'scr', 'килограмм', 'упражнен', 'трениров'],
    business: ['business', 'product', 'customer', 'revenue', 'medium', 'linkedin', 'article', 'startup', 'invoice'],
    ai: ['ai', 'openai', 'chatgpt', 'codex', 'mcp', 'whisper', 'model', 'api', 'agent'],
    family: ['family', 'daughter', 'school', 'parent', 'counsellor', 'семья', 'дочь'],
    wealth: ['wealth', 'invest', 'tax', 'money', 'super', 'stock', 'etf', 'dividend'],
    travel: ['travel', 'flight', 'hotel', 'trip', 'japan', 'greece'],
    routine: ['routine', 'morning', 'habit', 'check-in', 'sleep', 'daily'],
    trading: ['trading', 'binance', 'setup', 'position', 'risk'],
    car: ['car', 'scratch', 'service', 'repair'],
    work: ['work', 'job', 'office', 'email'],
  };

  for (const token of keywordMap[project.id] || []) {
    if (lower.includes(token)) score += 2;
  }

  return score;
}

function routeCapture(input: string, projects: ProjectRecord[], explicitProjectId?: string, explicitIntent?: CaptureIntent) {
  const intent = inferIntent(input, explicitIntent);
  const explicitProject = safeId(explicitProjectId);
  const ranked = projects
    .map((project) => ({
      id: project.id,
      title: project.title,
      score: explicitProject === project.id ? 100 : scoreProject(input, project),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const primaryProject = ranked[0];
  const candidates = ranked.length ? ranked : [{ id: 'inbox', title: 'Vault inbox', score: 0 }];
  const actions: Array<CaptureAction | null> = [
    { id: 'leave-in-inbox', label: 'Leave in inbox', description: 'Save only as raw capture for later review.' },
    primaryProject && primaryProject.id !== 'inbox'
      ? { id: 'link-to-project', label: `Link to ${primaryProject.title}`, description: 'Attach this capture as source evidence for the project.' }
      : null,
    intent === 'workout'
      ? {
          id: 'apply-structured-update',
          label: 'Update structured state',
          description: 'Apply this capture through the selected project processor after review.',
          processorId: 'health.activity',
          recordType: 'activity_log',
        }
      : null,
    intent === 'achievement'
      ? { id: 'add-today-achievement', label: 'Add to today achievement', description: 'Show this as something completed today.' }
      : null,
    intent === 'task' || intent === 'replan'
      ? { id: 'add-to-today-plan', label: 'Add to today plan', description: 'Promote this capture into the Today agenda.' }
      : null,
  ].filter(Boolean);

  return {
    intent,
    projectId: primaryProject?.id === 'inbox' ? undefined : primaryProject?.id,
    candidates,
    actions,
  };
}

function yamlString(value: string) {
  return JSON.stringify(value);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CaptureRequest;
    const input = body.input?.trim();

    if (!input) {
      return NextResponse.json({ ok: false, error: 'Missing input' }, { status: 400 });
    }

    const now = body.createdAt ? new Date(body.createdAt) : new Date();
    if (Number.isNaN(now.getTime())) {
      return NextResponse.json({ ok: false, error: 'Invalid createdAt' }, { status: 400 });
    }

    const iso = now.toISOString();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const date = `${year}-${month}-${day}`;
    const projects = await readProjects();
    const routing = routeCapture(input, projects, body.projectId, body.intent);
    const titleSeed = body.title?.trim() || input.split(/\s+/).slice(0, 9).join(' ');
    const title = body.title?.trim() || `Capture - ${date}`;

    const rawDir = path.join(VAULT_ROOT, 'raw', year, month);
    await fsp.mkdir(rawDir, { recursive: true });

    const filename = `${date}-capture-${slugify(titleSeed)}.md`;
    const fullPath = path.join(rawDir, filename);
    const relativePath = path.relative(VAULT_ROOT, fullPath);

    const content = [
      '---',
      `title: ${yamlString(title)}`,
      `created: ${yamlString(iso)}`,
      `source: ${yamlString(body.source || 'manual')}`,
      `capture_intent: ${yamlString(routing.intent)}`,
      routing.projectId ? `project: ${yamlString(routing.projectId)}` : '',
      `routing_status: "suggested"`,
      `privacy: private`,
      '---',
      '',
      `# ${title}`,
      '',
      input,
      '',
      '## Routing Suggestions',
      '',
      `- intent: ${routing.intent}`,
      routing.projectId ? `- primary project: ${routing.projectId}` : '- primary project: inbox',
      `- candidates: ${routing.candidates.map((candidate) => candidate.id).join(', ')}`,
      '',
      '## Available Actions',
      '',
      ...routing.actions.map((action: any) => `- ${action.label}: ${action.description}`),
      '',
    ].filter(Boolean).join('\n');

    await fsp.writeFile(fullPath, content, 'utf-8');
    await fsp.mkdir(path.dirname(CAPTURE_INDEX_PATH), { recursive: true });
    await fsp.appendFile(CAPTURE_INDEX_PATH, JSON.stringify({
      created: iso,
      source: body.source || 'manual',
      intent: routing.intent,
      projectId: routing.projectId || null,
      path: relativePath,
      title,
      candidates: routing.candidates,
      actions: routing.actions,
      metadata: body.metadata || {},
    }) + '\n', 'utf-8');

    return NextResponse.json({
      ok: true,
      path: relativePath,
      title,
      routing,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}

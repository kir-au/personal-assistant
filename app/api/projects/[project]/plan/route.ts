import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const VAULT_ROOT = path.join(process.env.HOME || '', 'personal-vault');
const PLANNER_ITEMS_PATH = path.join(VAULT_ROOT, 'structured', 'plans', 'planner-items.json');

function safeProjectId(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!normalized) throw new Error('Invalid project id');
  return normalized;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ project: string }> }
) {
  try {
    const { project } = await params;
    const projectId = safeProjectId(project);
    const store = JSON.parse(await fs.readFile(PLANNER_ITEMS_PATH, 'utf-8')) as {
      generatedAt?: string;
      items?: Array<Record<string, unknown>>;
    };
    const items = (store.items || [])
      .filter((item) => item.projectId === projectId && item.status !== 'archived')
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));

    return NextResponse.json({
      projectId,
      sourcePath: `structured/projects/${projectId}/current-plan.md`,
      generatedAt: store.generatedAt || null,
      items,
    });
  } catch (error) {
    return NextResponse.json({
      error: 'Failed to read project current plan',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

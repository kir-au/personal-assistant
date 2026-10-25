import { NextResponse } from 'next/server';
import path from 'path';
import { readSourceInventoryCache, refreshSourceInventory } from '@/lib/sourceInventoryWorker.mjs';

const VAULT_ROOT = path.resolve(process.env.PERSONAL_VAULT_ROOT || path.join(process.env.HOME || '', 'personal-vault'));

export const runtime = 'nodejs';

// Diagnostic reads the cache. Refresh is explicit and uses the same worker as
// projection freshness; neither endpoint writes Vault files.
export async function GET() {
  const cached = await readSourceInventoryCache(VAULT_ROOT);
  return NextResponse.json(cached ? { status: 'cached', ...cached } : { status: 'missing-cache' });
}

export async function POST() {
  const result = await refreshSourceInventory(VAULT_ROOT);
  return NextResponse.json(result);
}

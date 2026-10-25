export async function register() {
  // Keep the Node-only dependency inside the runtime branch for Edge bundling.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NEXT_PHASE === 'phase-production-build') return;
    const { startSourceInventoryLifecycle } = await import('./lib/sourceInventoryLifecycle.mjs');
    startSourceInventoryLifecycle();
  }
}

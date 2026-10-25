export function projectionFreshness(projection, inventoryResult) {
  const checkedAt = inventoryResult?.inventory?.scannedAt || null;
  if (!projection) return { state: 'missing', stale: true, reason: 'No projection is available.' };
  if (inventoryResult?.status !== 'fresh') return { state: 'scan-error', stale: true, checkedAt, reason: 'Source scan did not complete; the last projection may be stale.' };
  if (projection?.sourceInventory?.sourceVersion !== inventoryResult.inventory.sourceVersion) {
    return { state: 'source-changed', stale: true, checkedAt, reason: 'Readable source files changed since this projection was published.' };
  }
  return { state: 'fresh', stale: false, checkedAt, reason: null };
}

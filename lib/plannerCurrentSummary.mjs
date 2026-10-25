export const NO_CURRENT_SUMMARY = 'No current summary selected. Review recent changes before choosing today’s focus.';

// A Planner headline is derived state, never a Vault snapshot selected by filename.
// It must be explicitly reviewed and retain links to the source records it summarizes.
export function selectCurrentPlannerSummary(candidates, today) {
  return candidates.find((candidate) => (
    candidate?.kind === 'planner-change-summary'
    && candidate.status === 'reviewed'
    && typeof candidate.reviewedAt === 'string'
    && candidate.reviewedAt.slice(0, 10) <= today
    && Array.isArray(candidate.sourceLinks)
    && candidate.sourceLinks.length > 0
    && candidate.sourceLinks.every((source) => typeof source?.path === 'string' && source.path.length > 0)
    && typeof candidate.summary === 'string'
    && candidate.summary.trim().length > 0
  )) || null;
}

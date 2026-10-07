import type { Candidate } from '@/lib/types';
import { isRecentCandidate, pickCandidateColor } from '@/lib/utils';

export function CandidateName({
  candidate,
  index = 0,
  showNewBadge = true,
}: {
  candidate: Candidate;
  index?: number;
  showNewBadge?: boolean;
}) {
  const color = pickCandidateColor(candidate, index);
  const isNew = showNewBadge && isRecentCandidate(candidate.created_at);

  return (
    <span className="cand-name-colored">
      <span className="color-swatch" style={{ background: color }} />
      {isNew && <span className="badge badge-new">NEW</span>}
      <strong style={{ color }}>{candidate.name}</strong>
    </span>
  );
}

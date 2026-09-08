// packages/lesson-session-host/src/room.ts
// PeerStudio D1 — ephemeral in-memory peer-review Room.
// A Room groups N LessonSession ids so learners can rate each other's responses.
// Ratings accumulate locally; k-anonymity is enforced before any aggregate is revealed.
// The room never touches the learner session objects — it is a pure coordination layer.

/** Minimum number of independent peer ratings before any aggregate is revealed (k-floor). */
export const ROOM_K_FLOOR = 3;

export interface PeerRating {
  rater_session_id: string;
  target_session_id: string;
  passed: boolean;
  /** Holistic quality 1–5 */
  rating: number;
  helpful: boolean;
  ts: number;
}

export interface RoomEntry {
  id: string;
  teacher_key: string;
  bundle_ref: string;
  join_code: string;
  session_ids: Set<string>;
  ratings: PeerRating[];
  created_at: number;
  closed: boolean;
}

/** Per-target aggregate — only emitted once k_floor independent raters are in. */
export interface TargetAggregate {
  target_session_id: string;
  k: number;
  passed_rate: number;  // 0–1
  avg_rating: number;   // 1–5
  avg_helpful: number;  // 0–1
}

export interface RoomState {
  room_id: string;
  bundle_ref: string;
  session_count: number;
  rating_count: number;
  closed: boolean;
  /** Only targets that reached k_floor independent ratings. */
  aggregates: TargetAggregate[];
}

/** Group ratings by target, apply k-floor suppression over DISTINCT RATERS, return per-target
 *  aggregates.
 *
 *  The floor counts people, not rows (INT-STUDIUM-030, found auditing the floors; the same
 *  defect INT-STUDIUM-019 fixed on the collector side, where it counted telemetry files).
 *  Counting rows let one learner rate the same target three times and unlock an aggregate that
 *  was their own three opinions averaged — surfaced to the teacher as a k=3 peer consensus.
 *  Nothing in the Room prevents a repeat rating, so the dedup lives here: one rater is one
 *  opinion, their latest, and every published number is computed over that same population. */
export function aggregateRatings(ratings: PeerRating[], kFloor = ROOM_K_FLOOR): TargetAggregate[] {
  const byTarget = new Map<string, Map<string, PeerRating>>();
  for (const r of ratings) {
    const byRater = byTarget.get(r.target_session_id) ?? new Map<string, PeerRating>();
    const prev = byRater.get(r.rater_session_id);
    if (!prev || r.ts >= prev.ts) byRater.set(r.rater_session_id, r);
    byTarget.set(r.target_session_id, byRater);
  }
  const result: TargetAggregate[] = [];
  for (const [target, byRater] of byTarget) {
    const rs = [...byRater.values()];
    if (rs.length < kFloor) continue;
    result.push({
      target_session_id: target,
      k: rs.length,
      passed_rate: rs.filter((r) => r.passed).length / rs.length,
      avg_rating: rs.reduce((s, r) => s + r.rating, 0) / rs.length,
      avg_helpful: rs.filter((r) => r.helpful).length / rs.length,
    });
  }
  return result;
}

/** Distinct raters of one target — the number the k floor is applied to. */
export function distinctRaters(ratings: PeerRating[], targetSessionId: string): number {
  return new Set(ratings.filter((r) => r.target_session_id === targetSessionId)
    .map((r) => r.rater_session_id)).size;
}

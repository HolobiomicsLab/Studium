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

/** Group ratings by target, apply k-floor suppression, return per-target aggregates. */
export function aggregateRatings(ratings: PeerRating[], kFloor = ROOM_K_FLOOR): TargetAggregate[] {
  const byTarget = new Map<string, PeerRating[]>();
  for (const r of ratings) {
    const arr = byTarget.get(r.target_session_id) ?? [];
    arr.push(r);
    byTarget.set(r.target_session_id, arr);
  }
  const result: TargetAggregate[] = [];
  for (const [target, rs] of byTarget) {
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

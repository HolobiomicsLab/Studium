# PeerStudio — D1 Multi-learner substrate

## Motivation

The active-learning scene types (spot_the_flaw, explain_back, comparison, etc.) are graded offline by the CritiqueEvaluator. PeerStudio extends this with a *social* layer: a teacher can group N learner sessions into an ephemeral Room so learners can rate each other's responses. Aggregate peer signals feed the existing `decide_item` gate to promote approved responses into the community bundle.

Design principle: **lightest possible composition of existing primitives**. PeerStudio adds a coordination layer only; it reuses `record_peer_review`, `decide_item`, and `discoverCommunityBundles` without duplicating any grading or storage logic.

---

## Data flow

```
Teacher: open_peer_room(bundle_ref)
       → { room_id, join_code, teacher_key }

Students (N): join_peer_room(join_code, session_id)
            → session linked into Room

Students rate: submit_peer_rating(room_id, rater_session_id, target_session_id, {passed, rating 1–5, helpful})
             → { suppressed: true|false, k }
             (suppressed = true until 3 independent ratings for that target)

Teacher polls: get_peer_room_state(room_id, teacher_key)
             → { session_count, rating_count, aggregates: TargetAggregate[] }
             (aggregates list only targets that reached k_floor=3)

Teacher: close_peer_room(room_id, teacher_key)
       → final RoomState with aggregates
       → teacher forwards passed_rate ≥ threshold to scene-synth /decide_item
         → approved responses emit into <courseRoot>/community/*.zip
         → discoverCommunityBundles() picks them up at the next session
```

---

## Privacy / k-anonymity

- Aggregates are **suppressed** until `ROOM_K_FLOOR = 3` independent raters have rated the same target. No single-rater signal is ever revealed.
- The `target_session_id` is an opaque UUID; the dashboard displays only its last 6 characters as a non-identifying tag (`#ABC123`).
- Rater identity is never included in the aggregate. Only `{ k, passed_rate, avg_rating, avg_helpful }` is exposed.
- Self-rating is rejected at the host layer (`PeerRoomError`).

---

## Architecture

### Backend (`packages/lesson-session-host`)

| File | Purpose |
|---|---|
| `src/room.ts` | `PeerRating`, `RoomEntry`, `TargetAggregate`, `RoomState` types; `aggregateRatings()` pure function with k-floor suppression |
| `src/host.ts` | `SessionHost.openRoom / joinRoom / submitRoomRating / getRoomState / closeRoom`; `PeerRoomError`; ephemeral in-memory `rooms` + `joinCodeIndex` maps |

The Room is **ephemeral**: it lives only in the `SessionHost` process. On server restart, all open rooms are lost. This is intentional — a PeerStudio session is a synchronous classroom activity, not a persistent record.

### MCP interface (`apps/lesson-mcp`)

Five tools: `open_peer_room`, `join_peer_room`, `submit_peer_rating`, `get_peer_room_state`, `close_peer_room`. The MCP interface is the primary path for AI-driven / automated pedagogical workflows.

### HTTP interface (`apps/lesson-server`)

Five Fastify routes mirroring the MCP tools, for the teacher-dashboard UI:

| Verb | Path | Purpose |
|---|---|---|
| POST | `/rooms` | Open a room |
| POST | `/rooms/join` | Join by join_code |
| POST | `/rooms/:id/ratings` | Submit a peer rating |
| GET | `/rooms/:id?teacher_key=` | Read room state (teacher-gated) |
| POST | `/rooms/:id/close` | Close room (teacher-gated) |

### Teacher dashboard (`apps/teacher-dashboard`)

Route `/room` renders `PeerRoomPanel`:
1. Form: enter bundle_ref → "Open room" → displays the 6-char `join_code` prominently
2. Live state panel: session count, rating count, k-suppressed aggregate table
3. "Close room" → final aggregates + note to forward to `decide_item`

---

## Design decisions

| Question | Resolution |
|---|---|
| k-floor | 3 — minimum for meaningful anonymity in a classroom |
| join_code format | First 6 hex chars of `room_id`, uppercased — human-typable, low collision risk for same-class use |
| teacher_key | Opaque UUID returned at open time; never derivable from room_id |
| Room persistence | Ephemeral in-memory only — a PeerStudio session is synchronous |
| decide_item coupling | Loose — `closeRoom` returns aggregates; teacher dashboard (or a teacher-operated script) calls `decide_item` explicitly. The Room has no direct dependency on scene-synth. |
| Rater-vs-target validation | Self-rating rejected at host; no registry validation (callers are trusted for session_id validity) |

---

## Tests

- `packages/lesson-session-host/src/host.room.test.ts` — 15 unit tests: lifecycle, k-suppression per-target independence, self-rating rejection, rating bounds, wrong-key gate, no-fabrication
- `apps/lesson-server/src/server.room.test.ts` — 10 HTTP integration tests: all 5 routes, error paths
- `apps/teacher-dashboard/components/PeerRoomPanel.test.tsx` — static markup contract tests

---

## Related specs

- `docs/specs/learner-as-author-plan.md` — LAItem lifecycle that `decide_item` is part of
- `docs/specs/community-bundles-live-runtime-A3.md` — how approved items reach students

"use client";

import { useState, useCallback } from "react";
import {
  openRoom,
  getRoomState,
  closeRoom,
  type RoomState,
  type TargetAggregate,
} from "@/lib/api";

// ── injected actions (testable) ──────────────────────────────────────────────
export type OpenRoomAction = (bundleRef: string) => Promise<{ room_id: string; join_code: string; teacher_key: string }>;
export type GetStateAction = (roomId: string, teacherKey: string) => Promise<RoomState>;
export type CloseRoomAction = (roomId: string, teacherKey: string) => Promise<RoomState>;

type Props = {
  onOpenRoom?: OpenRoomAction;
  onGetState?: GetStateAction;
  onCloseRoom?: CloseRoomAction;
};

export function formatRoomError(_error: unknown): string {
  return (
    "lesson-server n’a pas pu terminer l’opération. " +
    "Vérifiez que le service lesson-server est démarré et accessible, puis réessayez."
  );
}

function AggregateRow({ agg }: { agg: TargetAggregate }) {
  const pct = (n: number) => `${Math.round(n * 100)} %`;
  const tag = agg.target_session_id.slice(-6).toUpperCase();
  return (
    <tr data-testid="aggregate-row" data-target={agg.target_session_id}>
      <td className="room-session-tag">#{tag}</td>
      <td>{agg.k}</td>
      <td>
        <span
          className={`metric-reading metric-reading--${agg.passed_rate >= 0.6 ? "strong" : "watch"}`}
        >
          {pct(agg.passed_rate)}
        </span>
      </td>
      <td>{agg.avg_rating.toFixed(1)}/5</td>
      <td>{pct(agg.avg_helpful)}</td>
    </tr>
  );
}

function RoomStateView({ state, onRefresh, onClose, busy }: {
  state: RoomState;
  onRefresh: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <div data-testid="room-state" className="room-stack">
      <div className="room-toolbar">
        <span className="room-meta">
          {state.session_count} participant{state.session_count !== 1 ? "s" : ""} &middot;{" "}
          {state.rating_count} note{state.rating_count !== 1 ? "s" : ""}
        </span>
        {state.closed ? (
          <span
            data-testid="closed-badge"
            className="status-badge status-badge--neutral"
          >
            Salle fermée / Room closed
          </span>
        ) : (
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            className="secondary-button"
          >
            Rafraîchir / Refresh
          </button>
        )}
      </div>

      {state.aggregates.length > 0 ? (
        <div className="table-scroll">
          <p className="room-help">
            Agrégats ≥ k=3 / Aggregates (k≥3 raters):
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Session</th>
                <th>k</th>
                <th>Réussi / Passed</th>
                <th>Note moy.</th>
                <th>Utile / Helpful</th>
              </tr>
            </thead>
            <tbody>
              {state.aggregates.map((a) => (
                <AggregateRow key={a.target_session_id} agg={a} />
              ))}
            </tbody>
          </table>
          {state.closed && (
            <p className="room-help room-help--spaced">
              Transmettez ces résultats à{" "}
              <code>scene-synth/decide_item</code>{" "}
              pour publier dans le bundle communautaire.
              <br />
              <span className="room-help__translation">
                Forward these aggregates to scene-synth/decide_item to publish in the community bundle.
              </span>
            </p>
          )}
        </div>
      ) : (
        <p className="empty-state empty-state--panel">
          Aucun agrégat disponible (seuil k=3 non atteint). / No aggregates yet (k=3 floor not reached).
        </p>
      )}

      {!state.closed && (
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          data-testid="close-room-btn"
          className="danger-button"
        >
          Fermer la salle / Close room
        </button>
      )}
    </div>
  );
}

export default function PeerRoomPanel({
  onOpenRoom = openRoom,
  onGetState = getRoomState,
  onCloseRoom = closeRoom,
}: Props) {
  const [bundleRef, setBundleRef] = useState("atomistique-l1/lesson.json");
  const [room, setRoom] = useState<{ room_id: string; join_code: string; teacher_key: string } | null>(null);
  const [state, setState] = useState<RoomState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrap = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(formatRoomError(e)); } finally { setBusy(false); }
  }, []);

  async function handleOpen(e: React.FormEvent) {
    e.preventDefault();
    await wrap(async () => {
      const r = await onOpenRoom(bundleRef);
      setRoom(r);
      setState(null);
    });
  }

  async function handleRefresh() {
    if (!room) return;
    await wrap(async () => setState(await onGetState(room.room_id, room.teacher_key)));
  }

  async function handleClose() {
    if (!room) return;
    await wrap(async () => setState(await onCloseRoom(room.room_id, room.teacher_key)));
  }

  return (
    <div data-testid="peer-room-panel" className="room-panel">
      <h3 className="room-panel__title">
        PeerStudio — Gestion de salle / Room management
      </h3>

      {!room ? (
        <form onSubmit={handleOpen} className="room-stack">
          <label className="field-group">
            <span className="field-group__label">
              Référence du bundle / Bundle ref
            </span>
            <input
              data-testid="bundle-ref-input"
              type="text"
              value={bundleRef}
              onChange={(e) => setBundleRef(e.target.value)}
              className="st-input room-input"
              required
            />
          </label>
          <button
            type="submit"
            disabled={busy || !bundleRef.trim()}
            data-testid="open-room-btn"
            className="primary-button"
          >
            Ouvrir une salle / Open room
          </button>
        </form>
      ) : (
        <div className="room-stack">
          <div
            data-testid="join-code-display"
            className="join-code"
          >
            <p className="join-code__label">
              Code d&apos;accès / Join code
            </p>
            <p className="join-code__value" aria-label="join code">
              {room.join_code}
            </p>
            <p className="join-code__hint">
              Les étudiant·es saisissent ce code dans l&apos;interface pair-à-pair.
              <br />
              Students enter this code in the peer interface.
            </p>
          </div>

          {!state ? (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={busy}
              data-testid="load-state-btn"
              className="secondary-button"
            >
              Charger l&apos;état / Load state
            </button>
          ) : (
            <RoomStateView
              state={state}
              onRefresh={handleRefresh}
              onClose={handleClose}
              busy={busy}
            />
          )}
        </div>
      )}

      {error && (
        <p role="alert" data-testid="room-error" className="inline-error">
          Erreur : {error}
        </p>
      )}
    </div>
  );
}

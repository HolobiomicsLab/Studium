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

function AggregateRow({ agg }: { agg: TargetAggregate }) {
  const pct = (n: number) => `${Math.round(n * 100)} %`;
  const tag = agg.target_session_id.slice(-6).toUpperCase();
  return (
    <tr data-testid="aggregate-row" data-target={agg.target_session_id} className="border-t">
      <td className="py-1 pr-4 font-mono text-xs text-gray-500">#{tag}</td>
      <td className="py-1 pr-4 text-center">{agg.k}</td>
      <td className="py-1 pr-4 text-center">
        <span className={agg.passed_rate >= 0.6 ? "text-green-700 font-semibold" : "text-red-600"}>
          {pct(agg.passed_rate)}
        </span>
      </td>
      <td className="py-1 pr-4 text-center">{agg.avg_rating.toFixed(1)}/5</td>
      <td className="py-1 text-center">{pct(agg.avg_helpful)}</td>
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
    <div data-testid="room-state" className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-sm text-gray-600">
          {state.session_count} participant{state.session_count !== 1 ? "s" : ""} &middot;{" "}
          {state.rating_count} note{state.rating_count !== 1 ? "s" : ""}
        </span>
        {state.closed ? (
          <span
            data-testid="closed-badge"
            className="text-xs font-semibold px-2 py-0.5 rounded bg-gray-200 text-gray-700"
          >
            Salle fermée / Room closed
          </span>
        ) : (
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            className="text-xs px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            Rafraîchir / Refresh
          </button>
        )}
      </div>

      {state.aggregates.length > 0 ? (
        <div>
          <p className="text-xs text-gray-500 mb-1">
            Agrégats ≥ k=3 / Aggregates (k≥3 raters):
          </p>
          <table className="text-sm w-full">
            <thead>
              <tr className="text-xs text-gray-500 text-left">
                <th className="pr-4 pb-1">Session</th>
                <th className="pr-4 pb-1 text-center">k</th>
                <th className="pr-4 pb-1 text-center">Réussi / Passed</th>
                <th className="pr-4 pb-1 text-center">Note moy.</th>
                <th className="pb-1 text-center">Utile / Helpful</th>
              </tr>
            </thead>
            <tbody>
              {state.aggregates.map((a) => (
                <AggregateRow key={a.target_session_id} agg={a} />
              ))}
            </tbody>
          </table>
          {state.closed && (
            <p className="text-xs text-gray-500 mt-2">
              Transmettez ces résultats à{" "}
              <code className="bg-gray-100 px-1 rounded">scene-synth/decide_item</code>{" "}
              pour publier dans le bundle communautaire.
              <br />
              <span className="text-gray-400">
                Forward these aggregates to scene-synth/decide_item to publish in the community bundle.
              </span>
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          Aucun agrégat disponible (seuil k=3 non atteint). / No aggregates yet (k=3 floor not reached).
        </p>
      )}

      {!state.closed && (
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          data-testid="close-room-btn"
          className="text-sm px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
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
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
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
    <div data-testid="peer-room-panel" className="space-y-6 max-w-xl">
      <h3 className="font-semibold text-base">
        PeerStudio — Gestion de salle / Room management
      </h3>

      {!room ? (
        <form onSubmit={handleOpen} className="space-y-3">
          <label className="block text-sm">
            <span className="block text-gray-700 mb-1">
              Référence du bundle / Bundle ref
            </span>
            <input
              data-testid="bundle-ref-input"
              type="text"
              value={bundleRef}
              onChange={(e) => setBundleRef(e.target.value)}
              className="w-full border rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              required
            />
          </label>
          <button
            type="submit"
            disabled={busy || !bundleRef.trim()}
            data-testid="open-room-btn"
            className="text-sm px-4 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Ouvrir une salle / Open room
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          <div
            data-testid="join-code-display"
            className="p-4 rounded-lg border-2 border-blue-400 bg-blue-50 text-center space-y-1"
          >
            <p className="text-xs text-blue-600 uppercase tracking-wide font-medium">
              Code d&apos;accès / Join code
            </p>
            <p className="text-4xl font-mono font-bold tracking-widest text-blue-900" aria-label="join code">
              {room.join_code}
            </p>
            <p className="text-xs text-blue-500">
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
              className="text-sm px-3 py-1 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
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
        <p role="alert" data-testid="room-error" className="text-xs text-red-600">
          Erreur : {error}
        </p>
      )}
    </div>
  );
}

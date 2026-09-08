import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { tauri, type BundleEntry } from "../lib/tauri";

/**
 * The library: the bundles this installation can open (INT-STUDIUM-034).
 *
 * Until now this screen was a hardcoded card for `demo-metabolomics-001`, stating a title, a
 * level, a duration and a scene count as literal markup for a bundle it never opened, behind a
 * `<Link>` to a player that loaded a module constant. So the runtime could play exactly one
 * lesson, fixed when the binary was compiled, and the atomistique bundle the M6 demo builds
 * and validates two steps earlier had no path through the user interface at all. Four E2E
 * harnesses have asserted this screen's `library-load-bundle` control since M5; none of them
 * had ever run, so nothing said it did not exist.
 *
 * `__test_bundle_path` is the harnesses' staging hook — the same `window.__x` override
 * convention the telemetry endpoint already uses (`hooks/useTelemetry.ts`). It only ADDS a row
 * and never hides what the directory really holds, and it is offered FIRST because every
 * harness clicks the first match.
 *
 * It is re-read on a timer rather than once on mount, because the harnesses do not agree on
 * when they set it: the M5, C.8 and M6 specs pass through `/consent` first, so the library
 * mounts after the flag exists — but A.10 sets it with the app already open on a returning
 * installation, and M6's second session does too. A single mount-time read would work for
 * some of them and silently play the wrong bundle, or nothing at all, for the others. The
 * poll reads a window property and performs no I/O; the directory itself is read once.
 */
const STAGED_POLL_MS = 250;

type Row = BundleEntry & { staged?: boolean };

function stagedBundlePath(): string | null {
  if (typeof window === "undefined") return null;
  const p = (window as unknown as { __test_bundle_path?: string }).__test_bundle_path;
  return typeof p === "string" && p.length > 0 ? p : null;
}

/** A staged path that is not in the bundles directory: named by its file, claiming nothing else. */
function stagedRow(path: string): Row {
  const name = path.split("/").pop() || path;
  return { path, bundle_id: name.replace(/\.zip$/, ""), title: name, n_scenes: 0, staged: true };
}

export default function LibraryScreen() {
  const navigate = useNavigate();
  const [installed, setInstalled] = useState<BundleEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<string | null>(stagedBundlePath);

  useEffect(() => {
    let live = true;
    tauri.listBundles().then(
      (listed) => {
        if (live) setInstalled(listed);
      },
      (e: unknown) => {
        // An empty library and a broken bridge look identical to a learner, and they need
        // different actions — so the failure is named rather than folded into "no lessons".
        if (live) setError((e as Error).message);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setStaged((prev) => stagedBundlePath() ?? prev), STAGED_POLL_MS);
    return () => clearInterval(t);
  }, []);

  // When the staged path is also on disk we already know its real title and scene count, so the
  // directory entry is hoisted rather than replaced by a synthesised one.
  const known = staged ? (installed ?? []).find((b) => b.path === staged) : undefined;
  const head: Row | null = staged ? (known ?? stagedRow(staged)) : null;
  const rows: Row[] | null =
    head === null
      ? installed
      : [head, ...(installed ?? []).filter((b) => b.path !== staged)];

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-3xl mx-auto">
        <header className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Bibliothèque</h1>
          <Link to="/settings" className="text-sm text-blue-600 underline">Réglages</Link>
        </header>

        {rows && rows.length > 0 ? (
          <ul className="space-y-4">
            {rows.map((b) => (
              <li key={b.path} className="bg-white shadow rounded-lg p-6 hover:shadow-md transition">
                <h2 className="text-xl font-semibold">{b.title}</h2>
                <p className="text-gray-600 mt-1">
                  {b.staged ? b.path : `${b.bundle_id} · ${b.n_scenes} scènes`}
                </p>
                <button
                  type="button"
                  data-testid="library-load-bundle"
                  data-bundle-path={b.path}
                  onClick={() =>
                    navigate(
                      `/lesson/${encodeURIComponent(b.bundle_id)}` +
                        `?bundle=${encodeURIComponent(b.path)}`,
                    )
                  }
                  className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white rounded"
                >
                  Démarrer la leçon
                </button>
              </li>
            ))}
          </ul>
        ) : error ? (
          <p className="text-red-600">Impossible de lire la bibliothèque : {error}</p>
        ) : rows === null ? (
          <p className="text-gray-500">Chargement de la bibliothèque…</p>
        ) : (
          <p className="text-gray-600">
            Aucune leçon installée. Déposez un bundle <code>.zip</code> dans le dossier des
            leçons (<code>STUDIUM_BUNDLES_DIR</code>) puis rouvrez cet écran.
          </p>
        )}
      </div>
    </main>
  );
}

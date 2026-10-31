import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { tauri, type BundleEntry } from "../lib/tauri";
import StudyShell from "../components/StudyShell";

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
  const [query, setQuery] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let live = true;
    setInstalled(null);
    setError(null);
    tauri.listBundles().then(
      (listed) => {
        if (live) setInstalled(listed);
      },
      (e: unknown) => {
        // An empty library and a broken bridge look identical to a learner, and they need
        // different actions — so the failure is named rather than folded into "no lessons".
        if (live) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
    };
  }, [reloadVersion]);

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

  const search = normalizeSearch(query.trim());
  const visible = rows?.filter((row) => normalizeSearch(`${row.title} ${row.bundle_id}`).includes(search));

  return (
    <StudyShell>
      <main className="library-page">
        <header className="library-intro">
          <div>
            <p className="eyebrow">Ta bibliothèque</p>
            <h1>Le temps de<br /><em>comprendre.</em></h1>
            <p className="intro-copy">Un concept à la fois. Choisis une leçon, explore les idées et mets-les en pratique.</p>
          </div>
          <div className="library-emblem" aria-hidden="true">
            <span className="emblem-axis" /><span className="emblem-orbit orbit-one" /><span className="emblem-orbit orbit-two" />
            <span className="emblem-core">S</span><span className="emblem-caption">L’apprentissage en mouvement</span>
          </div>
        </header>
        <div className="library-toolbar">
          <h2>Mes leçons <span className="count-badge" aria-label="Nombre de leçons">{rows?.length ?? "…"}</span></h2>
          <label className="search-field">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
            <input type="search" aria-label="Rechercher une leçon" placeholder="Rechercher une leçon…" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
        </div>
        {error && (
          <div role="alert" className="notice notice-error">
            <p>Impossible de lire la bibliothèque : {error}</p>
            <button className="button-secondary" onClick={() => setReloadVersion((version) => version + 1)}>Réessayer</button>
          </div>
        )}
        {visible && visible.length > 0 ? (
          <ul className="lesson-grid">
            {visible.map((b, index) => (
              <li key={b.path} className="lesson-card">
                <div className="lesson-card-art" aria-hidden="true"><span>{String(index + 1).padStart(2, "0")}</span><i /><i /><i /></div>
                <div className="lesson-card-body">
                  <p className="eyebrow">{b.staged ? "Leçon préparée" : `${b.n_scenes} scènes`}</p>
                  <h3>{b.title}</h3>
                  {b.staged && <p className="staged-path">{b.path}</p>}
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
                  className="button-primary lesson-start"
                  aria-label={`Démarrer la leçon : ${b.title}`}
                >
                  Démarrer la leçon <span aria-hidden="true">↗</span>
                </button>
                </div>
              </li>
            ))}
          </ul>
        ) : rows && rows.length > 0 ? (
          <div className="empty-state" role="status">
            <h3>Aucune leçon ne correspond à ta recherche.</h3>
            <button className="button-secondary" onClick={() => setQuery("")}>Effacer la recherche</button>
          </div>
        ) : error ? null : rows === null ? (
          <div className="empty-state" role="status">Chargement de la bibliothèque…</div>
        ) : (
          <div className="empty-state">
            <p className="eyebrow">Une place pour tes prochaines découvertes</p>
            <h3>Aucune leçon installée.</h3>
            <p>Les leçons installées sur cet appareil apparaîtront ici.</p>
            <details><summary>Comment ajouter une leçon ?</summary><p>Dépose un bundle <code>.zip</code> dans le dossier des leçons (<code>STUDIUM_BUNDLES_DIR</code>), puis actualise la bibliothèque.</p></details>
            <button className="button-secondary" onClick={() => setReloadVersion((version) => version + 1)}>Actualiser la bibliothèque</button>
          </div>
        )}
      </main>
    </StudyShell>
  );
}

function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
}

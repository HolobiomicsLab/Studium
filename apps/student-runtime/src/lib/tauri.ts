import { invoke } from "@tauri-apps/api/core";

export type ConsentRecord = {
  consent_id: string;
  level_a: boolean;
  level_b: boolean;
  level_c: boolean;
  granted_at: string;
};

/** One library row, as `list_bundles` describes it (INT-STUDIUM-034). Every field is read
 *  from the bundle's own `lesson.json`; `path` is what `loadBundle` is later handed. */
export type BundleEntry = {
  path: string;
  bundle_id: string;
  title: string;
  n_scenes: number;
};

/**
 * The bundle's `lesson.json`, parsed (INT-STUDIUM-034).
 *
 * `load_bundle` is `Result<String, String>` over `read_lesson_json`, which reads the entry out
 * of the zip as text, so what crosses the IPC is a JSON *string* — exactly like
 * `telemetry_outbox_drain`, whose consumer has always parsed each element
 * (`hooks/useTelemetry.ts`). `invoke<unknown>` said otherwise and the one caller handed the
 * result straight to a Zod object schema, so every bundle was "illisible" the moment a screen
 * finally offered one. The parse belongs here, once, rather than at each call site.
 */
async function loadBundle(path: string): Promise<unknown> {
  const text = await invoke<string>("load_bundle", { path });
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    // The bundle is named: a bare `Unexpected token` says nothing about which file the
    // learner clicked, and the library can offer several.
    throw new Error(
      `lesson.json de ${path} n'est pas du JSON valide (${(e as Error).message})`,
    );
  }
}

export const tauri = {
  loadBundle,
  listBundles:   (dir?: string)                      => invoke<BundleEntry[]>("list_bundles", { dir: dir ?? null }),
  getConsent:    ()                                  => invoke<ConsentRecord | null>("get_consent"),
  setConsent:    (record: ConsentRecord)             => invoke<void>("set_consent", { record }),
  saveState:     (lessonId: string, stateValue: unknown) => invoke<void>("save_state", { lessonId, stateValue }),
  loadState:     (lessonId: string)                  => invoke<unknown | null>("load_state", { lessonId }),
  appendEvent:   (event: object)                     => invoke<void>("append_event", { event }),
  getPseudonyme: (lessonId: string)                  => invoke<string>("get_pseudonyme", { lessonId }),
  deleteAllData: ()                                  => invoke<void>("delete_all_data"),
  telemetryOutboxPush:  (eventJson: string)          => invoke<void>("telemetry_outbox_push", { eventJson }),
  telemetryOutboxDrain: ()                            => invoke<string[]>("telemetry_outbox_drain"),
  telemetryOutboxCount: ()                            => invoke<number>("telemetry_outbox_count"),
};

export type JournalEntry = {
  id: number;
  scene_id: string;
  content_encrypted: string;
  created_at: string;
  updated_at: string;
  revision_index: number;
};

export const journalCreate = (scene_id: string, content: string): Promise<number> =>
  invoke("journal_create", { sceneId: scene_id, content });

export const journalUpdate = (entry_id: number, content: string): Promise<void> =>
  invoke("journal_update", { entryId: entry_id, content });

export const journalList = (scene_id?: string): Promise<JournalEntry[]> =>
  invoke("journal_list", { sceneId: scene_id ?? null });

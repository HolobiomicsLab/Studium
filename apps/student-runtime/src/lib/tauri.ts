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

export const tauri = {
  loadBundle:    (path: string)                      => invoke<unknown>("load_bundle", { path }),
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

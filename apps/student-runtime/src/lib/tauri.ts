import { invoke } from "@tauri-apps/api/core";

export type ConsentRecord = {
  consent_id: string;
  level_a: boolean;
  level_b: boolean;
  level_c: boolean;
  granted_at: string;
};

export const tauri = {
  loadBundle:    (path: string)                      => invoke<unknown>("load_bundle", { path }),
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

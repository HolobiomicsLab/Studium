// host-phrases.ts — the strings only the extension HOST shows (modal prompts, status bar, the Reviews
// node, URI and data-management messages). The webview's own strings live in phrases.ts; this table is
// separate so the two can evolve independently. Both catalogues are typed against the same key set, so a
// string added in one language and forgotten in the other fails the type-check (VSC-5), and every
// message is a real translation: no slash-bilingual labels, no French fallback in English.
import { frenchSpacing, type Locale, type PhraseParams } from "./phrases.js";

const FR = {
  // Reproduction confirmation (ENG-02)
  run_confirm_message: "Ce cours demande d'exécuter une commande sur ton ordinateur, dans ton dossier de travail. Studium ne la lance que si tu l'autorises.",
  run_confirm_detail: "Commande :\n{command}\n\nPaquets à installer : {packages}\n\nDossier d'exécution :\n{cwd}\n\nCapsule : {capsule}",
  run_confirm_none: "aucun",
  run_confirm_run: "Exécuter",
  run_confirm_trust: "Exécuter et faire confiance à ce cours",
  run_declined: "Studium : exécution annulée, rien n'a été lancé.",
  run_refused_absolute: "Studium : exécution refusée. Le dossier d'exécution demandé par le cours ({dir}) est un chemin absolu ; seuls les dossiers de ton espace de travail sont permis.",
  run_refused_parent: "Studium : exécution refusée. Le dossier d'exécution demandé par le cours ({dir}) sort de ton espace de travail (« .. »).",

  // Status bar and the Reviews node (VSC-6)
  status_idle: "Studium",
  status_due: "Studium · {count} à réviser",
  // H3 / I-3: relearn or unmeasured concepts are not « à réviser »; the tooltip names each group in its words.
  status_pending: "Studium · {count} à travailler",
  status_tooltip: "{groups}. Ouvre le panneau Studium.",
  status_tooltip_due: "{count} notions à réviser",
  status_tooltip_due_one: "1 notion à réviser",
  status_tooltip_relearn: "{count} notions à reprendre",
  status_tooltip_relearn_one: "1 notion à reprendre",
  status_tooltip_unmeasured: "{count} notions pas encore mesurées",
  status_tooltip_unmeasured_one: "1 notion pas encore mesurée",
  status_tooltip_idle: "Studium : rien à réviser pour l'instant. Ouvre le panneau Studium.",
  status_tooltip_lesson: "Leçon en cours. Ouvre le panneau Studium.",
  reviews_label: "Révisions",
  reviews_due: "{count} à réviser",
  reviews_none: "Rien à réviser pour l'instant",
  reviews_next: "Prochaine révision : {date}",
  // H3 / I-3: each group of the Reviews node in its own words (as the study plan names them).
  reviews_group_due: "à réviser",
  reviews_group_relearn: "à reprendre",
  reviews_group_unmeasured: "à revoir, pas encore mesurée",
  // « Réviser maintenant » when start_review_session has nothing to play: a notice in the pane, not an error.
  review_nothing_due: "Rien à réviser pour l'instant. Prochaine révision : {date}.",
  review_nothing_scheduled: "Rien à réviser pour l'instant : aucune révision n'est encore prévue.",
  review_unavailable: "La séance de révision n'a pas pu démarrer.",

  // Local data (ENG-03)
  forget_data_prompt: "Effacer les données d'apprentissage que cette extension garde dans VS Code : ta progression dans chaque leçon, ton profil d'apprenant·e, le calendrier des révisions de toutes tes leçons et les cours auxquels tu as fait confiance ? Cette action est irréversible. Les données Studium d'un assistant (Claude Code, Codex…) se trouvent dans {harness_data} : elles ne sont pas effacées.",
  forget_data_action: "Effacer mes données",
  forget_data_done: "Studium : les données de cette extension ont été effacées.",
  forget_data_failed: "Studium : effacement impossible — {error}",

  // Errors that used to be hard-coded English
  connect_failed_notification: "Studium : connexion à lesson-mcp impossible — {error}",
  community_scan_failed: "Studium : impossible de lister les contributions de la classe — {error}",

  // Opening a lesson from a link or a file (VSC-7)
  uri_missing_bundle: "Studium : ce lien ne désigne aucune leçon (paramètre « bundle » absent).",
  uri_not_absolute: "Studium : le chemin de la leçon doit être absolu — {path}",
  uri_not_lesson: "Studium : « {path} » n'est pas un fichier de leçon (.json).",
  uri_not_found: "Studium : fichier de leçon introuvable — {path}",
  open_this_no_file: "Studium : choisis un fichier de leçon (lesson.json) à ouvrir.",
};

export type HostPhraseKey = keyof typeof FR;

const EN: Record<HostPhraseKey, string> = {
  run_confirm_message: "This course asks to run a command on your computer, in your workspace folder. Studium only starts it if you allow it.",
  run_confirm_detail: "Command:\n{command}\n\nPackages to install: {packages}\n\nRun folder:\n{cwd}\n\nCapsule: {capsule}",
  run_confirm_none: "none",
  run_confirm_run: "Run",
  run_confirm_trust: "Run and trust this course",
  run_declined: "Studium: run cancelled, nothing was started.",
  run_refused_absolute: "Studium: run refused. The run folder the course asks for ({dir}) is an absolute path; only folders inside your workspace are allowed.",
  run_refused_parent: "Studium: run refused. The run folder the course asks for ({dir}) leaves your workspace (“..”).",

  status_idle: "Studium",
  status_due: "Studium · {count} to review",
  status_pending: "Studium · {count} to work on",
  status_tooltip: "{groups}. Open the Studium panel.",
  status_tooltip_due: "{count} concepts to review",
  status_tooltip_due_one: "1 concept to review",
  status_tooltip_relearn: "{count} concepts to take up again",
  status_tooltip_relearn_one: "1 concept to take up again",
  status_tooltip_unmeasured: "{count} concepts not measured yet",
  status_tooltip_unmeasured_one: "1 concept not measured yet",
  status_tooltip_idle: "Studium: nothing to review right now. Open the Studium panel.",
  status_tooltip_lesson: "Lesson in progress. Open the Studium panel.",
  reviews_label: "Reviews",
  reviews_due: "{count} to review",
  reviews_none: "Nothing to review right now",
  reviews_next: "Next review: {date}",
  reviews_group_due: "to review",
  reviews_group_relearn: "to take up again",
  reviews_group_unmeasured: "to revisit, not measured yet",
  review_nothing_due: "Nothing to review right now. Next review: {date}.",
  review_nothing_scheduled: "Nothing to review right now: no review is scheduled yet.",
  review_unavailable: "The review session could not start.",

  forget_data_prompt: "Erase the learning data this extension keeps in VS Code: your progress in each lesson, your learner profile, the reviews of all your lessons and the courses you chose to trust? This cannot be undone. The Studium data of an assistant (Claude Code, Codex…) lives in {harness_data}: it is not erased.",
  forget_data_action: "Erase my data",
  forget_data_done: "Studium: this extension's data has been erased.",
  forget_data_failed: "Studium: could not erase the data — {error}",

  connect_failed_notification: "Studium: could not connect to lesson-mcp — {error}",
  community_scan_failed: "Studium: could not list the community contributions — {error}",

  uri_missing_bundle: "Studium: this link does not name a lesson (the “bundle” parameter is missing).",
  uri_not_absolute: "Studium: the lesson path must be absolute — {path}",
  uri_not_lesson: "Studium: “{path}” is not a lesson file (.json).",
  uri_not_found: "Studium: lesson file not found — {path}",
  open_this_no_file: "Studium: choose a lesson file (lesson.json) to open.",
};

// UX-12: the French catalogue is typeset like the pane's (phrases.ts frenchSpacing), since some of these lines are
// shown in the pane's status line.
const FR_TYPESET = Object.fromEntries(Object.entries(FR).map(([key, text]) => [key, frenchSpacing(text)])) as Record<HostPhraseKey, string>;

export const HOST_CATALOGUES: Record<Locale, Record<HostPhraseKey, string>> = { fr: FR_TYPESET, en: EN };

/** Look up a host-side message and fill its `{name}` placeholders; an unknown placeholder is left as written. */
export function hostPhrase(key: HostPhraseKey, params: PhraseParams = {}, locale: Locale = "fr"): string {
  return HOST_CATALOGUES[locale][key].replace(/\{([a-z_]+)\}/gi, (token, name: string) => {
    const value = params[name];
    return value === undefined ? token : String(value);
  });
}

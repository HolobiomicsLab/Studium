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
  // BN-4: from prepare_sources until the lesson lands (or 20 minutes), ahead of the review count.
  status_preparing: "$(loading~spin) Studium · leçon en préparation…",
  status_tooltip_preparing: "Ton assistant prépare une leçon à partir de « {source} ».",
  status_tooltip_preparing_untitled: "Ton assistant prépare une leçon.",
  status_tooltip_preparing_wait: "Cela prend en général quelques minutes ; VS Code te prévient quand elle est prête. Si l'assistant te demande dans le chat d'autoriser une étape, réponds-lui là. S'il s'est arrêté, la leçon ne viendra peut-être pas.",
  // BN-1: a lesson the assistant wrote into the library is announced once.
  lesson_ready: "Studium : ta leçon « {title} » est prête ({steps} étapes).",
  lesson_ready_one: "Studium : ta leçon « {title} » est prête (1 étape).",
  lesson_ready_open: "Ouvrir",
  lesson_ready_later: "Plus tard",
  lesson_ready_never: "Ne plus afficher",
  // Review finding 2: lessons that land together share one notice; « Afficher » opens the Lessons view.
  lessons_ready: "Studium : {count} leçons sont prêtes : {titles}.",
  lessons_ready_more: "Studium : {count} leçons sont prêtes, dont {titles}.",
  lessons_ready_title: "« {title} »",
  lessons_ready_show: "Afficher",
  // BN-7: the lesson in progress, offered in the status bar (when nothing is due) and first in the Lessons view.
  status_continue: "Studium · reprendre {title}",
  status_tooltip_continue: "Reprendre « {title} » à l'étape {step} sur {total}. Clique pour l'ouvrir.",
  continue_minutes_left: "Environ {minutes} min restantes.",
  continue_scope: "C'est la progression que VS Code garde pour toi (panneau Studium, @studium, et Copilot avec le serveur Studium que propose cette extension) ; les leçons jouées avec un autre assistant ou un serveur Studium ajouté à la main n'y sont pas.",
  tree_continue: "Reprendre : {title}",
  tree_continue_step: "étape {step}/{total}",
  tree_continue_minutes: "environ {minutes} min",
  tree_done: "terminée",
  reviews_label: "Révisions",
  reviews_due: "{count} à réviser",
  reviews_none: "Rien à réviser pour l'instant",
  // Approval state of a course in the picker and the tree (read from approval.json, never from validated_by).
  approval_by: "validée par {reviewer}",
  approval_changed: "modifiée depuis sa validation",
  approval_none: "aucune approbation enregistrée",
  // The demo lesson shipped with Studium (2026-11-25)
  demo_pick_label: "$(mortar-board) Découvrir Studium — leçon de démonstration",
  demo_pick_description: "livrée avec Studium · une dizaine de minutes",
  demo_pick_detail: "Rédigée par l'IA à partir de la documentation de Studium, non vérifiée par un enseignant. Elle reste à part de tes cours.",
  demo_missing: "Studium : la leçon de démonstration est introuvable ({path}). Réinstalle l'extension.",
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
  // Review finding 7: a link opens a lesson only from the library, studium.bundlesRoot or the lessons shipped with Studium.
  uri_outside_lessons: "Studium : « {path} » n'est pas dans tes leçons (ta bibliothèque, le dossier de studium.bundlesRoot ou les leçons livrées avec Studium) : un lien ne l'ouvre pas. Pour l'ouvrir quand même, fais un clic droit sur le fichier et choisis Studium : Ouvrir cette leçon.",
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
  status_preparing: "$(loading~spin) Studium · preparing a lesson…",
  status_tooltip_preparing: "Your assistant is preparing a lesson from “{source}”.",
  status_tooltip_preparing_untitled: "Your assistant is preparing a lesson.",
  status_tooltip_preparing_wait: "It usually takes a few minutes; VS Code tells you when it is ready. If the assistant asks you in the chat to allow a step, answer it there. If the assistant has stopped, the lesson may not come.",
  lesson_ready: "Studium: your lesson “{title}” is ready ({steps} steps).",
  lesson_ready_one: "Studium: your lesson “{title}” is ready (1 step).",
  lesson_ready_open: "Open",
  lesson_ready_later: "Later",
  lesson_ready_never: "Don't show again",
  lessons_ready: "Studium: {count} lessons are ready: {titles}.",
  lessons_ready_more: "Studium: {count} lessons are ready, including {titles}.",
  lessons_ready_title: "“{title}”",
  lessons_ready_show: "Show",
  status_continue: "Studium · continue {title}",
  status_tooltip_continue: "Continue “{title}” at step {step} of {total}. Click to open it.",
  continue_minutes_left: "About {minutes} min left.",
  continue_scope: "This is the progress VS Code keeps for you (Studium pane, @studium, and Copilot with the Studium server this extension offers); lessons played with another assistant or a Studium server added by hand are not in it.",
  tree_continue: "Continue: {title}",
  tree_continue_step: "step {step}/{total}",
  tree_continue_minutes: "about {minutes} min",
  tree_done: "done",
  reviews_label: "Reviews",
  reviews_due: "{count} to review",
  reviews_none: "Nothing to review right now",
  approval_by: "validated by {reviewer}",
  approval_changed: "changed since its approval",
  approval_none: "no approval recorded",
  // The demo lesson shipped with Studium (2026-11-25)
  demo_pick_label: "$(mortar-board) Discover Studium — demo lesson",
  demo_pick_description: "shipped with Studium · about ten minutes",
  demo_pick_detail: "Drafted by an AI agent from Studium's documentation, not checked by a teacher. It stays apart from your courses.",
  demo_missing: "Studium: the demo lesson is missing ({path}). Reinstall the extension.",
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
  uri_outside_lessons: "Studium: “{path}” is not among your lessons (your library, the studium.bundlesRoot folder or the lessons shipped with Studium), so a link does not open it. To open it anyway, right-click the file and choose Studium: Open this lesson.",
  open_this_no_file: "Studium: choose a lesson file (lesson.json) to open.",
};

// UX-12: the French catalogue is typeset like the pane's (phrases.ts frenchSpacing), since some of these lines are
// shown in the pane's status line.
const FR_TYPESET = Object.fromEntries(Object.entries(FR).map(([key, text]) => [key, frenchSpacing(text)])) as Record<HostPhraseKey, string>;

export const HOST_CATALOGUES: Record<Locale, Record<HostPhraseKey, string>> = { fr: FR_TYPESET, en: EN };

/** BN-1: the text of a lesson-ready notice. One lesson: its title and steps. Several, that landed together: how many,
 * and the titles of the first three. */
export function lessonReadyMessage(lessons: readonly { title: string; steps: number }[], locale: Locale): string {
  const [first] = lessons;
  if (lessons.length <= 1) {
    const title = first?.title ?? "";
    return first?.steps === 1 ? hostPhrase("lesson_ready_one", { title }, locale) : hostPhrase("lesson_ready", { title, steps: first?.steps ?? 0 }, locale);
  }
  const titles = lessons.slice(0, 3).map(({ title }) => hostPhrase("lessons_ready_title", { title }, locale)).join(", ");
  return hostPhrase(lessons.length > 3 ? "lessons_ready_more" : "lessons_ready", { count: lessons.length, titles }, locale);
}

/** Look up a host-side message and fill its `{name}` placeholders; an unknown placeholder is left as written. */
export function hostPhrase(key: HostPhraseKey, params: PhraseParams = {}, locale: Locale = "fr"): string {
  return HOST_CATALOGUES[locale][key].replace(/\{([a-z_]+)\}/gi, (token, name: string) => {
    const value = params[name];
    return value === undefined ? token : String(value);
  });
}

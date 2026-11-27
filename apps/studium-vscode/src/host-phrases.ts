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
  lesson_ready_opened: "Elle est ouverte dans le panneau Studium.",
  lesson_ready_stop_opening: "Ne plus ouvrir toute seule",
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
  demo_pick_description: "livrée avec Studium · environ douze minutes",
  demo_pick_detail: "Rédigée par l'IA à partir de la documentation de Studium. Elle reste à part de tes cours.",
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

  // Route A, lot 1 (plan 2026-11-27-moodle-etagere): « Importer une leçon… », a .studium.zip downloaded from a course page.
  import_dialog_title: "Studium : Importer un fichier de leçon",
  import_dialog_open: "Importer",
  import_dialog_filter: "Fichier de leçon Studium",
  import_confirm_message: "Importer la leçon « {title} » dans ta bibliothèque ?",
  import_confirm_steps: "{steps} étapes.",
  import_confirm_steps_one: "1 étape.",
  import_confirm_approved: "Approbation enregistrée dans le fichier (un relevé, pas une signature) : validée par {reviewer} le {date}.",
  import_confirm_approved_undated: "Approbation enregistrée dans le fichier (un relevé, pas une signature) : validée par {reviewer}.",
  import_confirm_changed: "Une approbation est enregistrée, mais la leçon a changé depuis : ce n'est pas la leçon qui a été validée.",
  import_confirm_none: "Aucune approbation n'est enregistrée pour cette leçon.",
  import_confirm_fingerprint: "Empreinte de la leçon : {fingerprint}.",
  import_confirm_ignored: "{count} fichiers de l'archive ne font pas partie de la leçon : ils ne seront pas copiés.",
  import_confirm_ignored_one: "1 fichier de l'archive ne fait pas partie de la leçon : il ne sera pas copié.",
  import_confirm_action: "Importer",
  import_conflict_message: "Une autre leçon portant le même identifiant ({bundle_id}) est déjà dans ta bibliothèque.",
  import_conflict_detail: "Remplacer supprime les fichiers du dossier {bundle_id} de ta bibliothèque et y met « {title} » ; les contributions de la classe, dans son dossier community/, sont gardées. Ta progression est gardée : elle est enregistrée sous l'identifiant de la leçon, pas sous son contenu, et la nouvelle version la reprend. Les étapes qu'elle partage avec l'ancienne restent faites ; si tu avais terminé l'ancienne, la nouvelle est marquée terminée. Annuler ne change rien.",
  import_conflict_detail_no_community: "Remplacer supprime les fichiers du dossier {bundle_id} de ta bibliothèque et y met « {title} ». Ta progression est gardée : elle est enregistrée sous l'identifiant de la leçon, pas sous son contenu, et la nouvelle version la reprend. Les étapes qu'elle partage avec l'ancienne restent faites ; si tu avais terminé l'ancienne, la nouvelle est marquée terminée. Annuler ne change rien.",
  import_conflict_message_no_lesson: "Un dossier nommé {bundle_id} est déjà dans ta bibliothèque et ne contient aucune leçon lisible.",
  import_conflict_detail_no_lesson: "Remplacer supprime ce que contient ce dossier, sauf son dossier community/ (les contributions de la classe), et y met « {title} ». Une progression enregistrée sous cet identifiant, s'il y en a une, est gardée et la nouvelle leçon la reprend. Annuler ne change rien.",
  import_conflict_detail_no_lesson_no_community: "Remplacer supprime ce que contient ce dossier et y met « {title} ». Une progression enregistrée sous cet identifiant, s'il y en a une, est gardée et la nouvelle leçon la reprend. Annuler ne change rien.",
  import_conflict_replace: "Remplacer",
  import_already_present: "Studium : « {title} » était déjà dans ta bibliothèque ; elle est ouverte.",
  import_refreshed: "Studium : « {title} » était déjà dans ta bibliothèque ; son relevé d'approbation ou ses figures ont été mis à jour. Elle est ouverte.",
  import_failed: "Studium : impossible d'importer ce fichier — {error}",
  import_error_not_zip: "Studium : ce fichier n'est pas une archive de leçon lisible ; rien n'a été écrit. Télécharge à nouveau le fichier .studium.zip depuis la page du cours.",
  import_error_unsupported_zip: "Studium : cette archive utilise un format zip que Studium ne lit pas (zip64, chiffrement ou compression inhabituelle) ; rien n'a été écrit. Demande à ton enseignant de refaire le fichier avec Studium.",
  import_error_unsafe_member: "Studium : cette archive contient un chemin dangereux ({member}) ; rien n'a été écrit. Demande un nouveau fichier à ton enseignant.",
  import_error_duplicate_member: "Studium : cette archive contient deux fois le même fichier ({member}) ; rien n'a été écrit. Demande un nouveau fichier à ton enseignant.",
  import_error_too_many_members: "Studium : cette archive contient plus de 2000 fichiers ; rien n'a été écrit. Demande un fichier plus léger à ton enseignant.",
  import_error_too_large: "Studium : cette archive, ou l'un de ses fichiers, dépasse la taille permise (50 Mo par fichier, 200 Mo en tout) ; rien n'a été écrit. Demande un fichier plus léger à ton enseignant.",
  import_error_missing_lesson: "Studium : cette archive ne contient pas de lesson.json, ce n'est pas un fichier de leçon Studium ; rien n'a été écrit. Vérifie que tu as téléchargé le bon fichier.",
  import_error_invalid_lesson: "Studium : la leçon de cette archive n'est pas valide ({error}) ; rien n'a été écrit. Signale-le à ton enseignant.",
  import_error_bad_bundle_id: "Studium : l'identifiant de cette leçon (bundle_id) ne peut pas servir de nom de dossier ; rien n'a été écrit. Signale-le à ton enseignant.",
  import_error_changed_since_check: "Studium : le fichier de leçon a changé après ta confirmation ; rien n'a été écrit. Importe-le à nouveau.",
  import_error_folder_taken: "Studium : ta bibliothèque a déjà un dossier « {member} » dont le nom ne diffère de l'identifiant de cette leçon que par la casse ou les accents ; rien n'a été écrit. Renomme ou déplace ce dossier, puis importe à nouveau.",
  import_error_write_failed: "Studium : la leçon n'a pas pu être écrite dans ta bibliothèque ({code}) ; rien n'a été changé. Vérifie l'espace libre et les droits de ton dossier Studium, puis importe à nouveau.",
  import_error_restore_failed: "Studium : la nouvelle leçon n'a pas pu prendre la place de l'ancienne, et l'ancienne n'a pas pu être remise ({code}). L'ancienne leçon et ses contributions sont gardées dans le dossier {path} (sous-dossiers previous et new) : remets-les dans ta bibliothèque.",
  picker_import_label: "$(file-zip) Importer un fichier de leçon…",
  picker_import_description: "un fichier .studium.zip, par exemple téléchargé depuis la page d'un cours",
  picker_import_detail: "La leçon est copiée dans ta bibliothèque Studium et se joue sur ton ordinateur.",
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
  lesson_ready_opened: "It is open in the Studium pane.",
  lesson_ready_stop_opening: "Don't open lessons by themselves",
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
  demo_pick_description: "shipped with Studium · about twelve minutes",
  demo_pick_detail: "Drafted by an AI agent from Studium's documentation. It stays apart from your courses.",
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

  import_dialog_title: "Studium: Import a lesson file",
  import_dialog_open: "Import",
  import_dialog_filter: "Studium lesson file",
  import_confirm_message: "Import the lesson “{title}” into your library?",
  import_confirm_steps: "{steps} steps.",
  import_confirm_steps_one: "1 step.",
  import_confirm_approved: "Approval recorded in the file (a record, not a signature): validated by {reviewer} on {date}.",
  import_confirm_approved_undated: "Approval recorded in the file (a record, not a signature): validated by {reviewer}.",
  import_confirm_changed: "An approval is recorded, but the lesson changed since: this is not the lesson that was validated.",
  import_confirm_none: "No approval is recorded for this lesson.",
  import_confirm_fingerprint: "Lesson fingerprint: {fingerprint}.",
  import_confirm_ignored: "{count} files of the archive are not part of the lesson: they will not be copied.",
  import_confirm_ignored_one: "1 file of the archive is not part of the lesson: it will not be copied.",
  import_confirm_action: "Import",
  import_conflict_message: "A different lesson with the same identifier ({bundle_id}) is already in your library.",
  import_conflict_detail: "Replacing deletes the files in the {bundle_id} folder of your library and puts “{title}” there; the class contributions in its community/ folder are kept. Your progress is kept: it is saved under the lesson's identifier, not its content, and the new version takes it up. The steps it shares with the old one stay done; if you had finished the old one, the new one is marked finished. Cancel changes nothing.",
  import_conflict_detail_no_community: "Replacing deletes the files in the {bundle_id} folder of your library and puts “{title}” there. Your progress is kept: it is saved under the lesson's identifier, not its content, and the new version takes it up. The steps it shares with the old one stay done; if you had finished the old one, the new one is marked finished. Cancel changes nothing.",
  import_conflict_message_no_lesson: "A folder named {bundle_id} is already in your library and holds no readable lesson.",
  import_conflict_detail_no_lesson: "Replacing deletes what this folder holds, except its community/ folder (the class contributions), and puts “{title}” there. Progress saved under this identifier, if there is any, is kept and the new lesson takes it up. Cancel changes nothing.",
  import_conflict_detail_no_lesson_no_community: "Replacing deletes what this folder holds and puts “{title}” there. Progress saved under this identifier, if there is any, is kept and the new lesson takes it up. Cancel changes nothing.",
  import_conflict_replace: "Replace",
  import_already_present: "Studium: “{title}” was already in your library; it is open.",
  import_refreshed: "Studium: “{title}” was already in your library; its approval record or figures were updated. It is open.",
  import_failed: "Studium: could not import this file — {error}",
  import_error_not_zip: "Studium: this file is not a readable lesson archive; nothing was written. Download the .studium.zip file from the course page again.",
  import_error_unsupported_zip: "Studium: this archive uses a zip format Studium does not read (zip64, encryption or an unusual compression); nothing was written. Ask your teacher to make the file again with Studium.",
  import_error_unsafe_member: "Studium: this archive holds an unsafe path ({member}); nothing was written. Ask your teacher for a new file.",
  import_error_duplicate_member: "Studium: this archive holds the same file twice ({member}); nothing was written. Ask your teacher for a new file.",
  import_error_too_many_members: "Studium: this archive holds more than 2000 files; nothing was written. Ask your teacher for a lighter file.",
  import_error_too_large: "Studium: this archive, or one of its files, is over the allowed size (50 MB a file, 200 MB in all); nothing was written. Ask your teacher for a lighter file.",
  import_error_missing_lesson: "Studium: this archive holds no lesson.json, so it is not a Studium lesson file; nothing was written. Check that you downloaded the right file.",
  import_error_invalid_lesson: "Studium: the lesson in this archive is not valid ({error}); nothing was written. Tell your teacher.",
  import_error_bad_bundle_id: "Studium: this lesson's identifier (bundle_id) cannot name a folder; nothing was written. Tell your teacher.",
  import_error_changed_since_check: "Studium: the lesson file changed after you confirmed it; nothing was written. Import it again.",
  import_error_folder_taken: "Studium: your library already has a folder “{member}” whose name differs from this lesson's identifier only by case or accents; nothing was written. Rename or move that folder, then import again.",
  import_error_write_failed: "Studium: the lesson could not be written into your library ({code}); nothing was changed. Check the free space and the permissions of your Studium folder, then import again.",
  import_error_restore_failed: "Studium: the new lesson could not take the old one's place, and the old one could not be put back ({code}). The old lesson and its contributions are kept in the folder {path} (subfolders previous and new): move them back into your library.",
  picker_import_label: "$(file-zip) Import a lesson file…",
  picker_import_description: "a .studium.zip file, downloaded from a course page for instance",
  picker_import_detail: "The lesson is copied into your Studium library and plays on your computer.",
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

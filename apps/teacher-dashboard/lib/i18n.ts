export type Locale = "fr" | "en";

/** Cookie wins; otherwise honour language quality weights and regional tags. */
export function detectLocale(cookie: string | undefined, acceptLanguage = ""): Locale {
  if (cookie === "fr" || cookie === "en") return cookie;
  const languages = acceptLanguage.split(",").map((part, index) => {
    const [tag, ...parameters] = part.trim().toLowerCase().split(";");
    const quality = parameters.find((p) => p.trim().startsWith("q="));
    return { language: tag.split("-")[0], quality: quality ? Number(quality.trim().slice(2)) : 1, index };
  }).filter((entry) => entry.quality > 0 && entry.quality <= 1).sort((a, b) => b.quality - a.quality || a.index - b.index);
  return languages.find((entry) => entry.language === "en" || entry.language === "fr")?.language as Locale | undefined ?? "fr";
}

const fr = {
  teacherSpace: "Espace enseignant", home: "Accueil", library: "Bibliothèque de cours", room: "Salle pair-à-pair",
  navigation: "Navigation principale", skip: "Aller au contenu", appearance: "Affichage", language: "Langue",
  theme: "Thème", system: "Système", light: "Clair", dark: "Sombre", apply: "Appliquer",
  libraryEyebrow: "Préparer · relire · accompagner", libraryTitle: "Vos cours, à portée de regard.",
  libraryLead: "Retrouvez les leçons de votre bibliothèque, examinez leur parcours et préparez leur relecture avant toute diffusion.",
  courseCount: "cours", checkedCount: "vérifiés", approvedCount: "approuvés", lessons: "Leçons disponibles",
  libraryLocal: "Bibliothèque locale", review: "Relire", followClass: "Suivre la classe", sceneOne: "scène", scenes: "scènes", conceptOne: "concept", concepts: "concepts",
  minutes: "min", authoring: "Autorat", teacher: "Enseignant", selfStudy: "Auto-apprentissage", unknown: "Non renseigné",
  draft: "Brouillon", checked: "Vérifié", approved: "Approuvé", status: "Statut", colon: "\u00a0: ",
  ungraded: "Sans notation", author_keyed: "Clé d’auteur", production: "Production", externally_grounded: "Résultat externe",
  keyClasses: "Origine des clés", statusHelp: "Vérifié : schéma valide et aucun TODO. Approuvé : reçu humain correspondant aux octets actuels de la leçon. La vérification technique ne vaut pas approbation pédagogique.",
  noLessons: "Aucune leçon dans cette bibliothèque.", noLessonsHelp: "Ajoutez un dossier contenant lesson.json à votre bibliothèque locale, puis actualisez cette page. BUNDLES_ROOT permet de choisir un autre dossier.",
  libraryError: "Bibliothèque indisponible", libraryErrorHelp: "Le tableau de bord ne peut pas lire la bibliothèque. Vérifiez BUNDLES_ROOT (par défaut STUDIUM_HOME/library, ou ~/.studium/library), créez ce dossier si nécessaire et donnez au serveur le droit de le lire, puis actualisez.",
  unreadable: "Dossiers à vérifier", unreadableHelp: "Ces dossiers sont illisibles, contiennent un JSON invalide ou dépassent les limites de lecture. Vérifiez lesson.json et les permissions.",
  backLibrary: "Retour à la bibliothèque", reviewEyebrow: "Relecture pédagogique", reviewLead: "Un aperçu du parcours, de ses concepts et de ses sources pour préparer votre décision.",
  outline: "Parcours de la leçon", outlineHelp: "Titres, types de scènes et références. Les corrigés et les extraits qui peuvent révéler une réponse restent hors de cet aperçu.",
  sources: "Sources", noSources: "Aucune source renseignée", noConcepts: "Aucun concept associé", remaining: "TODO restants",
  schemaIssues: "Points de schéma à corriger", reviewReadiness: "Avant de partager", approvalHeading: "Enregistrer votre approbation",
  approvalHelp: "Après relecture, lancez cette commande depuis la racine du dépôt. Remplacez VOTRE NOM. Elle vérifie les TODO et le lint puis lie votre décision au fichier actuel.",
  approvalNotice: "Cette page reste en lecture seule. L’approbation ne diffuse pas la leçon aux étudiants.",
  approvalRecorded: "Approbation enregistrée", reviewer: "Relecture par", reviewedAt: "Date", staleApproval: "Le reçu est incomplet ou ne correspond plus à cette leçon. Une nouvelle relecture est nécessaire.",
  noApproval: "Aucune approbation correspondant au fichier actuel.", selfStudyApproval: "Les leçons d’auto-apprentissage restent signalées comme telles. La commande approve refuse ce mode.",
  mystra: "Ouvrir la vue MySTRA", observatory: "Ouvrir l’Observatoire", observatoryUnavailable: "MySTRA indisponible : démarrez l’Observatoire sur le port 8004 (ou configurez OBSERVATORY_BASE_URL), puis actualisez.",
  observatoryMissing: "L’Observatoire répond, mais aucun rapport MySTRA n’est enregistré sous le nom de ce dossier. Ajoutez le dossier du cours à STUDIUM_OBS_COURSES.",
  print: "Imprimer / PDF", sceneType: "Type de scène", lessonMissing: "Leçon introuvable", lessonMissingHelp: "Le fichier a peut-être été déplacé. Revenez à la bibliothèque pour choisir une leçon disponible.",
  lessonUnreadable: "Leçon illisible", lessonUnreadableHelp: "Le tableau de bord ne peut pas lire cette leçon. Vérifiez la syntaxe de lesson.json, sa taille (10 Mo maximum) et les permissions du dossier. Les liens symboliques ne sont pas acceptés dans la bibliothèque.",
  intro: "Introduction", concept: "Concept", quiz: "Quiz", meta_checkpoint: "Point d’étape", reproduction: "Reproduction", ai_critique: "Critique de l’IA", discussion: "Discussion", spot_the_flaw: "Repérer le défaut", explain_back: "Expliquer", comparison: "Comparaison", summary_audit: "Audit de résumé", prompt_practice: "Pratique du prompt", communication_sim: "Mise en situation",
};
const en: typeof fr = {
  teacherSpace: "Teacher workspace", home: "Home", library: "Course library", room: "Peer-review room",
  navigation: "Main navigation", skip: "Skip to content", appearance: "Appearance", language: "Language",
  theme: "Theme", system: "System", light: "Light", dark: "Dark", apply: "Apply",
  libraryEyebrow: "Prepare · review · support", libraryTitle: "Your courses, at a glance.",
  libraryLead: "Find lessons in your library, explore their learning paths and prepare your review before sharing them.",
  courseCount: "courses", checkedCount: "checked", approvedCount: "approved", lessons: "Available lessons",
  libraryLocal: "Local library", review: "Review", followClass: "Class overview", sceneOne: "scene", scenes: "scenes", conceptOne: "concept", concepts: "concepts",
  minutes: "min", authoring: "Authoring", teacher: "Teacher", selfStudy: "Self-study", unknown: "Not specified",
  draft: "Draft", checked: "Checked", approved: "Approved", status: "Status", colon: ": ",
  ungraded: "Ungraded", author_keyed: "Author key", production: "Production", externally_grounded: "External result",
  keyClasses: "Key provenance", statusHelp: "Checked: valid schema and no TODOs. Approved: a human receipt matches the current lesson bytes. Technical checks are not pedagogical approval.",
  noLessons: "No lessons in this library yet.", noLessonsHelp: "Add a folder containing lesson.json to your local library, then refresh this page. Set BUNDLES_ROOT to choose a different folder.",
  libraryError: "Library unavailable", libraryErrorHelp: "The dashboard cannot read the library. Check BUNDLES_ROOT (defaults to STUDIUM_HOME/library, or ~/.studium/library), create the folder if needed and give the server permission to read it, then refresh.",
  unreadable: "Folders to check", unreadableHelp: "These folders are unreadable, contain invalid JSON or exceed the reading limits. Check lesson.json and the permissions.",
  backLibrary: "Back to library", reviewEyebrow: "Lesson review", reviewLead: "An overview of the learning path, concepts and sources to inform your decision.",
  outline: "Lesson outline", outlineHelp: "Titles, scene types and references. Answer keys and excerpts that may reveal an answer stay outside this overview.",
  sources: "Sources", noSources: "No source recorded", noConcepts: "No linked concept", remaining: "TODOs remaining",
  schemaIssues: "Schema issues to fix", reviewReadiness: "Before sharing", approvalHeading: "Record your approval",
  approvalHelp: "After reviewing, run this command from the repository root. Replace YOUR NAME. It checks TODOs and lint, then binds your decision to the current file.",
  approvalNotice: "This page is read-only. Approval does not distribute the lesson to students.",
  approvalRecorded: "Approval recorded", reviewer: "Reviewed by", reviewedAt: "Date", staleApproval: "The receipt is incomplete or no longer matches this lesson. A new review is needed.",
  noApproval: "No approval matches the current file.", selfStudyApproval: "Self-study lessons keep their authoring notice. The approve command refuses this mode.",
  mystra: "Open MySTRA view", observatory: "Open Observatory", observatoryUnavailable: "MySTRA unavailable: start Observatory on port 8004 (or configure OBSERVATORY_BASE_URL), then refresh.",
  observatoryMissing: "Observatory is running, but no MySTRA report is registered under this folder name. Add the course folder to STUDIUM_OBS_COURSES.",
  print: "Print / PDF", sceneType: "Scene type", lessonMissing: "Lesson not found", lessonMissingHelp: "The file may have moved. Return to the library to choose an available lesson.",
  lessonUnreadable: "Lesson unreadable", lessonUnreadableHelp: "The dashboard cannot read this lesson. Check the syntax of lesson.json, its size (10 MB maximum) and the folder permissions. Symbolic links are not accepted inside the library.",
  intro: "Introduction", concept: "Concept", quiz: "Quiz", meta_checkpoint: "Checkpoint", reproduction: "Reproduction", ai_critique: "AI critique", discussion: "Discussion", spot_the_flaw: "Spot the flaw", explain_back: "Explain back", comparison: "Comparison", summary_audit: "Summary audit", prompt_practice: "Prompt practice", communication_sim: "Communication scenario",
};
export function messages(locale: Locale) { return locale === "en" ? en : fr; }
/** "1 concept", "8 concepts": French keeps the singular for 0 and 1, English only for 1. */
export function counted(n: number, one: string, many: string, locale: Locale): string {
  const singular = locale === "fr" ? n <= 1 : n === 1;
  return `${n} ${singular ? one : many}`;
}
export function sceneTypeLabel(type: string, locale: Locale): string { return messages(locale)[type as keyof typeof fr] ?? type; }

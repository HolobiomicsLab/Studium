# AGENT_LOG — prototype-build

> Moved from `AGENT_LOG.md` at the repository root. Maintainer and agent journal: add an entry at each significant commit.

Journal des unités TDD par milestone. Mis à jour à chaque commit significatif.

---

## 2026-10-30 (matin) — lot « apprenant autonome » : une leçon depuis ses propres références

Demande propriétaire : « Oui, lot autonome. Fais les choses bien. » après le constat qu'un étudiant
sans enseignant pouvait techniquement construire une leçon mais que rien ne le cadrait (rapport
vague 3 §11, spec `studium_dev/docs/superpowers/specs/2026-10-30-lot-apprenant-autonome.md`).
Quatre sous-agents Claude (Opus) sur des fichiers disjoints, intégration et vérification par le
lead ; un rejeu réel par un agent suivant le skill (Durkheim, Wikisource) a relevé 18 constats, six
corrigés dans la foulée ; non commité.

- **Schéma (lead).** LessonBundle 1.4 gagne `metadata.authoring = {mode: teacher|self_study,
  author_is_learner, note?}` (optionnel, absent = enseignant, pas de bump de version) : Zod
  `packages/lesson-bundle-schema/src/index.ts` + miroir Pydantic ; tests `authoring.test.ts` (nouveau)
  et `tests_python/test_lesson_bundle_schema.py`.
- **scene-synth (S1, V4).** Plus de verrou `atomistique-l1` : `BUNDLES_ROOT` (défaut
  `<repo>/fixtures`), `course_id` validé `^[a-z0-9][a-z0-9._-]{0,63}$` (400 sinon), cours canonique
  `<root>/<course>/lesson.json` (404 sinon), émission `<root>/<course>/community/community-<item>.zip`
  (`COMMUNITY_BUNDLES_ROOT` ne remplace que l'émission) ; le zip émis hérite langue/cible/discipline
  et porte `authoring {teacher, author_is_learner: true}`. `tests/test_learner_courses.py` (32, nouveau).
- **Hôte, MCP, panneau (S2, V6 + avis).** `list_community_bundles({course_id?})` (22 outils) ;
  `packages/lesson-session-host/src/authoring.ts` (`authoringOf`, avis fr/en × juge absent/présent,
  `judge = host.live`) et `key-class.ts` ; bloc `authoring {mode, author_is_learner, validated, judge,
  notice}` dans `start_lesson_session`, chaque `presentation` et `get_operator_context` (+ `task.md`) ;
  bannière `.authoring-notice[role=note]` dans `artifact-pane.js`. `certifiedCorrect`
  (`graders.ts:67`) ne certifie que `source === "llm"` : sans juge, aucune scène de production ne
  porte `correct` ni ne bouge la maîtrise, et l'avis le dit.
- **Packet, lint (S3).** `tools/self_study_passages.py` (nouveau) : `passages (--url|--html|--pdf|--text)`
  → enveloppe `self-study-passages/1.0` ; chrome Wikimedia ignorée, paragraphes courts fusionnés puis
  rattachés (`dropped_short`), abréviations (« M. ») non terminales. `experience_packet.py` :
  `prepare` accepte un dossier vide, préfixe `passage:`, consigne
  `tools/prompts/experience_author_self_study.md` (origine auto-étude ou `--self-study`) ;
  `bundle --self-study [--note]` → `authoring` + `validated_by = "SELF-STUDY — not teacher-validated"` ;
  `check` imprime `Key classes:`. `bundle_lint.mjs` : `self_study_authoring` (INFO),
  `self_study_open_book`, `self_study_no_external_key` (WARN), `learner_authored_validated` (INFO),
  quatre fixtures ; fixture de test `tools/fixtures/self-study/durkheim-ch1.html` (page Wikisource
  sauvegardée, 89 Ko, à confirmer par le propriétaire).
- **Skill et docs (S4).** `skills/studium-self-learner/SKILL.md` (+ liens `.claude/skills`,
  `.agents/skills`), `docs/tutorials/self-study-from-references.md`, `docs/features.md` (quatre avis,
  classes de clé), `docs/user/student-guide.md`, `getting-started/skills.md`, `agent-harness-matrix.md`.
- **Lead.** `.gitignore` (`fixtures/*/community/`), `community_flow_check.mjs` (entrées → `bundle_ref`,
  métadonnées canoniques), `package.nls*.json` (`communityBundlesRoot`), skill harness §8 (lint sans tsx).
- Vérification : `pytest_all` 16 suites (tools 230, scene-synth 267), `pnpm test` (host 222, session 333,
  MCP 26, pilotes extension dont webview-pane 132 et lesson-walk 606), `bundle_lint.test.sh` 23 OK,
  build extension, `pnpm lint` = la seule erreur préexistante `extension.ts:394`. Rejeu Durkheim et
  bannière dans le navigateur intégré : rapport vague 3 §11.

---

## 2026-10-29 (nuit, plus tard) — lot « rendu du panneau » : markdown complet, maths, code coloré

Demande propriétaire : « Oui, lot rendu » après le relevé des trois surfaces de rendu (rapport vague 3
§10). Mission Codex E puis correction de conception par le lead ; non commité.

- `apps/studium-vscode/media/artifact-pane.js` : `renderMarkdown()` (marked vendored, GFM, HTML brut
  échappé, allowlist DOM) remplace `mdLite` partout ; extensions marked `mathBlock`/`mathInline` qui
  tokenisent `$…$`, `$$…$$`, `\(…\)`, `\[…\]` avant la passe inline (règle pandoc pour les devises),
  rendu `katex.render` après l'allowlist, mhchem chargé, repli `imath` sans KaTeX ; `highlightCode`
  (python/js/sql/bash/json) pour les assets `code` et les blocs clôturés ; images relatives → placeholder
  décidé au rendu (`renderer.image`).
- `src/extension.ts` (`paneHtml`) : marked, KaTeX, mhchem chargés avant le panneau (vendor et CDN),
  `img-src https:`, `artifact-pane.js` en `defer`. `src/phrases.ts` : `pane_image_unresolved` fr/en.
- `package.json` : devDependency `marked@15.0.12`, script `vendor` étendu ; `media/VENDOR-LICENSES.md`.
- Tests : `src/webview-pane.driver.ts` 88 → 125 assertions (échantillon GFM, HTML hostile, KaTeX,
  devises, repli, cas limites TeX). Typecheck + 13 pilotes + build verts.

## 2026-10-29 (nuit) — lot 1 de la vague 3 : mémoire inter-leçons (V17, V1, V9, V19, V2)

Demande propriétaire : « Oui, lot 1 » après le rapport de la vague 3
(`studium_dev/docs/superpowers/audits/2026-10-29-web-cases-wave3-trial.md`, §9). Mission Codex D,
tests d'abord ; non commité.

- **Fermer ≠ oublier (V17).** `SessionHost.close()` vide les sorties, fusionne l'état et la mémoire FSRS
  de la session dans le profil sans marquer la leçon terminée, retire l'entrée. L'outil MCP
  `end_session` ferme désormais (`{closed, state_kept}`) ; `forget_session` (nouveau, 21 outils) porte
  l'effacement RGPD ; l'extension appelle `forget_session` sur ses deux actions « oublier ».
- **Routeur de révision sur le profil (V1, V9, V19).** `get_next_reinforcement` accepte `session_id` ou
  `learner_id`, unit les cibles dues de la session et du profil (session prioritaire par concept),
  les projette sur une scène du bundle courant, renvoie `due[]` ordonné, `reason`
  (`due | nothing_due | no_history`) et `next_due_at` entier.
- **Neuf / repris / terminé (V2).** `LessonSession.start()` reprend à la première scène non terminée ;
  une leçon terminée repart de la scène 0 ; `host.create()` et `start_lesson_session` renvoient
  `resume {kind, scene_id, scenes_completed}` et `due[]` pour une leçon terminée.
- Tests : `lesson-session/src/session.start.test.ts`, `lesson-session-host/src/durable-host.test.ts`,
  `host-reinforcement-router.test.ts`, `lesson-mcp/src/server.test.ts`. Suites vertes (333 / 185 / 22),
  extension typecheck + pilotes, rejeu kepler-1 → kepler-2 compilé = source (47 événements).

---

## 2026-10-29 (soir, suite) — restes de code après la vague 2

Demande propriétaire : « Tu peux y aller pour ces recommandations ». Trois correctifs hors des
vagues, un commit, non poussé.

- **Test FSRS dépendant de la date** (`host.review.test.ts › reviewQueue … FSRS schedule`, rouge
  depuis que le calendrier a dépassé t0 + 90 jours). Cause réelle : l'historique est horodaté par
  `AdaptationEngine.appendHistory` avec `new Date()`, pas par l'horloge de la session ; le rejeu FSRS
  lit cet horodatage. `AdaptationEngine` reçoit maintenant un `now()` (la session passe
  `deps.clock.now`), `SessionHostOptions.clock` injecte l'horloge dans `buildHostDeps`, et les
  lectures `reviewQueue` / `nextReinforcement` / `nextReinforcementScene` / `dueReinforcements` /
  `nextCourseStep` prennent par défaut cette horloge. Le test fixe `FixedClock("2026-06-20T10:00:00Z")`.
- **Champs pré/post durables (W8)** : `confidence_declared` déclare `pre`, `post`,
  `confidence_delta` optionnels dans `@studium/learner-state` ; un objet zod retirait ces clés au
  rechargement `FileStateStore`. Le grader perd son `as Signal`. Test
  `learner-state/src/confidence-pre-post.test.ts`.
- **Extension VS Code localisée** : `package.nls.json` (en) + `package.nls.fr.json` (fr), 27 clés :
  titres des sept commandes, nom de la vue, titre et descriptions des onze réglages avec leurs
  `enumDescriptions`. Les titres bilingues « A / B » disparaissent ; VS Code choisit selon sa langue
  d'affichage. README et walkthrough alignés.

Vérification : `pnpm -r --no-bail test` entièrement vert (host 182/182, plus aucun test rouge),
extension typecheck + 14 pilotes dont le manifeste.

## 2026-10-29 (soir) — vague 2 : neuf correctifs appliqués, commit 3e701f8 non poussé

Demande propriétaire : « Oui, corrige » après le rapport de la vague 2
(`studium_dev/docs/superpowers/audits/2026-10-29-web-cases-wave2-trial.md`, §7 → §9).
Branche `fix/2026-10-29-harness-trial` sur eb5b1e1, commit `3e701f8` (51 files changed, 2893 insertions(+), 453 deletions(-)), **non
poussé** (go propriétaire « Oui, un commit »). Quatre missions Codex sol-max (E moteur, F hôte/chargeur/MCP/identité,
G outils enseignant, H catalogue fr/en), intégrées par le lead.

Unités : `RunRequiredError` sur une reproduction sans run attesté (W3) ; mémoire de passage
des prérequis — porte passée si dossier sans faute ou item réussi pendant un détour de graphe,
mémorisée pour la session, item non vu préféré (W1) ; `nav(decision)` (W2) ; chargeur limité aux
nuls optionnels hérités (W4) ; deck de verdicts : détection ≥ 0,6 et rejet ≥ 0,5, `verdict.detail`
(W5) ; prérequis inévaluable annoncé une fois (W6) ; confiance pré/post (W8) ; saut sur maîtrise
limité à intro/concept/quiz (W9) ; retour sur chaque scène notée hors quiz via `phrases.ts` (W10) ;
catalogue fr/en par `metadata.language`, `Presentation.locale`, chrome hôte / canal fichier /
extension (W11) ; `git describe --dirty` dans le build (W12) ; plan 1.x `Concept.prerequisites` +
`SceneOutline.concept_refs`, `check` qui alerte, `bundle` qui émet refs, arêtes et règle (W13) ;
guide harnais (W14) ; `--force` (W15) ; `returns_to` réel (W16) ; `skipped_scene_ids`,
`summary.mastery`, `scenes_detoured` (W17).

Corrections du lead sur les rendus : E marquait un prérequis « passé » à toute réponse juste
(la persona *struggling* d'`eval/tests/test_drive_integration.py` n'était plus gardée ni
escaladée) ; G alertait sur `intro`/`meta_checkpoint` ; H laissait en anglais les entrées `fr`
des explications du moteur et des mots du retour.

Vérification : `pnpm -r --no-bail test` vert sauf `host.review.test.ts › FSRS schedule`
(préexistant, date) ; `tools/pytest_all.py` 16 suites / 0 échec ; extension typecheck, build,
14 pilotes ; rejeu des trois cas v2→v4 contre le dist reconstruit et sonde run-required
(`~/git/studium_eval/trials/2026-10-29-web-cases-wave2/logs/`). Attentes modifiées :
`session.universe.test.ts` (état initial explicite au lieu de trois réponses, puisque le passage
de porte s'en mêle). Pas de VSIX.

---

## 2026-10-29 — essai trois cas web, correctifs harnais et VS Code

Demande propriétaire : jouer Studium sur trois cas d'enseignement pris sur le web
(OpenStax photosynthèse, Carpentries Python, OpenStax p-value), relever problèmes et
améliorations côté harnais agentique et VS Code, puis corriger P1/P2 et les huit points
du §7 du rapport (`studium_dev/docs/superpowers/audits/2026-10-29-three-web-cases-trial.md`).

Unités : scène publique sans `feedback_*` ni `hints` ; `Transition` porteuse de
`verdict` et `navigation` (sorte `remediate`, règle `graph_prereq_gate_passed`) et
surfaces VS Code / canal fichier alignées ; `get_server_info` avec identité de build
(`build-info.ts`, define esbuild) ; `bundle_lint.mjs` réécrit (`--root`, règles graphe,
convention source=dépendant documentée dans le schéma, fixtures) ; run attesté non
redemandé ; recettes Claude/Codex avec `build` et appel de fumée ; sélecteur de leçon ;
`experience_packet.py check` bavard et `bundle` squelette 1.4 validé par
`bundle_validate.ts` ; cinq types actifs plannifiables, déclarés non synthétisables
dans scene-synth. Quatre missions Codex sol-max (A–D), intégrées par le lead.

Vérification : TS `pnpm -r --no-bail test` vert sauf `host.review.test.ts › FSRS
schedule`, échec préexistant lié à la date (identique sur `dev` intact) ; Python 16
suites / 0 échec ; extension 13 pilotes, `lesson-walk` 1052 assertions ; rejeu des trois
cas contre le dist reconstruit : 0 fuite, navigation sur chaque transition, quiz réussi
non rejoué. Aucun ancien test affaibli ; les attentes modifiées suivent le nouveau
contrat. Pas de push ; VSIX non repackagé.

## 2026-09-10 — INT-STUDIUM-040, littérature et harnais

Première tranche de la demande propriétaire après lecture du manuscrit (lecture
seule) : normalisation réelle Perspicacité et migration du cache; dossier auteur
indépendant du fournisseur, validation des sources/citations et du brouillon;
export ASTRA/MySTRA; contexte public commun MCP/fichiers avec exemples de réponse
canoniques. Deux feuilles Sol high : contrats/implémentation Python, revue indépendante.

Exemple reproductible depuis un passage SimMS capturé via Perspicacité/PMC :
brouillon non approuvé, calcul réel de spectres synthétiques, visualiseur externe
avec paramètres, provenance, comparaison au résultat initial et réflexion locale.
Contrôles négatifs conservés : le passage/source ne peut pas être substitué dans
le dossier; les clés/feedback/meta arbitraires sont absents du contexte; désactiver
le shift et resserrer la tolérance changent l'exploration sans changer le cours.

Vérification de travail : build, lint (194 avertissements existants, 0 erreur),
tests TS, Python 16 suites/0 failing, MCP smoke 14 assertions, ASTRA réel et audit
navigateur passent. La vérification du commit exact depuis un checkout neuf et
les chiffres consolidés sont consignés dans le hub INT040. Aucun ancien test
modifié. Aucune approbation pédagogique, exécution ASB arbitraire, API modèle,
diffusion étudiante ou écriture manuscrit. Pas de push.


## 2026-09-10 — INT-STUDIUM-038, audits reproductibles

Pilotes locaux versionnés: captures des douze vues enseignantes sur le vrai
collecteur; cohorte synthétique (55+2+1 événements, dix agrégats et gardes
401/403/422); diagnostic d'autorité conceptuelle. Les contrôles navigateur
enseignant passent sur desktop et 390 px, avec une feuille CSS et zéro exception.
Le pilote conceptuel reproduit exactement les mesures Sol: deux divergences sur
seize arêtes assesses et une conséquence de routage, sans modifier le bundle.

Les guides donnent commandes, frontières et moyens de reprise. Le contrôle natif
reste non lancé: le stockage utilise une entrée Keychain globale indépendante du
dossier SQLite. Cargo a construit le binaire et passé le test de stockage injectant
une clé, mais cela ne constitue pas un audit GUI natif. Aucun secret n'a été lu.

## 2026-09-10 — INT-STUDIUM-038, refonte du tableau de bord enseignant

Audit initial: zéro feuille de style, Times par défaut, contrôles minuscules.
Le shell commun charge désormais son CSS, hiérarchise douze vues dans quatre
groupes, indique la destination active et replie la navigation sur mobile.
Accueil, cartes, tableaux, notices et formulaires partagent une identité ivoire,
encre et sarcelle. Les lecteurs/API, seuils et formules n'ont pas changé.

Sol a prouvé les trois nouveaux contrats de navigation/44 px rouges puis verts.
Revue indépendante: notices ADR 006/011/013, modération, non-attribution et
branches suppressed/unavailable conservées. Vitest: 9 fichiers, 76 tests passent;
TypeScript passe. Chrome réel + collecteur synthétique: **23 tests navigateur passent**.

Modification des tests historiques annoncée explicitement pendant la session:
six fichiers avaient sept échecs de sélecteurs. Les unions CSS/`text=` invalides
utilisent maintenant `or()`, et les mentions ADR/KPI sont cherchées dans leur
contenant. Le test Trajectoire vérifie désormais explicitement le retrait décidé
par INT-STUDIUM-030 (notice d'indisponibilité, ni graphique ni retenue d'effectif),
au lieu d'attendre un graphique vide qui aurait porté un message faux. Aucun test
supprimé, aucune assertion de chiffre ou de confidentialité affaiblie.

Le choix optionnel `PLAYWRIGHT_CHANNEL=chrome` dans la configuration permet de
jouer toute la suite avec Chrome installé. Le Chromium attendu était absent;
son téléchargement est resté bloqué après le transfert et a été arrêté. Les
résultats verts proviennent de Chrome, sans simulation des API enseignantes.

## 2026-09-10 — INT-STUDIUM-038, attendre aussi l'envoi déjà en vol

La revue de la sortie a identifié la concurrence avec un flush automatique:
le buffer pouvait être vide parce qu'un envoi attendait le réseau. Le flush de
sortie attend maintenant la promesse active avant de traiter le lot suivant.
Un nouveau test différé déclenche l'auto-flush, demande une sortie, fait échouer
réseau et outbox, puis vérifie que l'erreur arrive au demandeur et que la reprise
conserve le lot exact. Rouge avant sérialisation, vert après; 30 fichiers et
144 tests apprenant passent, TypeScript sans émission passe. Aucun test existant
modifié; aucune règle de consentement, métrique ou contrat IPC changée.

## 2026-09-10 — INT-STUDIUM-038, un espace apprenant utilisable

Cadre visuel commun aux écrans: papier ivoire, encre sombre, titres serif locaux,
navigation, lien d'évitement, retour en haut au changement d'écran, progression
du lecteur et cartes de leçons tirées des vrais bundles. La bibliothèque cherche
sans accents, distingue vide/aucun résultat/erreur et permet de réessayer. Les
rejets Rust sous forme de chaîne sont maintenant affichés dans bibliothèque et
lecteur; auparavant ils pouvaient laisser un chargement permanent.

Neuf nouveaux contrats rouges puis verts (recherche, effacement de recherche,
reprise d'erreur, erreur avec bundle préparé, erreur native du lecteur, position
de défilement, sortie confirmée, flush avant sortie et reprise après échec d'outbox).
La sortie d'une leçon annonce la perte du
brouillon et le redémarrage à la première scène; annuler garde la réponse et
rend le focus au bouton. Aucun test antérieur au chantier modifié. Suite apprenant:
**29 fichiers, 143 tests passent**; TypeScript sans émission passe. ESLint: zéro erreur, deux
avertissements préexistants sur les effets de télémétrie du lecteur. Les contrats
de consentement, événements, remount de scènes et bundle choisi restent verts.

La sortie attend le flush des événements avant de démonter le lecteur. Si réseau
et stockage local échouent, seul le suffixe non persisté revient en mémoire avec
ses identifiants originaux; le préfixe déjà en outbox n'est pas recopié. Le test
injecte une panne au deuxième événement puis vérifie l'ordre et l'identité de la
tentative suivante. La revue Sol a aussi fait préserver l'encadré des scènes web
non prises en charge et l'ordre de titres du consentement.

`tools/audit-learner-ui.mjs` joue le vrai frontend dans Chrome avec un double IPC
en mémoire explicitement déclaré: leçon métabolomique inchangée terminée en
7 scènes, recherche, erreurs/reprise, annulation d'effacement, clavier, captures
desktop/390 px sans débordement, zéro exception navigateur. Ce n'est pas un test
du stockage natif ni d'une transmission réelle. Les captures et mesures seront
archivées dans le hub avec l'audit enseignant et conceptuel.

## 2026-09-10 — INT-STUDIUM-038, le navigateur ne démarrait pas

Audit live depuis le checkout isolé `prototype-build-ux`: écran blanc à `/`,
console `ReferenceError: process is not defined` dans le module partagé
`lesson-session/src/grading/deck.ts`. Le build et les suites Node étaient verts,
mais l'import du paquet dans le webview évaluait `process.env` avant React.

Un nouveau test exécute le vrai module transpilé dans un contexte sans globale
Node `process`, avec Web Crypto: rouge avec cette même ReferenceError. La lecture
de l'environnement est maintenant conditionnelle; la route serveur et son secret
configuré restent identiques, le webview utilise le tirage cryptographique local
déjà prévu. Aucun polyfill Node ni secret serveur n'est injecté dans le client.
Le test passe; vérification de la suite lesson-session et du démarrage live jointe
au bilan du chantier. Aucun test existant modifié.

## 2026-09-10 (conséquence) — La porte de prérequis s'ouvrait sans le dire (`1470199`)

La décision du propriétaire sur INT-STUDIUM-035 avait laissé deux choses ouvertes, dites
telles quelles : les candidats 3 et 4, et une conséquence de routage notée sans être traitée.
Cette entrée traite la seconde et **mesure** la première ; elle n'en décide aucune.

### Ce qui a été trouvé, et qui n'était pas ce que la note annonçait

La note disait : hors ligne, une remédiation routée vers une scène `ai_critique` ne peut plus
converger par la maîtrise. C'est exact dans le code — et le bundle réel ne contient **aucune**
scène `ai_critique`. La conséquence notée est latente. En allant la vérifier, le driver en a
trouvé une autre, active, et plus grave.

`ANSWER_GRADED_TYPES` porte deux types. Son commentaire affirmait « les types dont la
correction émet un `answer_submitted` ». **Huit** en émettent. `concept:c-configuration` est
prérequis de `c-periodicite` et de `c-geometrie`, et sa seule scène d'évaluation est un
`prompt_practice` : le routeur ne la voit pas, `firstAnswerGradedSceneForConcept` rend `-1`, et
le code retombait sur `reason: "advance"` — la raison d'un passage ordinaire.

Aucun détour n'est dépensé, donc le budget ne s'épuise jamais, donc la libération annoncée que
INT-STUDIUM-036 avait construite exprès ne se déclenche jamais :

```
avant : advance=7  remediate=17  gate_released=0   (4 des « advance » franchissent un verrou)
après : advance=3  remediate=17  gate_unassessable=4
```

### Un rapport, pas une route

L'index rendu est identique — une assertion dédiée le dit, parce que c'est ce qui sépare une
réparation d'une décision de routage. Ce qui change est que la session dit
`graph_prereq_unassessable`, avec son propre `rule_id` : « trois essais n'ont pas suffi » parle
de l'apprenant, « il n'y avait rien à essayer » parle du **bundle**, et c'est l'enseignant qui
peut y remédier. Emprunter le `rule_id` de la libération aurait affirmé une remédiation qui n'a
jamais eu lieu.

### Trois ensembles, tous différents, et désormais mesurés

Depuis le candidat 2, émettre un `answer_submitted` n'implique plus faire monter la maîtrise :
hors ligne seuls `quiz` et le **deck** de `spot_the_flaw` portent un `correct`, les deux notés
contre la clé par identité. Donc le prédicat qu'un routeur veut — « un détour ici peut-il faire
monter la maîtrise ? » — n'est plus une propriété du type de scène.
`answer-graded-types.contract.test.ts` exécute les correcteurs réels et épingle les trois
ensembles ; changer un correcteur fait bouger les nombres tout seuls.

L'**appartenance** de `ANSWER_GRADED_TYPES` est laissée telle quelle. L'élargir routerait des
apprenants hors ligne vers des scènes qui ne peuvent pas converger ; la restreindre coûterait à
un déploiement en ligne sa remédiation en texte libre. Choisir est la décision de routage que
l'intent dépose et ne prend pas.

### Le plafond du candidat 3, avant qu'on écrive des indices

Le candidat 3 propose d'écrire plusieurs indices par point-clé et d'exiger une proportion —
c'est-à-dire un **seuil** sur le score existant. Avant d'écrire quoi que ce soit, mesurer ce
qu'un seuil peut atteindre, sur les douze réponses réelles :

```
moyenne 0,16 sur les 5 réponses qu'un enseignant valide
        0,86 sur les 7 qu'il refuse                      — à l'envers
meilleur seuil : 58 %, contre 58 % pour refuser de corriger
AUC 0,114 sur 35 paires (0,5 = pile ou face ; en dessous, inversé)
```

Ce n'est pas « encore bourrable » : c'est inversé. Un étudiant qui n'écrit jamais « Hund » ne
gagne rien à ce qu'il existe cinq façons de l'écrire qu'il n'écrit pas non plus ; quelqu'un qui
colle des mots-clés gagne cinq chaînes de plus à coller. Le signe est ce qu'il faudrait changer,
et c'est une réécriture des indices — matériel validé par Élise Dumont, règle 003 — pas un
réglage. Mesure faite sur douze réponses d'un seul bundle, étiquetées à la main.

### Le candidat 4 n'est pas seulement une préférence

Publier le texte brut de l'apprenant au professeur se heurte à **R2 d'INT-STUDIUM-030**, qui
est *Accepted* : « aucune surface ne peut se rétrécir à une personne ». Un texte libre s'y
rétrécit par construction, et `events.ts:96` interdit déjà de le transmettre. Le candidat 4
demande donc un amendement à un intent accepté plus un mécanisme de consentement, pas un
arbitrage d'ingénierie. Constat, pas décision.

### Portes

`pnpm test` vert ; `python tools/pytest_all.py` 16 suites 0 failing ; `tsc --noEmit` propre ;
les sept drivers passent ; `teacher_check.mjs` toujours **completed 5/5**. Les deux gardes
prouvées rouges en annulant la réparation (2 échecs), les autres inchangées.

---

## 2026-09-10 (décision) — Le score mot-clé ne certifie plus (`97cf72f`)

La moitié de INT-STUDIUM-035 qui n'était pas la mienne a été tranchée par le propriétaire :
**candidat 2**. Le score par appariement de sous-chaînes reste calculé, reste publié au
professeur comme indice de couverture — et cesse de dire si la réponse était juste.

**Ce qui a disparu, et où.** `answer_submitted.correct` devient optionnel. Absent ne veut pas
dire faux : rendre l'absence comme un échec serait exactement le défaut d'origine retourné, et
le dépôt a déjà tranché cette question ailleurs — `matchesCondition` fait `if (!(key in ctx))
return false`, l'absence y est une réponse de plein droit (INT-STUDIUM-029). Trois chemins
certifient encore : le quiz, où le choix marqué **est** la vérité terrain ; le paquet de
verdicts, dont les marques sont notées contre la clé par identité et non par sous-chaîne — la
seule note hors ligne honnête du projet, qu'un remplacement en bloc aurait supprimée avec le
reste ; et un évaluateur vivant, qui se déclare `source: "llm"`.

**Les six lecteurs bougent ensemble.** Arrêter la seule mise à jour Beta n'aurait pas supprimé
l'affirmation fausse, il l'aurait déménagée. Cinq autres la lisaient : `ctx.answer_correct` dans
le moteur d'adaptation, la file de révision FSRS des deux clients (`if (!a.correct) return 1`
aurait replanifié chaque réponse non corrigée en « à revoir »), `scene_completed.success` — rendu
optionnel, ADR 006 v1.7, dans les deux miroirs TS et Python comme `score_source` en v1.6 — et
`compute_progress`, qui lisait `get("success", False)` et publiait donc « cette scène est ratée
par tout le monde » là où la vérité est « personne ne l'a corrigée ». Le taux vaut désormais
`None`, avec `n_graded` et `n_ungraded` publiés à côté : une mesure vide rendue comme un zéro est
une faute déjà enregistrée dans ce dépôt.

**L'absence est comptée.** `ConceptState.ungraded_attempts` la rend dénombrable, délibérément
hors de `total_attempts` — ce compteur-là se lit comme de la preuve, et y verser des tentatives
non corrigées reproduirait la confusion d'un cran plus bas.

**Mesuré, pas affirmé.** `grading_reality_check.mjs` portait lui-même le défaut qu'il mesurait :
`r.signal.correct ? "PASS" : "FAIL"` imprimait un échec pour toute réponse désormais non
corrigée. Le pilote a trois états maintenant. Il passait de « 5 bonnes réponses marquées fausses ;
6 mauvaises marquées justes » à 12 réponses, 0 certifiée, 0 désaccord — et il imprime ce que le
score **seul** aurait affirmé, 11 verdicts faux sur 12, pour que la décision reste discutable et
pas seulement appliquée.

**Conséquence notée, pas encore traitée.** `graph-nav.ts` compte `ai_critique` parmi les
`ANSWER_GRADED_TYPES` : hors ligne, une remédiation routée là ne peut plus converger par la
maîtrise. La terminaison tient quand même, par `MAX_PREREQ_DETOURS = 3` et l'annonce
`graph_prereq_gate_released` (INT-STUDIUM-036) — vérifié : `teacher_check.mjs` rend toujours
« completed 5/5 », et les 6 pilotes de fixtures passent.

Portes : `pnpm test` vert, `python tools/pytest_all.py` 16 suites 0 failing, `tsc --noEmit`
propre sur les six paquets touchés. Chaque nouvelle garde a été prouvée rouge en retirant sa
réparation : moteur 6 échecs, hôte 3, collecteur 4.

---

## 2026-09-10 (fin) — Les intents déposés, repris un par un (`ecf95b2`, `8e38cb1`, `d9b1b1e`)

Quatre intents étaient encore en **Draft**. Ce qui restait de chacun a été repris ; ce qui reste
maintenant ne relève plus de la réparation.

**INT-STUDIUM-007, le dernier point ouvert.** L'URL du service d'évaluation de critique était un
littéral dans le corps de `AICritiqueScene.submit`, et la propriété `critiqueEvalEndpoint` de
`SceneRouter` — celle qui existait pour la configurer — n'était passée par personne. Le littéral
était donc toujours l'URL, et il n'y avait nulle part où la changer sans recompiler.
`lib/serviceEndpoints.ts` la résout comme `getTelemetryEndpoint` résout déjà le collector.

L'autre moitié de l'énoncé était « un diagnostic d'accessibilité ». « Failed to fetch » était tout
ce que l'apprenant lisait : ni l'URL tentée, ni le fait qu'aucune n'avait été configurée, ni le
service à démarrer. Les trois cas sont distingués — injoignable, erreur HTTP, réponse illisible —
et le premier dit quand l'URL n'est que le défaut de développement. Ce n'est pas de l'ergonomie :
sans ce service, toute réponse libre passe au repli mot-clé.

**INT-STUDIUM-004, la dernière dérogation.** Déposée comme un écart d'orthographe (« le corrigé
écrit *unite de temps*, la clé attend *unites* »), c'était en fait le défaut que l'item 4 du même
intent avait réparé dans la capsule : « ~1.65 unite de temps » est indécidable. La capsule rapporte
depuis k en s^-1 et la demi-vie en s ; le corrigé le dit maintenant, une clause par erreur plantée.
Les deux quarantaines sont vides : 7 bundles, 0 en échec, 0 écart connu.

**INT-STUDIUM-035, la moitié qui n'est pas une décision.** Le sens à donner à la notation par
mots-clés appartient au propriétaire ; qu'on ne puisse pas savoir *quel* correcteur a produit un
nombre, non. `HttpCritiqueEvaluator` rattrape n'importe quelle erreur et renvoie le repli mot-clé
dans la même forme qu'une vraie évaluation : une cohorte notée par sous-chaînes et une cohorte
notée par un LLM arrivaient identiques à tous les étages. `CritiqueEvaluation.source` puis
`critique_submitted.score_source` (ADR 006 v1.6, optionnel et rétro-compatible, comme `scene_type`
en v1.4) le disent, et le collector expose `keyword_graded_rate` à côté de
`critique_completion_rate`, avec son propre dénominateur. Une cohorte non étiquetée lit **None**,
jamais 0.0 : « 0 % noté par mots-clés » serait la lecture rassurante d'une question que personne
n'a posée. Mesuré sur un vrai passage du bundle atomistique-l1 : complétion 0.176,
`keyword_graded_rate` 1.0 sur 17 événements. Le second nombre n'existait pas.

**Ce qui reste, et qui n'est pas technique.** `atomistique-l1::s5b-spot-azote` sans `sound_claims`
(matériel validé d'Élise Dumont, règle 003) ; le §8 du manuscrit et l'entrée C7 de PAPER_SPEC
(INT-STUDIUM-002, autre dépôt) ; et la direction de l'INT-STUDIUM-035 elle-même.

---

## 2026-09-10 (suite) — Les trois écarts enregistrés, et ce qu'ils ont en commun (`da0c804`, `da083b1`)

Les trois points que l'audit avait consignés sans les traiter sont traités. Deux d'entre eux
tenaient à la même cause : un état qu'un composant écrit et qu'un autre possède.

**`scenes_replayed` n'a jamais dépassé zéro.** Champ déclaré, persisté, présent dans le résumé de
fin de session et au dénominateur d'`autonomyRatio` — et jamais renseigné. La session
l'incrémentait, mais `applySignal` fait `this.state = this.engine.getState()` au signal suivant et
le moteur rend son propre objet ; `getState()` aggravait le tout en retournant directement
`this.engine.getState()`, sans passer par `this.state`. Le compteur vit maintenant côté session
(`replayCounts`), et un seul point — `engineStateWithReplays()` — l'appose sur l'état du moteur.
Les quatre sorties de la session y passent : `getState`, la sauvegarde, `finalState`, et
`buildMasteryClaims`. Un apprenant qui épuise son budget de replays relit désormais
`{ "q-base2": 3 }` et non `{}`.

**Trois vocabulaires de types de scène, jamais comparés.** Ce qu'un plan peut demander
(`lesson_plan_schema.SceneType`, 9), ce que scene-synth sait produire (7 agents), ce qu'un bundle
peut porter et que le runtime note donc (13). Un outline dont le type n'a pas d'agent est sauté
avec un warning que personne ne lit : la scène disparaît entre le plan et le bundle, et toutes les
vérifications de niveau plan qui la comptaient passent quand même. C'est ainsi que `simulation` a
survécu — planifiable, acceptée par la cohérence Bloom du critic, recommandée par son verdict
hors-ligne en dur, produite par rien, et même pas représentable dans un bundle. Dans l'autre sens,
cinq types que le runtime note (`explain_back`, `comparison`, `summary_audit`, `prompt_practice`,
`communication_sim`) n'existent que là où un humain les a écrits à la main.

Les deux écarts sont désormais **déclarés avec leur raison** (`KNOWN_UNSUPPORTED_SCENE_TYPES`,
`HAND_AUTHORED_ONLY_SCENE_TYPES`), `SUPPORTED_SCENE_TYPES` est dérivé de la table d'agents, et un
test de garde échoue sur tout type qui n'est dans aucun ensemble, sur toute entrée périmée, et sur
tout type productible qu'aucun bundle ne pourrait porter. Un écart reste un écart — mais un écart
décidé, pas un silence.

**Le critic ne promet plus une couverture qui ne survivra pas.** Il accepte toujours `simulation`
OU `reproduction` comme couverture du niveau apply, mais il avertit quand la couverture ne repose
QUE sur un type que scene-synth ne sait pas produire — au moment du plan, quand l'auteur peut
encore le changer. Les verdicts hors-ligne en dur recommandent `reproduction`, productible de bout
en bout. `simulation` n'est **pas** supprimé : le membre d'énumération porte du vrai routage dans
l'enrichissement par évidences, le mapper perspicacité, l'extraction d'assets ABS et la cohérence
Bloom ; le supprimer supprimerait cette couverture. Un test de dérive compare les deux services
(dans un sous-processus : chacun possède un paquet `agents` de premier niveau).

**Ce qui reste sous décision.** Écrire les cinq types manquants suppose de générer leurs `cues` —
c'est-à-dire de générer la clé de notation que l'INT-STUDIUM-035 met précisément en cause.
Construire maintenant industrialiserait le défaut. C'est écrit dans la raison de chaque entrée.

---

## 2026-09-10 — Le test en conditions réelles : deux boucles sans fin, et une notation par mot-clé (`74f74e5`, `b31cee6`)

Audit du système sur du VRAI matériel pédagogique — le bundle atomistique-l1 monté depuis le cours
de L1 d'Élise Dumont — avec des réponses telles qu'un étudiant les écrit, et non fabriquées à
partir des chaînes-indices du corrigé. Les drivers existants du répertoire font l'inverse : leurs
réponses « GOOD » sont composées des mots-clés attendus, si bien qu'ils prouvent que la chaîne
tourne sans jamais prouver qu'elle note.

**Une leçon qu'on ne pouvait pas finir.** Un apprenant compétent mais formulant autrement ne
sortait jamais du chapitre : 199 replays d'une même scène en 400 pas. Deux boucles distinctes, non
bornées pour la même raison — chacune suppose que la maîtrise finit par monter, ce qui n'est vrai
que d'un apprenant dont les réponses finissent par être notées justes. La grille de prérequis
renvoyait indéfiniment vers la première scène notée du prérequis ; `replay_current_scene`
reservait indéfiniment la même scène faute d'item alternatif non vu. Bornées à 3 (`gate_released`,
`replay_budget_exhausted`), et annoncées : un passage sans maîtrise est un fait que l'enseignant
doit voir. La leçon se termine désormais en 91 pas pour l'apprenant compétent, 118 pour celui qui
échoue partout. Le compteur de replays a dû passer côté session : `state.scenes_replayed`
appartient au moteur, qui rend son propre objet à chaque `getState()`, et n'a jamais dépassé 1.

**Ce que la correction a fait apparaître.** `teacher_check.mjs` n'avait pas de branche
`communication_sim` et retombait sur `ack` : la scène n'était jamais atteinte, un bon apprenant la
sautant et un apprenant faible restant coincé en amont. Le script affichait `completed 3/5` sans
échouer — les deux sessions manquantes étaient celles des apprenants en difficulté, celles dont
le tableau de bord enseignant a le plus besoin. Mesuré avant/après : 3/5 puis 5/5.

**La notation hors-ligne, elle, n'est pas corrigée — c'est une décision de conception.** Hors
LiteLLM et hors shim :8002 (le chemin par défaut du testeur VS Code, et le repli de
`HttpCritiqueEvaluator` à la moindre erreur), toute réponse libre est notée par
`matchClaimsAgainstCritique` : un point du corrigé est crédité si sa chaîne-indice apparaît
QUELQUE PART dans la réponse. Pas de négation, pas de sujet, pas d'exigence de phrase. Sur les
vraies scènes, 11 réponses sur 12 sont notées à l'inverse d'un enseignant — « Je ne vois aucune
erreur » obtient 1.00 en contenant « Hund », « célibataires » et « 2p3 ». Le diagnostic est
`fixtures/atomistique-l1/grading_reality_check.mjs` (sortie 0 : il rapporte, il ne barre pas).

---

## 2026-09-10 — Tier-A, le compromis de coût : la jambe macOS sur demande (`6fd4f8a`)

Le point de coût de la release Tier-A, appliqué à `dev` **plutôt que pris depuis
`chore/release-tier-a`**. Un runner macOS GitHub-hosted est facturé 10x la minute Linux, et sur
un push sa jambe de `tauri-build` ne produit qu'une preuve de compilation : rien ne consomme son
bundle en aval — `demo-m6` reconstruit sur Linux — et la couverture tarpaulin est sur la jambe
Ubuntu. La matrice devient donc `fromJSON(github.event_name == 'workflow_dispatch' ? les deux :
Ubuntu seul)`, et `workflow_dispatch:` entre dans le bloc `on:`.

Supprimer la ligne macOS aurait été plus court et aurait supprimé la couverture avec : Tauri casse
par plateforme, et ce build l'a déjà montré une fois. Le compromis est « moins souvent », pas
« plus jamais ». `demo-m6` reste sur chaque push — c'est le seul chemin de preuve d'INT-STUDIUM-034.

**Pourquoi la branche n'est pas fusionnée.** `chore/release-tier-a` porte bien cette décision,
mais elle est antérieure à plusieurs réparations de `dev` et les annulerait : `pnpm build`
(compilation du workspace), `bundle_lint`, le smoke MCP headless, l'étape du validateur ASTRA,
l'étape LWG du planner, l'étape Observatory, `webkit2gtk-driver` (INT-STUDIUM-033) et
`tools/e2e-demo-m6.test.sh` (INT-STUDIUM-021) ; et elle remplacerait `python tools/pytest_all.py`
par un `pytest` nu, que `pytest.ini` borne à `packages` (112 tests). Un merge pour récupérer une
ligne de matrice aurait rendu la CI verte en lui retirant ce qu'elle mesure.

Vérification locale seulement (la CI de l'organisation est bloquée sur facturation) : le YAML
parse, les deux branches de `fromJSON` sont du JSON valide, et l'expression tient sur une ligne —
un scalaire replié dont la continuation est plus indentée garde son saut de ligne et serait partie
coupée en deux.

---

## 2026-09-10 — INT-STUDIUM-030 : faire respecter le consentement que l'écran enregistre (`1c1becb`)

L'item déposé portait sur la **formulation** : `student-guide.md` et `ConsentScreen.tsx` promettent
des « données/indicateurs anonymisés », ce qui est de la pseudonymisation, pas de l'anonymat. La
reformuler s'est révélée impossible à faire honnêtement, parce que le code sous la formule ne fait
ce qu'annonce ni l'une ni l'autre des deux surfaces. Deux défauts, tous deux vérifiés :

- **L'accord était enregistré et jamais appliqué.** `ConsentScreen` écrit `level_b` ; personne ne
  le lisait. `LessonPlayer` passait `getTelemetryEndpoint(null)`, et cette fonction résout une
  *configuration* : elle rend `window.__telemetry_endpoint` dès qu'il est posé, c'est-à-dire
  exactement le mode d'un déploiement et du harnais E2E. Un apprenant n'ayant coché que A
  transmettait donc quand même. Le commentaire de la fonction promettait déjà le portillon —
  « peut être `null` si l'apprenant n'a pas consenti niveau B » : c'est ainsi qu'un portillon
  manquant reste invisible, la conception documentée à l'endroit qui ne l'implémente pas.
- **Le pseudonyme sur le fil était la chaîne littérale `"anonymous"`.** `pseudonyme.rs` calcule
  HMAC(secret machine, lesson_id) et `get_pseudonyme` l'expose ; le magasin local chiffré l'estampe
  sur chaque event. Le contexte transmis codait « anonymous » en dur — la même valeur pour tout le
  monde, ni un pseudonyme ni un anonymat, et un plancher k réduit à une cohorte d'un.

`resolveTelemetryEndpoint(consent, fallback)` est le portillon, et il **échoue fermé** : pas de
dossier, une lecture en échec, ou un dossier sans l'accord résolvent tous à `null`. L'override de
test ne le contourne pas — une brèche là serait une brèche dans le seul mode où l'application
transmet réellement. `LessonPlayer` lit désormais le dossier ET le pseudonyme, et ne transmet sous
aucun des deux si l'une des lectures échoue.

**Trois specs E2E posaient l'override et ne cochaient que `#a` tout en affirmant une transmission**
— elles mesuraient une fuite, pas une fonctionnalité. Elles accordent B.

Les trois nouveaux cas `LessonPlayer` ont été vérifiés ROUGES contre le joueur précédent
(`3 failed | 3 passed`) avant d'être verts. student-runtime 122 → 125 tests, 22 fichiers ;
`tsc --noEmit` propre ; `pnpm test` exit 0 ; 16 suites Python, 0 failing.

**Tenu pour le·la propriétaire** (rule 003) : la réécriture de la formulation elle-même, et la
contradiction de taxonomie — `docs/user/student-guide.md` numérote B = journal et C = agrégat
enseignant, quand l'application fait de B la transmission. C'est la taxonomie qui décide ce que
vaut un `level_b = true` déjà stocké pour les étudiants ayant consenti.

---

## 2026-09-10 — INT-STUDIUM-004 item 2 : une scène `discussion` qu'une leçon peut atteindre (`1213090`)

`discussion` était le seul type de scène sans aucune couverture par fixture : exercé par des tests
unitaires qui construisent leur propre bundle et par `SceneRouter.test.tsx`, mais porté par aucun
bundle sous `fixtures/` — donc aucune leçon qu'on puisse donner à un apprenant n'en contenait une.

`fixtures/capsule-debate-demo` est un bundle de démo nouveau plutôt qu'une scène ajoutée à un
existant, ce que l'intent recommandait lui-même : pas dans `atomistique-l1`, matériel L1 validé
d'Élise Dumont où rédiger du dialogue pédagogique est la décision du·de la propriétaire.
`capsule-loop-demo` était l'autre candidat et a été laissé tel quel — six fichiers de test et le
décompte d'étapes documenté du harnais épinglent sa séquence exacte de scènes. Trois scènes :
intro, discussion, meta_checkpoint, sur la même cinétique d'ordre 1 que le reste de la famille
capsule ; le débat porte sur ce qu'une constante ajustée sur une fenêtre finie autorise à conclure.

**La garde est l'objet, pas le fichier.** `corpus-over-distrust.test.ts` consigne pourquoi une
fixture qui *existe* n'est pas une couverture : `corpus-discussion.test.ts` n'affirme donc pas
qu'une scène `discussion` est présente — il **découvre** chacune sous `fixtures/` et la conduit
dans le vrai `LessonSession`, en marchant jusqu'à elle scène par scène, en soumettant un tour, et
en affirmant que le scorer a été atteint et le signal émis sous l'id de cette scène. Une scène
déclarée mais injouable, ou un bundle qu'on ne peut pas parcourir jusqu'à sa propre discussion,
tombe là. Un second cas envoie `max_turns + 2` tours et vérifie que le plafond est *appliqué* et
pas seulement déclaré. Vérifié rouge avec la fixture déplacée, vert avec elle remise.

`bundle_lint` : 7 bundles, 0 failing (le nouveau `OK — 3 scenes`), son propre auto-test 8/8 ;
lesson-session 249 → 252 ; `pnpm test` exit 0 ; `tsc --noEmit` propre.

*Item 3 du même intent (la quarantaine `demo-atomistique`) était déjà bâti* — `KNOWN_BROKEN_BUNDLES`
est vide et le lint dit `OK — 10 scenes` depuis `c22a42a` (2026-09-08). C'est la ligne du relevé
qui était périmée, pas le code.

---

## 2026-09-10 — INT-STUDIUM-010 nit 3 : une section « univers » est un delta, pas une liste (`eca96d0`)

Un univers EST un delta par rapport aux défauts, mais `nest_universe` assigne CHAQUE décision de
l'analyse pour qu'aucune sélection ne lise `[MISSING_DECISION]`. La section imprimait cette
assignation complète : ce qu'un univers change réellement était enseveli sous la liste des défauts,
répétée une fois par univers. Elle imprime maintenant ce qui a bougé, avec la valeur d'où cela a
bougé, et compte le reste : « 3 decisions at default ».

**La formule n'a pas été écrite pour l'occasion.** `universe_diff` existait déjà dans
`observatory_provenance.py`, répondant exactement à cette question pour les cartes univers de
l'Observatory : le changement est donc un **déplacement**, pas une troisième copie (spec R9).
`analyses_of`, `_defaults_by_analysis` et `universe_diff` descendent dans
`provenance/astra_read.py`, le chargeur que les deux lecteurs partagent déjà, rejoints par
`universe_summary` et les deux formateurs. L'Observatory les importe et garde ses 229 tests
inchangés.

`summary_lines` prend le résumé plutôt que l'univers parce que le rapport d'audit de cours se rend
depuis le seul rapport, plus tard, sans document ASTRA en main : le résumé est calculé au build et
stocké à côté de la sélection complète, qui reste dans le JSON — ce rapport se lit aussi comme
donnée.

Deux choses trouvées par les tests, et aucune n'est le nit :

- **Les sections « univers » n'avaient aucune couverture.** Les deux rendus ont changé de forme et
  les 16 suites sont restées vertes ; les assertions étaient `"## Universes" in page`. Elles
  affirment désormais le delta et l'absence de la liste complète.
- Un défaut à `None` s'imprimait ``(default `None`)`` — un défaut, sur la page d'un enseignant, que
  nul artefact n'enregistre. C'est la forme réelle d'un cours dont les univers ont été écrits
  contre une autre analyse, ce que construit précisément la fixture d'approbation. Lit maintenant
  « (no default recorded) ».

services/planner 234 → 238 ; 16 suites, 0 failing.

---

## 2026-09-09 — INT-STUDIUM-008 slice 3 : l'onglet Harness (spec R7) (`8ff6046`)

R7 était la dernière exigence du design Observatory sans code : un répertoire de session explicite,
rendu en table d'étapes depuis `index.json`, `task.md` courant, dernier `feedback.md`, rafraîchi en
sondant les mtimes, sans dépendance à un file-watcher.

**La moitié intéressante n'est pas ce qui est rendu mais ce qui est posé à côté sur le disque.**
`.studium-session/` contient aussi `response.json` et `run_result.json` — la soumission de
l'apprenant et son propre résultat d'exécution — et N1 interdit de poser un champ libre d'origine
apprenant sur un onglet. Trois fichiers sont donc lus, les deux fichiers apprenant sont exclus par
une constante nommée, et **l'exclusion est testée comme un comportement** : une chaîne canari est
écrite dans les deux et vérifiée n'atteindre aucun payload ni aucune page, et un second test
enregistre chaque fichier ouvert sous un répertoire de session et compare l'ensemble à `READ_FILES`.

**Le canari a trouvé une vraie fuite.** `index.json` est rendu en table d'étapes et jamais en texte
— mais son texte brut voyageait quand même, et ses entrées portent des CHEMINS d'artefacts, que la
table réduit à des basenames (un chemin est l'endroit où un répertoire personnel, donc un nom,
fuit). Le document brut les remettait sur la page et dans le jumeau JSON. Un champ sans rendu n'est
pas inoffensif : c'est la copie que rien ne filtre.

Les noms de fichiers du protocole vivent en TypeScript et Python ne peut pas les importer ; les
noms Python sont donc un miroir. R9 interdit une seconde déclaration et la dérive TS/Py
d'`over_distrust` est le précédent : le miroir est donc **vérifié**, un test lisant
`session-workspace.ts`, en extrayant le littéral `FILES`, et tombant en nommant la dérive sur un
renommage — et sur un septième fichier, ce qui force quelqu'un à décider s'il est rendu ou retenu
plutôt qu'à hériter du silence.

Deux décisions à nommer :

- Les répertoires de session sont désignés un par un (`--session-dir`, répétable ;
  `STUDIUM_OBS_SESSION_DIRS`), jamais balayés. Le dossier siège à la racine du workspace que pilote
  un opérateur et rien n'en met plusieurs sous un même parent : une convention `<racine>/<session>`
  nommerait une disposition qu'aucun écrivain ne produit.
- Le sondage est le meta refresh de la PAGE, pas une boucle serveur : R7 interdit un watcher et R8
  interdit un état serveur. `--harness-refresh 0` le désactive. Le jumeau JSON porte l'intervalle
  comme un nombre et ne pose aucun en-tête de rafraîchissement — un client qui sonde possède son
  propre intervalle.

Rien ne lève (N3) : un index illisible, un `entries` mal formé, une ligne malformée et un fichier
illisible deviennent chacun un état et une raison sur la page. Un document mal formé n'est
délibérément pas une table vide silencieuse — une table vide se lit « cette session n'a franchi
aucune étape », ce qui est une affirmation sur la session, et une fausse.

services/observatory 198 → 229 tests ; 16 suites, 0 failing.

---

## 2026-09-09 — INT-STUDIUM-010, nits 2 et 5 : un instant par revue, et pas de second tag

Les deux nits que la revue de -010 avait laissés au·à la propriétaire, tous deux rouges avant
d'être verts.

- **Nit 2 — `eval/harness/scene_judge.py`.** `created_at` prenait l'horloge AU MOMENT DE
  L'ÉMISSION : `verdicts.json` et `review/astra.yaml` nommaient donc deux instants différents, et
  deux `write_review` sur la MÊME revue produisaient deux documents différents. `judge_bundle`
  estampille désormais une fois (`judged_at`) et `emit_review_astra` lit cette estampille avant
  l'horloge ; l'argument explicite reste prioritaire, et une revue écrite avant l'existence de
  `judged_at` s'émet encore. Le test a d'abord été écrit sur la scène PROPRE : sans défaut, le
  document ne porte aucun `created_at` et l'égalité tenait quoi que fît le code — un vert qui
  mesurait un champ absent. Réécrit sur la scène corrompue, il tombe sans le correctif.
- **Nit 5 — `services/planner/provenance/astra_emit.py`.** Ré-émettre un corps portant déjà un
  tag `source_edge_id:` en ajoutait un second. `source_edge_id` renvoyant le PREMIER, la valeur
  lue restait juste et seul le fichier grossissait — le genre de défaut invisible jusqu'au jour
  où quelqu'un compare deux émissions d'un même document et les trouve inégales. Le tag conservé
  est l'existant, qui porte le vrai id brut : à la ré-émission l'entrée est clefée par son slug,
  donc l'ajout aurait enregistré le slug comme id brut.

Vérification : `python tools/pytest_all.py` → 16 suites, 0 failing (eval/tests 47 → 48,
services/planner 233 → 234).

---

## 2026-09-09 — INT-STUDIUM-002 : une carte de résultats commise, et ce que la relecture du run bloqué a réellement montré

La moitié repo de -002. La question ouverte de l'intent — le non-achèvement de `hint_reliant`
est-il un défaut d'instrument (plafond de tours trop bas) ou un vrai résultat ? — **n'a ni l'une
ni l'autre réponse.**

La lecture tour par tour du run `05-claude-20260615-203632` montre une **boucle de trois scènes** :
du tour 4 au tour 57, la session repasse les mêmes trois quiz (index 10, 6, 2), `scenesCompleted`
figé à 4, la maîtrise figée à 0,783 sous un seuil que l'un des concepts a franchi à 0,8, et un
indice demandé à **chacun** des 58 tours de quiz. Le plafond n'a pas tronqué une session longue
mais qui progressait : il a arrêté une session qui ne progressait plus depuis le tour 4. Un
plafond plus haut n'aurait rien changé sinon le nombre de tours identiques enregistrés.

Et le run n'est pas attribuable au code commis : `hint_reliant` et `misconception` n'entrent dans
`eval/harness/personas.mjs` que le 2026-06-20 (`9c64a00`, « consolidate accumulated working-tree
state »), **cinq jours après** le run du 2026-06-15 qui les nomme. Le commentaire de
`makeHintReliant` décrit précisément le contraire de ce qui s'est produit — « INTERNALISES … the
persona COMPLETES … instead of offloading forever and hitting the turn cap » — ce qui se lit comme
un correctif écrit *après* avoir observé cette boucle. Le §8 du manuscrit s'appuie donc sur un run
produit par du code qui n'est pas le code commis. C'est exactement le défaut que -002 nomme, sous
une forme plus forte que « l'entrée C7 ne porte pas d'identifiant de run ».

- **Re-run déterministe, gratuit** (`--author deterministic`, corpus 05, aucun modèle payant) :
  les cinq personas terminent, `hint_reliant` en 17 tours, verdict `PASS`, aucune branche
  manquante. Run `05-deterministic-20260909-113535`.
- **`eval/validity/scorecard.py` + `SCORECARD.json` / `.md`**, écrits par `run_all.py` et
  **commis**, à la manière de `bea_external/external_result.json`. La carte nomme le run, le
  commit, et pour chaque outil le rapport lu **avec son sha256**.
- **L'appariement se fait sur le CONTENU, jamais sur le nom de fichier.** `grounding_relevance`
  et `bea_tutor` nomment leur rapport d'après le *bundle* (`05-bundle.json`) : le run suivant du
  même cours l'écrase sur place. Un rapport qui appartient à un autre run est marqué **non
  attribué** au lieu d'être adopté silencieusement, et le sha256 est ce qui permet à un lecteur
  ultérieur de savoir si le fichier porte encore les nombres cités.
- **`kt_calibration` est enregistré comme indépendant du run** (`n/a`) : il valide le modèle
  d'apprenant contre ASSISTments et rendrait le même nombre à côté de n'importe quel run id — le
  marquer « attribué » ferait lire une constante comme une réplication.
- **Garde RGPD avant toute écriture** : `eval/reports/` est gitignoré parce qu'il porte de l'état
  par apprenant·e, et ce fichier-ci est commis. La garde refuse la CLÉ plutôt que de la filtrer,
  et distingue un pseudonyme (16 hex) d'un sha256 (64 hex) par la forme exacte.

**Pour le·la propriétaire, non traité ici** : le run frais donne `relevance_grade 0.5` (2 scènes
évidenciées sur 4 sous le seuil), là où le §8 énonce « relevance grade 1.0 ». La formulation du §8
et l'entrée C7 du PAPER_SPEC vivent dans le dépôt manuscrit et ne sont pas modifiées ici.

Vérification : `python tools/pytest_all.py` → 16 suites, 0 failing (eval/validity 133 → 145).

---

## 2026-09-09 — INT-STUDIUM-030, R1 ÉTAPE 2 : chaque nombre publié nomme la population sur laquelle il a été calculé

R1 sur les trois surfaces restantes — les endpoints du collecteur, `tools/class_report.py`, le
tableau de bord enseignant. Le constat qui a ouvert l'étape : **`cohort_state` (le portail de
sortie) est déjà correct au niveau du cours, mais une mesure est souvent calculée sur une
population bien plus étroite que la cohorte qu'il a contrôlée.** Une ligne de confiance par scène,
un score de raisonnement par scène, une exactitude d'audit par scène, une ligne de concept dans le
rapport de classe : chacune peut être une seule personne dans une classe de trente. Le plancher
passait ; la ligne publiait le jugement d'un individu sous le nom d'une scène.

- **La population est accumulée LÀ OÙ le nombre est calculé** (`metrics.Population`), pas
  re-dérivée après coup depuis un second prédicat — un second prédicat est une seconde définition,
  et elle dérive. Un membre est une paire `(leçon, identité)` parce qu'un pseudonyme est
  `HMAC(learnerId:lessonId)` : dans UNE leçon ce sont des personnes, et une union entre leçons
  compte des paires apprenant·e–leçon. Le payload dit laquelle des deux, au lieu d'appeler les deux
  « apprenant·e·s ».
- **Le plancher s'applique par ligne, avant l'agrégat.** Une scène sous son propre plancher est
  écartée avant de contribuer à `gaps`, `over_trusts`, `over_distrusts` et à la population — pas
  seulement avant le payload : une moyenne sur deux scènes dont l'une est un individu publie la
  moitié du jugement de cet individu comme celui de la classe.
- **`cohort_band`, `cohort_counts` et `non_attribution` sont les objets du collecteur.** La
  bande et la phrase vivent dans `metrics.py` ; `observatory_sessions.py` en fait des alias, et un
  test l'assure par identité d'objet (`is`). Une phrase copiée trois fois dit trois choses
  différentes — la dérive TS/Py sur `over_distrust` est le précédent maison.
- **Ce que le test de propriété a trouvé.** Une scène retenue et trois scènes retenues devaient
  produire le même payload. `n_audits` valait `len(gaps)` sur *toutes* les scènes notables : 1
  retenue → 2, 3 retenues → 4. Le compte supprimé d'une clé revenait par la clé voisine, exactement
  le défaut de l'étape 1 où il avait survécu dans la prose. `n_audits` (et `n_scenes` de
  `compute_ai_audit_accuracy`) ne comptent plus que les scènes publiées.
- **`floor=0` lit l'arithmétique brute, et le DÉFAUT est le publiable.** Un appelant qui oublie
  l'argument retient au lieu de divulguer. Un répertoire qui mélange identités nommées et anonymes,
  ou leçons nommées et anonymes, est **refusé** plutôt que sommé.
- **Tableau de bord.** `Judgement` devient un type, requis et non optionnel, sur calibration,
  autonomie, confiance-IA et raisonnement ; `CohortLine` rend la bande et l'unité comptée,
  `WithheldNotice` l'état retenu — sans prop, parce qu'il n'y a aucun compte à passer. La
  traduction française est indexée sur la phrase exacte du serveur et retombe en verbatim si elle
  change : *stale-and-fluent* est pire que non traduit, parce que rien ne le signale.
- **Deux états rendus comme un seul, corrigés.** « Aucun signal de raisonnement reçu » et « aucun
  audit n'a encore été joué » étaient affichés quand la mesure existait mais était retenue : ils
  envoient un·e enseignant·e réparer un parcours qui n'a rien.

Vérification : `python tools/pytest_all.py` → 16 suites, 0 failing (collecteur 140 → 158, tools
32 → 39) ; `pnpm test` vert ; `next build` du tableau de bord vert (66 → 76 tests).

---

## 2026-09-09 — INT-STUDIUM-030, R1 SUR LA SURFACE OBSERVATORY : une règle d'identité, des cohortes en bandes, des motifs au lieu de comptes

La moitié R1 que l'intent mettait en attente. Quatre changements, chacun vérifiable sur un diff.

- **Une seule règle d'identité (INT-STUDIUM-025).** La colonne « session runs » publiait la
  cohorte que lui rendait `build_report`, qui retombe sur le CHEMIN DU FLUX quand un flux ne porte
  pas de pseudonyme (`tools/class_report.py:163`) : un apprenant synthétique par flux muet, donc
  une population comptée autrement que celle sur laquelle cette page avait appliqué son plancher.
  Le nombre publié vient désormais du préflight lui-même. Le chiffre de `build_report` reste
  affiché sous le nom qu'il porte honnêtement, `n_streams`, et la ligne de divergence compare donc
  deux populations comptées de la même façon des deux côtés — ou ne compare rien.

- **Une cohorte de jugement est une bande, jamais une taille (call 1).** `cohort_band`
  (`5–9 / 10–19 / 20+`), `cohort_counts` qui dit si la bande compte des personnes ou des paires
  apprenant-leçon, et `non_attribution` qui dit en toutes lettres que le nombre est une lecture de
  classe. Un effectif exact bouge à chaque nouveau contributeur — dix-neuf transitions sur une
  classe de vingt-quatre, chacune datable contre une liste que l'enseignant détient ; la bande
  bouge deux fois. Le `>= 5` que la synthèse proposait est écarté par R1 elle-même : il ne nomme
  aucune population, et une calibration sur cinq contributeurs arriverait identique à une
  calibration sur vingt-quatre.

- **Ce qui est retenu est un motif, jamais un compte (R2, deuxième clause).**
  `withheld_below_floor` / `withheld_unseen` / `withheld_unreadable` remplacent
  `n_withheld_scenes` et `n_withheld_lessons`. **Et la phrase perd le compte aussi** — c'est le
  test qui l'a trouvé : trois booléens à côté d'une raison disant « 3 scene(s) withheld »
  laissaient le canal exactement où il était. Trois nombres de scènes retenues produisent
  maintenant la même charge utile, octet pour octet.

- **`ok` veut dire qu'un nombre a été calculé (R1 au niveau de la valeur).** Chaque famille porte
  `measured`, et quand il est faux la famille dit pourquoi le `null` EST la mesure : aucune leçon
  commencée (`n_started == 0`), ou tout audit non étayé (`planted_errors == 0`). Le drapeau est
  calculé sur la valeur réellement publiée et jamais recopié d'un lecteur : un lecteur qui
  annonce `measured: true` à côté du `null` qu'il publie est le défaut, pas l'autorité sur le
  défaut — quand le rapport de classe le fait, la page le dit. `over_distrust` reste `null` sans
  faire basculer `measured` : l'écart qui A été mesuré n'est pas supprimé avec celui qui ne l'a
  pas été (le piège de la garde symétrique, INT-STUDIUM-026).

Et le nit que l'intent avait déposé sur `_read` : un `TypeError` levé par l'APPEL — signature qui
ne lie pas, donc aucune frame du lecteur sous la nôtre — n'est plus « unreadable », qui envoyait
l'opérateur chercher dans sa propre télémétrie un défaut situé dans cette page. C'est un sixième
état, `broken`, et le discriminateur est lui-même sous test dans les deux sens.

Trois tests qui épinglaient les entiers retenus sont réécrits, pas supprimés, et l'assertion qui
les remplace est la plus forte : la famille ne publie AUCUN compte de retenue. Un test à jeu de
clés exact accueille les trois clés de jugement explicitement, parce qu'un test de clés exactes
est l'endroit où une nouvelle clé doit être défendue.

`services/observatory` **197 passés** (186 avant, +11) ; suite Python complète **16 suites, 0 en
échec**. Aucun TypeScript touché. `metrics.py` et `tools/class_report.py` restent intacts : leur
tour est la seconde tranche, sous la contrainte de consommateur existant d'INT-STUDIUM-005.

---

## 2026-09-07 — OBSERVATORY TRANCHE 2, RETOUR DE REVUE : une réparation qui retirait une mesure vraie

Seconde revue indépendante, portée sur `cef794c..e6c8e8d` — la réparation elle-même. Les quatre
défauts bloquants sont confirmés fermés, et les onze régressions sont honnêtes (11 échecs sur 11
contre le module d'avant). Deux défauts introduits par la réparation, corrigés ici, rouges d'abord :

- **`requires=("n_critique", "n_hints")` supprimait une autonomie réellement mesurée.**
  `critique_completion_rate` divise par `n_critique` seul — sans critique, c'est bien un taux sur
  personne, et c'est le défaut d'origine. Mais `autonomy_ratio` divise par `n_critique + n_hints`,
  qu'un seul contributeur de l'un ou l'autre suffit à remplir : un cours où six apprenants
  soumettent une critique et où personne n'a eu besoin d'un indice vaut 6/6 = 1.0, mesuré sur tout
  le monde. La garde le rendait `unmeasured` sous une phrase affirmant que le ratio portait sur
  personne — donc fausse. Une leçon bien étayée est précisément le cas où les indices sont rares.
  `requires=("n_critique",)` ; le plancher continue de s'appliquer à toute population vivante.

- **`suppressed — None` sur la page.** Quand aucune clé ne survivait aux filtres alors qu'aucune
  population n'était sous le plancher, la famille repartait avec la raison `None` : un nombre
  retenu sans motif, sur une surface dont tout le contrat est que chaque état non-`ok` dise
  pourquoi. Et le mot `suppressed` signifie ici le plancher de k-anonymat, qui n'était pas la
  cause. `_nothing_left` sépare les deux : `suppressed` seulement si `short` est non vide, sinon
  l'état `withheld` avec la raison qui nomme la vraie cause (clé jamais scannée, valeur non
  finie), et une phrase de repli quand les deux lectures ne s'accordent pas sur ce qui existe.
  `_pair_families` cesse au passage d'affirmer le plancher pour une paire retenue autrement.

Deux remarques non bloquantes de la même revue, corrigées ici parce qu'elles portent sur du texte
et du code écrits par la réparation elle-même : la phrase « first seen when the reader ran »
affirmait une course qui n'a pas eu lieu pour une clé que le scan avait refusée sur son type — un
`scene_id` entier était là depuis le début —, et `_read` rendait `(None, None)` quand l'appelé
renvoyait `None`, si bien que la fonction écrite pour éviter un 500 en aurait levé un, hors de tout
`try`, sur le `.get` de l'appelant.

Suite du plan **615 passés, 2 sautés** ; `services/observatory` **181 passés** (610/2 et 176 avant).

---

## 2026-09-07 — OBSERVATORY TRANCHE 2, DURCISSEMENT DES SESSIONS : quatre façons de publier un nombre que personne n'a mesuré

Revue indépendante de l'intégration (`ca1ef46` + le report de la revue, `5267cdb`) : la surface
Review avait été durcie, la surface Sessions — celle qui lit la télémétrie des apprenants —
portait la même classe de défaut, plus une brèche de k-anonymat. Onze régressions écrites rouges
d'abord (`cef794c`), puis la correction (`dca7d25`). Aucun lecteur n'est réimplémenté, aucune
formule n'est ajoutée : les quatre réparations sont des refus de publier.

- **Un nombre non fini n'est pas une mesure.** `NaN` traverse `json.loads` et le garde
  `isinstance(value, (int, float))`, et les deux jumeaux ne s'accordaient pas dessus : pydantic
  le sérialisait en `null` (`{"status": "ok", "mean_autonomy": null}`, indiscernable d'une
  famille qui a tourné sans rien trouver) pendant que `"%.4g"` écrivait `nan` sur la page. La
  famille devient `unreadable` et NOMME le champ, jamais la valeur. La chaîne `"nan"` est
  refusée avec le flottant, puisque `float()` accepte les deux.
- **Un type faux est une source illisible, pas un 500.** Le préflight établit qu'une ligne parse
  et qu'elle est un objet, jamais qu'un champ porte le type que son lecteur passe à `int()` :
  un seul `"planted_errors": "abc"` faisait tomber les deux routes pour l'arbre entier.
- **L'autonomie est un rapport sur deux populations**, donc il lui faut les deux : un cours avec
  des adaptations « hint » et aucune soumission de critique publiait
  `critique_completion_rate: 0.0` sur personne. Zéro contributeur = non mesuré.
- **Le plancher est décidé sur une lecture, les nombres viennent d'une autre**, et le collecteur
  écrit dans la partition du jour pendant que la page est servie. Une scène ou une leçon qui
  apparaît d'abord dans la lecture du lecteur n'a été soumise à AUCUN plancher : elle était
  publiée avec son propre compte d'apprenants — `n_learners: 1` sous un plancher de 5. Elle est
  maintenant retenue et comptée, avec une raison distincte de celle du sous-plancher. Pas de
  cache : la projection ne publie que les clés pour lesquelles le préflight a établi une cohorte.

Un écart de confiance non fini est aussi refusé à la comparaison elle-même, où
`abs(nan - nan) > tolérance` vaut False et se serait affiché comme un accord.

**Correction d'une justification fausse déjà commitée** : l'entrée du durcissement Review
ci-dessous affirmait qu'un NaN répondait 500 sur le jumeau JSON. C'est faux — il répondait 200
avec `null`. Le défaut et la réparation restent justes ; le mécanisme enregistré ne l'était pas,
et c'est ce mécanisme qui aurait fait conclure que la colonne Sessions était sûre parce qu'elle
ne tombait pas en 500. Corrigé dans l'entrée et dans le docstring du test concerné.

Tests : `services/observatory` **176 verts** (165 avant, +11). Suite complète du plan :
**610 passés, 2 sautés** (les 2 sautés restent les imports `indicium` absents). Aucun test
existant modifié ni affaibli ; la seule retouche à un fichier de test existant est le docstring
factuellement faux ci-dessus, sans changement d'assertion.

---

## 2026-09-07 — OBSERVATORY TRANCHE 2, TÂCHES 4–7 : les deux colonnes de sessions, la page, la preuve, les docs

Quatre unités TDD du plan `studium_dev/docs/superpowers/plans/2026-09-06-studium-observatory-s2.md`
(branche `feat/observatory-s2`, base `81d3712`), avec les **six amendements d'exécution** de la
revue indépendante du 2026-09-06, qui remplacent les règles de cohorte, de comparaison, d'erreur et
de sortie du plan initial. **La tâche 8 (vérification manuelle sur artefacts réels, capture
d'écran) n'est pas faite** : elle appartient au coordinateur.

- **Les deux colonnes** (`eca201f`) : `observatory_sessions.py`. Deux lecteurs, aucune troisième
  formule : `metrics.compute_*` sur `<store>/<cours>/<date>.jsonl`, `class_report.build_report` sur
  UN répertoire. Ce qui est neuf est le préflight que ni l'un ni l'autre ne peut faire pour
  lui-même :
  - **cohorte par leçon.** `learner_pseudonym` = HMAC(learnerId:lessonId) : une personne DANS une
    leçon. Chaque partition de leçon doit atteindre le plancher ; une union inter-leçons compte des
    paires apprenant-leçon et ne peut jamais faire franchir le plancher à une leçon. Une personne
    portant cinq pseudonymes salés reste supprimée ; au-delà d'une leçon `n_learners` est `null` et
    l'agrégat s'appelle `n_learner_lesson_pairs`, y compris dans le rapport imbriqué.
  - **un cours peuplé ne prouve pas une métrique peuplée.** Chaque famille est fermée sur les
    pseudonymes qui ont RÉELLEMENT contribué aux events que son lecteur consomme — par leçon, et par
    scène en plus pour une valeur par scène. Six participants dont un seul auditeur ne publient pas
    le résultat de confiance de cette personne. `metrics._is_autonomy_critique` est importé (pas
    recopié), donc `explain_back` ne peut pas élargir la cohorte d'autonomie. Zéro contributeur =
    « non mesuré », jamais un zéro mesuré. Une famille supprimée d'un côté supprime sa paire de
    l'autre : un nombre montré d'un côté et retenu de l'autre EST le nombre retenu, par différence.
  - **projection opérateur seulement** : progression par scène assainie, complétion par leçon,
    résumés d'autonomie et de confiance ; complétion de session, autonomie moyenne, résumé de
    confiance. Les concepts, règles d'adaptation, priorités de reprise et charges par scène du
    rapport de classe restent dehors, comme la liste `per_scene` brute du collecteur. Chaque famille
    omise ou supprimée porte sa raison, en HTML et en JSON.
  - **une colonne supprimée ne porte AUCUN nombre**, pas même la taille de cohorte que la forme
    « suppressed » de `build_report` renvoie.
  - **divergence sur une seule portée identique** `(lesson_id, bundle_version)` des deux côtés.
    Plusieurs portées, des portées différentes, ou le seau `"unversioned"` : les deux colonnes se
    rendent indépendamment avec la raison, sans drapeau. Supprimé et non mesuré ne se lisent jamais
    comme un accord (`comparable: false`, `diverges: null`).
  - **« illisible » est un état distinct** d'absent et de supprimé : 200 avec un marqueur
    `basename` + classe d'exception, diagnostic journalisé. Jamais un répertoire parent de session
    (ses segments sont des pseudonymes), jamais un message d'exception.
  - **confinement avant chaque lecture** via `observatory_discovery._within` : un enfant de store
    qui sort de la racine n'est pas listé donc pas routable, et un lien JSONL/télémétrie qui sort de
    la racine est refusé AVANT son lecteur — `build_report` découvre son entrée tout seul et ne
    pourrait pas être arrêté après.
  Complétion et autonomie sont **montrées, jamais signalées**, chaque formule nommée à l'écran :
  populations différentes, et deux définitions d'« autonomy ratio » qui partagent un nom et pas une
  formule (défaut à part, intention Draft, non résolu ici). 34 tests.
- **La page Sessions** (`4d3c82f`, corrections de formulation `23719d7`) : quatre routes
  (`/sessions`, `/sessions/{cours}` et jumeaux JSON), id résolu uniquement par `store_courses`.
  Deux colonnes avec le chemin absolu lu et le lecteur qui l'a lu, cohorte étiquetée pour ce qu'elle
  est, raison à la place de chaque valeur retenue, table « indicateurs comparés » (ou la raison de
  l'absence de comparaison), table « montré, non signalé » avec les deux formules issues de la
  constante de module, et la phrase D1 en bannière. Les quatre états ont été rendus hors serveur
  dans `/private/tmp/studium-observatory-s2-codex/sessions-*.html` pour relecture visuelle ; trois
  formulations corrigées à la lecture du rendu. 11 tests de route.
- **La preuve sur les nouvelles routes** (`28a8345`) : `_urls()` gagne les deux routes Review par
  cours et les quatre routes Sessions ; la boucle de secrets gagne les six pseudonymes du store.
  Aucun changement de production nécessaire. Deux ajouts pour ce que seule cette tranche peut fuir :
  une page sous le plancher qui ne porte que la raison (les jetons interdits sont exactement ceux
  que la page « ok » affiche pour les mêmes fixtures — vérifié côte à côte, donc l'assertion
  discrimine), et les pseudonymes du store absents des quatre routes **et comptés par la même
  requête**, pour que la preuve ne puisse pas passer parce que rien n'a été lu. La couverture du
  crawl a été prouvée mordante hors test en injectant un pseudonyme dans le rendu Sessions
  (`prove_crawl_bites.py`) : les quatre nouvelles URL déclenchent.
- **Docs** (ce commit) : `services/observatory/README.md` (variable, drapeaux, deux nouvelles
  pages, section « les deux sources de session », plancher à deux niveaux et paire de colonnes) et
  `docs/guides/observatory.md` (en termes opérateur : ce que signifie et ne signifie PAS un
  drapeau, pourquoi rien n'est comparé sur des portées ambiguës, pourquoi un ancien run
  synthétique ne produit pas de colonne — identité inconnue, pas persona comptée comme personne).
  `.github/workflows/ci.yml` **lu et vérifié** : l'étape Observatory passe le répertoire
  `services/observatory`, les nouveaux fichiers de test sont donc pris sans édition.

Tests : `services/observatory` **141 verts** (94 avant, +47). Suite complète du plan :
**575 passés, 2 sautés** (les 2 sautés sont les imports `indicium` absents, inchangés).
Aucune dépendance ajoutée ou épinglée autrement. INT-STUDIUM-005 **n'est pas déclarée fermée** :
les lecteurs et endpoints en amont gardent leurs propres planchers inter-leçons et contributeurs,
suivis à part côté hub.

---

## 2026-09-07 — OBSERVATORY TRANCHE 2, DURCISSEMENT DES TÂCHES 2–3 : la surface Review contre des artefacts qu'aucun émetteur n'écrit

Correction bornée des trois défauts matériels relevés par une revue indépendante sur
`f0a9d77..81d3712`, branche `codex/observatory-s2-review-hardening`. Aucun périmètre produit
nouveau : `review/<bundle_id>/` est le seul arbre d'un cours dont les noms et le contenu viennent
de qui a lancé le juge, et les trois défauts sont trois façons de mentir plutôt que d'échouer en
douceur. Un fichier de test de régression écrit rouge d'abord (`8a988cb`), puis le garde
`protect-tests` armé pendant la correction.

- **Les deux moitiés d'une revue sont lues indépendamment** (`astra_read.load_course`) : le lecteur
  lisait `astra.yaml` en premier et sautait le bundle quand il manquait ou était illisible, ce qui
  faisait disparaître un `verdicts.json` parfaitement lisible — exactement le défaut
  qu'INT-STUDIUM-020 avait corrigé pour le fichier plat hérité, réintroduit par bundle. Les deux
  moitiés sont désormais lues chacune pour elle-même ; le `ReviewDoc` existe dès que l'une est
  lisible, le marqueur ASTRA (`missing` / `unreadable: <Type>`) reste affiché, et un répertoire
  dont aucune moitié n'est lisible n'est toujours pas une revue. `CourseDocs.review` prend le
  premier document ASTRA LISIBLE (le fichier hérité gardant sa priorité), donc `None` veut dire
  « aucune revue affichable » et jamais « la première était cassée » — `tools/astra_render` est
  inchangé.
- **Une valeur malformée n'est pas une mesure** (`observatory_provenance`) : `bool("false")` vaut
  `True`, donc une calibration en échec s'affichait comme réussie ; `float("nan")` est un float,
  et les deux jumeaux ne s'accordaient même pas dessus : l'annotation `-> dict` de la route fait
  passer la charge par pydantic (`ser_json_inf_nan='null'`) avant que `allow_nan=False` ne la
  voie, donc un seul NaN répondait 200 avec `null` sur le jumeau JSON — indiscernable d'une
  calibration qui aurait tourné sans rien trouver — pendant que `%.4g` écrivait `nan` sur la page
  (N3 ; mécanisme corrigé le 2026-09-07, la mention d'un 500 était fausse) ; un nombre de paires absent était
  rendu `0`, c'est-à-dire une calibration qui aurait tourné. Kappa et confiance sont maintenant
  validés finis et dans leur intervalle (`bool` n'est pas un nombre : `True` est un `int` en
  Python), `separates` est un booléen ou « non renseigné », les blocs `scenes` / `skipped` /
  `worst_case` / `calibration` du mauvais type sont NOMMÉS au lieu de se vider en silence, et un
  mot qui n'est pas un des trois verdicts du juge n'est ni classé ni affiché comme un verdict. Le
  demi-état que la page ne savait pas montrer — le fichier a parsé, une valeur dedans n'en est pas
  une — devient la liste `problems` (`{field, reason}`) rendue par le macro `markers` existant :
  le champ et le TYPE, jamais la valeur, jamais la ligne source, jamais un message d'exception.
  Les lignes saines et les décisions ASTRA du bundle survivent à côté.
- **Un artefact de revue ne quitte pas son cours** : `is_file()` et `is_dir()` suivent les liens,
  donc un lien déposé sous `review/` faisait lire — et rendre — un document de n'importe où sur la
  machine. La règle est celle que `observatory_discovery._within` applique déjà à toutes les
  racines balayées, portée ici sur la racine `review/`, les répertoires par bundle, `astra.yaml`,
  `verdicts.json` et le fichier hérité. Cible externe : marqueur `unreadable: leaves the course
  directory`, cible jamais divulguée, chemin dans le journal seulement. `iterdir()` illisible et
  résolution de lien impossible échouent en douceur en `strict=False` ; en `strict=True` le lecteur
  lève, parce que strict a toujours voulu dire « ne pas deviner ».
- **Conflit d'identité de bundle** : quand l'id valide de `verdicts.json` ne se slugifie pas
  (`scene_judge.bundle_slug`, importé) vers le répertoire qui le stocke, l'un des deux est faux et
  le lecteur ne peut pas dire lequel. Le répertoire — le seul fait observé et non lu — est affiché,
  le conflit est nommé, l'id revendiqué n'est jamais rendu. Le chemin heureux `Unit 1/Intro` sous
  son slug et les replis hérités sont inchangés.

Tests : nouveau `services/observatory/tests/test_observatory_review_robustness.py`, **24 verts**
(ASTRA manquant/malformé avec verdicts valides, cinq échappements par lien symbolique dont le
lecteur strict, NaN/Infinity/−Infinity, kappa hors intervalle, `separates` chaîne et absent, compte
de paires non entier, confiance NaN et booléenne, conteneurs imbriqués du mauvais type, verdict
inconnu en scène et en `worst_case`, conflit d'identité, id slugifié). `services/observatory`
**118 verts** (94 avant), `services/planner` **233 verts, 2 sautés**, `tools/test_astra_render.py`
**4 verts** ; avec `eval/tests/test_scene_judge.py`, `tools/test_class_report.py` et
`services/analytics-collector` : **498 passés, 2 sautés**. Aucun test existant modifié ni affaibli.

---

## 2026-09-06 — OBSERVATORY TRANCHE 2, TÂCHES 1–3 : racine de sessions, lecteur de revue, onglet Review

Trois unités TDD du plan `studium_dev/docs/superpowers/plans/2026-09-06-studium-observatory-s2.md`,
branche `feat/observatory-s2` (base `f0a9d77`). **Les tâches 4 à 8 ne sont pas faites** : colonnes
de sessions, page Sessions et confiance, preuve lecture-seule/confidentialité sur les nouvelles
routes, docs, vérification manuelle sur artefacts réels.

- **Racine de sessions + les deux drapeaux CLI** (`beb2a65`) : `STUDIUM_OBS_SESSIONS_ROOT` désigne
  UN répertoire, résolu en absolu comme le store collector d'INT-STUDIUM-019, lu en entier par
  `class_report.build_report` (`rglob("telemetry.jsonl")`). Volontairement NON découpé par cours :
  ni l'arbre durable (`<pseudonyme>/<bundle_id>/`) ni celui d'un run d'éval (`<persona>/`) n'a de
  dimension cours. `main()` gagne `--sessions-root` et `--analytics-data-dir` — ce dernier manquait
  depuis INT-STUDIUM-019, le store n'était atteignable que par variable d'environnement.
  Fixtures : les MÊMES events dans les deux layouts, construits depuis les modèles Pydantic ADR-006
  et écrits par `store.append_events` du collector ; `lesson_id` et `learner_pseudonym` sur chaque
  event (le pseudonyme est HMAC(learnerId:lessonId) — une personne DANS une leçon, pas une identité
  inter-leçons, donc une leçon par pseudonyme). Contrôle hors test : 60 lignes identiques des deux
  côtés, 6 apprenants distincts, même écart de confiance (0,083, bande « bien ») chez les deux
  lecteurs — l'accord est donc l'état par défaut et un test de divergence devra le provoquer.
- **Lecteur de revue** (`28eb107`) : `reviews_detail(ref)` rend une section par bundle, pire cas
  d'abord aux deux niveaux, avec `VERDICTS` et `worst()` importés du juge (pas de seconde table de
  sévérité) ; `verdicts.json` obtient son premier lecteur et `bundle_id` arrive pour la première
  fois à l'écran. **Le répertoire n'est pas l'identité** : `write_review` slugifie l'id fourni par
  l'auteur (`Unit 1/Intro` → `Unit-1-Intro`) et `load_course` remonte le SLUG ; la vue affiche l'id
  jugé de `verdicts.json`, garde le slug dans `dir_slug`, nomme la provenance dans
  `bundle_id_source`. Tolérance aux pannes portée sur la FORME et pas seulement la syntaxe : gardes
  de type sur chaque bloc, verdict non reconnu jamais passé à `worst()` (sa table lèverait),
  marqueur assaini `unreadable: not a list (<type>)` avec le détail journalisé, décisions ASTRA du
  bundle préservées dans tous les cas. `worst_overall` reste `None` quand rien n'a pu être classé :
  « non lu » ne se rend jamais comme « relu, propre ».
- **Onglet Review** (`b36245a`) : `/courses/{id}/review` et son jumeau JSON, id résolu uniquement
  par `discover(cfg)` (un répertoire non-cours sous la racine reste un 404). Scènes, dimensions,
  scénarios d'échec et citations du juge (contenu de bundle, jamais de télémétrie), scènes sautées,
  calibration (kappa / sépare / paires ; `gold` et `pred` non recopiés), lien depuis la page cours.
  Un cours sans revue rend le marqueur `(missing review/astra.yaml)` et un 200.

Tests : `services/observatory` 94 verts (75 avant, +19). Suite complète du plan :
**528 passés, 2 sautés** (base équivalente 509 + 19 ; les 2 sautés sont les imports `indicium`
absents). Deux échecs `eval/tests/test_drive_integration.py` observés à la mesure de base de la
session tenaient aux liens pnpm par paquet absents du worktree ; ils sont apparus depuis, hors de
cette session, et ces tests sont verts.

---

## 2026-08-21 — RAPPORT DE CLASSE + PORTE DE PARITÉ TS/PY (la classe de dérive est fermée)

- **class_report.py** : section trust_calibration dans le rapport hors-ligne enseignant (JSON+MD),
  MÊME formule que le collecteur (import de `_over_distrust_rate`/`TRUST_WELL_BAND` — pas de 3e
  copie), ligne explicite « NOT measured » sans audits ancrés ; le cas-sonde planted=2/sound=8/fp=6
  → gap −0.75 « sous » est épinglé par test. Docstring périmée d'`analytics_collector_app` corrigée.
- **Porte de parité de contrat** (`packages/telemetry-events`) : `scripts/contract_dump.ts` émet
  {type: {champ: required|optional}} depuis l'union Zod ; `tests/test_contract_parity.py` construit
  le même résumé depuis l'union Pydantic et échoue sur TOUTE asymétrie. Collectée par le `pytest`
  racine (testpaths=packages) → déjà en CI. **Prise immédiate : 3 types d'événements absents côté
  Python (hint_requested, universe_selected, tutor_move) — le collecteur les REJETAIT à l'ingestion
  (batch validé par `list[TelemetryEvent]`).** Modèles ajoutés en miroir exact + preuve
  endpoint-niveau (POST /telemetry accepte les 3). 166 tests collector+telemetry verts.

---

## 2026-08-20 (suite) — JUGE DE SCÈNES, MySTRA, VSIX AUTONOME, PREUVE MULTI-HARNAIS

Quatre unités TDD dans la foulée du support ASB/ARA :

- **Juge de contenu par scène** (`eval/harness/scene_judge.py`, 9 tests) : dimensions discrètes
  (key_correctness, distractor_quality, flaw_veracity, key_recall, evidence_sufficiency,
  locale_consistency, asset_congruence), verdict pass/suspect/defect + failure_scenario OBLIGATOIRE,
  agrégation pire-cas (jamais de moyenne — leçon du 0.883), calibration par scènes corrompues
  déterministes (kappa via bea_external/agreement), échec LLM ⇒ scène SKIPPED jamais inventée
  (leçon critic.py). Verdicts émis en décisions ASTRA (review/astra.yaml, forme ASB).
- **MySTRA** (`tools/astra_render.py`, 4 tests) : page MyST composée DEPUIS astra.yaml + universes/
  + trace/exploration_tree.yaml + review/ — décisions avec alternatives et exclusions, univers,
  arbre d'exploration en mermaid, verdicts de revue. Jamais rédigée à la main.
- **VSIX autonome** (`studium-vscode`) : lesson-mcp esbuildé en `dist/lesson-mcp.cjs` (entrée
  dédiée `lesson-mcp-entry.ts` — la garde import.meta ne se déclenche pas en bundle CJS), résolution
  checkout-d'abord / bundle-ensuite / erreur actionnable sinon (`resolveServerLaunch`, spawn
  ELECTRON_RUN_AS_NODE), réglage repoRoot documenté facultatif. 12 drivers verts ; VSIX empaqueté
  avec le serveur embarqué (923 Ko) ; smoke stdio du bundle OK.
- **Preuve multi-harnais** (`apps/lesson-mcp/scripts/headless_smoke.mjs`, en CI) : un client MCP nu
  (SDK seul, zéro code VS Code) démarre une vraie leçon atomistique-l1, soumet une réponse, lit le
  render manifest — 14 assertions. Matrice harnais : `docs/guides/agent-harness-matrix.md`
  (Claude Code / Cursor / OpenCode + canal fichier du protocole de run).

---

## 2026-08-20 — SUPPORT ASB + ARA : document ASTRA imbriqué (`analyses:`) + trace d'exploration

**Objectif** : qu'un `astra.yaml` de Studium soit lisible par les chargeurs de l'écosystème ASB
(forme imbriquée réelle, cf. `asb_benchmark_metabolomics_v1/q_metlinkr`), et que chaque build de
cours émette aussi le trajet de recherche au format ARA (spec exploration-trace 0.1.0 d'ASB).

**Livré** (ADR `docs/adr/0001-astra-analyses-shape-and-ara-trace.md`) :
- `emit_astra` → document ASB : racine `version/name/description/inputs/outputs` (pas d'`id`
  racine ; `description` car 0.0.12 a supprimé `Narrative`), le cours = UNE sous-analyse sous
  `analyses:`, sorties racine ré-exportées via `from`. Univers imbriqués (`nest_universe`) ;
  la charge `lesson_plan.universes` reste plate (API interne).
- Lecteurs bi-formes : `analysis_body(doc)` + `_universe_decisions(u)` dans `approval.py` —
  les artefacts pré-imbrication continuent de se résoudre.
- NOUVEAU `provenance/exploration_trace.py` (contrat 0.1.0 vendored depuis ASB `trace_extract`) :
  racine `question` + un nœud `decision` par décision du build (choice + alternatives),
  `source_refs` pointant dans `astra.yaml` ; construit DEPUIS le document émis (zéro dérive d'ids).
  Écrit `trace/exploration_tree.yaml` à chaque build LWG.
- Vérif interop structurelle : seul écart racine vs le document ASB réel = `description` vs
  `narrative` (= exactement la migration 0.0.10→0.0.12). `astra validate` (CLI) indisponible
  hors-ligne — à exécuter dès que possible.

**Vérifié** : suite planner **208 verts** (dont 5 nouveaux tests de trace + 2 tests de forme) ;
TDD (tests rouges d'abord : collection errors sur `analysis_body`/`nest_universe`/module trace).

---

## 2026-08-19/20 — AUDIT DU HUB : métrique de confiance TS/Py alignée, ASTRA 0.0.12, échecs silencieux

Voir `docs/audits/2026-08-19-hub-audit.md` (grand livre corrigé/ouvert). Points saillants :
`sound_total` ajouté à `ai_audit_result` (Zod+Pydantic) — le collecteur calcule enfin
`over_distrust` comme le moteur (min(fp,sound)/sound, `None` si non mesuré) ; `critic.py` ne
fabrique plus un 0.78 sur échec LLM (raise en mode live, mock estampillé `is_mock`) ; canal
run-protocol : stderr → OutputChannel, parse gardé, RunResult persisté sur échec ; ASTRA
0.0.10→0.0.12 via contrat vendored + ids slugifiés + tests de conformité RÉELS — le panel de
revue a attrapé que la slugification cassait la jointure `approval.py` (réparée via
`source_edge_id`, test qui appelle vraiment `_astra_for`) ; lint de bundles repo-wide en CI
(`tools/bundle_lint.mjs`) + XOR payload/path sur RenderAsset + distracteurs du quiz carbone
reconstruits (4 choix à 6 électrons, une idée fausse distincte chacun).

## 2026-07-17 — CAPSULE PHARE concept→reproduire→juger (métabolomique, patron déterministe)

**Objectif** : démontrer la boucle nord-étoile sur du CONTENU métabolomique RÉEL (pas un jouet) — un
apprenant reproduit une vraie annotation puis audite une lecture IA sur-confiante de SON propre résultat.

**Livré** (`fixtures/metabo-judgment-demo/`) :
- `run.py` : vrai **cosinus modifié** de type GNPS (appariement glouton, tolérance de fragment + décalage
  de précurseur), stdlib. Landmark déterministe `MODIFIED_COSINE=0.6477 MATCHED_PEAKS=7` (niveau analogue,
  PAS une identité — d'où le défaut planté « MSI-1 confirmé »). `spectra.json` = paire quasi-analogue (CH2).
- `judgment.json` : scène `spot_the_flaw` (verdict_deck) fondée sur le landmark ; 3 affirmations
  défectueuses (MSI-1 / confirmé / nouveau) + 2 solides (le cosinus modifié tolère le décalage de masse ;
  7 fragments partagés). Audit métabolomique authentique.
- `README.md` : conception + plan de bascule vers un vrai jeu FBMN public + porte de fidélité + FRONTIÈRE
  HONNÊTE (c'est le PATRON prouvé sur de petites données réelles ; le flagship complet = semaines + un jeu
  de données redistribuable à confirmer).

**Vérifié** : 5 tests verts (`pytest`) — landmark déterministe, cosinus identique=1, matching par décalage
de masse, scène fondée sur le landmark.

---

## 2026-07-17 — PAQUET DE PRÉPARATION D'ESSAI DÉCISIF (pré-enregistrement + puissance + export)

**Objectif** : l'étape empirique décisive du manuscrit (un essai en classe mesurant un gain
d'apprentissage) reste à faire ; pré-engager l'étude pour que le trio (étudiant + ingénieur
pédagogique + chercheur) l'exécute le trimestre prochain comme une collecte de données, pas une
conception à partir de zéro.

**Livré** (`eval/decisive-trial/`) :
- `PREREGISTRATION.md` : croisement intra-sujet, bras traitement (boucle opération→jugement) vs
  contrôle actif ; critère primaire = score de TRANSFERT de jugement (auditer une lecture erronée
  d'un résultat non produit par l'apprenant) ; H1/H2/H3 ; plan d'analyse ; consentement ; le trio.
- `power_analysis.py` (stdlib : `math.erf` + quantile d'Acklam ; pas de numpy/scipy) : puissance
  analytique du plan apparié + vérification Monte-Carlo. Chiffres : d_z=0,5 → 32 apprenants (80 %),
  43 (90 %) ; EDM à n=60 → 0,36, n=120 → 0,26.
- `pilot_export.py` : projette la télémétrie `ai_audit_result` en table d'étude par apprenant
  (score de transfert, fausses alertes), squelette que le trio remplit avec les données réelles.

**Vérifié** : 9 tests verts (`pytest eval/decisive-trial/`). MC=0,914 vs analytique=0,918 à n=45,d=0,5.

**Reste** : D4 capsule métabolomique phare.

---

## 2026-07-17 — ATTESTATION DE RUN (anti « opération-théâtre »)

**Objectif** : `passed` est ASSERTÉ par l'opérateur — Studium ne peut pas le vérifier (cerveau seul). Un
opérateur paresseux/bogué/malveillant pourrait alimenter un run fabriqué → scène de jugement → `trust_calibration`.

**Livré** :
- `packages/lesson-session-host/src/run-result.ts` : `verifyRunAttestation(manifest, result)` — vérifie
  SANS exécuter, sur les seules données rendues : sorties déclarées produites, checks déclarés rendus+passés,
  cohérence `passed` vs checks, présence d'un landmark. Non-answer-bearing (jamais la VALEUR du landmark).
- `host.ingestRunResult` : un run non attesté AVANCE quand même (la porte de délégation reste `ran && passed`)
  mais est MIS EN QUARANTAINE — ni `recordLearnerRun` ni régénération, donc il ne fonde aucun jugement et
  n'alimente jamais `trust_calibration`. Réutilise la règle existante « non-fondé ⇒ n'alimente pas la confiance ».
- MCP `submit_run_result` expose `attested` + `attestation_reasons` (visibilité enseignant).
- Frontière honnête documentée : attaque le théâtre PARESSEUX/PARTIEL/INCOHÉRENT, PAS une contrefaçon
  parfaite (pas d'attestation cryptographique d'exécution). Le gabarit d'opérateur produit un run conforme.

**Vérifié** : host 156 verts (7 unit d'attestation + 1 quarantaine e2e). 3 fixtures de run rendues réalistes
(elles étaient vides = le cas théâtre même). tsc propre.

**Reste** : D3 préparation d'essai, D4 capsule métabolomique, mise à jour ciblée du preprint.

---

## 2026-07-17 — INSTRUMENT DE CONFIANCE BIDIRECTIONNEL (deck de verdicts + SDT) + harnais de validité de la porte

**Objectif** : mesurer la SUR-MÉFIANCE sans clé LLM et séparer compétence et biais de confiance (le
`trust_calibration` signé confond les deux). Ferme la limitation 4c du manuscrit côté hors-ligne. Décision
verrouillée après débat à 3 experts (psychométricien + ingénieur + sceptique-validité) : deck hybride,
complément (pas remplacement), porte INCHANGÉE, pas de porte sur le critère c (le scepticisme est la
direction sûre).

**Livré** :
- `packages/learner-state/src/sdt.ts` : détection du signal — `computeSdt` (correction loglinéaire Hautus
  1995), `inverseNormalCdf` (Acklam), A' (Grier), B''D (Donaldson), d', c, variance de Miller.
- `recordJudgmentSdt` + champs `ConceptState` optionnels `trust_sdt_counts` / `trust_discrimination` (A') /
  `trust_bias_c` (c), cumulés par concept. `recordJudgmentAudit` INCHANGÉ — la porte de certification et
  `trust-gate.test.ts` restent verrouillés.
- `packages/lesson-session/src/grading/deck.ts` : deck de verdicts déterministe, tokens opaques d0..dN,
  mélange salé par un SECRET SERVEUR (`STUDIUM_DECK_SECRET`, sinon aléatoire par process) — la permutation
  n'est PAS reconstructible côté client (Kerckhoffs ; corrige la fuite positionnelle trouvée par le panel).
  `flawGrader` gagne la branche `flaw_verdicts` : une case cochée = un signalement, donc les fausses alertes
  sur les `sound_claims` sont COMPTÉES sans LLM (sur-méfiance hors-ligne, clé-libre).
- `verdict_deck` (schéma TS + miroir Python), `PublicScene` projette le deck sans étiquette,
  `response-input-schema` + `types` : nouvelle réponse `flaw_verdicts`, l'engine plie `recordJudgmentSdt`
  à côté du gap signé.
- `packages/lesson-session/src/gate-validity.ts` (Direction 2) : `runGateValidity` + 4 dispositions
  canoniques ; apprenants synthétiques (paramètres INDÉPENDANTS P(flag|flawed/sound)) à travers le VRAI
  grader → plis → porte ; l'instrument RETROUVE la disposition et le taux de FAUX-MAINTIEN mesuré = 0. Démo
  `apps/lesson-mcp/src/gate-validity-demo.ts`.

**Vérifié** : 570 tests verts (+50). tsc propre. Panel adversarial (fuite de redaction + maths SDT + archi
+ direction/docs) : 1 bloquant (fuite positionnelle du deck) CORRIGÉ, advisories traitées (docstrings
`trust_calibration` obsolètes, code mort, formulation non-circularité).

**Reste** : D5 attestation d'exécution, D3 paquet de préparation d'essai en classe, D4 capsule
métabolomique phare. Branche `feat/trust-instrument` (non poussée).

---

## 2026-06-28 — TRUST_CALIBRATION : la direction OVER-DISTRUST est ENFIN ALIMENTÉE (live LLM AuditJudge) + 3 preuves live

Ferme la frontière d'honnêteté documentée : le matcher par mots-clés ne pouvait JAMAIS mesurer la sur-méfiance (il porte la clé des fautes plantées, pas les affirmations SAINES — il ne distingue pas « signaler à tort » de « louer »). Un juge LLM, lui, reçoit les DEUX listes.

- **PORT** `AuditJudge.judge({flawed_content, flawed_claims, sound_claims, critique}) → {caught_flaw_ids, wrongly_flagged_sound_ids}` ; **SCHÉMA** `spot_the_flaw.sound_claims?:[{id,text}]` (clé de réponse sur-méfiance, server-side, strippée par publicScene + miroirs Python) ; **GRADER** `flawGrader` consulte `auditJudge` SI présent ET sound_claims → true_positives + false_positives, sinon matcher (fp=0, frontière préservée) ; **ADAPTERS** `StubAuditJudge` (offline, ne fabrique jamais de sur-méfiance) + `HttpLlmAuditJudge` (endpoint OpenAI-compatible, zod-validé, dégrade au fallback mots-clés, **timeout AbortSignal**) ; câblé live UNIQUEMENT sous `live && LITELLM_BASE_URL` (offline ⇒ undefined).
- **PREUVES LIVE (OpenRouter `claude-haiku-4.5`, Anthropic-direct rate-limité jusqu'au 2026-07-01)** : (1) opérateur LLM pilote une session réelle + capsule réelle → `trust_calibration=0.25` ; (2) sur-méfiance : critique sur-sceptique → `false_positives=1/1 sound → −0.500` ; critique calibrée → `0.000` ; offline stub → fp=0 (frontière tenue) ; (3) régénération par-run (slice suivante).

**Vérification** : learner-state 38 + lesson-session 223 + lesson-session-host 146 + adaptation-engine 51 + lesson-bundle-schema 62 + lesson-mcp 13 + lesson-server 31 ; Python scene-synth+compose+schema 207 ; `tsc` propre. Revue adverse (workflow 4 lentilles + réfutation, **9 confirmés**) entièrement repliés : (should) le DÉNOMINATEUR `planted` divergeait entre chemin mots-clés (compte de mots-clés) et chemin LLM (compte de claims) → standardisé en **compte-de-claims-distincts** dans LES DEUX chemins (over_trust comparable offline/live) ; (should) over_distrust normalisait fp par le compte de FAUTES → normalisé par la population SAINE (`sound_total` plumb dans judgment_audit + recordJudgmentAudit) → deux taux commensurables ; (should) jugement LLM unique non-répliqué → documenté (blend λ=0.5 lisse, multi-vote différé) ; (should) miroirs Python droppaient sound_claims → ajoutés (scene-synth + lesson-bundle-schema) ; (should) fetch sans timeout bloquait respond() → AbortSignal.timeout sur les 2 adapters ; (nit×3) ids distincts, granularité caught, commentaires-frontière périmés → corrigés.

---

## 2026-06-28 — Régénération par-run : générateur de jugement LLM LIVE (HttpLlmJudgmentGenerator)

Concrétise la frontière « live per-run regen quality » : le `judgment-generator.ts` n'avait que le stub ; le générateur LIVE était décrit mais pas implémenté.

- `HttpLlmJudgmentGenerator(baseUrl, {apiKey, model, timeoutMs})` : écrit une lecture IA DÉLIBÉRÉMENT FAUSSE ancrée sur le run RÉEL de l'apprenant (landmark) + la clé de réponse (claims + flaws_expected) + model_correction ; endpoint OpenAI-compatible ; zod-validé (rule 002) ; **dégrade au StubJudgmentGenerator** sur tout échec (transport/non-JSON/schéma) → jamais une scène sans clé ; AbortSignal.timeout. La clé reste server-side (publicScene strippe claims/sound_claims/model_correction).
- **PREUVE LIVE** : régénère des fautes APPARIÉES au run sur deux landmarks différents (k=0.4212/half_life=1.6457 vs k=0.0917/7.5589) → chaque lecture fausse s'ancre sur SON k réel, fautes distinctes (soundness capsule stochastique).

**Vérification** : lesson-session-host 146 (4 neufs : stub ancré, parse+validate live, dégrade non-200, dégrade schéma-invalide) ; `tsc` propre.

---

## 2026-06-28 — FSRS : SEEDING du replay de session depuis la mémoire de profil (accumulation cross-lesson)

Ferme l'avant-dernier petit reliquat : aujourd'hui le routeur cross-lesson LIT `profile.concept_memory`, mais le replay de CHAQUE leçon repart de zéro — donc re-réviser un concept partagé donnait une stabilité B-seule, pas A+B. Le seeding fait que le replay démarre DEPUIS la mémoire accumulée du profil.

- `lesson-session-host/host.ts` — `memoryFromHistory(concept_id, state, seed?)` + `conceptMemoryFromState(state, seed?)` acceptent un seed optionnel (backward-compatible : tous les appels existants — reviewQueue / nextReinforcement within-session — passent SANS seed, comportement inchangé, scope-session). La branche `respond(complete)` seed depuis `base.concept_memory` (le profil dans lequel on merge) → la répétition espacée COMPOSE A+B+C… à travers les leçons.
- **Dédup par timestamp** : le seed couvre déjà tout jusqu'à son `last_reviewed_at` ; sur un RESUME du même bundle l'historique chargé RETIENT ces réponses → on ne re-fold QUE les réponses strictement postérieures. Ré-répondre une scène plus tard est une vraie récupération → ça accumule (reps +1 par ré-réponse, l'historique chargé n'est jamais re-foldé). Garde seed MAL-FORMÉ (reps≥1 mais stability≤0/last null → pas une ancre FSRS valable → replay propre depuis le défaut, pas de demi-reset silencieux).

**Vérification** : lesson-session-host 142 (10 neufs : accumulation, no-re-fold de l'historique chargé, RESUME+ré-réponse host-level reps 1→2→3 exactement +1, borne clock-skew/same-ms, garde seed mal-formé, chaîne multi-leçons A→B→C, persistance durable) ; dépendants verts (learner-state 36, adaptation-engine 51, lesson-session 214) ; `tsc` propre. Revue adverse (workflow 4 lentilles + réfutation, **5 confirmés**) repliés HONNÊTEMENT : le « must-fix » (la suite d'idempotence prouvait un no-op que le chemin RESUME réel ne déclenche jamais ; le vrai chemin ré-répond → reps monte) était en fait le COMPORTEMENT CORRECT (ré-répondre = vraie récupération) mal documenté → docs/tests reformulés + test host-level RESUME+ré-réponse prouvant +1 exact (jamais re-fold de l'événement chargé) ; should-fix clock-skew (un événement neuf à un timestamp ≤ seed est conservativement sauté — sous-comptage borné, auto-guérison, jamais de double-comptage) documenté + testé ; should-fix chaîne multi-leçons testée ; should-fix seed mal-formé gardé+testé ; nit cap-50 doc maintenue exacte.

---

## 2026-06-28 — FSRS CROSS-LESSON : persistance de la mémoire + AUTO-ROUTAGE du prochain pas

Deux moitiés couplées qui font franchir les leçons à la répétition espacée ET piloter le prochain pas. Lève le TODO de `fsrs.ts` (« persist concept_memory beside concept_states »).

- **PERSISTANCE** : `learner-state` — `ConceptMemoryStateSchema` (miroir zod de l'interface `adaptation-engine/fsrs.ts` ; learner-state ne peut PAS importer le moteur, c'est l'inverse) + `LearnerProfile.concept_memory?` + `mergeConceptMemoryIntoProfile` pur (latest-wins, **SKIP des entrées reps===0** pour ne JAMAIS écraser une vraie mémoire portée d'une leçon antérieure par un défaut « non-vu »). `lesson-session-host` — la branche `respond(complete)` persiste aussi `conceptMemoryFromState(state)` dans le profil ; `dueReinforcementTargetsFromMemory` pur + `host.dueReinforcements(learnerId, nowMs)` (routeur CROSS-LESSON lisant la mémoire accumulée du profil — pas de session vivante requise).
- **AUTO-ROUTAGE** : `host.nextCourseStep(course, learnerId, nowMs) → CourseStep` (reinforce | advance | done | **blocked**). Un renforcement DÛ (concept maîtrisé en leçon antérieure dont le rappel a décliné) PRÉEMPTE l'avancement → la répétition espacée pilote vraiment le prochain pas. Profil chargé UNE fois ; `done` vs `blocked` désambiguïsé via `isCourseComplete` (spine épuisée vs prérequis non-satisfait/cyclique).

**Vérification** : learner-state 36 (6 neufs dont garde-clobber) + lesson-session-host 132 (8 neufs dont régression-clobber + blocked) ; dépendants verts (adaptation-engine 51, lesson-session 214, lesson-mcp 13, lesson-server 31) ; `tsc` propre. Revue adverse (workflow 4 lentilles + réfutation) → **1 must-fix / 1 should-fix / 1 nit** repliés : (must) la mémoire cross-lesson était ÉCRASÉE quand une leçon ultérieure DÉCLARE (warm-seed) un concept partagé sans le ré-répondre (replay reps:0 → écrasait la vraie mémoire) — VÉRIFIÉ par repro runtime du reviewer, corrigé par le skip reps===0 + re-vérifié par un agent adverse (chemin complètement fermé, skip non sur-agressif, writer unique) ; (should) `nextCourseStep` confondait spine-bloquée et cours-terminé → variante `blocked` + `isCourseComplete` ; (nit) caveat docstring sur le cap d'historique à 50.

---

## 2026-06-28 — studium-vscode : `run.json` comme TÂCHE VS Code native

Concrétise « laisser VS Code gérer l'environnement et l'install pour l'usage agentique » : le manifeste de run learner-time est surfacé comme une TÂCHE VS Code native. Le protocole reste de la délégation PURE — Studium (host/MCP) N'EXÉCUTE JAMAIS ; c'est l'environnement de l'opérateur (= le workspace de l'utilisateur) qui exécute.

- `studium-vscode/src/run-task.ts` (pur, sans dépendance — esbuild ne bundle que vscode + MCP SDK + typed-graph-lens, donc les shapes RunManifest/RunResult sont mirrorées, lockstep avec lesson-bundle-schema + run-result.ts) : `runManifestToTaskSpec` (install requirements puis run cmd, args shell-quotés), `evaluateChecks` (« file exists: <path> » sous working_dir ; inconnu → NON passé), `buildRunResult` (ran = exitCode≠null ; passed = exit 0 ET tous les expected_outputs présents ET tous les checks passés ; landmark auteur retenu → null).
- `extension.ts` : commande `studium.runReproduction` → get_run_manifest → `vscode.Task` (ShellExecution dans le terminal intégré) → handler one-shot onDidEndTaskProcess → buildRunResult (fileExists = existsSync sous le workspace) → submit_run_result → avance sur status « ran » + transition (complete → done, sinon avance). État `activeLesson` (garde par IDENTITÉ d'objet, pas par valeur sid) + indice de découvrabilité sur une scène reproduction. `package.json` : commande + activation onCommand + `taskDefinitions {type:"studium-run"}`.

**Vérification** : `tsc` extension exit 0 ; harnais headless complet (8 drivers) vert dont run-task (22 assertions) + lesson-walk e2e (12, boucle leçon intacte). Revue adverse (workflow 4 lentilles : shape RunResult / résolution de chemins / sûreté de la tâche / câblage+honnêteté du protocole) → **0 must-fix / 1 should-fix + 1 nit** repliés (garde dispose par identité d'objet vs collision de sid-sentinelle ; listener one-shot tracké dans context.subscriptions). Shape RunResult + cohérence des chemins task-cwd↔existence vérifiées sans défaut.

---

## 2026-06-28 — FSRS comme ROUTEUR (et non plus simple lecture)

Promeut FSRS d'une LECTURE (`reviewQueue` listait tous les concepts dus) à un ROUTEUR : une décision de sélection — le concept le PLUS urgent à renforcer + la scène qui l'adresse. Le routage FSRS est intrinsèquement inter-TEMPS (le rappel doit décliner), donc `nowMs` est injecté.

- `adaptation-engine/fsrs.ts` : `nextReinforcement(states, mastery, nowMs, opts) = dueForReinforcement(...)[0] ?? null` (tête de routeur). Pur.
- `lesson-session-host/host.ts` (le host N'IMPORTE PAS adaptation-engine — il INLINE un miroir verbatim de fsrs.ts) : miroir `fsrsReinforcementPriority` + `fsrsDueForReinforcement` ; exports purs `conceptMemoryFromState` (rejoue l'historique → carte mémoire), `nextReinforcementFromState` (décision concept), `reinforcementSceneFromState` (route vers le CONTENU : la scène couvrant le concept, en PRÉFÉRANT une scène de RÉCUPÉRATION quiz/spot_the_flaw/explain_back/comparison/summary_audit/prompt_practice à un intro passif, repli sur la 1re couvrante) ; méthodes host `nextReinforcement` + `nextReinforcementScene`. Test de PARITÉ-LOCKSTEP : host == engine pour les mêmes réponses+maîtrise.
- `lesson-mcp` : outil `get_next_reinforcement {session_id, now_ms?}` → `{reinforcement: {concept_id, scene_id, due_at, retrievability} | null}` — la surface driver qui rend le routeur consommable par un VS Code natif (e2e : frais → null ; futur lointain → route vers la scène quiz).
- HONNÊTETÉ : rien n'AUTO-route (pas d'injection dans la boucle d'avancement — ça toucherait la sélection cœur) ; le routeur EXPOSE la décision qu'un driver consomme (distinct de la lecture `reviewQueue`). La persistance cross-lesson de la mémoire FSRS reste un nice-to-have (la décision se calcule par-rejeu de l'historique de la session).

**Vérification** : adaptation-engine 51 (1 neuf) + lesson-session-host 124 (11 neufs dont parité-lockstep + préférence-récupération) + lesson-mcp 13 (1 neuf e2e) ; `tsc` 3 packages exit 0. Revue adverse (workflow 4 lentilles dont lockstep + honnêteté-du-claim-routeur) → **0 must-fix / 1 should-fix + 2 nits** repliés (due_at honore opts.requestRetention ; préférence scène-récupération vs intro ; arithmétique maîtrise du commentaire 0.714).

---

## 2026-06-28 — Surface ENSEIGNANT de complétion par leçon du parcours (niveau-classe)

Rend visible au tableau de bord la complétion par leçon de la colonne de cours. HONNÊTETÉ : le pseudonyme télémétrique est salé par bundle_id (`session.ts:73`) → le MÊME humain a un pseudonyme DIFFÉRENT à chaque leçon. Donc le suivi par-individu cross-lesson est IMPOSSIBLE depuis la télémétrie (par conception, vie privée). La seule surface fidèle = des compteurs INDÉPENDANTS par leçon (apprenant·e·s distinct·e·s par leçon), JAMAIS un entonnoir/flux de rétention.

- `analytics-collector/metrics.py` : `compute_course_completion(data_dir, course, bundle_version?)` — lit `lesson_completed`, groupe par lesson_id (== bundle_id), compte les `learner_pseudonym` distincts. `{lessons:{lesson_id:{n_completed}}, total_completions}`. `GET /metrics/course-completion` (token auth).
- `lesson-server` : `GET /courses?ref=` → `resolveCourse(bundlesRoot, ref)` (manifeste CourseSchema parsé), avec garde anti-path-traversal (rejette `..` / chemin absolu).
- `teacher-dashboard` : `getCourseCompletion` (analytics) + `getCourse` (lesson-server) ; composant `CourseProgress` (colonne ordonnée + prérequis + compteurs distincts par leçon + **cadrage honnête : compteurs indépendants, NON comparables comme un flux**) ; page `course-progress` (dégradation gracieuse → compteurs bruts si pas de manifeste) ; onglet « Parcours ».

**Vérification** : analytics-collector 123 (8 neufs : distincts par leçon, doublon=1, vide, lesson_id manquant, filtre bundle_version ; + 401/403/funnel endpoint) ; lesson-server 31 (4 neufs : manifeste parsé, ref manquant 400, path-traversal 400, 404) ; teacher-dashboard 54 (api wrapper getCourse/getCourseCompletion + render CourseProgress incl. 0-completers + honnêteté). `tsc` lesson-server + dashboard exit 0. Revue adverse (workflow 4 lentilles dont SÉCURITÉ path-traversal — garde jugée adéquate — + réfutation) → **0 must-fix / 1 should-fix** replié : retrait du cadrage « entonnoir/funnel » (surclaim de rétention cohorte que les pseudonymes salés-par-leçon ne supportent pas) → compteurs INDÉPENDANTS non-comparables + barre neutre dé-emphasée.

---

## 2026-06-28 — Surface ENSEIGNANT de `trust_calibration` (jugement-sur-artefact)

Rend VISIBLE au tableau de bord enseignant la dimension phare de la session — la calibration du jugement face à une lecture IA d'un résultat RÉEL (distincte de la calibration de confiance déclaré-vs-compétence). Jusqu'ici `trust_calibration` était calculée par le moteur mais invisible à tout humain.

- `analytics-collector/metrics.py` : `TRUST_WELL_BAND=0.4` + `compute_trust_calibration(data_dir, course, learner?, bundle_version?)` — agrégat telemetry-natif sur les events `ai_audit_result` (mêmes que ai_audit_accuracy). Par scène scorable (planted>0, compteurs poolés par scene_id) : `over_trust=missed/planted`, `over_distrust=min(fp,planted)/planted`, `gap=over_trust-over_distrust ∈ [-1,1]` ; overall = MOYENNE des gaps par scène (miroir de ai_audit `overall_accuracy`) ; bande "bien" (|gap|≤0.4) / "sur" (sur-confiance IA) / "sous" (méfiance IA). Fidèle au moteur `recordJudgmentAudit`.
- `analytics_collector_app.py` : `GET /metrics/trust-calibration` (auth `X-Course-Token`, `_validate_bundle_version`).
- `teacher-dashboard` : `getTrustCalibration` + type `TrustCalibrationResponse` (lib/api.ts) ; composant `TrustCalibrationChart` (verdict FR par bande + breakdown sur-confiance/méfiance + **limite d'honnêteté affichée**) ; page `app/courses/[token]/trust-calibration/page.tsx` ; onglet « Confiance IA » dans `CourseNav`.
- LIMITE D'HONNÊTETÉ (surfacée dans l'UI + le docstring) : le matcher hors-ligne fixe `false_positives=0` → en prod la direction « méfiance » est structurellement non-alimentée ; seule la sur-confiance bouge (gap≥0). La surface reflète fidèlement ce que la télémétrie porte. NON ajouté au blueprint composable (le gap signé n'est pas un score [0,1] « plus haut = mieux » ; son cousin composable ai_audit_accuracy y est déjà).

**Vérification** : analytics-collector 115 (14 neufs : bien/sur/sous, cap fp, planted=0 non-scorable, pooling, moyenne-par-scène, filtre apprenant, bande inclusive ; + 401/403/aggregats endpoint) ; teacher-dashboard 47 (api wrapper + render component toutes bandes incl. null + limite d'honnêteté) ; `tsc` dashboard exit 0. Revue adverse (workflow 4 lentilles + réfutation par finding) → **0 must-fix / 0 should-fix / 2 nits** repliés (label `n_audits`→« scène(s) » ; normalisation `-0.00`).

---

## 2026-06-28 — Régénération du jugement PAR-RUN : lève le caveat de déterminisme

Lève le caveat de déterminisme de la boucle opération→jugement : un `spot_the_flaw` avec `reference_from_run` + `regenerate_from_run` voit son `flawed_content` + `claims` RÉGÉNÉRÉS depuis le run RÉEL de l'apprenant (côté serveur) — les défauts plantés collent à SES chiffres, même pour une capsule STOCHASTIQUE.

- `lesson-bundle-schema` (TS + mirror Python) : `spot_the_flaw.regenerate_from_run` (optionnel).
- `lesson-session` : `setSceneOverride(sceneId, override)` + `scene()` fusionne l'override EN PREMIER (présentation ET notation voient le jugement régénéré), puis l'overlay reference_result.
- `lesson-session-host` : port `JudgmentGenerator` + `StubJudgmentGenerator` (déterministe, key-free ; le générateur LIVE est LLM-backed → clé requise). `SessionHostOptions.judgmentGenerator` (opt-in). `host.ingestRunResult` (quand l'apprenant lance la capsule) régénère les `spot_the_flaw` en aval (reference_from_run===task_card && regenerate_from_run) depuis le run de l'apprenant → `setSceneOverride`. La clé-réponse régénérée reste CÔTÉ SERVEUR (publicScene strip claims/model_correction).

**Vérification** : lesson-session-host 113 (régénéré depuis le landmark de l'apprenant ; clé-réponse non-fuitée ; sans générateur → défauts d'auteur inchangés ; trust alimenté) ; `tsc` 3 packages ; scene-synth 206 (mirror) ; suite TS complète exit 0. Revue adverse (workflow 2 lentilles). HONNÊTETÉ : la qualité de régénération LIVE nécessite une clé ; le mécanisme + le stub sont prouvés key-free.

---

## 2026-06-28 — Colonne vertébrale de COURS : séquençage multi-leçons

Ferme le dernier blocker « cours » de l'analyse de gaps : aucune couche au-dessus du bundle (pas de course_outline / lesson_sequence / next_lesson). Une COLONNE de cours séquence les leçons par-dessus le profil cross-lesson.

- `lesson-bundle-schema/course.ts` : `CourseSchema` (course_id, title, lessons:[{lesson_id, bundle_ref, title?, prerequisite_lesson_ids[]}]) + routeur PUR `nextCourseLesson(course, completedLessonIds)` (première leçon non-faite dont TOUS les prérequis sont faits ; null si fini/bloqué — linéaire, DAG, sans-prérequis) + `isCourseComplete`.
- `learner-state` : `LearnerProfile.completed_lessons` (optionnel, rétro-compatible) + `recordCompletedLesson` pur (dédupliqué, non-mutant).
- `lesson-session-host` : `host.respond`(complete) enregistre la leçon complétée dans le profil ; `host.nextLesson(course, learnerId)` lit `completed_lessons` (pseudonyme niveau-apprenant) → routeur ; `resolveCourse(bundlesRoot, courseRef)` charge + valide `course.json`. Fixture `fixtures/courses/decay-course.json` (capsule-run-demo → capsule-loop-demo qui le requiert).

**Vérification** : lesson-bundle-schema 62 (routeur : linéaire/DAG/prérequis/fini ; parse) + learner-state 30 + lesson-session-host 111 (e2e : complète A → next B → complète B → null ; par-apprenant ; resolveCourse charge le fixture) ; `tsc` 3 packages ; suite TS complète exit 0. Revue adverse (workflow 2 lentilles + réfutation par finding).

---

## 2026-06-28 — Profil apprenant CROSS-LESSON : démarrage à chaud entre leçons

Ferme un blocker original de l'analyse de gaps : l'état était keyé par (pseudonyme, bundle) → un concept maîtrisé en leçon A repartait À FROID en leçon B. Un PROFIL apprenant (niveau-apprenant) agrège l'état des concepts entre bundles.

- `learner-state` : `LearnerProfile` (concept_states keyés par concept_id + pseudonyme + updated_at) + helpers PURS `seedConceptStatesFromProfile` (warm-start : copie l'état du profil pour les concepts du bundle ABSENTS de l'état per-bundle — le per-bundle a la PRIORITÉ, jamais écrasé) + `mergeConceptStatesIntoProfile` (carry-forward latest-wins, non-mutant).
- `lesson-session-host` : `LearnerProfileStore` (InMemory par défaut — persiste entre sessions d'une instance host ; `FileLearnerProfileStore` = `<dataDir>/<pseudonyme>/profile.json` en mode durable). Le pseudonyme du PROFIL est salé par un scope FIXE (`__learner_profile__`), donc STABLE entre leçons (le pseudonyme per-bundle est salé par bundle_id). `host.create` SEED l'état initial depuis le profil (avant `session.start`) ; `host.respond` (complete) MERGE l'état de la leçon dans le profil ; `host.forget` (RGPD) efface AUSSI le profil cross-lesson.
- HYPOTHÈSE documentée : un concept de même id entre bundles EST le même concept (espace de concepts partagé — le composeur de cours assigne des ids partagés) ; si les ids sont locaux au bundle, ça ne seed simplement pas.

**Vérification** : learner-state 30 (seed/merge purs : warm/cold, précédence per-bundle, non-mutation, round-trip) + lesson-session-host 109 (e2e : concept travaillé en A → chaud en B ; non-apparenté reste froid ; isolation par apprenant ; forget efface le profil) ; `tsc` host ; suite TS complète exit 0. Revue adverse (workflow 3 lentilles + réfutation).

---

## 2026-06-28 — Opérateur agentique RÉEL (LLM-backed) + démo bout-en-bout

L'opérateur n'est plus seulement stub/watch : un VRAI opérateur LLM pilote une leçon complète run+jugement. Il POSSÈDE l'exécution — Studium n'exécute jamais.

- `lesson-session-host/session-runner.ts` : `makeLlmOperator({ llm, runCapsule })` — sur une scène `reproduction(run_manifest)` il lit le manifeste et LANCE la capsule via `runCapsule` injecté (l'opérateur exécute, pas Studium) ; sur un `spot_the_flaw` il appelle `llm` pour JUGER la lecture IA défectueuse du run de l'apprenant ; quiz/meta/contrôle = réponse déterministe ; la clé-réponse n'entre jamais dans le prompt. `OperatorLlm = {complete(prompt)}` (découplé du provider) + `writeRunResult` exportés.
- Démo `apps/lesson-mcp/llm-operator-demo.ts` : câble un VRAI run de capsule (`python3 tools/capsule_runner.py`, uv venv isolé) + LLM (placeholder key-free par défaut ; `--live` = LiteLLM via LITELLM_BASE_URL). **EXÉCUTÉE bout-en-bout sans clé sur `capsule-loop-demo` : `next → next → complete ✔`, trust_calibration alimenté (1 sample de run jugé).** Le run de capsule est RÉEL ; la qualité du jugement live nécessite une clé (frontière d'honnêteté).

**Vérification** : lesson-session-host 107 (l'opérateur LLM pilote la boucle key-free : capsule lancée sur la scène run, LLM-jugée sur le spot_the_flaw ancré, trust alimenté ; aucun appel LLM sur un run échoué) ; démo réellement exécutée (capsule réelle, key-free) ; `tsc` host+mcp ; suite TS complète exit 0. Revue adverse (workflow 3 lentilles + réfutation par finding) : 0 must-fix ; appliqués — should-fix (runner démo parse STDOUT de capsule_runner → gracieux sur `deferred`/`no-executable` au lieu d'un crash ENOENT) + 2 nits (override `LITELLM_MODEL` ; `.studium-session/` gitignored).

---

## 2026-06-28 — Parité canal MCP : protocole de run pour VS Code natif

Donne au canal MCP (surface VS Code native, MCP-only) la parité avec le canal fichier pour le protocole de run apprenant — pour que l'extension studium-vscode puisse piloter la boucle run + jugement. Studium n'exécute JAMAIS.

- `apps/lesson-mcp/server.ts` : 2 nouveaux outils — `get_run_manifest` (le manifeste de provisioning/run de la scène courante, NON porteur de réponse, ou null) et `submit_run_result` (ingère le run de l'opérateur ; gate sur ran&&passed ; renvoie {status, learner_run_recorded, transition? redacted}).
- `lesson-session-host/host.ts` : cœur PARTAGÉ `ingestRunResult(id, result)` (gate ran&&passed → recordLearnerRun(task_card_id) → avance via ack ; garde-fou `not_a_run_scene`) utilisé par les DEUX canaux (l'outil MCP + `SessionWorkspace.ingestRun` REFACTORISÉ pour l'appeler — pas de dérive) ; + `runManifest(id)`.
- REDACTION : une scène de run (run_manifest présent) RETIENT son run d'auteur — `publicScene` drop `reference_result` + `host.sceneArtifacts` filtre `executed_result` (parité avec le canal fichier ; l'apprenant produit frais). Le jugement `reference_from_run` reste ancré sur le run de l'APPRENANT côté MCP, et la clé-réponse reste redacted.

**Vérification** : lesson-mcp 12 (parité : manifeste null/présent ; gate ran&&passed + self-heal ; passing→avance + jugement ancré sur le run apprenant + trust_calibration alimenté ; not_a_run_scene) + lesson-session-host 105 (redaction publicScene/sceneArtifacts) + canal fichier inchangé (refacto sans régression) ; `tsc --noEmit` host+mcp ; suite TS complète exit 0. Revue adverse multi-lentilles (workflow : 4 lentilles + réfutation par finding).

---

## 2026-06-28 — Boucle opération→jugement : ancrer un jugement sur le run de l'APPRENANT

Ferme la boucle nord-star : l'apprenant lance la capsule lui-même (protocole de run), PUIS audite une lecture IA défectueuse de SON PROPRE résultat exécuté — et ce jugement alimente `trust_calibration`. « Opération réelle = véhicule ; jugement calibré d'un artefact réel = destination. »

- `lesson-bundle-schema` (TS + mirror Python) : `spot_the_flaw` gagne un champ optionnel `reference_from_run` (un task_card_id) — le jugement est ancré sur le run capturé de l'apprenant. + export du type `ReferenceRun`.
- `lesson-session` : `recordLearnerRun(taskCardId, run)` mémorise le run de l'apprenant ; le SEUL point d'injection est `scene()` (accesseur unique présentation+notation) : pour un `spot_the_flaw` avec `reference_from_run` ET un run enregistré, renvoie une copie avec `reference_result` = le run de l'apprenant — donc l'évidence affichée ET le `flawGrader` (qui pose `judgment_audit` quand reference_result≠null → `trust_calibration`) voient le run de l'apprenant. Aucun run → scène d'auteur inchangée (non-ancrée, pas de fabrication).
- `lesson-session-host` : `host.recordLearnerRun` ; `SessionWorkspace.ingestRun` projette le `run_result` de l'opérateur en `ReferenceRun` (`runResultToReferenceRun`) et l'enregistre sous le task_card_id de la scène run AVANT d'avancer.
- Fixture `fixtures/capsule-loop-demo` (intro → reproduction(run_manifest) → spot_the_flaw(reference_from_run)).

HONNÊTETÉ : les défauts plantés (claims) supposent un résultat CANONIQUE ; l'ancrage sur le run de l'apprenant n'est sain que pour une capsule DÉTERMINISTE (même landmark à chaque run) — vrai pour `capsule-demo` (seed fixe).

**Vérification** : lesson-session 3 (overlay ancré→reference_result injecté ; sans run→non-ancré ; notation→trust_calibration) + lesson-session-host e2e 1 (run → tâche jugement affiche le landmark de l'APPRENANT → noté → trust alimenté) ; lesson-session 213 · lesson-session-host 102 · lesson-bundle-schema 59 · scene-synth 206 ; `tsc --noEmit` 3 packages ; suite TS complète exit 0. Revue adverse (Opus) en cours.

---

## 2026-06-28 — Exécution PAR L'APPRENANT : protocole de run (délégation agentique pure)

Ferme le gap « no-host-learner-time-execution » : l'apprenant provisionne + exécute lui-même la capsule (via l'opérateur agentique dans l'espace de travail VS Code), Studium n'exécute JAMAIS (brain-only, pas de sandbox Studium). « Opération réelle = véhicule. » Décision utilisateur : DÉLÉGATION AGENTIQUE PURE (Studium émet un manifeste, l'opérateur installe + lance).

- `lesson-bundle-schema` (TS + mirror Python `scene_synth_schemas`) : `RunManifest` + champ optionnel `run_manifest` sur `ReproductionScene` — instructions de provisioning/run NON porteuses de réponse (capsule_ref / install / cmd / noms de fichiers produits / vérifs d'existence), JAMAIS les valeurs attendues ni le landmark de l'auteur.
- Canal fichier `.studium-session/` (`SessionWorkspace`) : pour une scène reproduction avec `run_manifest`, `writeStep` émet `run.json` + une tâche « provisionne & lance » (statut `awaiting_run`) en RETENANT le landmark de l'auteur (l'apprenant produit un résultat frais). L'opérateur lance dans l'espace de travail puis écrit `run_result.json` ; `ingestRun` le valide, GATE l'avancement sur `ran && passed` (enregistre le run de l'apprenant en statut `ran` + landmark/artifacts) et s'auto-répare (absent → attente ; `ran:false`/vérifs échouées → consommé + feedback correctif, jamais bloqué). `run-result.ts` (RunResultSchema + parseRunResult lenient).
- Harnais `runStudiumSession` rendu run-aware (`OperatorCtx.expects`) ; `stubOperator` écrit un run PLACEHOLDER passant (n'exécute rien), `watchOperator` attend `run_result.json` ; `writeRunResult` (atomique). Le CLI `--watch`/`--stub` marche sans changement.
- Fixture `fixtures/capsule-run-demo/lesson.json` (intro + reproduction-with-run_manifest, dérivée de `capsule-demo`). Doc `agentic-session-protocol.md` mise à jour.

**Délégation pure** : aucun process lancé côté Studium — l'e2e prouve le PROTOCOLE (run simulé par l'opérateur/stub) ; l'exécution réelle est celle de l'opérateur agentique dans VS Code.

**Vérification** : run-protocol host 4 + harnais 2 ; lesson-bundle-schema 59 (RunManifest) ; lesson-session-host 100 ; `tsc --noEmit` host+schema ; scene-synth 200 (mirror Python round-trip) ; suite TS complète exit 0. Revue adverse (Opus) en cours.

---

## 2026-06-27 — Calibration du jugement-sur-artefact : `trust_calibration`, dimension d'engine de première classe

Atteint la DESTINATION nord-star : « dans un monde où l'opération scientifique est conduite par l'IA, la compétence durable n°1 est la confiance CALIBRÉE dans une sortie ». Une nouvelle dimension `trust_calibration` — DISTINCTE de `confidence_calibration` — mesure si la confiance de l'apprenant dans une lecture IA défectueuse d'un RÉSULTAT EXÉCUTÉ RÉEL suit la vérité-terrain, et GATE dessus.

- `packages/learner-state` : `ConceptState.trust_calibration`/`_samples` (optionnels, rétro-compatibles) ; `recordJudgmentAudit` (over-trust = défauts ratés `+`, over-distrust = faux positifs `−` ; cap fp≤planted ; EWMA λ=0.5 ; clamp [-1,1] ; planted=0 ⇒ no-op) ; `isTrustCalibrated`/`isTrustMiscalibrated`/`isOverTrusting` (mesuré + bande, mirrors confidence). `answer_submitted` gagne `judgment_audit?` (grounded/planted/caught/false_positives).
- `packages/adaptation-engine/engine.ts` : un `answer_submitted` portant `judgment_audit.grounded` plie la confiance-dans-l'artefact dans `trust_calibration` (indépendant de la confiance-en-soi) ; `buildContext` expose `trust_calibration(+abs)` pour les règles.
- `lesson-session/grading/graders.ts` : `flawGrader` attache `judgment_audit` UNIQUEMENT quand la scène est ancrée (`reference_result` présent) — une scène de jugement non-ancrée ne nourrit JAMAIS la dimension de confiance.
- **GATE certification** (`mastery-claims.ts`) : OVER-TRUST-SEUL — retient la claim d'un apprenant compétent MAIS systématiquement crédule (a raté les défauts d'une lecture IA d'un vrai résultat) ; la sur-méfiance n'est jamais retenue (mirrors overconfiance-seule). La compétence seule ne certifie pas : le jugement calibré EST la destination évaluée.
- **GATE skip** (`graph-nav.ts buildLwgCalibration`) : nudge symétrique de recalibration sur la mal-calibration de confiance OU de trust.

**HONESTY BOUNDARY** : seul l'OVER-TRUST est alimenté en LIVE aujourd'hui — le matcher renvoie `false_positives=0` (il porte la clé-réponse des défauts plantés, pas les affirmations SAINES nécessaires pour détecter le sur-signalement), donc en production `trust_calibration` ne monte que ≥0. La dimension signée + le gate symétrique sont prêts ; la capture de l'over-distrust attend un signal « affirmations saines » du matcher.

**Vérification** : learner-state 26 · adaptation-engine 50 · lesson-session 210 ; `tsc --noEmit` 3 packages ; suite TS complète exit 0 (25 packages/apps, zéro régression). Revue adverse (Opus) : math CORRECTE, 0 must-fix, ship-with-fixes — le should-fix (honnêteté over-distrust) appliqué en commentaires.

---

## 2026-06-27 — Chaîne de composition : planner → scene-synth → bundle de jugement ancré

Ferme le blocker « le planner et scene-synth sont deux services disjoints que rien ne chaîne ; le planner ne peut même pas demander une scène de jugement ». Une seule passe in-process transforme (manifeste corpus + capsule) en bundle gradé incluant une scène `spot_the_flaw` ancrée sur une EXÉCUTION RÉELLE. « Opération scientifique réelle = véhicule ; jugement calibré d'un artefact réel = destination. »

- `lesson-plan-schema` (Python + mirror TS `src/index.ts` & `src/schema.json`) : `SceneType` gagne `spot_the_flaw` — le planner peut enfin DEMANDER une scène de jugement.
- `planner_agent._enrich_from_abs` : avec `emit_judgment_scenes`, émet une scène `spot_the_flaw` par task card (à côté de la reproduction), pointant sur la même capsule. Défaut OFF (les cours existants gardent leur forme exacte).
- `scene-synth/orchestrator.py` : injection `capsule_runner` ; `_synthesize_judgment` résout la capsule via `corpus_refs`, l'exécute UNE fois (mémoïsée), enrichit l'outline avec le `reference_run` vérifié (le LLM lit des valeurs réelles, ne les invente pas) + le cadran de fiabilité, et attache le run exécuté comme `reference_result` (attaché PAR CODE, non-hallucinable). Non-ancré ⇒ warning honnête, jamais fabriqué.
- `SynthesizeOptions` : cadran `judgment_n_flaws`/`judgment_level`/`judgment_guidance` (fiabilité paramétrable par l'auteur).
- `capsule_runner.py` : expose `research_question` dans le résultat (pour le prompt du juge).
- `tools/compose_lesson.py` : l'entrée de la chaîne (planner → orchestrateur ancré → bundle) ; isolation `sys.modules`/`sys.path` pour la collision de packages `agents` planner vs scene-synth.

**Vérification** : orchestrator-grounding 3 (run réel mémoïsé + non-ancré averti) · planner-abs (judgment émis/omis) · chaîne e2e RÉELLE sur `fixtures/capsule-demo` (vrai uv venv, landmark `k_fit=` vérifié, non-halluciné) ; scene-synth 200 · planner 190 · lesson-plan-schema 13 (TS) ; zéro régression. Revue adverse (Opus) = ship-with-fixes ; should-fix corrigés (warning si projecteur de grounding absent ; `_resolve_capsule` 2-passes exact-match-d'abord ; restore `sys.path`).

---

## 2026-06-27 — Tap de confiance per-réponse + EWMA glissant (calibration continue LIVE)

Ferme le follow-up de la tranche #3 : la capture de calibration per-réponse passe de « prête » à **LIVE** dans les deux surfaces.
- **Webview** (`media/artifact-pane.js` + `.css`) : sélecteur « Ta confiance : 0–4 » sur les scènes quiz + free-text ; la confiance tapée chevauche l'input soumis (`withConf`). Omise si non tapée.
- **Notebook** (`src/notebook.ts`) : token optionnel `conf:N` (0–4) en fin de cellule → extrait par `extractConfidence` (pur, testable, dans `scene-io.ts`) et attaché à l'input ; aide d'intro mise à jour ; un chiffre nu (meta_checkpoint) n'est PAS un token.
- **Moteur** (`learner-state` + `adaptation-engine`) : `CALIBRATION_ANSWER_LAMBDA=0.4` ; la voie per-réponse utilise λ<1 → MOYENNE GLISSANTE (plus last-write-wins) ; la voie `meta_checkpoint` reste λ=1.0 (auto-jugement délibéré = signal plein, déclenche la règle 0.4). `updateCalibration`/`recordConfidenceSample` prennent un λ.
- `ResponseInput` (scene-io.ts) gagne `confidence?` sur les kinds-réponses.

**Vérification** : tsc ; learner-state 18 (test EWMA glissant vs last-write-wins) · adaptation-engine 47 · studium-vscode scene-io 51 (extractConfidence + parité) · webview-pane 68 (tap → `input.confidence` dans les 2 surfaces) ; zéro régression (lesson-session 408, lesson-session-host 188, lesson-mcp tsc). La calibration-gating est désormais alimentée en continu PAR RÉPONSE, plus seulement au meta_checkpoint.

---

## 2026-06-27 — Calibration-gating : calibration = dimension de première classe, évaluée + GATING

**Tranche #3 de la pivot capsule-backed (décision verrouillée).** `confidence_calibration` devient une dimension SAMPLE-COMPTÉE qui GATE ; capture per-réponse plumbée bout-en-bout (prête, pas encore alimentée par UI).

- `packages/learner-state` : `ConceptState.calibration_samples` (optionnel, rétro-compatible) ; `CALIBRATION_WELL_BAND=0.4` ; `recordConfidenceSample` (updateCalibration + samples++) ; `isCalibrated` / `isMiscalibrated` (mesuré + bande, symétrique) / `isOverconfident` (mesuré + sur-confiance seule). `answer_submitted` gagne `confidence?` optionnel.
- `packages/adaptation-engine/engine.ts` : `confidence_declared` → `recordConfidenceSample` (compte les samples) ; un `answer_submitted` portant un `confidence` capture aussi (per-réponse, contre la maîtrise POST-réponse).
- **GATE certification** (`mastery-claims.ts`) : OVERCONFIANCE-SEULE (`isOverconfident`) — on ne retient JAMAIS la claim d'un maître sous-confiant (par l'arithmétique, pour actual≥θ seule la sous-confiance dépasse la bande ⇒ un gate symétrique ne frapperait que les maîtres sous-confiants = pénalité de compétence). Inerte pour un vrai maître ; ne mord qu'une sur-confiance.
- **GATE skip** (`graph-nav.ts` `buildLwgCalibration` + param `calibrated` ; câblé `session.ts`) : SYMÉTRIQUE — skip-on-mastery ne saute PAS un concept maîtrisé-mais-mal-calibré (replay = nudge de recalibration peu coûteux). Conservateur : ne bloque jamais (au pire, atterrit SUR la scène).
- `ResponseInput` (types.ts + response-input-schema.ts) + `grade()` : portent un `confidence?` optionnel de l'entrée → signal.
- Cohérence « mesuré » : `host.ts calibrationVerdict` (+ port studium-vscode) renvoie `null` sans sample (sinon « bien calibrée » fabriqué pour un concept jamais auto-évalué).

**Vérification** : tsc 5 packages ; learner-state 17 · adaptation-engine 47 · lesson-session 408 · lesson-session-host 188 · 209 assertions drivers studium-vscode (e2e lesson-walk inclus) ; zéro régression (~660 tests back-end). Revue adverse (2 lentilles × Opus) = ship-with-fixes ; **2 must-fix corrigés** (le verdict learner-facing partage la déf « mesuré » ; gate certification overconfiance-seule + documenté) + should-fix (commentaires « continu » honnêtes ; λ=1.0 = last-write-wins documenté, pas EWMA).

**NON construit (suivi honnête)** : l'affordance UI du tap de confiance per-réponse (plumbing prêt+testé mais aucune UI ne l'alimente — seul le `meta_checkpoint` alimente la calibration en vrai aujourd'hui) ; EWMA glissant (λ<1) lié à cette UI ; diagnostic auditable des concepts retenus-pour-calibration.

---

## 2026-06-27 — Rendu inline de la figure `executed_result` (notebook)

Le contrôleur notebook (`apps/studium-vscode/src/notebook.ts`) rend désormais les assets `executed_result` (et `image`) comme **image native inline** — lecture du fichier depuis le dossier du bundle + légende (landmark / checks) — au lieu d'une simple note `📎`. La logique pure chemin+MIME est extraite dans `src/asset-path.ts` (testable) ; le câblage `vscode.*` reste tsc-only (Extension Host). Nouveau driver `asset-path` (8 assertions) ajouté au runner. Ferme le follow-up « rendu natif » du canal `.studium-session/`. Vérif : tsc + **208 assertions** drivers studium-vscode.

---

## 2026-06-27 — Harnais opérateur de session (`runStudiumSession` + CLI)

**Suite du canal `.studium-session/`** : un harnais *runnable* qui pilote une session complète avec un opérateur ENFICHABLE — le canal fichier devient utilisable, pas seulement testé.
- `packages/lesson-session-host/src/session-runner.ts` — `runStudiumSession(host, bundleRef, dir, operator)` boucle `writeStep → operator → ingest` jusqu'à `complete`. Opérateurs : `stubOperator` (placeholder déterministe sans clé, pour démos/tests), `watchOperator({pollMs,timeoutMs})` (ATTEND qu'un agent EXTERNE — Claude Code / Copilot / Codex / humain — écrive `response.json` ; Studium n'appelle aucun modèle), `writeResponse` (écriture atomique tmp+rename). La rédaction de la clé de réponse est héritée de `SessionWorkspace`.
- `apps/lesson-mcp/src/session-runner-cli.ts` — CLI : `tsx … <bundleRef> [--dir=] [--bundles-root=] [--stub]`. Défaut `--watch` (l'assistant du workspace pilote).
- `docs/agentic-session-protocol.md` — section « Run it » ; le harnais passe de follow-up à **livré**.

**Vérification** : lesson-session-host tsc + lesson-mcp tsc + **186 vitest** (3 nouveaux session-runner : session-stub-complète-avec-rédaction-tenue · watch-retourne-sur-réponse-externe · watch-timeout). **Run live** : la CLI `--stub` déroule `capsule-judgment-demo` jusqu'au bout (`next → next → complete`, 3 étapes) en laissant un vrai `.studium-session/` (task.md/feedback.md/index.json ; log : intro graded → 2× spot_the_flaw graded → complete).

---

## 2026-06-27 — Canal de session agentique fichier (`.studium-session/`) — outsourcing exécution/rendu

**Vision** : la leçon capsule-backed n'embarque PAS son propre sandbox d'exécution ni sa pile de rendu ; elle les délègue à l'**hôte VS Code** + un **opérateur agentique enfichable** (Copilot / Claude Code / Codex / opencode). Studium reste le *cerveau* (routage adaptatif, maîtrise, calibration, scènes de jugement + ancrage). Deux canaux : **MCP** (déjà existant, `apps/lesson-mcp`, déjà rédacté) et **fichiers** (nouveau, universel).

**Construit (branche `feat/capsule-judgment-slice`)** :
- `packages/lesson-session-host/src/session-workspace.ts` — conducteur `SessionWorkspace` du protocole `.studium-session/` : `writeStep()` écrit un `task.md` RÉDACTÉ (via `publicScene`) + le résultat réellement exécuté (landmark/figure, allowlist) + `index.json` (mémoire/log) ; `readResponse()` mappe `response.json` → ResponseInput (coercition du `kind`) ; `ingest()` note via le vrai grader, écrit `feedback.md`, avance. **Self-heal** : une `response.json` invalide/mal typée est consommée + `feedback.md` correctif (le canal ne se bloque pas).
- `tools/build_capsule_judgment_demo.py` émet aussi `fixtures/capsule-judgment-demo/lesson.json` (bundle chargeable : intro + 2 `spot_the_flaw` ancrés, rules:[] → avance linéaire).
- `docs/agentic-session-protocol.md` — les deux canaux + layout `.studium-session/` + quick-start opérateur (n'importe quel assistant) + garantie de rédaction.

**Invariant clé (vérifié)** : la clé de réponse (claims/flaws_expected/model_*) n'atteint JAMAIS l'opérateur via task.md/feedback.md/index.json. `publicScene` rédacte les champs de scène ; `renderTask` ne surface QUE l'asset `executed_result` + une allowlist de meta (landmark/path/cmd/passed), car `host.sceneArtifacts` n'est pas rédacté (asymétrie connue, commentée).

**Vérification** : lesson-session-host tsc + **180 vitest** (3 nouveaux : round-trip ancré rédacté · self-heal · no-leak-toutes-scènes) ; lesson-mcp build ; 200 assertions drivers studium-vscode (aucune régression). Revue adverse (2 lentilles × Opus) = ship-with-fixes ; **2 must-fix corrigés** (self-heal anti-blocage ; cette entrée AGENT_LOG) + 4 should-fix (allowlist commentée · écriture atomique documentée · prose rendu-natif resserrée · clause quick-start « pas de harnais opérateur »).

**NON construit (suivi honnête)** : rendu inline de la figure `executed_result` dans le notebook (aujourd'hui une note de référence ; le contrôleur n'a pas de cas `executed_result`) ; harnais opérateur réel (Claude Code/Copilot) ; intégration du `work/` opérateur dans l'évaluation de processus.

---

## 2026-06-27 — Slice « capsule-backed judgment » (vision capsule-backed lessons, tranche 1)

**Vision (verrouillée en discussion ; mémoire `studium-capsule-backed-lessons`)** : l'opération scientifique réelle est le *véhicule*, le jugement calibré est la *destination*. Première tranche de dé-risquage : prouver qu'un composeur agentique peut produire une scène de jugement ANCRÉE sur une exécution réelle.

**Construit (branche `feat/capsule-judgment-slice`)** :
- **Carrier TS** : `reference_result` (ReferenceRunSchema) optionnel sur `SpotTheFlawSceneSchema` ; `sceneRenderAssets` généralisé (`"reference_result" in scene`) → une scène de jugement ancrée expose le run réel comme asset `executed_result` (même carrier que `reproduction`).
- **Composeur** : nouvel agent génératif `SpotTheFlawAgent` + `prompts/spot_the_flaw.j2` (le type était schema-only ; l'orchestrateur le sautait — désormais 7 agents). Le prompt injecte le landmark RÉEL + un cadran de fiabilité auteur (`n_flaws`).
- **Ancrage** : `tools/ground_judgment.py::ground_spot_the_flaw` attache le `reference_result` depuis un vrai run `tools/capsule_runner.py` ; le LLM n'écrit que l'*interprétation*, le *résultat* est attaché par code (non hallucinable).
- **Miroir Python** : `ReferenceRun` ajouté (corrige le drift TS↔Python signalé par l'audit) + `reference_result`/`image_path` sur ReproductionScene & SpotTheFlawScene.
- **Démo e2e** : `tools/build_capsule_judgment_demo.py` exécute la VRAIE capsule (`fixtures/capsule-demo`, venv uv isolé) puis génère 2 scènes ancrées (subtle=1 défaut, blatant=3) → `fixtures/capsule-judgment-demo/{scenes.json,decay.png,README.md}`. Landmark réel `k_fit=0.4212`.

**Vérification** : 25 pytest scene-synth (agent + intégration ancrage + round-trip) ; 56 vitest lesson-bundle-schema (dont nouveau cas `executed_result` spot_the_flaw) ; tsc lesson-session/host/mcp ; 200 assertions drivers studium-vscode (aucune régression). Revue adverse (3 lentilles × Opus) = **ship-with-fixes, 0 must-fix** ; le seul should-fix corrigé : README + docstring n'impliquent plus que la démo déterministe prouve le *cadran de prompt* (le stub honore `n_flaws` via l'outline, pas le prompt rendu ; l'authorabilité du cadran est prouvée par test unitaire ; bout-en-bout = `--live`).

**NON prouvé (assumé, honnêtement signalé)** : qualité de génération avec un vrai modèle (pas de clé API dans ce shell — `--live` requis). Reportés (séparables) : calibration-as-gating + capture de confiance CONTINUE (décision « continuous » verrouillée pour la tranche suivante), provenance span-level, environnement capsule installé.

---

## 2026-06-27 — studium-vscode : câblage des scènes active-learning (audit → fix Wave 1-3)

**Contexte** : un audit multi-agent (21 agents) a montré que l'extension VS Code (`apps/studium-vscode`, le runtime étudiant) n'avait jamais été mise à jour quand les types de scènes Wave-1/Wave-2 ont atterri. Les 4 plus récents (comparison/summary_audit/prompt_practice/communication_sim) **cassaient la leçon** : les deux surfaces (webview `media/artifact-pane.js` + notebook `src/notebook.ts`) tombaient sur un `{kind:"ack"}` que leurs graders rejettent (`SceneGradingError`) → reset de session / toast d'erreur. Le bundle démo par défaut `atomistique-l1` est touché (scène 4 = summary_audit).

**Fix (renderer-only — aucun changement schema/grader/transport ; les champs arrivent déjà via publicScene)** :

| Wave | Contenu |
|---|---|
| 1 | comparison / summary_audit / prompt_practice / communication_sim : rendu des champs montrés + soumission du bon `kind` (calqué sur explain_back) sur les 2 surfaces. Source unique `src/scene-io.ts` (FREE_TEXT_KIND). |
| 2 | discussion multi-tours : message webview `{type:"turn"}` → `submit_turn` → signal de raisonnement + réplique socratique dans un transcript ; le notebook route tout texte non-`next` vers submit_turn jusqu'à max_turns puis ack. |
| 3 | reproduction : rendu des `steps[]` ; carte de calibration (`src/calibration.ts`, port verbatim de host.ts ; bandes sur/sous, sans chiffre) ; `end_session`/« 🗑 M'oublier » (purge RGPD confirmée par modale ; directive notebook `forget`) — la fermeture seule ne fait que couper le transport (l'état persiste pour reprise). |

**Balayage de complétude (no gaps overlooked)** : re-audit indépendant (agent) → 2 surfaces × 13 types × tools × render-kinds. Tout câblé SAUF un résidu réel **trouvé + corrigé** : le panneau webview ne rendait pas l'énoncé `quiz.question` ni `meta_checkpoint.pre_question`/`scale_labels` (le notebook le faisait) → l'élève voyait les boutons-réponses sans la question. Corrigé dans `renderPane` + libellés d'échelle ; gardé par 3 assertions de parité + 5 assertions DOM. Parité notebook ajoutée aussi : `presentation.explanation` (rationale d'adaptation) + directive `hint`. `explain_last_adaptation` (MCP) = redondant (la rationale est déjà poussée via `presentation.explanation`) — pas un gap.

**Vérification** : tsc clean, esbuild OK, **200 assertions de drivers** vertes (`pnpm --filter studium-vscode test`) — `scene-io` 44 (contrat scène→kind + parité webview + calibration), `webview-pane` 63 (rendu DOM LIVE via jsdom + clics → messages), `community` 19, `modality` 26, `review-fsrs` 36, `lesson-walk` 12. Back-end live : `lesson-walk.driver.ts` (e2e via le vrai serveur MCP) déroule `src/fixtures/wave-scenes.json` (bundle non-gaté, tous les types active-learning) + `all-scene-types.json` (boucle discussion) jusqu'à `complete`, et confirme que `summary_audit` d'atomistique-l1 ne lève plus d'erreur. (atomistique-l1 ne se termine pas sous answers synthétiques : son moteur adaptatif gate sur la maîtrise accumulée — comportement moteur, pas un bug.)

---

## 2026-06-27 — Roadmap complet : active learning, learner-as-author, PeerStudio

**Branches** : `feat/learner-as-author`, `feat/roadmap-wave1`, `feat/roadmap-wave2`, `feat/roadmap-d1-peerstudio`, `feat/d1-teacher-ui` — toutes mergées sur `main` à `e227cb5`.

**Méthode** : parallel workflow orchestration (Workflow tool + file-area partitioning), TDD strict (tests écrits avant ou en même temps que le code), revue adverse à chaque merge.

### Learner-as-author (A1–A4 + Workflows A/B/C)

| Feature | Commits clés | Description |
|---|---|---|
| A — backend | `b3782eb` | LAItemEnvelope schema-pure, append-only JSONL ledger, decide_item (rule-003 gate), HMAC author_pseudonym server-only |
| B — peer loop | `058adce` | record_peer_review → k-suppressed peer_signals → decide_item; discoverCommunityBundles |
| C — UIs | `7bd039e` | /studio (StudioForm + validate badge + SelfTestPanel + consent) ; /submissions (SubmissionsQueue moderation) |
| A3 — runtime | `8a4d366` | community-bundle live (lesson-mcp + VS Code extension wire) |
| A4 — redaction | `d19f2bd` | publicScene/publicPresentation/publicTransition (REDACTED_SCENE_FIELDS) ; calibrationFor fix (h.kind → h.signal.kind) |

### Wave 1 — Nouveaux types de scènes (C1–C3) + surfaces (B1–B2)

| Feature | Description |
|---|---|
| C1 comparison | artifact_a/artifact_b, key_points, comparisonGrader |
| C2 summary_audit | source_content + ai_summary, flaws_expected, summaryAuditGrader |
| C3 prompt_practice | task + key_points, promptPracticeGrader |
| B1 FSRS | reviewQueueFromState + calibrationFor surfacés ; host.review.test (no-fabrication guard) ; FSRS inline copy + 7/7 parity test |
| B2 modalité | selectRenderOrder(assets, pref) ; studium.modalityPreference config VS Code |
| A1 /studio | SpotTheFlawEditor, ExplainBackEditor, RevealPanel ; tous types authoriables |
| A2 /peer | PeerBoard + PeerTakePanel + PeerRatePanel ; rating scalaire {passed, rating 1–5, helpful} ; auteur jamais affiché |

### Wave 2 — communication_sim (D2) + correctifs

| Feature | Description |
|---|---|
| D2 communication_sim | scenario + prompt + key_points + model_response ; communicationSimGrader ; publicScene inclut model_response dans REDACTED_SCENE_FIELDS |
| MASTERY_CLAIM_THRESHOLD | bug : 0.85 → DEFAULT_THETA (0.8) ; 3 bonnes réponses → posterior 0.846 → mastery claim |
| calibrationFor | bug : h.kind → h.signal.kind ; no-fabrication regression test |
| cues stopwords | s3d-communicate-2p : "sans"→"image", "comme"→"couloir" |

### D1 PeerStudio — Substrat multi-apprenants

| Feature | Description |
|---|---|
| Room backend | room.ts types + aggregateRatings (k-floor=3) ; host.ts openRoom/joinRoom/submitRoomRating/getRoomState/closeRoom ; PeerRoomError |
| MCP tools | 5 outils (open/join/submit/get/close_peer_room) |
| HTTP API | 5 routes Fastify (lesson-server) + Zod schemas |
| Teacher dashboard | /room route + PeerRoomPanel : open form → join-code display → état live → close |
| Spec doc | docs/specs/peerstudio-d1.md |

**Tests au moment du merge final** :
- lesson-session-host : **87 passés** (11 fichiers) dont 15 room + 7 FSRS parity + 12 review
- lesson-session : **392 passés** | 8 skippés (API-key gated)
- lesson-mcp : **8 passés**
- lesson-server : **27 passés** (7 fichiers) dont 11 room routes
- teacher-dashboard : **39 passés** (3 fichiers) dont 9 PeerRoomPanel
- lesson-bundle-schema : **55 passés** ; adaptation-engine : **44** ; typed-graph-lens : **7** ; student-runtime : **70**
- analytics-collector (Python) : **189 passés** (scene-synth)

**Bug de fond corrigé** : stale `.js`/`.d.ts`/`.map` compiled files dans `lesson-server/src/` (33 fichiers) shadowaient les `.ts` mis à jour sous vitest → supprimés.

**Régressions pré-existantes hors scope** : D.5 CI Tauri (bloqué sans push remote).

---

## 2026-05-13 — M6 polish + démo end-to-end atomistique (`prototype/m6-polish-demo`)

**Livré (12 tasks subagent-driven)** :

- Fixture `fixtures/m6/demo-atomistique/` complète : corpus PDF L1 SV
  (cours `cours-L1SV-atomistique.pdf` 23 MB + TD `TD-SPEB107-enonce.pdf` 1.2 MB),
  2 placeholders articles OA (fallback documenté), `lesson.json` schema 1.4
  (10 scènes leçon 1+2), ABS capsule `task-atom-001` + `periodic-table.svg` (5.7 KB),
  `build.sh` zip -> `demo-atomistique-bundle.zip` (~7 KB).
- Orchestrateur `tools/e2e-demo-m6.sh` avec modes `--no-tauri` (smoke macOS),
  `--ci` (CI Linux WDIO). 3 assertions curl (`/metrics/progress`,
  `/metrics/concept-mastery-history`, `/metrics/journal`).
- Spec WDIO `apps/student-runtime/tests-e2e/specs/demo-m6-atomistique.spec.ts`
  — 2 sessions cross-session, sélecteurs alignés sur le pattern m5
  (`#a`, `button*=Continuer`, `[data-testid='library-load-bundle']`,
  `[data-scene-type='...']`).
- CI workflow `.github/workflows/ci.yml` job `demo-m6` sur ubuntu-22.04 +
  xvfb + tauri-driver. `STUDIUM_EVIDENCE_ENRICH=off` (bundle pré-généré).
- Docs utilisateur : `docs/user/teacher-guide.md` (5.8 KB) + `docs/user/student-guide.md` (4.5 KB).
- Polish UI : QW1 focus-visible rings (7 scenes + AdaptationButton +
  CourseNav dashboard) + QW2 AdaptationButton tooltip explicabilité (named export
  `AdaptationButton` accepte `ruleLabel`, tooltip title + aria-label + sr-only).
  3 vitest verts.
- Audit accessibility `docs/audits/2026-05-13-axe-m6.md` — 0 critical / 0 serious.
  axe-cli indisponible localement (`npx canceled`) -> revue manuelle WCAG 2.1 AA
  sur 10 composants dashboard + 7 scenes + AdaptationButton. 1 moderate
  (`ProgressHeatmap` couleur seule) déféré M7.

**Tests verts ajoutés** :
- 5 pytest `services/scene-synth/tests/test_demo_atomistique_bundle.py`
- 2 pytest `services/planner/tests/test_demo_atomistique_abs.py`
- 3 vitest `apps/student-runtime/src/components/AdaptationButton.test.tsx`
- 4 smoke bash `tools/e2e-demo-m6.test.sh`

**Cumul tests M6 (snapshot 2026-05-13)** :
- pytest per-service : analytics-collector 97 + ingest 24 + planner 69 + scene-synth 41 = **231 passés**
  (collecte root échoue par collision `conftest.py` connue — invocation per-service contournée dans CI).
- vitest runtime : **56 passés** / 3 fails connus (`LessonPlayer.test.tsx` — Zod schema_version 1.3 vs 1.4).
- vitest dashboard : **14 passés** / 7 fichiers fail = pollution `@playwright/test` (config integration test) — hors scope M6.

**Trade-offs conscients** :
- 23 MB PDF cours commit-é sans git-lfs (research repo, fixture démo).
- Articles OA = placeholders (fallback documenté ; cours PDF suffit pour evidence).

**Régressions pré-existantes hors scope** :
- `LessonPlayer.test.tsx` : 3 tests fail (Zod schema_version 1.3 vs 1.4),
  héritage du merge evidence v1 (`cd881d0`). À fixer en M6.x suivant — bundle
  test fixture à mettre à jour 1.3 -> 1.4.

**Environnement local validé partiel** :
- `e2e-demo-m6.sh --no-tauri` syntaxe OK + Steps 1-2 OK (build + Pydantic).
- Step 3 (analytics-collector startup) bloqué env : `pyproject.toml` de
  `analytics-collector` référence `file:../../packages/telemetry-events` que
  pip résout vers `/Users/holobiomicslab/packages/telemetry-events` (chemin
  absolu erroné). CI Linux installera proprement via
  `pip install -e packages/telemetry-events` AVANT
  `pip install -e services/analytics-collector`.

**Hors scope confirmé (différés)** :
- Tableau périodique interactif (souhait auteur) -> M7+
- Escape game scene_type -> ADR futur
- M4 LAN coopératif -> reste différé (ADR 005)
- D.1 validation humaine M3 -> indépendant (rule 003)
- DRY `should_enrich` (module-level) vs `_evaluate_enrichment` (CriticAgent) -> M6.x

**Prêt pour tag `m6-demo`** après merge sur main.

---

## 2026-05-13 — Evidence enrichment (Perspicacité + ABS coupling authoring-time)

**Branche** : `prototype/evidence-enrichment` (10 commits + AGENT_LOG = 11 commits ahead of main au tag pose).
**Tag** : `m6-evidence-v1`.
**Méthode** : subagent-driven-development autonome, 12 tasks bite-sized,
TDD strict, mapping spec→codebase scene_types (intro+concept+simulation+
reproduction).

### Livré (10 commits)

| # | Tâche | Commit | Focus |
|---|---|---|---|
| 1 | Schema bump lesson-plan v1.4 | `bc5c9a8` | Evidence type AJV+TS+Pydantic, 6+6 tests |
| 2 | EvidenceEnricher skeleton | `cad8d8b` | should_enrich + enrich(plan), 3 tests |
| 3 | perspicacite_mapper | `1827985` | select_mode + extract_refs, 8 tests |
| 4 | ABS asset extractor | `28169e5` | extract_asset priorité par scene_type, 6 tests |
| 5 | CriticAgent._evaluate_enrichment | `e7723b2` | matrice scene_type × override, 10 tests |
| 6 | Pipeline /plan integration | `08026d5` | gated STUDIUM_EVIDENCE_ENRICH, 2 tests |
| 7 | Prov-O enrichment_activity | `09258b8` | ADR 009 chain étendue, 2 tests |
| 8 | Bundle schema 1.4 + scene-synth | `1b6ab70` | Zod EvidenceSchema + propagation, 19+20+36 verts |
| 9 | Fixture demo-metabolomics E2E | `235fd62` | task-msms-001 capsule + integration E2E, 67/67 planner |
| 10 | Métrique scenes_with_evidence | `b3ad816` | analytics + dashboard ProgressMetrics |

### Garde-fous ADR 014

- ✅ Formatif uniquement (hors `assessment_blueprint` ADR 013)
- ✅ Authoring-time seul (zero impact RGPD runtime)
- ✅ Prov-O traçable (`enrichment_activity` node)
- ✅ Override auteur préservé (`evidence_override: force | skip`)
- ✅ Wrapper Perspicacité M0 réutilisé (retries + cache + audit)
- ❌ Pas de re-ranking étudiant des refs
- ❌ Pas de scoring qualité auto-affiché étudiant

### ADRs et docs (Studium worktree)

- ADR 014 evidence enrichment v1
- Amendment ADR 003 — schema 1.3 → 1.4 trace historique
- Design : `Studium/docs/superpowers/specs/2026-05-13-evidence-enrichment-design.md`
- Plan : `Studium/docs/superpowers/plans/2026-05-13-evidence-enrichment-implementation.md`

### Reste post-M6 evidence

- UI auteur evidence editing (M6.5+)
- v2 runtime-side enrichment (déféré sous consent C élargi)
- Widget interactif ABS embedded (iframe — déféré)
- Override mode Perspicacité par scène (déféré)
- DRY `should_enrich` vs `_evaluate_enrichment` (suivi M6.x)

---

## Views v0.4 — Journal + Coopération + Blueprint livré 2026-05-13

**Branche** : `prototype/m6-views-v0.4` (12 commits ahead of main au tag pose).
**Tag** : `m6-views-v0.4`.
**Méthode** : subagent-driven-development autonome, 14 tasks bite-sized,
TDD strict, 4 phases (foundation → backends F1/F2/F3 → 3 vues → closure).

### Livré (12 commits + closure)

| # | Tâche | Commit | Focus |
|---|---|---|---|
| 1-2 | ADRs 006 v1.3 + 013 (Studium) | `d05257c` | 13 → 16 events fermés + blueprint composite |
| 3 | telemetry-events v0.4 | `135f1c7` | 3 events Zod + Pydantic + 38 tests round-trip |
| 4 | F1.1 SQLCipher learner_journal | `20f1d79` | table + 3 Tauri commands + 4 cargo tests |
| 5 | F1.2 JournalEntry component | `12606e0` | React + tauri.ts wrappers + 3 vitest |
| 6 | F1.3 GET /metrics/journal | `91e2e0a` | endpoint counters only + 7 tests |
| 7 | F2.1 GET /metrics/cooperation | `e8393bd` | endpoint analytics-only + 6 tests |
| 8 | F3.1 schema 1.3 + AssessmentBlueprint | `b9841c4` | Zod + Pydantic + sum-to-one validation |
| 9 | F3.2 POST /metrics/blueprint | `c1e9b05` | composite scoring + 7 tests |
| 10 | F1.4 Vue Journal | `f519ead` | 3 KPI + per-scene + ADR 006 disclaimer + 9-tab nav |
| 11 | F2.2 Vue Coopération | `eee1830` | 4 KPI + M4 deferred disclaimer + 3 Playwright |
| 12 | F3.3 Vue Blueprint | `251ec93` | recharts RadarChart + ADR 013 disclaimer |
| 13 | Régression + AGENT_LOG | (this commit) | 430 tests verts cumulés |

### Tests cumulés sur prototype/m6-views-v0.4

**430 verts** (158 TS + 252 Python + 20 Rust) — +92 vs main `m5-analytics` baseline (338).

| Suite | Tests | Delta |
|-------|-------|-------|
| TS vitest | 158 | +31 (telemetry-events +21, lesson-bundle-schema +4, teacher-dashboard +3 + 1 par vue × 3) |
| Python pytest | 252 | +41 (lesson-bundle-schema +4, analytics-collector +20 — journal/coopération/blueprint, telemetry-events +17) |
| Rust cargo | 20 | +4 (journal CRUD + wipe) |

### Garde-fous ADR 006 v1.3 + ADR 013 audités

- ✅ Aucun texte étudiant transmis (journal counters only, cooperative aggregate_only)
- ✅ Disclaimer "formatif uniquement" sur vue Blueprint
- ✅ Disclaimer "texte journaux reste local" sur vue Journal
- ✅ Disclaimer "En attente de M4" sur vue Coopération
- ✅ Audit grep dashboard : 3 matches `name=` HTML form attributes only (courseToken + 2× pseudonyme), aucun leak nominatif

### ADRs et docs (Studium worktree)

- ADR 006 amendment v1.3 (`d05257c`) — 16 events fermés
- ADR 013 (`d05257c`) — assessment_blueprint v1
- Design : `Studium/docs/superpowers/specs/2026-05-13-views-v0.4-design.md`
- Plan : `Studium/docs/superpowers/plans/2026-05-13-views-v0.4-implementation.md`

### Reste post Views v0.4

- M4 LAN runtime (cooperative deferred)
- M1 UI auteur blueprint (reporté à M6.5+)
- M6 polish + démo end-to-end (sous-projet C brainstorm post-M5)
- Follow-ups review minors : Task 5 TelemetryEmit type + module style, Task 8 stale docstrings v1.2, etc.

---

## M5 — analytics + dashboard v0.4 livré 2026-05-13

**Branche** : `prototype/m5-analytics-views` (17 commits ahead of main au tag pose).
**Tag** : `m5-analytics`.
**Méthode** : subagent-driven-development autonome (1 implementer + 2 reviews par task,
fresh subagent per task, superpowers explicites — TDD, verification-before-completion,
systematic-debugging, requesting-code-review).

### Livré (9 tasks + follow-ups consolidation)

| Task | Commit | Tests apportés |
|------|--------|----------------|
| M5.10 ai_audit_result emit | `eedffce` | 6 matcher + 1 intégration scene |
| M5.9.0 schema discussion ADR 012 | `ed0673b` | 3 Zod + 3 pytest |
| M5.9 DiscussionScene + reasoning-scorer | `0b230dd` | 5 scorer + 3 hook + 3 scene |
| M5.9 review fixes | `07e2f55` | +1 timer regression |
| M5.5 backend endpoint mastery-history | `a061204` | 3 intégration |
| M5.5 Trajectoire view | `8d5b7e0` | 3 Playwright + 2 vitest |
| M5.6 Littératie IA view (ADR 011) | `87abf00` | 3 Playwright + 1 vitest |
| M5.8 Raisonnement view | `55047e8` | 2 Playwright + 1 vitest |
| M5.7 bundle_version filter (parallèle) | `350d092` | 6 unit + 6 integration |
| M5.11 E2E 2-sessions + tools/e2e-m5.sh | `67c6070` | bash + tsc validations |
| Dette technique D.1-D.4 | `ae1d1eb` | audit ADR 011 clean |
| Follow-ups consolidation | `a1976a8` | IC80 + fmt + strict-match + Math.round + readiness polling |

### Tests cumulés sur m5-analytics-views

**338 verts** (127 TS vitest + 211 Python pytest) — +119 vs main baseline.

### Garde-fous ADR 011 audités

- AILiteracyCard footer + page banner « formatif uniquement »
- IC80 format `[low%, high%]` direct
- Pseudonyme obligatoire (FastAPI 422 + 400 défensif)
- Audit dashboard `name|email|firstName|lastName` : 0 leak (matches = HTML form attributes)

### ADRs et docs (Studium worktree)

- ADR 010 flat scene shape (`d0d77fd`)
- ADR 011 ai_literacy_index v1 + garde-fous (`ad2b547`)
- ADR 012 discussion scene type v1 (`724aed4`)
- ADR 006 amendment v1.1 — 11 → 13 events fermés (`c02864d`)

### Gate humain Task 9

Validation blanket par utilisateur 2026-05-13 (mode autonome multi-heures). 338 tests
verts + tous reviews approuvés (Critical 0, Important fixés ou follow-up consolidés)
+ démo dashboard locale services démarrés (collector :8003 + dashboard :3001 avec
7 events fixture) + audit ADR 011 visuel.

### Reste post-M5

- D.4 push remote (user action) → CI Linux validation in vivo (WDIO + tools/e2e-m5.sh)
- D.6 badge CI README
- Follow-ups optionnels minor (a11y role="note", form pseudonyme/scene_id sur vue
  Raisonnement, vitest exclude `tests/integration/**`)
- Suite post-M5 : voir `Studium/docs/superpowers/specs/2026-05-12-post-m5-roadmap-design.md`
  sous-projets B (D.4 remote), C (M6 démo), E (post-M6 enrichissements v0.4)

---

## 2026-05-12 — C.6 wiring useTelemetry dans le runtime

### Livré
Câblage du hook `useTelemetry` (déjà implémenté en C.5) dans les 6 points
d'émission du student-runtime, avec tests d'intégration TDD vitest.

**Composants câblés** :
- `views/LessonPlayer.tsx` → `lesson_started` (1×/mount), `scene_entered`
  (1×/scène via effet sur `scene.id`), `lesson_completed` (à la fin)
- `components/scenes/QuizScene.tsx` → `quiz_answered` (props `emit` optionnel)
- `components/scenes/AICritiqueScene.tsx` → `critique_submitted` (uniquement
  si l'évaluation LLM réussit)
- `views/ConsentScreen.tsx` → `consent_granted` (1× par scope A/B/C accordé)
- `views/SettingsScreen.tsx` → `forget_requested` (avec `flush()` avant
  `delete_all_data` pour préserver la trace)
- `hooks/useAdaptation.ts` → `adaptation_applied` (uniquement quand une règle
  matche, pas pour le fallback `advance_to_next_scene`)

**Architecture** :
- LessonPlayer instancie un unique `useTelemetry`, plumé via SceneRouter
  → renderers (prop `emit?: TelemetryEmit`) et via `useAdaptation`
  (4ᵉ param `onTelemetryEmit?`).
- ConsentScreen + SettingsScreen instancient leur propre `useTelemetry`
  (endpoint `null` en local — émission préservée pour outbox/flush local).
- Type `TelemetryEmit` exporté depuis `useTelemetry.ts` ; `EmitInput`
  converti en `DistributiveOmit` pour préserver l'union discriminée
  Zod (sinon Omit collapse les variants).

### Tests
- **5 nouveaux fichiers** : `QuizScene.test.tsx` (3), `ConsentScreen.test.tsx`
  (3), `SettingsScreen.test.tsx` (2), `useAdaptation.test.ts` (3),
  `LessonPlayer.test.tsx` (3). +2 tests ajoutés dans `AICritiqueScene.test.tsx`
  (telemetry emit + non-emit on failure).
- **Total student-runtime** : 40/40 verts (vs 24 avant C.6).
- **TypeScript `tsc --noEmit`** : 0 erreurs.

### Dette technique réglée
- `@studium/telemetry-events` ajouté en dépendance workspace de
  `apps/student-runtime/package.json` (manquait depuis C.5 ; les tests
  vitest passaient via résolution Vite, mais `tsc --noEmit` échouait).
  Symlink manuel posé dans `node_modules/@studium/` en attendant le prochain
  `pnpm install`.

### Notes ADR 010
- Schéma flat respecté : `scene.markdown`, `scene.choices`, `scene.claims`
  (pas de `scene.content.X`).
- `bundle_version` télémétrie = `bundle.schema_version` ("1.1") faute de
  champ dédié dans LessonBundleSchema.

---

## 2026-05-12 — D.1 validation humaine + D.2 build/tarpaulin + dette pnpm

### D.1 — validation humaine M3 (rule 003)
Blanket validation par l'utilisateur (Studium daily 2026-05-12). 8 items
couverts par les tests Rust/TS existants (12 Rust + 18 TS verts).

### D.2 — build release + couverture
- **Build Tauri release** : `Studium.app` 10 Mo ✅ (cible <30 Mo)
- **Bundle DMG** : `bundle_dmg.sh` échoue (non bloquant, à investiguer plus tard)
- **WDIO** : bloqué macOS — `tauri-driver` ne supporte que Linux/Windows.
  Exécution reportée à CI Linux (workflow D.5 + remote D.4).
- **cargo tarpaulin** : 37.18% (cible 60%). Gap : `commands.rs` 0/72 et
  `lib.rs` 0/9, tous deux couverts uniquement par WDIO E2E (bloqué macOS).
  Couverture réelle estimée >60% en CI Linux avec WDIO actif.

### Dette technique résolue
- **pnpm-workspace.yaml** : remplacé `allowBuilds` (clé invalide pnpm 11)
  par `onlyBuiltDependencies` + `ignoredBuiltDependencies`. Déverrouille
  `pnpm install` + `tauri build` (bug ERR_PNPM_IGNORED_BUILDS). À propager
  aux autres branches (a2, c2, d3) avant rebase.

---

## M3 — 2026-05-08

### Livré (13 unités TDD)
- **U0-U5** (sessions précédentes) : LessonBundleSchema (Zod + Pydantic), SceneSchema, RuleSchema, LearnerState, SignalSchema, DecisionSchema, defaultLearnerState/defaultConceptState
- **U6** : BetaUpdater (correct: alpha += 1+(1-w), wrong: beta += 1+w), tests TDD rouge→vert
- **U7** : ConditionMatcher (6 opérateurs : >=, <=, !=, ==, >, <), tests 9/9
- **U8** : AdaptationEngine (getState, onSignal, explain, firstMatch), tests 7/7
- **U9** : bundle.rs (ZIP reader), commands.rs (8 Tauri commands), lib.rs wiré — 12/12 Rust ✅
- **U10** : Webview Bootstrap/ConsentScreen/LibraryScreen/SettingsScreen + lib/tauri.ts wrappers typés
- **U11** : LessonPlayer + SceneRouter + 4 renderers (Intro/Concept/Quiz/MetaCheckpoint) + useAdaptation hook
- **U12** : CalibrationPanel (show_calibration_panel trigger) + AdaptationButton (bouton "?" M6)
- **U13** : 8 fichiers E2E tests-e2e/ + wdio.conf.ts — **tauri-driver non installé**, tests en attente d'exécution humaine

### Métriques
- `cargo test --lib` : 12/12 verts (pseudonyme 4, keystore 2, storage 3, bundle 3)
- `adaptation-engine` TS coverage : 91.93% statements (cible ≥70% ✅)
- TypeScript `tsc --noEmit` : 0 erreurs sur tous les packages
- Rust crates : rusqlite (bundled-sqlcipher), keyring 3, zip 2, dirs 5, chrono 0.4

### Blocages documentés
- **tauri-driver** : non disponible sur cette machine → 8 tests E2E créés mais non exécutés ; à lancer manuellement avec `pnpm tauri:build && pnpm wdio:run`
- **Bundle size** : non mesuré (build release non lancé) ; cible <30 Mo
- **cargo tarpaulin** : non installé ; Rust coverage à mesurer manuellement

### ADRs concernés
- ADR 006 : pseudonyme HMAC-SHA256, secret en SQLCipher, droit à l'oubli ✅
- ADR 008 : validation LessonBundleSchema côté webview avant rendu ✅
- ADR 009 : keyring v3 OS Keychain pour clé SQLCipher ✅

### Sortie
- Branche : `prototype/m3-student-runtime`
- Tag : `m3-runtime`
- Merge sur `main` : après validation humaine (rule 003 — parcours étudiant complet joué et observé)

---

## M2 — 2026-05-07

### Livré
- `packages/lesson-plan-schema` : enrichissement ontologique (Prov-O, SKOS, ESCO, Schema.org, DCT, EDAM, REPRODUCE-ME) + `RefType.abs_capsule`
- `services/planner/agents/` : `BaseAgent`, `PlannerAgent`, `CriticAgent`
- `services/planner/ontology/` : `prov.py`, `jsonld.py`
- `services/planner/schemas.py` : `CritiqueResult` (+ `llm_used` flag)
- `services/planner/mimosa_wrapper.py` : thin wrapper compat (tests M1 verts)
- `services/ingest/abs_reader.py` : `ABSCapsuleReader` (lecture JSON/Markdown, sans dépendance ABS)
- `services/ingest/ingest_app.py` : endpoint `POST /ingest/abs-capsule`
- `fixtures/m2/abs_capsule_minimal/` : fixture de test statique

### Tests
- Tous les tests M1 verts
- Nouveaux tests M2 : test_prov_graph, test_planner_agent, test_critic_agent, test_planner_agent_abs, test_abs_reader, test_abs_endpoint
- Total : 45 + 8 = 53/53 verts

### ADR
- ADR 009 à créer : M2 agents explicites + ontologies croisées + interface ABS

---

## 2026-05-08 — Hotfix post-M2 : convention nommage modules services

- Régression M1 e2e détectée pendant validation humaine M2.
  `services/planner/critic.py` faisait `from schemas import LessonPlan` qui
  résolvait vers `services/ingest/schemas.py` quand pytest mélangeait les
  sys.path → `ImportError` sur `test_e2e_ingest_to_plan_to_export`.
- Fix : rename `services/planner/schemas.py` → `planner_schemas.py` +
  suppression doublons stales (`services/planner/app.py` M1 1.0.0,
  `services/ingest/schemas.py` doublon de `ingest_schemas.py`) + 11 sites
  d'import mis à jour.
- Tests : 69/69 Python + 15/15 TS (avant : 67/68 + 15/15).
- Convention de nommage à propager : un service Python `services/<svc>/`
  expose ses modules sous `<svc>_app.py` / `<svc>_schemas.py` pour éviter
  les collisions sys.path en pytest. Documentée dans Studium rule 004.

---

## 2026-05-05 — Unité 0 : Init repo prototype-build

- Fichiers : `CLAUDE.md`, `AGENT_LOG.md`, `tools/memory_cli.py`, `.memory/INDEX.md`
- Structure `.memory/{decisions,entries,rules,daily,templates}/` créée
- Toolchain au démarrage : Node v25.8.2 ✅, pnpm v11.0.5 ✅, Python 3.13.2 ✅, Rust/Cargo ❌
- **Écart unité 8** : Tauri hello world skippé — Rust/Cargo absent. À installer avant M1/M3. Warning loggué ici.
- Suite : Unité 1 — pnpm workspace + lint + tsconfig

---

## 2026-05-05 — Unité 1 : pnpm workspace + lint + tsconfig

- Fichiers : `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.eslintrc.json`, `.prettierrc.json`
- `pnpm install` ✅, `pnpm lint` ✅
- Suite : Unité 2 — lesson-schema tests rouges

---

## 2026-05-05 — Unité 2 : lesson-schema tests rouges

- Fichiers : `packages/lesson-schema/tests/schema.test.ts`
- 3 tests rouges écrits (validateLesson vide, validateLesson valide, loadSchema $schema)
- Suite : Unité 3 — impl

---

## 2026-05-05 — Unité 3 : lesson-schema JSON Schema + Ajv + sample

- Fichiers : `packages/lesson-schema/src/schema.json`, `src/index.ts`, `architecture/examples/lesson_sample.json`
- JSON Schema Draft 2020-12, 8 types de scène (ADR 003), Ajv2020
- Sample métabolomique : 5 scènes (intro, concept, quiz, ai_critique, meta_checkpoint)
- Tests : 3/3 verts
- Suite : Unité 4 — Pydantic mirror

---

## 2026-05-05 — Unité 4 : Pydantic mirror lesson-schema

- Fichiers : `packages/lesson-schema/python/lesson_schema/__init__.py`, `pytest.ini`
- Pydantic v2, enums stricts, validateur objective_refs croisé
- Tests Python : 3/3 verts
- Suite : Unité 5-6 — llm-client

---

## 2026-05-05 — Unités 5-6 : llm-client

- Fichiers : `packages/llm-client/src/index.ts`, `tests/llm-client.test.ts`
- Interface LLMClient, 4 aliases whitelist, mock + LiteLLM adapter (ADR 002)
- Tests : 3/3 verts (mock mode + aliases + rejet alias inconnu)
- Suite : Unité 7 — perspicacite-client

---

## 2026-05-05 — Unité 7 : PerspicaciteClient

- Fichiers : `packages/perspicacite-client/src/index.ts`, `tests/perspicacite-client.test.ts`
- Mode mock (fixture statique) + mode real (retries 3, backoff exp 200ms, timeout 10s, fallback offline)
- Tests : 2/2 verts (mock fixture, fallback offline sur port inexistant)
- Suite : Unité 8 (SKIP) + Unité 9 CI

---

## 2026-05-05 — Unité 8 : SKIP Tauri (Rust absent)

- Rust/Cargo absent sur cette machine → unité 8 (student-runtime hello world) non exécutée.
- Action requise : installer `rustup` + `cargo` avant M1/M3.
- Aucun code applicatif Tauri produit. Bloquant seulement pour M3 (runtime étudiant).

---

## 2026-05-05 — Unité 9 : CI workflow

- Fichier : `.github/workflows/ci.yml`
- Steps : Node 20 + pnpm 9 + Python 3.12 → install → lint → pnpm test → pytest
- Pas de Tauri build en CI (attendu M3)

---

---

## 2026-05-05 — M1 : Pipeline auteur → plan validé

### Préconditions vérifiées
- Branche `prototype/m1-pipeline-auteur` créée depuis `main` (tag `m0-skeleton`)
- Python : miniconda3 (3.13.2), PyMuPDF 1.27, FastAPI 0.136
- MinerU absent → PyMuPDF fallback (ADR 008)
- Mimosa SDK absent → LLMClient direct fallback (ADR 008)

### Unités livrées

| Unité | Livrable | Tests |
|-------|---------|-------|
| 1 | `packages/lesson-plan-schema` JSON Schema + Pydantic | 7 TS + 5 Py ✅ |
| 2-3 | `services/ingest/pdf_extractor` PyMuPDF | 5 Py ✅ |
| 4 | `bibtex_parser` + `doi_resolver` | 5 Py ✅ |
| 5 | FastAPI `POST /ingest/corpus` | 3 Py ✅ |
| 6 | `services/planner/schemas.py` Pydantic | 3 Py ✅ |
| 7 | `mimosa_wrapper` LLMClient + audit trace (rule 002) | 4 Py ✅ |
| 8 | `critic` agent score + annotations | 3 Py ✅ |
| 9 | FastAPI `POST /plan` pipeline→critic | 4 Py ✅ |
| 10 | `apps/author-web` Next.js 14 upload+éditeur+export | build ✅ typecheck ✅ |
| 11 | Tests E2E CLI : ingest→plan→critic→export JSON validé | 3 Py ✅ |

### Résumé vérification finale
- `pnpm test` : 15/15 TS verts
- `pytest services/ packages/lesson-plan-schema/tests_python/` : 35/35 verts
- `pnpm --filter @studium/author-web build` : exit 0
- Validation Pydantic active sur tous les LLM calls (rule 002) ✅
- HITL : export JSON uniquement après validation enseignant (rule 003) ✅
- ADR 008 : fallbacks MinerU + Mimosa documentés

---

## 2026-05-05 — Unité 10 : Vérification finale M0

- `pnpm test` global : 8 tests TS verts (3 lesson-schema + 3 llm-client + 2 perspicacite-client)
- `pnpm lint` : clean
- `pytest` : 3 tests Python verts
- Écart documenté : unité 8 (Tauri) skippée — Rust absent
- Tag `m0-skeleton` posé
- Branche `prototype/m0-skeleton` à pousser (remote à configurer par l'utilisateur)

---

## 2026-05-09 — ACD Stream A2 (résumé branche `prototype/a2-scene-synth`)

Fork depuis `prototype/m3-student-runtime`. Détail A.0–A.7 dans la branche
`prototype/c2-analytics` (commit `3bfb370`).

| Unité | Cible | Tests | HEAD |
|-------|-------|-------|------|
| A.0–A.7 | services/scene-synth Python (sub-agents pendant absence) | 33 verts | `e23ac78` |
| A.8 | ReproductionScene.tsx + dispatch SceneRouter | 6 vitest | `2f842d2` |
| A.9 | AICritiqueScene.tsx + dispatch SceneRouter | 7 vitest | `2f842d2` |
| A.10 | services/scene-synth/tests/e2e/test_full_pipeline.py + WDIO spec + tools/e2e-a10.sh | 3 pytest | `2f842d2` |

A.10 design : pour ne pas dépendre d'un LLM réel, le pytest E2E utilise un
`_FakeLLM` signature-based qui renvoie du JSON canned par scène (matché sur
header unique du prompt Jinja2) + `_PermissiveCritic`. Couvre :
- 6 types de scène présents dans le ZIP produit
- skip ai_critique sur `include_critique=False`
- warning sur unsupported scene type

WDIO part (`apps/student-runtime/tests-e2e/play-bundle-from-scene-synth.test.ts`)
livré mais bloqué tant que la build Tauri release n'est pas faite (disque plein
sur cette session).

**Tests cumulés branche** : 33 (A.0–A.7) + 13 vitest (A.8 6 + A.9 7) + 3 pytest
(A.10 E2E pipeline) = **49**.

**Reste sur A2** : aucune unité — A2 complet. Reste juste merge sur main après
M3 mergé (Stream U humain).

## 2026-05-09 — ACD Stream C2 (C.0–C.4) : telemetry + analytics-collector

**Branche** : `prototype/c2-analytics` (depuis `prototype/m3-student-runtime`)
**HEAD** : `3510547`
**Tests** : 15/15 verts (7 unit metrics + 3 POST telemetry + 5 GET metrics)

| Unité | Cible | Tests | Commit |
|-------|-------|-------|--------|
| C.0 | Scaffold telemetry-events + analytics-collector + teacher-dashboard | health OK | `c7b5d5e`+`c7cd97e` |
| C.1 | `telemetry-events` Zod + Pydantic, 9 events ADR 006, round-trip Python | 4/4 Py (TS skippé, no node) | `8c08d0b` |
| C.2 | `POST /telemetry` valide batch + JSONL append-only par cours/jour | 3/3 | `8467897` |
| C.3 | `metrics.py` agrégations (progress + Brier calibration + autonomy_ratio) | 7/7 | `a998726` |
| C.4 | `GET /metrics/{progress,calibration,autonomy}` + auth course token | 5/5 | `3510547` |

**Bloqué** :
- **Sous-agents épuisés (budget plan, reset 11:30pm Paris)** → C.5 (useTelemetry hook + Rust telemetry_outbox) + C.7 (Next.js dashboard) reportés.
- **C.6 + C.8** (intégration runtime + E2E) bloquées sur merge A2 (qui dépend de D.3 merge M3).

**Dette / follow-ups** :
- TS Zod tests non exécutés (no node dans env sub-agent). À relancer en CI.
- `client_timestamp` typé `str` côté Pydantic pour parité Zod (pas `datetime`).
- JSONL append sans verrou de concurrence (acceptable prototype).
- `.gitignore` n'a pas `build/` → artefact setuptools accidentellement commité au scaffold C.0 puis retiré commit suivant.

## Bilan session 2026-05-09 (ACD)

Streams A2 et C2 avancés en parallèle via subagent-driven development pendant absence utilisateur.

| Stream | Unités livrées | Tests | Bloqué |
|--------|----------------|-------|--------|
| A2 (scene-synth) | A.0–A.10 (10/10) | 49 verts | merge sur main (D.3) |
| C2 (analytics) | C.0–C.4 (5/8) | 15 verts | C.5/C.7 budget ; C.6/C.8 sur merge A2 |
| D3 (infra) | 0/6 | n/a | humain (rule 003 M3) |

**Prochaine session** :
1. Reprendre C.5 (useTelemetry hook) puis C.7 (dashboard) après reset budget.
2. Stream U humain : D.1 (validation rule 003 M3) → D.3 (merge M3 sur main).
3. Une fois M3 + A2 mergés : C.6 + C.8 dispatchables.
4. D.5-D.6 (CI Tauri) en parallèle quand A2/C2 stabilisés.

---

## 2026-05-09 nuit — Reprise autonome (après installation tauri-driver+tarpaulin)

Session autonome lancée par utilisateur ("continue jusqu'à demain matin"). Tooling
natif vérifié présent (cargo 1.95, tauri-driver, cargo-tarpaulin, pnpm 11.0.5,
miniconda Python 3.13.2).

### Livrables nuit (3 branches touchées)

**`prototype/c2-analytics` (HEAD `d1ac48f`)** :
- C.5 livrée — useTelemetry hook + telemetry_outbox SQLCipher.
  - storage.rs : table `telemetry_outbox` + 3 helpers (push, drain, count) +
    `delete_all` étendu pour wipe outbox (RGPD).
  - commands.rs : 3 nouvelles Tauri commands (`telemetry_outbox_push|drain|count`)
    + cargo test integré.
  - useTelemetry.ts : buffer + flush par batch + outbox fallback offline + drain
    on mount + interval flush. 6 vitest verts.
  - Cumul cargo tests : 16/16 (12 existants + 4 nouveaux).

**`prototype/c2-analytics` HEAD `b0aXXX`** (post-C.7) :
- C.7 livrée — teacher-dashboard 3 pages.
  - lib/api.ts wrapper fetch (X-Course-Token, cache: no-store) + 6 vitest verts
    (URL building, error 401, encoding course token).
  - components : ProgressHeatmap (grille 5 paliers couleur), CalibrationChart
    (Brier qualifié), AutonomyBar (ratio + critique_completion_rate). Tailwind
    pur — recharts reportée à M5 (séries temporelles par learner).
  - pages App Router server components : `/`, `/courses/[token]/{progress,
    calibration,autonomy}`. Server action sur landing → redirect.
  - CourseNav réutilisable entre les 3 pages.
- C.6 + C.8 toujours bloquées sur merge A2 + bundle runtime.

**`prototype/a2-scene-synth` (HEAD `2f842d2`)** :
- A.8 livrée — ReproductionScene.tsx + dispatch SceneRouter.
  - normalisation (trim+lowercase) sur expected_output.
  - émet scene_entered + answer_submitted (correct=success) avec concept_id
    depuis concept_refs[0].
  - 6 vitest verts.
- A.9 livrée — AICritiqueScene.tsx + dispatch SceneRouter.
  - affiche claims sans révéler flaws_expected (anti-spoiler vérifié par test).
  - POST /scenes/critique-eval, émet answer_submitted (correct = score>=0.6).
  - bouton submit désactivé tant que critique < 10 chars (UX anti-offloading).
  - 7 vitest verts.
- A.10 livrée (Python part) — `services/scene-synth/tests/e2e/test_full_pipeline.py`
  3 pytest verts via FakeLLM signature-based + critic permissif. Couvre les 6
  types de scène, le skip ai_critique sur include_critique=False, le warning
  unsupported scene type.
- A.10 (WDIO part) : `play-bundle-from-scene-synth.test.ts` + `tools/e2e-a10.sh`
  livrés mais non exécutables (bundle Tauri release pas buildé — disque plein).
- Tests cumulés branche : 33 (existants) + 13 vitest + 3 pytest = 49.

**`prototype/d3-ci-tauri` NEW (HEAD `4c8f0c8`, depuis main)** :
- D.5 livrée — `.github/workflows/ci.yml` étendu avec job `tauri-build` matriciel
  macOS-latest + ubuntu-22.04, cache rust (Swatinem ciblé `apps/student-runtime/
  src-tauri/target`), tarpaulin coverage Linux uniquement (avec fallback si
  filtre `--packages` ne match pas), upload artifacts (coverage XML + bundles).
  Skip via `[skip tauri]` dans commit message si économie minutes nécessaire.

### Bloqué — actions requises de l'utilisateur

- **Disque plein (critique)** : root volume à 100% (1.2 Go libres au début, 1.3 Go
  après cargo clean ciblé). `~/Library/Caches` occupe 8.3 Go (cible de nettoyage
  facile). Tauri release build a planté avec errno=28 (No space left on device).
  Sans nettoyage, D.2 (build + wdio + tarpaulin + bundle size) reste impossible.

- **D.1** (rule 003 — 8 items parcours étudiant) : validation visuelle humaine,
  ne peut être automatisé.

- **D.3** (merge M3 → main) : bloqué sur D.1 + D.2.

- **D.4** (remote git) : nécessite création du repo GitHub par toi + push.

### Dette technique consolidée (mise à jour)

1. **Schéma divergence flat-vs-nested** : reproduction + ai_critique flat, 4
   anciens scenes nested `content`. Pas encore formalisée — candidat ADR.
2. **Canonical Pydantic mirror** : `packages/lesson-bundle-schema/python/` à 4
   scenes ; scene-synth-local à 6 scenes. Drift risk maintenu.
3. **Vitest config** : `tests-e2e/*.test.ts` parsés par vitest et échouent (ils
   sont wdio+mocha). Ajouter `exclude: ["tests-e2e/**"]` dans vite/vitest config.
   Préexistant — pas régressé cette session.
4. **Convention Python 3.13 baseline** : non formalisée. Candidat rule 005.
5. **`@testing-library/jest-dom`** : non installé ; tests utilisent
   `.toBeTruthy()` au lieu de `.toBeInTheDocument()`. Acceptable mais à
   standardiser pour cohérence.
6. **D.4 push remote** : permet aussi de tester le workflow CI réel et d'itérer
   sur erreurs (Linux webkit deps notamment).

### Cumul tests session nuit (3 branches)

| Branche | Nouveaux tests verts |
|---------|----------------------|
| c2-analytics | 4 cargo + 6 vitest (useTelemetry) + 6 vitest (dashboard api) = 16 |
| a2-scene-synth | 6 vitest (Reproduction) + 7 vitest (AICritique) + 3 pytest (E2E pipeline) = 16 |
| d3-ci-tauri | 0 (workflow yaml non testé local — sera testé via PR draft) |
| **Total session nuit** | **32 nouveaux tests verts cumulés** |

Cumul total post-nuit (pré-existant + nuit) :
- a2-scene-synth : 49 (33 + 13 vitest + 3 pytest)
- c2-analytics : 31 (15 + 6 + 6 + 4 cargo) — soit 12 cargo + 19 TS/Python total
- m3-student-runtime : 30 (12 cargo + 18 TS, pas modifié cette session)

### Suite quand utilisateur revient

1. **Libérer disque** (`~/Library/Caches`, target/debug si OK).
2. **D.2 D.1 D.3** dans cet ordre (build → validation visuelle → merge M3).
3. **Push remote** (D.4) → ouvrir PR draft sur `prototype/d3-ci-tauri` pour
   tester le workflow CI in vivo.
4. **Rebase + merge A2** sur main, puis rebase C2.
5. **C.6** intégration useTelemetry dans 6 composants runtime (LessonPlayer +
   4 renderers + Settings + ConsentScreen + useAdaptation hook).
6. **C.8** E2E telemetry runtime → collector → dashboard.

---

## C.8 — E2E telemetry pipeline scripts (2026-05-12)

**Livré** :
- `tools/e2e-c2.sh` : orchestration bash collector + dashboard + tauri:build
  + WDIO + assertion `/metrics/progress?course=e2e-course` ≥ 4 scènes.
  Cleanup trap sur EXIT/INT/TERM. Détection plateforme (warning macOS).
- `apps/student-runtime/tests-e2e/specs/telemetry-end-to-end.spec.ts` :
  spec WDIO qui joue le parcours complet (Consentement A → Library →
  LessonPlayer → 6 scènes) et asserte ≥ 30 événements émis. Compteur via
  patch de `window.fetch` interceptant POST `/telemetry`.
- `apps/student-runtime/src/hooks/useTelemetry.ts` : ajout additif de
  `getTelemetryEndpoint(fallback)` et `getTelemetryCourseToken(fallback)`
  — lecture des overrides `window.__telemetry_endpoint` /
  `window.__course_token` pour mode test E2E. **Aucune modification des
  composants** (territoire C.6).
- `apps/student-runtime/src/hooks/useTelemetry.test.ts` : +5 unit tests
  vitest sur les overrides. Total 11/11 verts.

**Bloqueur exécution** :
`tauri-driver` ne supporte que **Linux + Windows** (vérifié 2026-05-12).
**Exécution macOS impossible.** Le script + spec sont conçus pour être
exécutés via le workflow **CI Linux (D.5)**. Validation locale = lint
bash (`bash -n`) + unit tests vitest sur l'override + revue du spec
(globals `browser`/`$`/`expect` injectés par WDIO Mocha à l'exécution,
même schéma que le spec A.10 `play-bundle-from-scene-synth.test.ts`).

**Suite immédiate** :
- Une fois C.6 mergé (useTelemetry câblé dans 6 composants), exécuter
  `tools/e2e-c2.sh` sur runner Linux (workflow D.5) pour valider la
  chaîne complète.
- Si compte d'événements < 30 : vérifier que `bootstrap_complete`,
  `consent_changed`, `scene_entered`/`scene_exited` (×6 chacun),
  `quiz_answered`, `meta_answered`, `reproduction_completed`,
  `critique_submitted`, `lesson_complete` sont bien `emit()`-és.

---

## 2026-05-09 nuit — D.5 : CI Tauri matriciel (`prototype/d3-ci-tauri`)

Branche créée depuis `main` (donc sans M3 ni A2 ni C2 — D.5 ne dépend que de la
structure pnpm/cargo).

**Goal** : Étendre `.github/workflows/ci.yml` avec un job `tauri-build` matriciel
macOS-latest + ubuntu-22.04, cache Rust, tarpaulin coverage Linux.

**Livré** :
- Job `test` (existant) : Python deps complètes (`pydantic pytest fastapi httpx`).
  `pnpm install --no-frozen-lockfile` (lockfile bouge avec les nouvelles deps
  testing-library installées en C.5).
- Job `tauri-build` :
  - `matrix.os: [macos-latest, ubuntu-22.04]` (22.04 plutôt que latest pour
    stabilité webkit deps).
  - apt-get Linux : `libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev
    libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev` (Tauri 2 modernes).
  - `dtolnay/rust-toolchain@stable` + `Swatinem/rust-cache@v2` ciblé sur
    `apps/student-runtime/src-tauri/target`.
  - `pnpm tauri:build --debug` (pas de signing macOS pour CI).
  - `cargo install cargo-tarpaulin --locked --version "^0.30"` Linux uniquement.
  - `cargo tarpaulin --packages student-runtime --out Xml` avec fallback sans
    filtre `--packages` (au cas où le naming change).
  - Upload artifacts : `tarpaulin-coverage` (XML) + `tauri-bundle-{os}` (Linux
    + macOS bundles).
  - Skip via `[skip tauri]` dans commit message si économie minutes nécessaire.

**Reste sur D.5** : itération réelle sur erreurs CI (libwebkit version, Rust
cache miss premier run, codecov token absent — utiliser artifact upload seul).
Bloqué tant que D.4 (push remote) pas fait : pas moyen de tester le workflow
en condition réelle.

**D.6** (badge CI README) : à faire après merge PR D.5 sur main.


## 2026-09-10 — MySTRA teacher/reviewer continuation (INT-STUDIUM-039)

Codex Astra with explicitly requested Sol high leaves. The existing ASTRA pins and
real validator were confirmed (0.0.14 / 0.2.17; four canonical fixture files valid),
so no dependency upgrade or schema change was needed. MyST now includes every
analysis and review bundle, plus source/quote metadata through one shared
`evidence_view` in the existing loader. MySTRA adds a read-only printable HTML route
and JSON twin over the same readers. The old singular `course.review` contract is
preserved; `review_summary` supplies the complete overview. Malformed tags and trace
nodes now leave readable sections and named gaps. No student/validated content,
consent, grading, aggregate or model-call behavior changes.

New tests went red before fixes: renderer completeness 4, backend route/data 5,
review evidence 1, evidence source metadata 2, nested metadata 2. Current focused
suite 250 passed (Observatory + renderer). Original tests are unchanged. The live
Chrome audit has 11 desktop/mobile/print captures, real ASTRA five-file validation,
zero external requests/browser errors, and unchanged artifact hashes/mtimes. It
found that CSS alone does not print collapsed details: beforeprint/afterprint now
open and restore them, with browser assertions and extracted PDF evidence confirming
both bundles and their full ASTRA records. Full fresh-checkout checks are recorded
in the hub audit/handoff before integration. No push, PR, release or publication.
# 2026-09-11 — Grounded exploration from a swappable harness (INT040)

Codex Astra; one Sol high read-only review leaf. Added provider-free local
prepare/seal/verify exploration records bound to public session/scene context,
source/skill snapshots, named input/code/environment/output files, reported
actions/checks and optional learner-owned observations. Public MCP/file guidance
now describes tool discovery and predict/baseline/vary/compare/judge/transfer.
No executor, automatic answer, approval or publication path added.

New adversarial tests cover stale/private contexts, contradictory success,
unsafe paths/symlinks, size bounds, changed/extra receipt material, and invalid
spectral viewer measurements. Sol findings reproduced in 12 failing tests and
fixed. Existing tests unchanged. Targeted verification: 43 Python + 1 new TS
pass; full build, host typecheck and existing 9-check browser demo pass. Final
fresh-checkout full-suite evidence and exact revisions are recorded in hub
docs/superpowers/audits/2026-09-11-grounded-exploration.md.

Official Copilot tools/skills, pip and Vega-Lite documentation inspected; no
Copilot session tested. An actual ASB matchms cleaning card was captured locally
as not_run/type-checked, distinct from the executed synthetic matching demo.
New guide documents private local retention and teacher-approved exploration
scope. No paid call, push, grading/consent/bundle or shared skill-source change.

# 2026-09-11 — GitHub-ready teacher/student documentation (INT041)

Codex Astra with one Sol high read-only teacher-path/review leaf. Added a French
Markdown portal, feature/maturity catalogue, separate teacher/student onboarding,
Copilot Student/teacher benefit setup, Claude/Codex/Cursor/OpenCode v2 MCP examples,
API boundaries, three runnable tutorials, privacy and troubleshooting. Replaced
obsolete M6 entry guides and corrected the VSIX server-packaging claim. No product
code, tests, course content or global harness configuration changed.

Official provider documentation checked 2026-09-11; quotas/prices not frozen.
Fresh code worktree installation: frozen pnpm install, library build, vendor and
extension/CJS build; fresh Python 3.13 venv plus the documented requirements and
editable packages. Verified MCP smoke14, actual documented bundled-CJS config
(start/context/response/end), file stub4steps, packet/check/review, MySTRA HTTP200,
and executed synthetic exploration/browser9/receipt integrity. Ingest startup
and minimal planner POST pass; direct browser planner preflight returns405, now
explicitly documented alongside the unconfigured synthesis orchestrator.

All changed Markdown local links and JSON/TOML examples checked. No authenticated
Copilot/Claude/Codex/Cursor/OpenCode GUI session, Windows install or VSIX packaging
claimed tested. Existing esbuild import.meta CJS warning remains; bundled MCP
launch passed. Full product suite not repeated for a documentation-only change.
Sol's incorrect lesson-plan-schema editable-install suggestion was rejected:
lesson-schema has pyproject.toml; lesson-plan-schema is injected by the tool and
has no installable project. The fresh venv recipe and tutorials already passed.
No paid model call, push, Pages, release, visibility change or student publication.

# 2026-09-11 — Reusable onboarding skills (INT041 follow-up)

Added studium-teacher and studium-student with short role-specific procedures,
links to the maintained guides, observable completion and no assumed provider.
Updated the existing studium-harness source for portable root/server discovery,
Copilot/Codex routes, learner-owned confidence and intentional forgetting only.
Added three Codex UI metadata files and six relative discovery symlinks under
.agents/skills and .claude/skills; no duplicated operational skill source.
Public skills activation/invocation guide linked from portal and role guides.

Three official skill validators pass, 21 skill references and six project aliases
resolve, UI metadata checked. MCP14 and file stub4 pass in the separately installed
docs worktree. No product/test edit, API call, student session or publication.
Personal links are added only when missing after canonical integration; existing
studium-harness links remain untouched. Client catalogue refresh may require a
new session; automatic discovery in every authenticated client is not claimed.

# 2026-09-11 — Private experiment journal (INT044 / S1)

Typed predict/begin/observe/conclude records are separate from grading and public
operator context. Exact learner text, justification and confidence persist by
learner/lesson/revision in durable mode; forget erases revision journals. MCP and
file transports share host validation; stale scene/session envelopes are rejected.
The file watcher wakes for experiment actions without advancing the lesson.
Attribution is declared and consent explicit; neither establishes independent
authorship or absence of outside help. Exported harness copies retain their own
privacy/erasure boundary. Filesystem writes use lock plus atomic rename.

Red evidence: journal module absent; host recordExperiment absent and file action
ignored; watcher timed out waiting only for responses/results. All became green.
Focused journal/host/runner8 tests and MCP15 pass; host suite184 passes. Full pnpm
test passed, pnpm build:libs passed, lint0 errors/194 existing warnings. MCP types
rechecked after adding stale-scene validation. No teaching-model/benchmark call or student publication; development used Codex Astra and Sol high.

## INT044 review correction — locale-independent revisions

A red-first canonical-key vector showed localeCompare ordered uppercase/lowercase
keys differently from the portable code-unit order. Test committed3948dc6; revision
hashing now uses explicit lexical comparison. Journal+host8 tests pass unchanged.
This is pre-release work; no real learner journal was migrated or relabelled.

## INT044 review correction — anonymous session privacy

A red-first host test23add6f reproduced private journal persistence under the shared
anonymous identity. Anonymous, agent-operator and blank IDs now remain ephemeral;
unique stable learner IDs are required for durable contributions. The existing
grading/profile behavior is unchanged. Host experiment4 and type build pass.

# 2026-09-11 — Linked pedagogical MS/MS viewer (INT044 / S2)

Sol-high leaf built a self-contained synthetic network/mirror/candidate viewer
with stable IDs, threshold baseline/differences, prediction before reveal, own-text
export and a reusable generation brief. Parent review corrected focal selection,
flexible layout, baseline labels, axis units, mobile overflow, prediction wording
and temporary invalid tolerance recovery. Parent separated lower spectrum caption
from axis ticks after screenshot inspection. Original pair calculation retained.

Focused numerical/build/legacy/fixture20 tests pass. Final real fixture+MCP+Chrome
demo /tmp/studium-int044-final-demo passes18/18 browser checks, no console errors
or external requests, desktop/direct/mobile captured. Python baseline0.6477 with
7matched peaks; direct-only0.1871. All data are synthetic, not paper reproduction.
Viewer notes are distinct from the private host journal; neither auto-submits.

# 2026-09-11 — Reviewed revision to synthesis (INT044 / S3)

Sol-high leaf delivered import/attach-exploration/approve/verify/synthesize CLI.
Canonical hashes bind the exact editable plan and supporting inputs; synthesis
uses a captured verified snapshot without replanning. Post-call disk and in-memory
mutation checks quarantine stale generated artifacts. Failures are retryable;
reapproval archives prior synthesis records. Artifact URI/hash and source/check
references are visible in MySTRA. Technical exploration summaries omit structured
learner fields and copy no blobs or portable receipts. They are checked on attach,
not continuously attested. Plan approval never approves generated content/release.

Parent review corrections covered concurrent edits, in-memory mutation, stale
synthesis bindings, conditional failure wording and receipt privacy. Leaf final
focused95 pass; parent plan/packet/review47 pass. Production ConceptAgent and
bundler exercised with deterministic fake model/critic; scene-synth231 pass1skip.
No real teaching model called. CLI needs an explicitly configured local orchestrator;
identity remains locally declared and the older author-web/HTTP paths stay separate.

# INT044 final integration verification

All three local capabilities implemented; docs and three existing shared skills
updated without copying skill sources. Sol-high independent S1 review found no
additional consequential defect; direct parent review covered S2/S3.
Final pnpm test:1111 passed across18 packages. Python wrapper:16 suites,0failing.
Library, host/MCP, author-web and extension builds pass; packaged stdio prediction
roundtrip/forget passed. Lint0errors194warnings. Final browser18/18 plus numeric
fixture20 pass; no external browser requests.76 local doc links and three skill
validators checked.

Local runtime Node26.3.0/pnpm9.15.9/Python3.13.13; CI Node20/Python3.12 not rerun.
Known existing CJS import.meta warning remains, packaged entrypoint verified.
Work remains on codex/studium-experiment-continuity; no push, student release,
real teacher approval, new benchmark, external model evaluation or manuscript change.
The32-session protocol is unchanged/unrun and must freeze the chosen code first.

# 2026-09-11 — Harness activity templates and learner reports (INT045)

Three runnable templates (linked representations, controlled parameter comparison,
evidence/claim) and two explicitly proposed patterns share the strict
studium/learner-actions/v1 schema. The linked template reuses the numerical viewer
core. Recording is optional and local; synthetic fixtures are labelled. Source
binding includes identifiers and the prepared activity's content digest.

Reports reuse ASTRA0.0.14, ARA0.1.0 and the existing MySTRA renderer/Observatory;
no parallel provenance contract. Selected browser and host-journal streams remain
separate. Original text is excluded by default. Two portable skills and a French
end-to-end tutorial route harness preparation and explicit report export. Existing
teacher/student/harness skills link to them; project-local discovery symlinks share
one source. No global skill link points at this temporary checkout.

Two Sol-high leaves delivered bounded implementations. Focused template/trace/report
tests:60 passed; activity browser audit:41/41, no console errors/external requests.
Parent complete demo:34/34 additional report checks, including actual native MySTRA,
mobile and unchanged artifacts after viewing. Independent skill forward-test prepared
an evidence/claim activity without fabricating a learner response; clarified that
scene identifiers do not make sample data source-derived and that base UI is English.
Full pnpm test:1111 passed /18 packages; Python:16 suites,0 failing; author-web build
passed; lint:0 errors,194 existing warnings; packaged MCP smoke:14 passed.

Review checkpoint: optional confidence currently renders None/4 in the portable
report. A separate regression-first correction follows this feature checkpoint.
Runtime Node26.3.0/pnpm9.15.9/Python3.13.13, not exact CI20/3.12. No paid teaching
model, student study, manuscript change, release, merge or push.

## INT045 final review corrections and verification

Committed regression9cd4211 reproduced None/4 for absent confidence; report rendering
now omits absent confidence and preserves explicit0/4. Committed regression0296058
records the proposed-template CLI refusal; expected validation failures now produce
a concise error. Closed validation of nested linked-network fields precedes browser
embedding and numerical verification. Templates retain shared source and ID checks.
Markdown hard breaks were replaced with blank lines to pass whitespace checking.

The template leaf delivered late validation/CLI edits after its first stable notice;
the parent stopped further writes and reran verification on the final combined tree.
No claim of mechanical test-edit protection is made; existing assertions were retained.
Final focused tests:63 passed,1 existing Starlette/httpx deprecation warning.
Full Python rerun:16 suites,0 failing. Final reproducible demo has41 activity checks
and34 report checks, all passing, zero browser errors or external requests. Native
MySTRA and portable report screenshots inspected; optional confidence renders correctly.
99 local documentation links resolve;6 Studium skill validators and4 new discovery
symlinks pass. Lint remains0 errors,194 existing warnings. Earlier unchanged TS and
author-web verification remain applicable. All worker turns complete.

Final demo: .studium-session/int045-demo-verified/index.html. This is synthetic test
data, including browser-generated learner actions and a separate real-host transport
probe; no measured learning or scientific approval. Existing MySTRA retains its
course-review framing and shows absent teacher review as missing. No preview server
remains; regenerate with tools/demo-template-reports.py into a new directory.

## 2026-09-12 — Five practical activity templates (INT046)

Implemented the owner's request to complete both proposed patterns and improve
activities through practice. Diagnose-analysis and conclusion-robustness now use
closed, configurable captured-result contracts and the existing action/ASTRA/ARA/
MySTRA formats. Examples expose actual invented inputs and checkable arithmetic.
Five distinct science configurations exercise signed/zero values, both threshold
operators and all/some/no support; source-backed shapes are also checked. These
are software fixtures, not pedagogical or empirical validation.

Practical review corrected small-value rounding, inaccessible range labels,
misleading no-trace assistance, absent no-trace completion, and fused choice labels.
Progress/focus, mobile wrapping, signed bars and a non-wrapping brand improve the
shared viewer. Native controls retain common trace semantics. Off-grid baseline/
variation values are refused instead of being silently snapped by the browser.
Regression commits:752be84 (practical browser),a90c230 (step grid),d305cb2
(choice readability). No regression assertions weakened; existing proposal tests
now exercise a proposed catalogue entry via monkeypatch after the two promotions.
Two Sol-high leaves delivered isolated files, then stopped before final verification.

Final evidence:136 focused Python tests pass; full Python16 suites,0 failing;
TypeScript1111 tests/18 packages pass on retry. First TS run had a native Node26
V8 ToLocalChecked abort after passing lesson-mcp assertions; no code or test change
between runs. Author-web build passes; lint0errors/194existing warnings.
Final demo .studium-session/int046-final:65 common activity,51 practical and50
portable/native report browser checks, all green; no browser errors or external
requests. All6 reports verify, including a separate synthetic host journal.
Final screenshots inspected after the choice-label and mobile-brand corrections.
Updated skill validates;16 changed-document relative links resolve.

Runtime Node26.3.0/pnpm9.15.9/Python3.13.13, not exact CI20/3.12. Common contracts
unchanged; no model embedded, paid teaching-model run, real student, manuscript
change, teacher approval, student distribution, merge or push. All artifacts are
local; project-local skill discovery continues using the same shared source files.

## 2026-09-12 — INT047 common viewer charter

Shared local theme for prepared activities, portable reports and native
Observatory/MySTRA. Completed trace-choice/prediction sections are reopenable,
keyboard focus follows the activity, named table regions scroll on mobile, print
preserves report titles. Exact pre-theme report verification remains supported;
rehashed HTML tampering is rejected for both renderers. Future theme revisions
must freeze this CSS/renderer before changing them (viewer-charter.md).

Regression commit 2ad99f2 includes historical synthetic export and new browser/
compatibility tests. Existing kappa test now checks main content rather than
unrelated CSS dimensions; API rejection and explicit missing-value checks remain.
Red evidence covered collapsed steps and absent print title. Mobile header width
was corrected after actual screenshot review; full-page captures reset scroll.

Python16 suites/0 failing, TS1111 tests, build pass; lint0errors/194 existing
warnings. Final .studium-session/int047-complete:80 activity +51 practical +92
portable/native report browser checks pass,6 report packages verify. Desktop,
mobile and A4 print inspected; historical export unchanged. These are synthetic
technical tests, not student trials or a complete accessibility certification.
No push, release, scientific acceptance, model call or private learner data.
INT048 visual-support skill and figure-path fix are a separate slice.

## 2026-09-12 — INT048 grounded visual support and directory figures

Added studium-visual-support with project-local Claude/Codex discovery, capability
matrix, differentiation workflow, original Mermaid source and RenderAsset example.
Inspected upstream Lightcone audience-aware-skills and official OpenAI vision/image
editing docs. No global communication profile, model account or provider installed.
Automatic paper/ASB import, ZIP media transport, native Mermaid and private-history
adaptation remain explicitly designed follow-ups, not claimed shipped.

VS Code pane now uses the notebook's shared asset-path logic for image and
executed_result. Canonical confinement accepts relative/in-bundle absolute paths;
external absolute files must be copied into the lesson. Traversal/symlink escapes
and missing files keep the existing fallback. Preserved nested-bundle coverage,
added a real PNG and a valid two-dot filename regression; general containment
checks parent path components rather than a broad string prefix.

Sol-high leaf's final package test, typecheck and build pass (12 registered
drivers,16 asset-path assertions). Existing CJS import.meta build warning remains.
Skill frontmatter validates and relative guide links resolve. No real signed-in
VS Code session, image-generation call, real student trial or learning-effect
claim. Common RenderAsset, ASTRA/ARA and learner action formats remain unchanged.

## 2026-09-12 — INT051 contextual pedagogical help (Codex)

One authored EN/FR catalogue (18 topics, 13 public scene mappings), shared passive
renderers/CSS, help beside activity/report/Observatory sections, React web shells
and teacher metric pages, VS Code scene/graph help. Generic method guidance only;
no answer keys, help telemetry, model calls, scoring or schema changes. Native
disclosures preserve script-free portable reports and exact v1/v2 compatibility.
Added generated-task guidance, harness/template skill instructions and public guide.

Verification: full Python 16 suites/0 failing; full pnpm test 1117 Vitest +3 Node
and package drivers; full build/lint pass (194 existing warnings). Latest focused
31 and Observatory242 passed; two skills valid. Browser:80 activity+51 practical+
92 report+29 help+17 React+18 linked+5 extension-layout =292 assertions, plus11 native
MySTRA views, print restoration and read-only fixture checks. New extension driver
checks all13 scene help mappings and zero host messages. Synthetic checks only.

Review corrections: implicit HTML heads dropped helper CSS (new browser regression),
React package resolution, controlled print expansion excluding optional help, author
input box sizing on mobile, and graph canvas leaving room for a clickable help icon.
Only the existing print audit selector was narrowed to its original report-content
scope; a new check ensures help is not force-opened. Source/template hashes and old
report integrity checks remain strict. No push, merge, student release or sibling write.
See the hub audit and docs/guides/contextual-help.md for coverage and limitations.

## 2026-09-12 — INT052 API and independent harness access

Owner requests direct API, smoother VS Code integration and learning through an
independent harness. Baseline6351212; plan/spec/intent committed first in hub70e234e.
22 operation declarations now shared by MCP and authenticated loopback HTTP v1.
Adds schema discovery, JSON-file CLI, serialized calls, request receipts, stale-scene
checks, bounded queues/cache, bundle realpath containment and forgetting of cached
session outputs. Backend models require explicit API activation. Sessions remain
process-local; legacy REST and VS Code MCP are separate processes. Legacy REST
create/current/respond now use the existing public projections, fixing exposed
quiz keys without changing response envelopes or old tests.

Sol-high leaf owns only extension files: connection/disposal cleanup, shared gate
for pane/native reproduction mutations, disabled-state preservation, actionable
errors, native themes and 44px primary controls. Lead reviewed correction of false
restart-retention wording and native-task race. No full Extension Host test.
Three existing portable skills and user guides now cover API, resume, execution,
standard journal/report export and intentional erasure; no global skill copies.

Evidence:1135 Vitest passed plus existing3 Node tests and14 extension drivers;
16 Python suites/0failing. Full build and lint pass (201warnings/0errors).
New API32 tests including existing MCP contracts; legacy REST33 including2 new
redaction regressions; extension webview97/lifecycle9/MCP23/realstdio12 assertions.
Actual API entry+pnpm JSON client smoke10checks; ASTRA/ARA/MySTRA export verifies.
Reproducible Chrome pane audit9checks incl localKaTeX/light-dark/narrow/pending.
Artifacts:.studium-session/int052-api-verified and int052-vscode-verified.
Logs:/tmp/studium-int052-{final-test,final-build,final-lint,python}.log.

Workspace post-agent audit:164 repository snapshots/live-default checks and data
mtime sweep, only this checkout with recent sampled data; foodomeai_dev remote
lookup timed out. No global before-snapshot, so no claim of exclusive attribution.
Canonical/live dev33bf561 unchanged; no push/merge/release/paid call, manuscript or
LabOS write. Hub audit/handoff records exact output and limitations.

## 2026-11-06 — Live learner-trial fixes: retry feedback, equation legends and HTTP recall ratings

Addressed the three defects recorded during the 5 November atomistique learner
trial. Wrong quiz feedback that contains a correct choice is now withheld only
when the learner can retry before leaving the scene; non-revealing feedback and
feedback released on departure are unchanged. The bundle linter reports this
authoring problem, the affected fixture feedback is now methodological rather
than answer-revealing, and both authoring guides state the retry constraint.

Render assets now accept an optional validated symbol legend. Legends survive
the public-scene, MCP artifact and operator-context projections and render under
equations in chat, the VS Code pane and notebooks, and portable scientific
activities. All shipped equation fixtures carry lesson-grounded meanings; the
linter warns when a legend is absent, and generated bundle references document
the field. Learner reports were not an equation-rendering surface.

The HTTP API now exposes `rate_recall` as the one study-tool exception to I-11,
with mutation receipts and idempotent resend semantics and without a stale-scene
argument. The pinned HTTP operation contract grows from 25 to 26, while all
other study, authoring and teacher tools remain MCP-only. An in-process HTTP
trial covers hidden retry feedback and a successful recall rating after the
requested explanation scene.

Focused TypeScript, Python, bundle-lint, schema, HTTP and rendering checks pass,
as do build and lint. In this managed sandbox, commands that launch the `tsx`
CLI cannot create its Unix IPC socket (`listen EPERM`); this blocks the exact
full `pnpm test`, documentation-generation, parity-test and headless-smoke
commands despite equivalent `node --import tsx` checks. The Python aggregate
also retains an unrelated capsule-run failure. Work is intentionally left
uncommitted for owner review; no push, PR, tag, paid route or learner-home write.

## 2026-11-06 (suite) — Trial follow-up: recall items, notation reminder, lesson gaps

The first batch was committed as `c3b4a84` after the full gates passed outside the
sandbox (the previous entry's blocked commands all ran green there). One regression
was caught in review and undone before the commit: regenerating `lesson.json` had
replaced two carbon-quiz distractors, because `build_bundle.py` had fallen behind
the committed lesson.

Owner decision for the case left open (a prerequisite gate sending the learner
back to a question whose answer had just been shown): give each prerequisite
concept a second answer-graded item. `graph-nav` already prefers an item the
learner has not seen, wherever it sits in the lesson, so six recall quizzes
(`s9-rappel-*`) now close `atomistique-l1`, after the last gated scene; until the
lesson reaches them they are the unseen items a gate picks. `c-configuration` had
no answer-graded scene of its own, which would have detoured every learner to its
recall item, so it also gets an in-flow quiz (`s5e-quiz-oxygene`). The lesson goes
from 25 to 32 scenes and lints without warning. No engine change. The seven
questions were drafted by an agent and await teacher review.

Lesson gaps found in the trial: "nœud radial" is now defined before the quiz that
asks for it, `h` is defined in the text and the legend, and two feedbacks that
still stated the answer in a form the token rule cannot see (Hα, periodicity) are
rewritten.

Notation reminder: `SessionHost.sceneNotation` returns the legends already shown
for the current scene's concepts. `request_hint` replies with it next to the hint
and `get_operator_context` carries it. It is public material, not a hint: never
metered, still there once the hints are spent.

Test decisions: `http.test.ts` now expects the gate to route a wrong `s2-quiz-4f`
answer to `s9-rappel-3d`; `server.test.ts` and `host.test.ts` gain notation cases.

## 2026-11-06 (simulations) — Prerequisite routing: three defects found by synthetic learners

Owner request: run simulations on the trial fixes to check they hold and to find
problems. Sixty-four labelled synthetic learners (flawless, wrong on each first
visit, wrong on the first item of each concept, always wrong, and two random groups
of thirty at p = 0.5 and p = 0.75) played `atomistique-l1` in process, on the
corrected lesson and on the lesson as it was before the trial fixes. Every run
completed, no answer was visible before a same-scene retry, every requested
self-rating was recorded. Three engine defects came out; the recall items added in
`d6bb411` made the first two reachable on this lesson.

1. Two unmet prerequisites of one scene. A correct answer on the detour for
   prerequisite A was credited only if the router then chose A again. When it chose
   B, the answer was lost and the learner went back and forth between the two items
   until the detour budget released the gate (`s5e-quiz-oxygene` and `s4-quiz-balmer`
   three times each before `s6-concept-periodicite`). When it chose A, the gate
   opened with B never checked. `LessonSession.navigate` now credits the detour
   prerequisite before routing and routes again after each credit, so each
   prerequisite is judged on its own answer; `gate_passed` is announced when the
   gated scene is reached that way.
2. An item answered correctly out of order (a detour or an alternate) was served a
   second time when the lesson reached it. `graphAwareNextIndex` takes the ids of
   the answer-graded scenes answered correctly in the session and passes over
   them; the path without a graph does the same. Session-local, like the
   prerequisite passes: a lesson played again asks its questions again.
3. An alternate item placed further down the lesson (`remediate_alt`) made the
   session resume after the alternate, so every scene between the question and its
   alternate was never served. It now resumes after the scene just left, unless the
   alternate is the very next scene (the case the existing tests pin).

Measured on the corrected lesson, before and after: wrong on each first visit, 48
steps and 9 questions asked again after their answer was shown, now 38 and 0; wrong
on the first item of each concept, 38 and 6, now 32 and 0; random p = 0.5, 39.8
steps and 3.8 on average, now 35.8 and 0.4. The flawless path (32 steps) and the
always-wrong path (79 steps) are unchanged.

Left open, reported to the owner, not changed: a learner who keeps failing is asked
the same two items of a concept five or six times, because the replay budget and
the detour budget add up (79 steps, about 134 estimated minutes); the lesson
declares 60 minutes and the flawless path is estimated at 78; step numbers jump by
up to 24 positions on a detour to a closing recall item; and `get_workflow_graph`
derives a concept's state from posterior mastery alone, so at step 16 it reports
the first concept as current and every other as locked, the one being studied
included.

Test decisions: new `session.multi-prereq-gate.test.ts` (six cases); no existing
assertion changed. Gates green with `STUDIUM_EPHEMERAL=1`: `pnpm build:libs`,
`pnpm lint` (0 errors), `pnpm -r --no-bail test`, `tools/pytest_all.py` (16 suites,
0 failing), `tools/bundle_lint.test.sh`, `node tools/docs/check.mjs`,
`headless_smoke.mjs` (19 assertions).

## 2026-11-06 (carte) — Learner concept map, and a lesson from a conversation

Owner requests of 6 Nov, after the simulation report: build the concept map proposed
there; and make it fluid to call Studium from a Claude or Codex conversation already
under way, in self-study, with no teacher validating the lesson. Branch
`feat/2026-11-06-learner-concept-map`, cut from `fix/2026-11-05-trial-findings`
(PR 13), so it merges after it.

Concept map. `get_workflow_graph` derives a concept's state from posterior mastery
alone; at step 16 of `atomistique-l1` it reported the first concept as current and
the seven others as locked. The map is drawn from session facts instead.
`LessonSession.learnerPath()` returns the steps served, in order, with their outcome,
and the prerequisites the session credited (rebuilt from the saved history on a
resume). `buildConceptMap` (`lesson-session-host/src/concept-map.ts`) turns them into
`studium/concept-map/v1`: nodes with a state (`acquired`, `to_review`, `current`,
`seen`, `upcoming`), the questions answered with their step and result, prerequisite
edges travelled or not, the position (from, at, next), a Mermaid flowchart and a
list. `seen` is a concept whose answers nobody assessed: it is not called acquired.
Served at a few moments only: `start_lesson_session` and the first screen; then, on
a transition, a prerequisite detour, the return from it, a scene drawing on several
concepts and the end of the lesson (the whole map), and the first scene of a concept
(one position line). `display_markdown` carries it; `get_workflow_graph` returns it
on request. On a flawless run of `atomistique-l1`: five whole maps in 32 steps. The
`state` field of `get_workflow_graph` is unchanged (the VS Code pane reads it).

Lesson from a conversation. `tools/conversation_sources.py` reads a Claude Code
transcript (`.jsonl`) or a text export and prints `prepare_sources` input: the
user's and the assistant's text with numbered turns; sub-agent threads, harness
messages, compaction summaries and private reasoning left out; tool results only on
request; credential-looking strings replaced. `prepare_sources` accepts
`kind: "conversation"` on a source (recorded only then, so existing source sets keep
their id); `create_lesson` marks such a citation `prov_derived_from:
conversation:<id>`; the self-study notice then adds that the sources are excerpts of
a conversation with an AI assistant whose assertions were not checked. New skill
`studium-from-conversation` (one question at most, four tool calls, when to stop and
ask) and use case 9 in `docs/tutorials/use-cases`. Played end to end on the
transcript of the session that wrote this entry: 19 of 62 turns kept, 39 passages, a
six-scene lesson created on the first call and played with the map. No Codex
transcript parser: it needs a sample.

Not verified: how each harness renders the Mermaid block; any effect of the map on
learning. Test decisions: new `concept-map.test.ts`, `host.concept-map.test.ts`,
`session.learner-path.test.ts`, `tools/test_conversation_sources.py`; cases added to
`source-set.test.ts` and `build.test.ts`; no existing assertion changed.

## 2026-09-12 — INT-STUDIUM-053: onboarding and recent-development documentation

Reorganized the GitHub README/docs entry points around visual lessons, local
harnesses and HTTP. Added a dated 10–12 September development digest and seven
practical use cases: self-learning, literature authoring, ASB/spectral experiments,
analysis diagnosis/robustness, archaeology imagery, language/media support and
learner reports. Updated capability coverage, role guides, troubleshooting,
privacy, skills and explicit Claude Code/Codex/OpenCode onboarding. Provider
setup references were opened on 12 September. Remote dev/main still lack the
latest local slices; installation now states the revision requirement explicitly.

Corrected obsolete “no language switch” instructions in the activity tutorial
and its skill, and the frozen 14-check MCP count (actual smoke now has 19).
No runtime, schema, tests or dependency changes. No paid provider calls, global
configuration writes, publication or student distribution.

Validation: real MCP smoke 19/19; real HTTP/CLI continuity and standard report
smoke 10/10 (`.studium-session/int053-api`); file runner completes four synthetic
steps; French conclusion-robustness activity prepared with translations/supports
(`.studium-session/int053-activity`); 88 targeted template/presentation tests pass;
both changed skills validate. Relative Markdown links/anchors, shell syntax and
JSON/TOML examples checked. Authenticated provider UIs, fresh-machine installation
and the actual VS Code Extension Host were not exercised. Full regression counts
in the dated digest are attributed to baseline 2691a5a, not rerun for this docs slice.

[English](glossary.md) · Français

# Glossaire

Les termes que vous rencontrerez dans la documentation, les interfaces et les résultats d'outils de Studium, par ordre alphabétique. Chaque entrée renvoie à la page qui l'explique. Les noms techniques anglais (champs, outils) sont conservés tels que le code les emploie.

| Terme | Signification | Pour aller plus loin |
|---|---|---|
| ASTRA, MySTRA | Un format qui enregistre les décisions adaptatives et les analyses pour pouvoir les rejouer, et son lecteur local. Utilisés par les rapports de l'apprenant et l'Observatory. | [Rapport de l'apprenant](../learn/learner-report.fr.md) |
| Attestation de maîtrise | Un concept à une maîtrise d'au moins 0,8 après au moins trois tentatives évaluées, sans excès de confiance ni crédulité mesurés. Une attestation est alors écrite. | [Modèle de l'apprenant](learner-model.fr.md#quand-un-concept-compte-comme-maîtrisé) |
| Auto-évaluation | La note que l'apprenant donne à son propre rappel (again, hard, good, easy). Règle les révisions ; ne modifie jamais la maîtrise. | [Modèle de l'apprenant](learner-model.fr.md#auto-évaluation) |
| Avis | Le texte qu'une leçon d'auto-apprentissage affiche d'abord, pour dire qui a écrit les clés et ce qui est évalué. | [Honnêteté et provenance](honesty-and-provenance.fr.md#avis) |
| Bundle de leçon | `lesson.json` : métadonnées, concepts, graphe, scènes et règles d'une leçon. | [Référence du bundle](../reference/lesson-bundle.fr.md) |
| Bundle communautaire | Une leçon écrite par un apprenant et diffusée par un enseignant pour d'autres. | [Contributions des apprenants](../teach/learner-contributions.fr.md) |
| Calibration | L'écart entre la confiance déclarée par l'apprenant et la maîtrise qu'il a montrée. | [Modèle de l'apprenant](learner-model.fr.md#calibration) |
| Canal fichier | Une boucle tâche/réponse par fichiers dans `.studium-session/`, pour un harnais sans MCP. | [Harnais](../start/harnesses.fr.md) |
| Capsule ASB | Une analyse empaquetée et reproductible (issue du projet Agentic Science Builder) qu'une scène `reproduction` demande au harnais d'exécuter. | [Types de scènes](scene-types.fr.md#reproduction) |
| Carte des notions | Les notions de la leçon, leurs prérequis et votre état sur chacune, avec le chemin parcouru et ses preuves. | [Carte des notions](../learn/concept-map.fr.md) |
| Classe de clé | Qui détient la clé qui évalue un type de scène : `ungraded`, `author_keyed`, `production` ou `externally_grounded`. | [Types de scènes](scene-types.fr.md) |
| Confiance dans l'IA (calibration) | À quel point l'apprenant se fie trop, ou se méfie trop, d'une lecture fautive par l'IA d'un résultat réellement exécuté. | [Modèle de l'apprenant](learner-model.fr.md#confiance-dans-les-productions-de-lia) |
| Contestation | Une déclaration que vous connaissez une notion atteinte ou avez un doute, vérifiée par une ou deux questions. La déclaration seule ne change ni la maîtrise ni le parcours. | [Carte des notions](../learn/concept-map.fr.md#dans-le-panneau-de-leçon) |
| Correction du hasard | Sur une question à choix, une réponse fausse retire aussi le crédit qu'une réussite chanceuse aurait rapporté : répondre au hasard ne passe pas pour une maîtrise partielle. | [Modèle de l'apprenant](learner-model.fr.md#correction-du-hasard) |
| Diagnostic (scène de) | Une scène d'ouverture marquée `diagnostic: true`, qui demande ce que l'apprenant sait déjà. Elle est jouée une fois et ne revient jamais en révision. | [Réviser dans la durée](../learn/review-over-time.fr.md#jouer-une-séance-de-révision) |
| Échelle d'aide | Une aide progressive après votre propre tentative : relecture, indice, explication, puis référence avec le verdict. Un indice réduit le crédit d'une bonne réponse. | [VS Code](../start/vscode.fr.md#ce-que-vous-voyez) |
| FSRS | Free Spaced Repetition Scheduler : le modèle qui décide quand un concept doit être révisé. | [Modèle de l'apprenant](learner-model.fr.md#la-rétention-avec-fsrs) |
| Harnais | L'assistant d'IA ou le client qui pilote une leçon Studium : Codex, Claude Code, Copilot, OpenCode, Cursor ou l'extension VS Code. | [Harnais](../start/harnesses.fr.md) |
| Jeu de verdicts | Une forme de `spot_the_flaw` où l'apprenant marque chaque affirmation comme fautive ou correcte, comparée à la clé. | [Types de scènes](scene-types.fr.md#audits-avec-un-jeu-de-verdicts) |
| Juge | Un modèle configuré sur le serveur (`LITELLM_BASE_URL`) qui évalue les réponses rédigées. Sans juge, ces réponses ne sont pas évaluées. | [Honnêteté et provenance](honesty-and-provenance.fr.md#le-juge) |
| Landmark (ligne repère) | Une ligne que l'exécution d'une reproduction doit renvoyer (par défaut la dernière ligne non vide de sa sortie), dont on vérifie la présence, jamais la valeur. | [Types de scènes](scene-types.fr.md#reproduction) |
| Learning Workflow Graph (LWG) | Le graphe des concepts et des tâches d'une leçon, avec des arêtes typées comme `prerequisite_for`. | [Comment fonctionne Studium](how-studium-works.fr.md#le-graphe) |
| Leçon d'auto-apprentissage | Une leçon écrite pour soi, par l'apprenant ou par un agent (`mode: self_study`). Ne peut pas recevoir l'approbation d'un enseignant. | [Auto-apprentissage à partir de références](../tutorials/self-study-from-references.fr.md) |
| Leçon rédigée par un agent | Une leçon qu'un assistant d'IA a rédigée avec `create_lesson` à partir de sources choisies par l'apprenant. Non vérifiée par un enseignant ; son avis le dit. | [Honnêteté et provenance](honesty-and-provenance.fr.md) |
| Livre ouvert | Un quiz d'auto-apprentissage dont l'apprenant a écrit la clé : y répondre montre qu'on se souvient de sa propre clé, pas une évaluation externe. | [Honnêteté et provenance](honesty-and-provenance.fr.md#classes-de-clé) |
| Maîtrise bêta | L'estimation de ce qui a été montré sur un concept, α / (α + β), nourrie uniquement par des réponses évaluées. | [Modèle de l'apprenant](learner-model.fr.md#la-maîtrise-une-estimation-bêta) |
| Maîtrise effective | La maîtrise corrigée par le rappel actuel : estimation a posteriori × récupérabilité, ou l'estimation seule si le concept n'a jamais été révisé. | [Modèle de l'apprenant](learner-model.fr.md#maîtrise-effective) |
| Manifeste d'exécution | Ce qu'une reproduction doit produire et vérifier, sans les valeurs attendues. | [Types de scènes](scene-types.fr.md#reproduction) |
| MCP | Model Context Protocol : le standard par lequel les assistants appellent les outils de Studium. | [Outils MCP](../reference/mcp-tools.fr.md) |
| Modulateur | Une étiquette (M1, M3, M6) qui nomme l'intention pédagogique d'une règle d'adaptation. | [Modulateurs](modulators.fr.md) |
| Niveau de Bloom | Le niveau cognitif d'un concept (de *remember* à *create*). Il fixe le poids de difficulté de ses réponses. | [Types de scènes](scene-types.fr.md#difficulté) |
| Non mesuré | Aucune preuve n'a été recueillie. Studium ne le lit jamais comme zéro, faux ou oublié. | [Modèle de l'apprenant](learner-model.fr.md#non-mesuré-ne-veut-pas-dire-zéro) |
| Plan d'étude | `get_study_plan` : révisions dues, concepts à reprendre, leçons en cours et leçon suivante, toutes leçons confondues. | [Réviser dans la durée](../learn/review-over-time.fr.md) |
| Pseudonyme | Le HMAC de l'identifiant d'un apprenant, qui nomme son dossier de données. | [Confidentialité et limites](privacy-and-limits.fr.md#pseudonymes) |
| Rapport de classe | `class_report` : chiffres agrégés d'un cours sur la télémétrie consentie, chacun calculé sur au moins cinq apprenants. | [Suivre une classe](../teach/follow-a-class.fr.md) |
| Récupérabilité | La probabilité, selon FSRS, que l'apprenant se souvienne encore d'un concept maintenant. | [Modèle de l'apprenant](learner-model.fr.md#la-rétention-avec-fsrs) |
| Reçu de relecture | L'enregistrement des items de relecture ouverts et de votre verdict sur chaque item évalué. Un retour peut être enregistré sans approuver la leçon. | [Relire et approuver](../teach/review-and-approve.fr.md#approuver-le-fichier-exact) |
| Réduction pour indices | Chaque indice diminue le crédit d'une bonne réponse et affaiblit sa note de révision. | [Modèle de l'apprenant](learner-model.fr.md#les-indices-réduisent-le-crédit) |
| Référence | Ce à quoi une réponse est comparée après coup : points clés, défauts placés ou affirmations fautives, et une réponse modèle ; pour un quiz manqué, le bon choix. | [Types de scènes](scene-types.fr.md#réponses-rédigées) |
| Registre d'approbation | `approval.json`, écrit à côté d'une leçon par `experience_packet.py approve` et lié à l'empreinte SHA-256 du `lesson.json` exact. Documente une relecture ; ce n'est pas une signature. | [Honnêteté et provenance](honesty-and-provenance.fr.md#le-registre-dapprobation) |
| Règle 003 | La règle du projet selon laquelle aucun contenu n'est diffusé aux étudiants sans validation par un enseignant. | [Honnêteté et provenance](honesty-and-provenance.fr.md#règle-003-un-enseignant-avant-toute-diffusion) |
| Retenu (chiffre) | Un chiffre du rapport de classe auquel des apprenants ont contribué, mais moins que le plancher de cinq : masqué, ce qui n'est ni zéro ni non mesuré. | [Suivre une classe](../teach/follow-a-class.fr.md#lire-les-chiffres) |
| Scène | Une étape d'une leçon ; il en existe 13 types. | [Types de scènes](scene-types.fr.md) |
| Stabilité | Dans FSRS, le nombre de jours au bout duquel le rappel descend à la cible de 0,9. | [Modèle de l'apprenant](learner-model.fr.md#la-rétention-avec-fsrs) |
| Univers | Une variante du parcours d'une leçon : un parcours de base et un parcours de remédiation plus guidé. | [Comment fonctionne Studium](how-studium-works.fr.md#le-bundle-de-leçon) |
| Voie (rapide / compagnon) et rang de surface | La voie rapide est un panneau, un volet ou des formulaires ; la voie compagnon est la conversation. Le rang nomme la surface de la séance : 3 pour un panneau ou volet, 2 pour des formulaires, 1 pour la conversation. | [Panneaux de leçon](../start/harness-panels.fr.md#la-surface-sur-laquelle-la-leçon-se-joue) |
| Voix | La ligne qui dit qui a rédigé ou validé la leçon, ou qui a évalué une réponse. Elle distingue un enseignant, un brouillon d'IA et votre propre clé. | [VS Code](../start/vscode.fr.md#ce-que-vous-voyez) |

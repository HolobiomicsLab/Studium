[English](capabilities.md) · Français

# Capacités et limites

Cette page recense ce que fait Studium aujourd'hui, pour chaque type d'utilisateur, avec la limite pratique de chaque capacité. Studium est un prototype de recherche en enseignement adaptatif : son unité est un parcours explicite de concepts et de tâches, pas seulement une conversation avec un modèle. Une capacité listée ici existe dans le code ; elle n'est pas forcément disponible sur toutes les surfaces.

## Pour les apprenants et les autodidactes

| Capacité | Ce qui fonctionne | Limite pratique |
|---|---|---|
| Apprendre un sujet en conversation | Votre assistant transforme les sources que vous avez choisies en leçon jouable avec `get_authoring_guide`, `prepare_sources` et `create_lesson` ; chaque question évaluée cite une citation vérifiée | Rédigée par un agent, non validée par un enseignant ; jusqu'à 20 sources et 200 000 caractères ; pas de scène de reproduction |
| Parcours adaptatif | La navigation suit les prérequis, la maîtrise mesurée, les indices et la remédiation | Ne vaut que ce que valent la leçon et le juge |
| Réviser sur plusieurs jours | `get_study_plan` indique ce qui est dû, toutes leçons confondues ; `start_review_session` le joue ; `rate_recall` enregistre une auto-évaluation | Un concept qu'aucune leçon ne peut rejouer est listé mais jamais proposé |
| Retour honnête | Les réponses évaluées font évoluer la maîtrise ; sans juge, vous recevez la référence et notez votre rappel | Sans juge, les textes rédigés ne sont pas évalués |
| Métacognition | Confiance déclarée comparée à la performance mesurée | Indicateurs de prototype, ni diagnostic ni note institutionnelle |
| Journal d'expérience | Prédiction, confiance, observation et conclusion conservées via `record_experiment` et `get_experiment_journal` | Privé, sur consentement, non noté |
| Auto-apprentissage à partir de références | `experience_packet.py passages`, `prepare`, `check`, `bundle --self-study` | Livre ouvert pour les quiz et les défauts à repérer ; ni validation enseignante ni diffusion |
| Reproductions | Le harnais exécute une capsule ; Studium vérifie l'exécution par rapport à son manifeste ; VS Code demande confirmation avant d'exécuter du code | Studium n'exécute jamais ; un contrôle d'exécution n'est pas une preuve d'exécution |
| Évaluation par les pairs | Les salles de pairs (`open_peer_room`, `submit_peer_rating`) agrègent les notes | Salles en mémoire ; une cible reste masquée sous 3 évaluateurs |
| Langue | `set_session_language` et dictionnaires des activités | Les dictionnaires traduisent les textes fournis ; les anciennes interfaces ne sont pas toutes localisées |
| Rapport de l'apprenant | `tools/learner_report.py export` produit une copie locale ASTRA/MySTRA des actions choisies | Trace partielle : ne prouve ni l'apprentissage, ni l'absence d'aide, ni l'identité de l'auteur |

Commencez par [Apprendre avec votre assistant](../learn/learn-with-your-assistant.fr.md), le [guide de l'étudiant](../learn/student-guide.fr.md) et [Réviser dans la durée](../learn/review-over-time.fr.md).

## Pour les enseignants

| Capacité | Ce qui fonctionne | Limite pratique |
|---|---|---|
| De la littérature au cours | Capture de passages, plan canonique et liens exacts vers les preuves | Pas d'approbation scientifique automatique |
| Relire et approuver | `review_lesson` montre un brouillon sans ses clés ; `experience_packet.py approve` écrit `approval.json`, lié aux octets exacts de la leçon ; pages bibliothèque et relecture du tableau de bord | Le registre documente une relecture ; ce n'est pas une signature |
| Suivre une classe | `class_report` : exactitude par scène et par concept là où une clé ou un juge a évalué, recours aux indices, calibration, achèvement | Télémétrie consentie seulement ; plancher de 5 apprenants pour chaque chiffre ; couvre tout le dossier de données configuré |
| Contributions des apprenants | Proposition, relecture et diffusion de bundles d'apprenants ; découverte avec `list_community_bundles` | Le bundle d'un cours doit être en `<BUNDLES_ROOT>/<cours>/lesson.json` ; la diffusion suit la décision de l'enseignant |
| Modèles d'activités | Cinq activités portables : représentations liées, comparaison de paramètres, preuve et affirmation, diagnostic d'analyse, robustesse d'une conclusion | Lecteurs locaux sans agent intégré ; ils ne font pas avancer la séance |
| Médias et supports visuels | Mermaid, KaTeX, SMILES 2D, images, audio et vidéo avec provenance | Couverture variable selon le lecteur ; génération externe et facultative |
| Vue de provenance d'un brouillon | `tools/experience_review.py` affiche un brouillon vérifié via ASTRA et MySTRA, pour distinguer éléments vérifiés, déclarés et encore à examiner | Une vue de provenance, ni approbation ni jugement de validité scientifique |
| Dossier d'exploration | `tools/experience_exploration.py` capture ce qu'un harnais a exploré : sources, versions, fichiers nommés, contrôles | Les empreintes détectent les modifications ultérieures ; elles ne prouvent ni la science ni une exécution |
| Aide contextuelle | Les boutons `?` expliquent objectif, prédiction, confiance, preuves et adaptation, en français et en anglais | Ils énoncent une intention pédagogique, pas des bénéfices démontrés |
| Observatory | Inspection de cours et vues de relecture, MySTRA compris | Service local, pas un portail de classe authentifié |

Voir le [guide de l'enseignant](../teach/teacher-guide.fr.md), [Relire et approuver](../teach/review-and-approve.fr.md) et [Suivre une classe](../teach/follow-a-class.fr.md).

## Pour les développeurs et les intégrateurs de harnais

| Capacité | Ce qui fonctionne | Limite pratique |
|---|---|---|
| Serveur MCP | 34 outils sur stdio (25 de leçon, 4 d'étude, 3 de rédaction, 2 pour l'enseignant), invites `learn` et `review` | Chaque client a ses propres outils, son compte et sa séance |
| API HTTP locale | Les opérations de leçon, découverte des schémas, jeton porteur, protection contre les doubles soumissions | Boucle locale uniquement ; outils d'étude, de rédaction et d'enseignant réservés à MCP ; les séances actives s'arrêtent avec le processus |
| Canal fichier | Une boucle tâche/réponse dans `.studium-session/` pour un harnais sans MCP | Formats et écritures atomiques à respecter |
| Extension VS Code | Panneau de leçon, participant de chat, cellule de notebook, reprise au rechargement, révisions dans la barre d'état | Ses séances sont distinctes de celles du serveur MCP d'un assistant |
| Capsule ASB | Carte de tâche et protocole de reproduction | Le niveau d'une capsule n'atteste pas l'exécution d'un apprenant |

Voir [Harnais](../start/harnesses.fr.md), la [référence des outils MCP](../reference/mcp-tools.fr.md) et [Architecture](../develop/architecture.fr.md).

## Qui détient la clé

| Classe | Types de scènes | Dans une leçon d'auto-apprentissage |
|---|---|---|
| `ungraded` | `intro`, `concept`, `meta_checkpoint` | Rien n'est évalué |
| `author_keyed` | `quiz`, `spot_the_flaw` | La clé a été écrite par la personne qui répond (livre ouvert), ou par l'agent qui a rédigé la leçon |
| `production` | `explain_back`, `comparison`, `summary_audit`, `prompt_practice`, `communication_sim`, `discussion`, `ai_critique` | Sans juge modèle, la référence est montrée et rien n'est évalué ; un juge (`LITELLM_BASE_URL`) rend l'évaluation externe |
| `externally_grounded` | `reproduction` | Vérifiée par rapport à une exécution réelle |

## Les avis

Une leçon d'auto-apprentissage affiche un avis dès son premier écran. Il dépend de son rédacteur et de la présence d'un juge.

| Rédigée par, juge | Avis (leçons en français) |
|---|---|
| apprenant, aucun | Leçon auto-rédigée : les quiz et les défauts à repérer ont une clé écrite par l'apprenant (livre ouvert). Sans juge modèle, les scènes de production ne sont pas évaluées : comparez votre réponse à la réponse modèle et notez votre rappel ; cette note règle vos révisions, jamais votre maîtrise. Seules les reproductions exécutées portent une évaluation externe. |
| apprenant, configuré | Leçon auto-rédigée : les quiz et les défauts à repérer ont une clé écrite par l'apprenant (livre ouvert). Les scènes de production, jugées par le modèle, et les reproductions exécutées portent l'évaluation. |
| agent, aucun | Leçon rédigée par l'IA à partir de vos sources, non vérifiée par un enseignant : chaque question cite son passage ; contestez une clé qui vous semble fausse. Sans juge modèle, les scènes de production ne sont pas évaluées : comparez votre réponse à la réponse modèle et notez votre rappel ; cette note règle vos révisions, jamais votre maîtrise. Seules les reproductions exécutées portent une évaluation externe. |
| agent, configuré | Leçon rédigée par l'IA à partir de vos sources, non vérifiée par un enseignant : chaque question cite son passage ; contestez une clé qui vous semble fausse. Les scènes de production, jugées par le modèle, et les reproductions exécutées portent l'évaluation. |

Plus de détails dans [Honnêteté et provenance](honesty-and-provenance.fr.md).

## Supports et affichage

Les surfaces affichent images, SVG, équations LaTeX, code, CSV, protocoles, spécifications de graphiques et résultats exécutés ; les supports scientifiques comprennent orbitales, molécules 3D et spectres. Les bibliothèques de rendu sont embarquées pour un usage local (`studium.assets` = `vendor`, par défaut) ; une option `cdn` existe. Quand un moteur de rendu manque, une solution de repli garde le contenu lisible, sans promettre la même interaction. Les préférences de modalité peuvent réordonner et mettre en avant des supports sans masquer de contenu ; elles répondent à un besoin exprimé et ne diagnostiquent pas un profil cognitif. Voir [Langue et supports](../learn/language-and-supports.fr.md) et [Médias et supports visuels](../teach/media-and-visual-support.fr.md).

## Auditabilité

Les décisions adaptatives portent leur règle et leur modulateur, et le graphe comme les décisions peuvent être exportés sous forme d'affirmations indicium et d'enregistrements ASTRA. Une inférence devient ainsi inspectable ; elle n'en devient pas juste pour autant.

## Qui fait quoi

- **Studium** garde les concepts, les scènes, les réponses attendues, la progression et le protocole d'exécution.
- **Le harnais** possède ses outils et son modèle, lit les skills, cherche et exécute dans son propre environnement.
- **L'apprenant** prédit, choisit une variation, interprète et répond.
- **L'enseignant** fixe le périmètre, relit et décide de ce qui est diffusé.

La recherche web, Perspicacité, les bibliothèques et les skills ne deviennent pas disponibles parce qu'une leçon les mentionne : le harnais doit vérifier ses connexions réelles. Le [tutoriel d'expérience agentique](../tutorials/agentic-experiment.fr.md) montre comment s'en servir sans sortir du contrat de la leçon.

## Frontières ouvertes

- Reporté, par décision : variantes d'items et conceptions erronées, MCP Apps (interface interactive dans le chat), envoi HTTP de la télémétrie de classe, identité des concepts par espace de noms, publication npm et Marketplace.
- Pas de portail enseignant multi-utilisateur authentifié ; le tableau de bord et l'Observatory sont locaux.
- Le panneau VS Code et un serveur MCP indépendant ne partagent pas leur séance.
- Des tests logiciels réussis n'établissent ni la conformité institutionnelle, ni un déploiement multi-utilisateur, ni l'efficacité pédagogique. Commencez par un pilote accompagné et les règles de [Confidentialité et limites](privacy-and-limits.fr.md).

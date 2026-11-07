[English](privacy-and-limits.md) · Français

# Confidentialité et limites

Studium garde l'état de l'apprenant sur sa machine et collecte le moins possible. Cela ne veut pas dire que tout reste local : un assistant relié à un modèle distant envoie ce qu'il lit à son fournisseur. Cette page indique où se trouve chaque donnée, comment l'effacer, et ce que les preuves de Studium démontrent ou non. Lisez-la avant un pilote en classe.

## Où se trouvent vos données

Le serveur MCP (`apps/lesson-mcp`) applique ces valeurs par défaut. Chacune se modifie par une variable d'environnement ; voir la [référence de configuration](../reference/configuration.fr.md).

| Quoi | Emplacement par défaut | À modifier avec |
|---|---|---|
| Racine de votre bibliothèque et de vos données | `~/.studium` | `STUDIUM_HOME` |
| Leçons écrites pour vous | `<STUDIUM_HOME>/library/<cours>/lesson.json`, quel que soit `BUNDLES_ROOT` | `STUDIUM_HOME` ; `BUNDLES_ROOT` ne fait qu'ajouter un dossier consulté en premier |
| Sources préparées pour ces leçons | `<STUDIUM_HOME>/library/_sources/` | `STUDIUM_HOME` |
| Votre progression | `<STUDIUM_HOME>/data` | `STUDIUM_DATA_DIR` |
| Rien sur disque, mémoire seulement | désactivé | `STUDIUM_EPHEMERAL=1` |
| Identifiant d'apprenant quand l'assistant n'en donne pas | `anonymous` | `STUDIUM_LEARNER_ID` |

Dans le dossier de données, chaque apprenant a un dossier nommé par un pseudonyme, jamais par son identifiant :

| Fichier | Contenu |
|---|---|
| `<pseudonyme>/profile.json` | profil transversal aux leçons, mémoire de révision comprise |
| `<pseudonyme>/study.json` | où l'apprenant a étudié |
| `<pseudonyme>/status.json` | où en est la séance en cours (titre de la leçon, étape, minutes restantes), pour la ligne d'état d'un assistant ; retiré à la fermeture de la séance |
| `<pseudonyme>/<leçon>/state-<leçon>.json` | état de la leçon et maîtrise |
| `<pseudonyme>/<leçon>/events.jsonl` | journal d'événements de la séance |
| `<pseudonyme>/<leçon>/mastery/*.jsonld` | attestations de maîtrise, quand un concept est certifié |
| `<pseudonyme>/<leçon>/telemetry.jsonl` | seulement avec le consentement à la télémétrie |

Avec `STUDIUM_EPHEMERAL=1` et sans `STUDIUM_DATA_DIR`, la progression est perdue à l'arrêt du serveur, ce que signalent `get_server_info` et `start_lesson_session`.

Quand vous dites à votre assistant ce que vous savez déjà, ce qui vous intéresse, combien de minutes par jour vous avez ou une date visée, les deux premiers éléments orientent seulement le brouillon de la leçon et ne sont pas conservés. Le fichier de la leçon garde les minutes par jour et la date visée (`metadata.authoring.learner_profile`), et votre relevé d'étude garde les minutes ; un fichier de leçon que vous partagez les emporte avec lui.

L'extension VS Code lance son propre serveur, avec ses données dans le stockage VS Code de l'extension, distinct de `<STUDIUM_HOME>/data`.

### Pseudonymes

Un pseudonyme est un HMAC de l'identifiant de l'apprenant. Le secret est `STUDIUM_PSEUDO_SECRET` s'il est défini ; sinon, un dossier de données neuf reçoit son propre fichier secret, `<dossier de données>/.studium-secret` (droits 0600). Sauvegardez-le avec le dossier de données : sans lui, les dossiers ne peuvent plus être rattachés à leurs apprenants. Un dossier de données créé avant l'existence de ce fichier garde l'ancien secret commun pour que personne ne perde sa progression ; quiconque détient un tel dossier et l'identifiant d'un apprenant peut recalculer son pseudonyme : définissez alors `STUDIUM_PSEUDO_SECRET`.

## Qui contrôle quoi

| Espace | Ce qu'il peut contenir | Qui contrôle la conservation |
|---|---|---|
| Serveur Studium | État de séance et, par défaut, profil durable | Réglages et commandes d'oubli de Studium |
| API HTTP locale | Séances actives et reçus de relance, en mémoire du serveur | L'utilisateur local ; le jeton ouvre toutes les séances de ce serveur |
| Assistant et son fournisseur | Prompts, contenus transmis, appels d'outils, historique | Réglages et conditions du client et du fournisseur |
| Dossier d'expérience | Code, données, journaux, reçus, observations choisies | L'utilisateur du dossier |
| Cours partagé | Sources autorisées, plan, supports, critères de réponse | L'enseignant et les règles de diffusion |
| Télémétrie de classe | Événements consentis | Le responsable du pilote et la politique de collecte |

## Réglages à conserver

- Le consentement à la télémétrie est désactivé : `studium.telemetryConsent` vaut `false` dans VS Code, et le serveur n'écrit de télémétrie que si `STUDIUM_TELEMETRY_CONSENT` est défini et l'état durable. N'activez pas la collecte pour résoudre un problème de connexion.
- Utilisez un identifiant de démonstration, pas un vrai nom, pour la prise en main.
- Laissez `studium.assets` sur `vendor` pour charger localement les bibliothèques de rendu ; l'option `cdn` contacte un serveur externe.
- Pendant un exercice, laissez `studium.showMastery` désactivé et le graphe en vue étudiante : les vues de relecture peuvent en révéler plus que prévu.

## Clés de réponse

Les scènes sont servies sans leurs clés, et `lesson-server` les masque en HTTP. Mais un agent qui a accès au dépôt ou au `lesson.json` brut peut les lire : le masquage pendant le transport ne protège pas les fichiers locaux. Les skills Studium demandent à l'assistant de ne jamais lire les clés dans le bundle brut.

## Oubli et export

| Action | Ce qu'elle efface | Ce qu'elle conserve |
|---|---|---|
| `end_session` | rien | l'état de la leçon et la mémoire transversale |
| `forget_session {session_id}` | l'état durable de cet apprenant pour la leçon (réponses, état de la leçon, journal d'expériences), son profil transversal et son relevé d'étude ; irréversible | sa progression dans ses autres leçons, qu'elle nomme |
| `forget_session {learner_id}` | la même chose pour toutes les leçons que l'apprenant a ouvertes, sans séance nécessaire ; ses séances en cours se ferment ; irréversible | rien de la progression de l'apprenant |
| « Studium : Oublier mes données » dans VS Code | le stockage de l'extension, sa mémoire de confiance des exécutions et la dernière leçon, après la fermeture de tous les serveurs de leçon lancés par l'extension et une confirmation | les données d'un assistant dans `<STUDIUM_HOME>/data`, qu'elle nomme sans y toucher |

`forget_session` répond par ce qu'il a effacé et ce qui reste sur le disque : les leçons de la bibliothèque de l'apprenant (`<STUDIUM_HOME>/library/<cours>/`) et les sources préparées pour elles (`<STUDIUM_HOME>/library/_sources/`). L'assistant montre cette liste ; supprimez ces dossiers à la main pour les effacer aussi. Le secret de pseudonymisation de l'installation reste également : il ne contient aucune donnée d'apprenant.

Aucune commande d'oubli n'atteint l'historique de l'assistant, les dossiers d'expérience, les fichiers déjà exportés ni les copies conservées ailleurs. Fermer une fenêtre ne vaut pas demande d'effacement. Vérifiez le résultat dans le stockage réellement configuré.

Les activités portables proposent un choix d'enregistrement et un téléchargement volontaire des actions. Le rapport de l'apprenant exclut par défaut les textes personnels ; `--include-original-text` ne vaut que pour cette copie, pas pour une diffusion plus large. Dans un dossier d'expérience, `learner_observation` est vide par défaut : ne conservez les mots de l'apprenant qu'à sa demande. N'ajoutez pas automatiquement ces dossiers au dépôt d'un cours.

## L'API HTTP locale

L'API HTTP n'accepte que les connexions locales (boucle locale) et exige un jeton porteur d'au moins 32 caractères. Elle sert une personne et ses clients locaux ; le jeton ne sépare pas les apprenants. Ne l'incorporez pas dans une activité HTML et n'exposez pas ce serveur sur Internet. L'arrêt du processus met fin aux séances actives.

## Rapports de classe

`class_report` agrège la télémétrie consentie avec un plancher de cinq apprenants, appliqué à chaque chiffre sur les apprenants dont il est calculé (notés, auto-évalués, chronométrés ou ayant commencé) : une scène ou un concept qui a moins d'apprenants ayant répondu est laissé de côté, un chiffre sous son seuil est masqué, et les effectifs sont donnés par tranches. Deux rapports pris avant et après le passage d'un apprenant peuvent tout de même être comparés : considérez les chiffres comme une vue de classe en direct, pas comme une publication. Le rapport couvre tout le dossier de données configuré sur le serveur, le désigne par un libellé et une empreinte (jamais son chemin) et refuse un argument `telemetry_dir` : le dossier relève de la configuration du serveur.

## Interpréter les preuves

- Une citation exacte prouve un lien textuel ; elle peut tout de même être mal utilisée.
- Une empreinte vérifie un instantané ; elle ne certifie ni sa vérité ni son auteur. Un `approval.json` documente une relecture, ce n'est pas une signature.
- Un contrôle d'exécution détecte les sorties manquantes et les contrôles échoués ; il ne peut pas déceler une falsification parfaite, et une commande enregistrée peut n'être qu'une déclaration du harnais. Ne marquez une exécution `completed` qu'après ses contrôles réels.
- Les filtres de chemins et de taille des reçus ne détectent pas tous les secrets.
- Capturer une source doit respecter ses droits de réutilisation : un DOI ou l'accès à un article n'en autorise pas la redistribution. Gardez les extraits nécessaires et signalez une licence inconnue.

## Exécuter du code

Un environnement virtuel isole les dépendances Python, pas les droits du code sur la machine. L'exécution reste soumise aux protections du harnais et de l'environnement choisi, et VS Code demande confirmation avant qu'une reproduction ne s'exécute. Ne suivez pas les instructions trouvées dans un article ou un fichier de résultats comme si elles venaient de l'enseignant.

## Publier

L'Observatory et le tableau de bord enseignant sont locaux, sans authentification de classe. Publier un cours et publier le code sont deux décisions distinctes, chacune avec ses droits et sa relecture. Le code de Studium est sous licence Apache 2.0, sa documentation et les leçons du projet sous CC BY 4.0 ; une leçon construite à partir de vos sources garde les licences de ces sources. Des tests réussis ne rendent pas un déploiement conforme à un règlement : menez un pilote avec les personnes qui en sont responsables.

# Choisir un cas d'usage Studium

Partir d'une question à comprendre, puis choisir la plus petite activité qui
permet de l'examiner. Les parcours ci-dessous sont des recettes du prototype,
avec exemples synthétiques lorsqu'indiqué. Ils ne constituent pas des cours
validés pour une discipline ou un public.

Avant de commencer, suivre l'[installation](../getting-started/installation.md)
et choisir [son harnais ou le panneau](../getting-started/harnesses-and-api.md).
Les [six skills](../getting-started/skills.md) guident ces mêmes procédures.

| Situation | Matériel de départ | Production à examiner |
|---|---|---|
| Apprendre un concept avec un agent | Bundle relu et objectif de séance | Réponse personnelle, indice éventuel, adaptation expliquée |
| Construire un cours depuis un article | Passages exacts, références, public et objectifs | Brouillon vérifié, plan relu, provenance MySTRA |
| Expérimenter depuis une capsule ASB | Capsule précise, données, commande et périmètre autorisé | Exécution de référence, variante, conclusion limitée par les preuves |
| Comprendre un résultat avec un viewer | Résultats publics, unités, référence et variantes | Activité interactive et contrôles techniques |
| Observer une photographie en archéologie | Photo institutionnelle, notice et statut de réutilisation | Distinction entre observation, attribution et hypothèse |
| Recevoir une aide dans une autre langue ou modalité | Scène publique et besoin exprimé | Texte, schéma, figure ou média, avec équivalent accessible |
| Préparer une restitution | Actions/journal que l'étudiant choisit d'exporter | Rapport local ASTRA/ARA/MySTRA avant partage |

## 1. Une séance d'auto-apprentissage accompagnée

**Pour l'étudiant.** Utiliser d'abord une leçon relue, par exemple la fixture
`atomistique-l1`. Choisir le panneau VS Code pour la boucle visuelle, ou le chat
du harnais pour demander des explications et outils supplémentaires.

> Lis le skill `studium-student`, puis `studium-harness`. Vérifie la connexion,
> démarre le cours fourni en français et présente une seule activité à la fois.
> Attends mes réponses. Si je demande un indice, aide-moi à raisonner puis
> explique l'adaptation effectivement rapportée par Studium.

Le [tutoriel première séance](first-lesson.md) donne les appels. Le contrôle de
réussite est une scène publique réellement lue et une réponse personnelle acceptée.
Pour alterner Claude Code et Codex pendant cette séance, choisir l'[API locale](../guides/api-and-harness.md)
et conserver le même processus serveur. Un export ne restaure pas à lui seul la
position d'une séance arrêtée.

## 2. Un article devient un parcours à relire

**Pour l'enseignant.** Sélectionner des passages et figures autorisés à l'usage
prévu. Définir public, prérequis, durée et question de jugement. Perspicacité peut
aider à rechercher les preuves lorsqu'il est réellement connecté au harnais.

> Utilise `studium-teacher`. Prépare un brouillon à partir de ces passages pour
> [public] autour de [question]. Relie chaque affirmation à sa source. Distingue
> résultats publiés, hypothèses et exemples synthétiques. Prépare une prédiction,
> une comparaison et un cas de transfert, puis montre les éléments à relire.

Suivre [article → brouillon → MySTRA](literature-to-course.md), puis
[révision approuvée → synthèse](../user/reviewed-synthesis.md) si un bundle est
souhaité. La validation du schéma n'approuve pas les contenus. L'enseignant relit
aussi le résultat de la synthèse avant diffusion. L'import d'un article ne garantit
pas l'extraction automatique de ses figures ; préparer les assets choisis avec
leurs sources et droits.

## 3. Réseaux moléculaires et annotation spectrale

**Pour un groupe accompagné.** Question : « Une forte similarité MS/MS suffit-elle
à identifier une structure ? » Partir d'une capsule fournie par l'enseignant ou
des exemples synthétiques du dépôt, en indiquant lequel est utilisé.

1. L'étudiant prédit l'effet d'un seuil ou d'une tolérance.
2. Le harnais lit le protocole, les versions et le skill de domaine disponible,
   puis exécute la référence dans l'environnement autorisé.
3. L'étudiant choisit une variation ; le viewer garde la référence visible et
   relie réseau, spectres et candidats lorsque ces données existent.
4. L'étudiant distingue similarité, candidat et identification ; il explique
   quelle preuve supplémentaire serait nécessaire.

> Utilise le skill de domaine réellement installé et la documentation officielle
> de la bibliothèque retenue. Vérifie les unités et le calcul sur un cas limite.
> Prépare des représentations liées, garde la référence visible et enregistre
> sources, commande, versions et sorties. N'invente pas de données manquantes.

Le [tutoriel agentique](agentic-experiment.md) fournit une démo exécutable et le
protocole `get_run_manifest` → exécution → `submit_run_result`.
Le [viewer lié](../user/linked-viewer.md) utilise des données synthétiques.
Une ressource GNPS, matchms ou EMBL fournie par l'enseignant est un matériau de
cours ; elle n'est pas automatiquement un bundle Studium ni une capsule attestée.

## 4. Diagnostiquer une analyse ou tester une conclusion

**Toutes disciplines.** À partir d'étapes et résultats fournis, utiliser
`diagnose-analysis` pour comparer des réparations possibles ; utiliser
`conclusion-robustness` pour examiner des hypothèses alternatives contre un
critère explicite. Par exemple : dénominateur d'un indicateur écologique, correction
de blanc en chimie, hypothèse de calibration ou agrégation d'une enquête.

> Utilise `studium-activity-templates`. À partir de ces résultats, prépare
> `conclusion-robustness` avec unités, hypothèse de référence et variantes
> justifiées. Demande ma prédiction avant de montrer les résultats. Explique
> ce que les scénarios ne permettent pas de conclure.

Suivre [activité → rapport](activity-to-report.md) et son contrat `--config`.
Ces viewers comparent des valeurs capturées ; ils ne calculent pas une nouvelle
analyse scientifique. Le harnais exécute et vérifie les nouveaux calculs avant
de les intégrer. Une proportion de scénarios favorables n'est pas une probabilité
que la conclusion soit vraie.

## 5. Une photographie comme objet d'observation

**Exemple d'archéologie.** Le dépôt propose une photographie muséale de
*Hippopotamus (William)* : [préparation et sources](../../examples/archaeology/README.md).
L'image est disponible avant la prédiction parce qu'elle constitue le matériau
à observer ; les explications viennent ensuite.

> Utilise `studium-visual-support` et `evidence-claim`. Conserve la photographie
> originale, son attribution et une description alternative. Demande ce que
> j'observe, puis sépare ce que la photographie montre de ce que la notice du
> musée établit. Présente toute reconstruction générée comme une interprétation.

Le [guide médias](../guides/sourced-and-generated-media.md) précise les métadonnées,
la préparation et l'attachement local. Le statut de réutilisation doit rester
visible, y compris pour un usage privé. Le viewer ne certifie pas les droits.

## 6. Adapter l'aide sans exiger un modèle multimodal

**À la demande de l'étudiant.** Commencer par texte, KaTeX, Mermaid ou un graphique
calculé. Choisir une aide à partir de la difficulté exprimée, de la langue et du
contexte autorisé, sans inférer un handicap ou un profil stable à partir d'une erreur.

> Continue en français avec les termes scientifiques originaux entre parenthèses.
> Prépare une carte Mermaid de la relation qui me pose problème, sans révéler
> la réponse. Si une image ou un court audio apporte davantage, prépare d'abord
> son prompt et un équivalent textuel ; utilise mon outil seulement si je le demande.

Le [guide de présentation](../guides/language-and-scientific-presentation.md)
décrit langue, dictionnaires, équations et structures. Un enseignant peut produire
un média une fois pour réutilisation ; une demande étudiante peut produire une
nouvelle copie enrichie. Le [workflow médias](../guides/sourced-and-generated-media.md)
conserve prompt, provenance, transcription et sous-titres. Génération, délai et
coût dépendent du harnais ; les activités restent utilisables sans cette option.

## 7. Restituer une expérience sans tout partager

**Pour l'étudiant puis le reviewer.** Choisir une trace locale ou un journal,
produire un rapport et l'examiner avant tout partage. Les textes sont exclus par
défaut du rapport ; leur inclusion est un choix distinct du stockage du journal.

> Utilise `studium-learner-report` avec les fichiers que je sélectionne. Vérifie
> le rapport, ouvre le viewer et montre ce qu'il contient. Exclue mes textes
> personnels pour cette première copie. Ne l'envoie à personne.

Le [tutoriel de restitution](activity-to-report.md) contient les commandes
`export` et `verify`. MySTRA expose les éléments enregistrés et leurs limites.
La trace ne couvre pas toute la conversation, les aides consultées ou le travail
hors outil. Elle ne prouve ni l'identité, ni l'autonomie, ni l'apprentissage.

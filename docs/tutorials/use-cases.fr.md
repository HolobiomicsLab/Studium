[English](use-cases.md) · Français

# Choisir un cas d'usage Studium

Partez d'une question à comprendre, puis choisissez la plus petite activité qui permet de
l'examiner. Les recettes ci-dessous fonctionnent avec la version actuelle, avec des exemples
synthétiques lorsque c'est indiqué ; ce ne sont pas des cours validés pour une discipline ou un
public.

Avant de commencer, [installez Studium](../start/installation.fr.md) et choisissez
[votre harnais ou le panneau VS Code](../start/harnesses.fr.md). Les [skills](../start/skills.fr.md)
guident un assistant dans ces mêmes procédures.

| Situation | Matériel de départ | Ce que vous examinez |
|---|---|---|
| Apprendre un sujet à partir de ses sources | Un objectif et une ou deux sources | Une leçon fondée sur des citations exactes, vos réponses, des révisions sur plusieurs jours |
| Étudier une notion avec un agent | Une leçon relue et un objectif de séance | Votre réponse, un indice si besoin, l'adaptation expliquée |
| Construire un cours depuis un article | Passages exacts, références, public et objectifs | Un brouillon vérifié, un plan relu, la provenance MySTRA |
| Expérimenter depuis une capsule ASB | Une capsule, des données, une commande et un périmètre autorisé | Une exécution de référence, une variante, une conclusion bornée par les preuves |
| Comprendre un résultat avec un visualiseur | Résultats publics, unités, référence et variantes | Une activité interactive et des contrôles techniques |
| Observer une photographie en archéologie | Une photo institutionnelle, sa notice et son statut de réutilisation | La distinction entre observation, attribution et hypothèse |
| Recevoir une aide dans une autre langue ou modalité | La scène publique et le besoin exprimé | Texte, schéma, figure ou média, avec un équivalent accessible |
| Préparer une restitution | Les actions ou le journal que l'étudiant choisit d'exporter | Un rapport local ASTRA/ARA/MySTRA avant partage |
| Comprendre une conversation avec un assistant | La conversation en cours ou une séance passée | Une courte leçon qui cite l'échange, une carte des notions, ce qui est acquis et ce qui ne l'est pas |

## 1. Apprendre un sujet en conversation

**Pour l'autodidacte.** Demandez à votre assistant « Je veux apprendre <sujet> avec Studium » et
donnez-lui vos sources. Il construit une leçon avec les outils d'auteur, vous répondez avec vos
mots, et `get_study_plan` vous dit quoi réviser les jours suivants. Suivez
[Apprendre un sujet en conversation](learn-a-topic-in-a-conversation.fr.md) ; pour un texte plus
long ou plus de contrôle, [Auto-apprentissage à partir de ses références](self-study-from-references.fr.md).
La leçon est rédigée par l'agent et non vérifiée par un enseignant ; chaque question cite son
passage.

## 2. Une séance d'auto-apprentissage accompagnée

**Pour l'étudiant.** Commencez par une leçon relue, par exemple la fixture `atomistique-l1`.
Choisissez le panneau VS Code pour la boucle visuelle, ou le chat de votre harnais pour demander des
explications et des outils supplémentaires.

> Lis le skill `studium-student`, puis `studium-harness`. Vérifie la connexion, démarre le cours
> fourni en français et présente une seule activité à la fois. Attends mes réponses. Si je demande
> un indice, aide-moi à raisonner puis explique l'adaptation effectivement rapportée par Studium.

[La première séance](first-lesson.fr.md) donne les appels. La réussite, c'est une scène publique
réellement lue et une réponse personnelle acceptée. Pour alterner Claude Code et Codex pendant une
séance, gardez le même processus serveur et passez par l'[API HTTP](../reference/http-api.fr.md)
locale, qui sert les opérations de leçon.

## 3. Un article devient un cours à relire

**Pour l'enseignant.** Sélectionnez des passages et des figures autorisés pour l'usage prévu.
Définissez public, prérequis, durée et question de jugement. Perspicacité peut aider à rechercher les
preuves lorsqu'il est réellement connecté au harnais.

> Utilise `studium-teacher`. Prépare un brouillon à partir de ces passages pour [public] autour de
> [question]. Relie chaque affirmation à sa source. Distingue résultats publiés, hypothèses et
> exemples synthétiques. Prépare une prédiction, une comparaison et un cas de transfert, puis montre
> les éléments à relire.

Suivez [De la littérature à un brouillon relisible](literature-to-course.fr.md), puis
[Relire et approuver](../teach/review-and-approve.fr.md). La validation du schéma n'approuve pas le
contenu. L'import d'un article n'extrait pas ses figures automatiquement ; préparez les ressources
choisies avec leurs sources et leurs droits.

## 4. Réseaux moléculaires et annotation spectrale

**Pour un groupe accompagné.** Question : « Une forte similarité MS/MS suffit-elle à identifier une
structure ? » Partez d'une capsule fournie par l'enseignant ou des exemples synthétiques du dépôt, en
indiquant lequel.

1. L'étudiant prédit l'effet d'un seuil ou d'une tolérance.
2. Le harnais lit le protocole, les versions et le skill de domaine disponible, puis exécute la
   référence dans l'environnement autorisé.
3. L'étudiant choisit une variation ; le visualiseur garde la référence visible et relie réseau,
   spectres et candidats lorsque ces données existent.
4. L'étudiant distingue similarité, candidat et identification, et dit quelle preuve supplémentaire
   serait nécessaire.

> Utilise le skill de domaine réellement installé et la documentation officielle de la bibliothèque
> retenue. Vérifie les unités et le calcul sur un cas limite. Prépare des représentations liées,
> garde la référence visible et enregistre sources, commande, versions et sorties. N'invente pas de
> données manquantes.

[Une expérience scientifique avec son agent](agentic-experiment.fr.md) fournit une démo exécutable et
le protocole `get_run_manifest` → exécution → `submit_run_result`. Le gabarit
`linked-representations` ([gabarits d'activité](../teach/activity-templates.fr.md)) utilise des
données synthétiques. Une ressource GNPS, matchms ou EMBL fournie par l'enseignant est un matériau de
cours ; ce n'est pas automatiquement une leçon Studium ni une capsule attestée.

## 5. Diagnostiquer une analyse ou éprouver une conclusion

**Toutes disciplines.** À partir d'étapes et de résultats fournis, utilisez `diagnose-analysis` pour
comparer des réparations possibles et `conclusion-robustness` pour confronter des hypothèses
alternatives à un critère explicite : dénominateur d'un indicateur écologique, correction de blanc
en chimie, hypothèse de calibration, agrégation d'une enquête.

> Utilise `studium-activity-templates`. À partir de ces résultats, prépare `conclusion-robustness`
> avec unités, hypothèse de référence et variantes justifiées. Demande ma prédiction avant de montrer
> les résultats. Explique ce que les scénarios ne permettent pas de conclure.

Suivez [De l'activité interactive au rapport](activity-to-report.fr.md) et son contrat `--config`.
Ces visualiseurs comparent des valeurs capturées ; ils ne calculent pas une nouvelle analyse
scientifique. Le harnais exécute et vérifie les nouveaux calculs avant de les intégrer. Une
proportion de scénarios favorables n'est pas une probabilité que la conclusion soit vraie.

## 6. Une photographie comme objet d'observation

**Exemple d'archéologie.** Le dépôt propose une photographie muséale de *Hippopotamus (William)* :
[préparation et sources](../../examples/archaeology/README.md). L'image est montrée avant la
prédiction parce qu'elle constitue le matériau à observer ; les explications viennent ensuite.

> Utilise `studium-visual-support` et `evidence-claim`. Conserve la photographie originale, son
> attribution et une description alternative. Demande ce que j'observe, puis sépare ce que la
> photographie montre de ce que la notice du musée établit. Présente toute reconstruction générée
> comme une interprétation.

[Médias et supports visuels](../teach/media-and-visual-support.fr.md) précise les métadonnées, la
préparation et l'attachement local. Le statut de réutilisation doit rester visible, y compris pour un
usage privé ; le visualiseur ne certifie pas les droits.

## 7. Adapter l'aide sans exiger un modèle multimodal

**À la demande de l'étudiant.** Commencez par du texte, KaTeX, Mermaid ou un graphique calculé.
Choisissez une aide d'après la difficulté exprimée, la langue et le contexte autorisé, sans jamais
inférer un handicap ou un profil stable à partir d'une erreur.

> Continue en français avec les termes scientifiques originaux entre parenthèses. Prépare une carte
> Mermaid de la relation qui me pose problème, sans révéler la réponse. Si une image ou un court
> audio apporte davantage, prépare d'abord son prompt et un équivalent textuel ; utilise mon outil
> seulement si je le demande.

[Langues et supports](../learn/language-and-supports.fr.md) décrit langue, dictionnaires, équations
et structures. Un enseignant peut produire un média une fois pour le réutiliser ; une demande
étudiante peut produire une nouvelle copie enrichie qui conserve prompt, provenance, transcription
et sous-titres. Génération, délai et coût dépendent du harnais ; les activités restent utilisables
sans cette option.

## 8. Restituer une expérience sans tout partager

**Pour l'étudiant, puis le relecteur.** Choisissez une trace locale ou un journal, produisez un
rapport et examinez-le avant tout partage. Les textes sont exclus par défaut ; les inclure est un
choix distinct du stockage du journal.

> Utilise `studium-learner-report` avec les fichiers que je sélectionne. Vérifie le rapport, ouvre
> le visualiseur et montre ce qu'il contient. Exclus mes textes personnels pour cette première copie.
> Ne l'envoie à personne.

[De l'activité interactive au rapport](activity-to-report.fr.md) contient les commandes `export` et
`verify`. MySTRA montre les éléments enregistrés et leurs limites. La trace ne couvre ni toute la
conversation, ni les aides consultées, ni le travail hors outil, et elle ne prouve ni l'identité, ni
l'autonomie, ni l'apprentissage.

## 9. Comprendre une conversation que vous avez eue avec un assistant

**Pour toute personne qui a travaillé avec un assistant** sur une analyse, un débogage ou une
question de conception, et qui veut la comprendre plutôt que seulement en garder le résultat. Aucun
enseignant ne relit la leçon : elle est générée pour apprendre, et elle le dit.

> Utilise `studium-from-conversation`. Fais une courte leçon à partir de cette conversation pour que
> je vérifie que j'ai compris pourquoi [le point]. Pose-moi une question au plus avant de commencer.

L'assistant extrait de la transcription les tours utiles avec `tools/conversation_sources.py` ; les
extraits restent sur votre machine, les résultats d'outils sont écartés sauf demande, et les chaînes
qui ressemblent à des identifiants sont remplacées. `prepare_sources` enregistre la source comme une
conversation, `create_lesson` vérifie chaque citation, et le premier écran dit sur quoi la leçon
repose : ce que l'assistant y affirme n'a pas été vérifié, ce qui vient d'un fichier ou d'un
résultat d'outil cité est une observation. Chaque scène montre le passage qu'elle cite.

Une carte des notions ouvre la leçon et revient lors d'un détour par un prérequis, d'une scène de
synthèse et à la fin, avec les questions auxquelles vous avez répondu et leur résultat. Le but est
atteint quand vous pouvez dire, pour chaque notion, si vous l'avez réussie, si elle est à revoir ou
si vous l'avez seulement lue. La leçon vérifie ce que vous avez compris de ce qui a été dit, pas
que la conversation avait raison.

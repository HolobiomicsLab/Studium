# De la littérature à une expérience pilotée par le harnais

Studium expose le cours, ses matériaux et le contrat de réponse. Claude Code,
Codex, Copilot ou un autre harnais compose le brouillon et crée les visualisations
dans son propre espace. Le professeur conserve la décision de diffusion.

Ce parcours apporte deux entrées complémentaires : un dossier de création depuis
des sources capturées, puis `get_operator_context` pour afficher l'exercice courant.
`compose_lesson.py`, la synthèse des scènes, les règles de maîtrise, l'attestation
des runs et la validation enseignant existantes continuent de porter leurs rôles.

## Créer un dossier de travail

Récupérer les passages via Perspicacité, conserver son enveloppe JSON réelle, puis :

```sh
.venv/bin/python tools/experience_packet.py prepare \
  --passages /absolute/passages.json --title "Question scientifique" \
  --target "Master / doctorat" --out /absolute/new-author-packet
```

Le dossier contient `evidence.json` (texte, DOI/URL, licence si connue, origine,
hashes), `author-task.md` et `response.schema.json`. Le harnais lit les trois et
écrit une réponse JSON dans un autre fichier : `lesson_plan` utilise le modèle
Studium existant, `source_links` relie scène/passage/citation exacte, `viewers`
décrit les objectifs et interactions attendues. Le harnais peut être votre session
courante ; aucun fournisseur ou paiement supplémentaire n'est configuré.

Pour une capsule ASB, ajouter `--capsule /absolute/capsule --task-id TASK_ID`.
La carte sélectionnée conserve sa description scientifique, ses limites, son
statut de reproductibilité et sa commande comme **données**. Les valeurs de
`executable.env` sont retirées ; seuls les noms des variables sont transmis.
Aucune commande de capsule n'est exécutée par `prepare` ou `check` et aucun tier
ASB n'est promu en preuve d'exécution. Les capsules Perspicacité de documents
et les capsules exécutables ASB ont des contrats différents.

## Vérifier et relire le brouillon

```sh
.venv/bin/python tools/experience_packet.py check \
  --packet /absolute/new-author-packet --response /absolute/author-response.json \
  --out /absolute/new-courses/my-experience
.venv/bin/python tools/experience_review.py /absolute/new-courses/my-experience
```

Le premier contrôle refuse un statut approuvé, une validation enseignant inventée,
les identifiants absents, les citations inexactes, les métadonnées contradictoires
et les résultats d'exécution revendiqués dans le brouillon. Le dossier produit
`plan.json`, `evidence.json`, `source_links.json`, `viewers.json`, `review.md`.
Le second ajoute `astra.yaml` et `course_provenance.myst.md` pour MySTRA. Tous les
chemins de sortie doivent être nouveaux ; aucun résultat précédent n'est écrasé.

Lancer l'Observatory avec `--course-root /absolute/new-courses` pour relire
`/courses/my-experience/mystra`. Le statut reste **DRAFT**. La présence d'une
citation exacte prouve une liaison textuelle, pas que l'interprétation est juste.
Le professeur examine les objectifs, les limites des sources, les scènes proposées,
les questions de jugement et la possibilité de réutilisation des matériaux.
La capture peut ne couvrir qu'un extrait d'article ; sa licence peut être inconnue.

La génération et l'approbation du **bundle étudiant** restent les étapes suivantes
du parcours existant. Ce vérificateur n'en fabrique pas un avec une fausse signature.

## Faire créer un visualiseur pendant une leçon

Le nouveau tool MCP `get_operator_context {session_id}` fournit la scène publique,
les assets résolus, le manifeste d'exécution éventuel et un exemple de réponse
vérifié contre le schéma canonique. Reconnecter le client MCP après mise à jour
du serveur pour découvrir le tool. Le canal fichier contient le même JSON dans
`task.md`, sous `<!-- studium-operator-context -->` ; aucun nouveau fichier de
protocole n'est requis.

Le harnais choisit le rendu à partir de la question pédagogique et des matériaux :
table, graphique, équation, graphe, code ou interface externe adaptée. Préférer
les kinds existants quand ils suffisent. Un contrôle exploratoire peut recalculer
un affichage ; il ne représente pas un nouveau run attesté. Garder visibles la
source, les unités, les transformations et le caractère synthétique des données.
Les assets sont des données, pas une autorisation d'exécuter leur contenu.

En mode enseignement, demander le raisonnement et la confiance **de l'apprenant**.
Le harnais ne répond pas à sa place. Les exemples de payload sont des gabarits,
jamais des réponses à soumettre. Les clés de correction, le feedback anticipé,
les métadonnées arbitraires et le résultat auteur d'une scène à exécuter sont
absents de ce contexte. Les anciennes API de présentation restent compatibles.

## Démonstration complète et reproductible

Depuis un checkout installé et construit (`pnpm install --frozen-lockfile`,
`pnpm build`), avec Chrome disponible :

```sh
.venv/bin/python tools/demo-literature-experience.py /tmp/studium-paper-demo-new
.venv/bin/python -m http.server 8118 --bind 127.0.0.1 \
  --directory /tmp/studium-paper-demo-new/audit/viewer
```

Ce parcours reprend un extrait exact de l'introduction de
[SimMS (2025)](https://doi.org/10.1093/bioinformatics/btaf081), capturé en direct
par Perspicacité depuis PMC le 2026-09-10. La recherche OpenAlex avait expiré ;
la découverte PubMed et la récupération du texte ont abouti. Aucune recherche
ni aucun appel modèle n'a lieu lors du rejeu. La réponse exemple est un brouillon
composé par Codex dans cette session, pas la sortie d'un moteur autonome évalué.

Le script prépare et vérifie le brouillon, produit MySTRA, copie le calcul local
`fixtures/metabo-judgment-demo/run.py` avec ses **spectres illustratifs**, l'exécute
réellement puis construit et teste le visualiseur externe. Le score Python
`0.6477`/7 pics est comparé à celui du navigateur. Désactiver le décalage du
précurseur donne `0.1871` ; une tolérance très serrée réduit les appariements.
Ce n'est ni une reproduction des performances GPU SimMS, ni une identification
chimique, ni une mesure de gain d'apprentissage.

Le visualiseur exige le dossier de revue : sa scène, son brief et son passage
doivent correspondre. Les sources, le code du visualiseur, le contexte public et
les entrées portent des hashes. Ceux-ci permettent de détecter des changements ;
ils ne sont pas une signature indépendante de l'exécution. Les observations
peuvent être téléchargées localement, sans notation ni soumission à Studium.

Pour adapter le visualiseur avec votre propre harnais, partir de
`examples/literature-experience/` et du contexte public. Ce dossier est un exemple
de code produit par le harnais, pas un nouveau moteur de rendu embarqué.

Pour prolonger la séance avec recherche web, skills de domaine, dépendances et
expériences comparées, suivre [le parcours d'exploration](grounded-exploration.md).
Il fournit un dossier portable lié à la scène, distinct des réponses et runs soumis.

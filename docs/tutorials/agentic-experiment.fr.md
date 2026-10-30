[English](agentic-experiment.md) · Français

# Une expérience scientifique avec son agent

Utilisez la liberté de votre harnais pour tester une idée, en restant lié à la scène, à ses preuves
et au contrat de réponse de Studium. L'enseignant fixe le périmètre ; l'étudiant choisit une
hypothèse et défend sa conclusion. Le résultat attendu : une prédiction, une comparaison
reproductible, une limite explicitée et un transfert argumenté vers un cas nouveau.

## Cas A : similarité spectrale et visualiseur sur mesure

Question proposée : « Une meilleure similarité après déplacement des pics suffit-elle à identifier
une molécule ? » L'exemple est un calcul illustratif sur des spectres synthétiques, relié à un
passage capturé de l'article SimMS. Il ne reproduit ni l'article ni une capsule ASB de nettoyage de
bibliothèque.

Pour rejouer le calcul, le visualiseur et l'audit technique (Node, Python et Chrome disponibles) :

```bash
.venv/bin/python tools/demo-grounded-exploration.py "$HOME/studium-demo-exploration"
```

Le script produit notamment `capsule/outputs/match.json`, `execution.json`, `audit/viewer/`,
`audit/report.json`, `exploration-receipt/` et `exploration-verification.json`. Il réutilise hors
ligne les passages capturés, exécute le calcul et teste le visualiseur. Les observations de cet
audit sont synthétiques, pas des réponses d'étudiant. Pour examiner le visualiseur :

```bash
.venv/bin/python -m http.server 8118 --bind 127.0.0.1 --directory "$HOME/studium-demo-exploration/audit/viewer"
```

Ouvrez `http://127.0.0.1:8118`, manipulez les contrôles et vérifiez que les valeurs changent de façon
cohérente. Le visualiseur est un artefact local externe ; il n'est pas installé dans le panneau
Studium. Arrêtez avec Ctrl-C.

## Cas B : une tâche réelle issue d'une capsule ASB

À partir d'une capsule fournie par l'enseignant, une tâche de nettoyage spectral peut devenir une
comparaison avant/après : quels spectres ont été rejetés, selon quels critères et avec quelles
conséquences sur l'analyse ? Lisez sa carte exacte, ses données et ses dépendances. Ne remplacez
jamais une tâche indisponible par l'exemple synthétique en lui donnant le nom du résultat réel.

Le harnais vérifie ses outils effectifs : accès aux fichiers, terminal, recherche web, Perspicacité
éventuel et skills de domaine. Un skill explique comment opérer ; sa présence n'installe ni
bibliothèque ni connecteur. Pour une question scientifique, lisez l'article et des sources
primaires ; pour coder ou installer, partez de la documentation officielle de la version choisie.
Gardez l'URL, la date, l'extrait utile et la raison de chaque choix.

## La boucle à suivre en séance

1. **Prédire.** L'étudiant formule l'effet attendu avant de voir les résultats.
2. **Exécuter une référence.** Le harnais réalise la tâche autorisée et conserve entrées, versions,
   commande et sorties réelles.
3. **Faire varier un facteur.** L'étudiant choisit un seuil ou une hypothèse ; la référence reste
   visible.
4. **Tester les limites.** Examiner au moins un cas limite et un résultat nul ou contradictoire.
   Vérifier unités et calculs, pas seulement l'apparence.
5. **Juger.** L'étudiant explique ce que l'expérience soutient, ce qu'elle ne démontre pas et quelles
   preuves supplémentaires seraient utiles.
6. **Transférer.** Appliquer le raisonnement à un cas nouveau, puis revenir à la réponse personnelle
   demandée par Studium.

Un prompt à adapter :

> Lis le contexte public de la scène et le skill Studium. Vérifie tes outils. Aide-moi à
> expérimenter sur [question], dans [périmètre de l'enseignant]. Demande d'abord ma prédiction.
> Propose l'environnement minimal et les sources officielles pertinentes ; utilise un skill de
> domaine si nécessaire. Exécute la référence, puis la variation que je choisis. Crée un visualiseur
> avec données, unités, référence et variante visibles. Teste les contrôles et un cas limite.
> Conserve les preuves et distingue `completed`, `failed` et `not_run`. Termine par une question de
> jugement et attends ma réponse ; ne soumets rien à ma place.

Préférez une ressource existante ou une spécification déclarative quand cela suffit. Un visualiseur
sur mesure se justifie lorsqu'une interaction répond à une question pédagogique précise. Installez
les bibliothèques dans un environnement propre à l'expérience et notez les versions ; un
environnement virtuel n'est pas un bac à sable de sécurité, et le harnais garde ses permissions
d'exécution habituelles.

## Respecter le protocole d'exécution

Pour une scène comportant une exécution, appelez `get_run_manifest`, réalisez réellement l'opération
autorisée, puis transmettez un `RunResult` conforme avec `submit_run_result`. Le skill
[`studium-harness`](../../skills/studium-harness/SKILL.md) et le
[protocole de séance agentique](../reference/agentic-session-protocol.fr.md) donnent les champs
actuels. Studium n'exécute pas la science à la place du harnais pendant l'étude. Dans VS Code,
**Studium : Exécuter la reproduction** montre ce qui va s'exécuter et demande votre confirmation ;
la demande revient dès que la commande, les paquets ou le fichier de leçon changent. Un recalcul
exploratoire dans un graphique n'est pas une nouvelle exécution attestée et ne doit pas remplacer
discrètement le résultat soumis.

## Conserver un dossier d'expérience portable

Enregistrez le JSON public de `get_operator_context` sous `current-context.json`, puis :

```bash
.venv/bin/python tools/experience_exploration.py prepare --context current-context.json --out new-experiment
```

Lisez `task.md` et le schéma généré. Complétez `experiment.json` avec la question, l'hypothèse, les
sources, les fichiers explicitement choisis, les actions et les contrôles ; le gabarit initial est
volontairement incomplet. Une action déclarée `completed` exige des preuves et des contrôles
réussis. Puis :

```bash
.venv/bin/python tools/experience_exploration.py seal --workspace new-experiment --out new-receipt
.venv/bin/python tools/experience_exploration.py verify new-receipt --context fresh-context.json
```

Le reçu vérifie l'intégrité des fichiers capturés et leur rattachement au contexte. Il ne prouve ni
la vérité scientifique, ni une exécution indépendante, ni un auteur humain, et il ne se soumet pas
comme `response.json` ou `run_result.json`. Les reçus ne sont pas encore intégrés à la revue MySTRA.
Ne conservez l'observation personnelle de l'étudiant qu'à sa demande ; elle est vide par défaut. Ces
fichiers restent hors de l'effacement de séance et de la télémétrie Studium. Pour les notes que le
moteur garde lui-même, voir le [journal d'expérience](../learn/experiment-journal.fr.md).

**Réussite pédagogique attendue :** une prédiction personnelle, une comparaison reproductible, une
limite explicite et un transfert argumenté. Que l'agent ait écrit du code ou produit un joli
graphique ne suffit pas.

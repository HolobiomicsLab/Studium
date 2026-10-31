[English](experiment-journal.md) · Français

# Journal d'expérience

Avant de lancer une expérience, notez ce que vous attendez et pourquoi. Ensuite, notez ce que vous avez vu et
ce que vous en concluez. Studium garde ces quatre entrées dans un journal privé, à côté de la leçon, avec vos
propres mots, pour que vous puissiez confronter votre raisonnement initial à ce qui s'est passé.

Le journal **n'est pas noté**, ne fait pas avancer la leçon et n'entre jamais dans les analyses de
l'enseignant. L'assistant vous demande vos mots et votre accord pour les enregistrer ; il ne doit pas les
écrire à votre place.

## Les quatre étapes

| Étape | Vous enregistrez | Règle |
|---|---|---|
| `predict` | Votre prédiction, votre raison et votre confiance (0 = pas confiant, 4 = très confiant) | En premier |
| `begin` | Rien : l'étape marque le moment qui précède toute exécution ou tout résultat affiché | Seulement après une prédiction |
| `observe` | Ce que vous avez observé, et éventuellement les résultats consultés (`evidence_refs`) | Après `begin` |
| `conclude` | Ce que les observations établissent ou non, si elles ont changé votre raisonnement, et votre confiance | En dernier |

Une entrée enregistrée est définitive ; renvoyer la même entrée ne change rien. Pour une nouvelle tentative,
prenez un nouvel identifiant d'expérience plutôt que de réécrire votre première prédiction. Une observation ou
une conclusion peut venir dans une scène ultérieure de la même leçon, avec le même identifiant ; la scène de la
prédiction reste rattachée.

## Avec un assistant (MCP)

L'assistant appelle `record_experiment` avec l'identifiant de séance, celui de la scène en cours et une
entrée, puis `get_experiment_journal` pour relire vos entrées. Une prédiction a cette forme ; les champs à
remplir attendent vos mots, jamais une réponse d'exemple :

```json
{
  "kind": "predict",
  "experiment_id": "network-threshold-1",
  "prediction": "<ma prédiction>",
  "justification": "<ma raison>",
  "confidence": 2,
  "authorship": "learner",
  "consent": true
}
```

`begin` ne demande que `kind` et `experiment_id`. `observe` prend `text` et, au besoin, `evidence_refs` (des
chaînes qui désignent les résultats consultés) ; `conclude` prend `text` et `confidence`. Les deux reprennent
`authorship: "learner"` et `consent: true`. Les références de preuve sont des liens que vous fournissez :
Studium ne les vérifie pas.

## Avec le canal fichier

Quand une leçon passe par le canal fichier (le lanceur de séance en mode veille, voir le
[protocole de séance agentique](../reference/agentic-session-protocol.fr.md)), écrivez un
`experiment-action.json` complet dans son dossier `.studium-session`, de façon atomique :

```json
{
  "session_id": "<identifiant de séance lu dans task.md>",
  "scene_id": "<identifiant de scène lu dans task.md>",
  "input": { "kind": "begin", "experiment_id": "network-threshold-1" }
}
```

Remplacez `input` par chaque entrée à son tour, en commençant par `predict`. Le lanceur consomme le fichier,
écrit `experiment.json` (schéma `studium/experiment-journal/v1`) et un court `feedback.md`, puis continue
d'attendre : une entrée de journal ne soumet jamais une réponse de leçon. Pour cela, utilisez `response.json`
ou `run_result.json`. Une enveloppe avec un ancien identifiant de séance ou de scène est refusée. Chaque entrée
compte comme un pas dans le budget du lanceur : prévoyez quatre pas de plus par expérience.

Ce journal est distinct de l'enregistrement de provenance scientifique de `tools/experience_exploration.py` ;
gardez l'espace de travail de cet outil dans un dossier à part.

## Reprise, stockage et confidentialité

Le journal est enregistré sur disque, dans votre dossier de données privé, par apprenant et par révision de la
leçon, à deux conditions : la progression est durable (le cas par défaut ; voir
[réviser dans la durée](review-over-time.fr.md#où-sont-vos-données)) et l'assistant transmet un identifiant
d'apprenant explicite. Avec les identifiants partagés par défaut `anonymous` ou `agent-operator`, un
identifiant vide ou `STUDIUM_EPHEMERAL=1`, il reste en mémoire et son champ `storage` vaut `ephemeral`. Le
journal d'une séance de révision n'est jamais enregistré sur disque.

Pour reprendre, relancez la même leçon avec le même identifiant et le même dossier de données, par MCP ou par
fichiers ; la nouvelle séance a un nouvel identifiant de séance. Une leçon modifiée ouvre un nouveau journal :
les entrées précédentes ne sont pas réétiquetées.

- Oublier vos données pour une leçon (`forget_session`) efface ses journaux pour toutes ses révisions. Les
  copies déjà exportées dans un dossier du harnais ou une conversation doivent être supprimées là-bas.
- Ne versionnez ni ne partagez `experiment.json` ; gardez le dossier de séance privé.
- Ces outils locaux n'ajoutent aucune authentification : un déploiement partagé doit protéger les
  identifiants de séance et l'accès au stockage.
- Un fichier de verrou refuse deux écritures simultanées. Après un plantage, vérifiez que rien n'écrit avant de
  supprimer un `experiments/.lock` resté en place.

Le journal enregistre l'ordre des entrées et l'autorat que vous déclarez. Il ne peut prouver ni que personne
ne vous a aidé, ni qui a tapé le texte, ni que vous avez appris. Son but est de rendre votre raisonnement
visible pour vous.

## S'exercer dans le visualiseur de spectres lié

Un exemple local relie un réseau moléculaire synthétique, une paire de spectres en miroir et une table de
candidats par des identifiants de nœuds partagés. Il fait distinguer le changement d'un seuil d'arête du
changement des preuves. Une similarité entre candidats n'est pas une identification de composé.

1. Écrivez une prédiction : abaisser le seuil change-t-il les nœuds, les arêtes, les deux ou rien ? Les
   calculs restent cachés tant que votre prédiction est vide.
2. Révélez le réseau et comparez la référence enregistrée (0,65) aux préréglages « nouvelles arêtes » (0,64)
   et « aucun changement d'arête » (0,70). Les arêtes de référence restent visibles en pointillés ; un seuil
   filtre les arêtes (`score >= seuil`) et ne retire jamais de nœud.
3. Sélectionnez un nœud au pointeur, ou atteignez-le avec Tab puis Entrée ou Espace : le même identifiant est
   sélectionné dans le réseau, le titre du miroir et la ligne de candidat.
4. Écrivez une observation et une conclusion. Rien n'est noté, enregistré ni soumis.
5. Appuyez sur **Export my notes** seulement si vous voulez une copie JSON locale.

Les notes du visualiseur sont distinctes du journal. Si vous utilisez les deux, enregistrez votre prédiction
dans le journal avant de révéler les calculs, et ne présentez jamais après coup une note exportée comme si elle
avait été enregistrée d'abord. Les scores illustrent un calcul (cosinus modifié glouton, un pour un, tenant
compte du précurseur, sur intensités normalisées L2) ; ils n'établissent ni identité ni nouveauté, et déplacer
le seuil n'est pas une nouvelle exécution.

### Construire le visualiseur (enseignants)

Produisez les spectres, le résultat d'exécution, le contexte opérateur public et le dossier de relecture
vérifié avec la [démarche littérature et preuves](../teach/literature-and-evidence.fr.md), puis :

```bash
node examples/literature-experience/build-viewer.mjs \
  SPECTRA_JSON RESULT_JSON OPERATOR_CONTEXT_JSON CHECKED_REVIEW_DIR NEW_OUTPUT_DIR [NETWORK_JSON]
python3 -m http.server 8118 --bind 127.0.0.1 --directory NEW_OUTPUT_DIR
```

Le réseau par défaut est `examples/literature-experience/linked-network.json`. Un autre réseau synthétique
relu par un enseignant doit porter un `generation_brief` (`learning_goal`, `inputs`, `reference_calculation`,
`allowed_parameters`, `hidden_information`, `cross_view_questions`, `learner_sequence`, `export_policy`) et des
identifiants de nœuds uniques, partagés par `nodes` et `candidates` ; gardez au moins un changement de paramètre
qui modifie les arêtes et un qui ne les modifie pas. Le constructeur refuse les données mal formées ou non
synthétiques et enregistre l'empreinte du réseau dans `viewer-provenance.json`. Vérifications :

```bash
.venv/bin/python -m pytest -q tools/test_linked_viewer_numeric.py tools/test_linked_viewer_build.py tools/test_experience_viewer_inputs.py
```

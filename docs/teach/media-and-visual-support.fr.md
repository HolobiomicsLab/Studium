[English](media-and-visual-support.md) · Français

# Médias et supports visuels

Vous pouvez donner à une leçon les figures, équations, cartes conceptuelles, photographies et courts
extraits audio ou vidéo qui aident les étudiants à raisonner, chacun avec sa source et ses droits
consignés. Vous préparez les médias réutilisables une fois ; un étudiant peut aussi demander un
nouveau support à son assistant pendant une séance. L'objectif d'apprentissage, l'attribution et la
réponse propre de l'étudiant restent toujours séparés des médias, et aucun modèle d'image, d'audio ou
de vidéo n'est nécessaire pour terminer une activité.

Le skill `studium-visual-support` guide un assistant dans ce travail
(voir [skills](../start/skills.fr.md)). Les options de langue et la notation scientifique côté
étudiant sont dans [langue et supports](../learn/language-and-supports.fr.md).

## Ce qui fonctionne aujourd'hui

| Besoin | État |
|---|---|
| Figures, SVG, équations, graphiques, tableaux, spectres, molécules 3D, audio, vidéo | Le contrat des ressources de leçon (`render_assets`) ; le panneau VS Code en affiche le plus large éventail, les autres surfaces moins : testez celle que vous utilisez |
| Une figure locale dans un dossier de leçon | Résolue depuis le dossier de la leçon ; un fichier situé hors de ce dossier, même par un lien symbolique, est refusé : copiez-le dans `assets/` |
| Diagrammes Mermaid | Rendus localement dans les modèles d'activités (`--supports`) ; affichés en texte source dans MySTRA |
| Une nouvelle image pendant une séance | Seulement si l'assistant de l'étudiant dispose réellement d'un outil d'image |
| Supports générés d'après l'historique d'un étudiant | Non implémenté ; le contexte public de la scène exclut cet historique |

## Trois sortes de figures

**Figure de source.** Conservez le fichier, sa légende, le DOI ou l'identifiant de capsule, la page et
le panneau, et tout recadrage. Notez provenance et statut de réutilisation avant d'en distribuer une
copie. Une lecture multimodale d'une figure reste une interprétation à vérifier.

**Graphique calculé.** Tracez-le à partir des données réellement utilisées, avec script, paramètres,
unités et contrôles. Utilisez un outil de tracé ou un `plot_spec` quand les valeurs exactes comptent.
Gardez les échecs et les résultats nuls.

**Support explicatif généré.** Une carte conceptuelle, une analogie visuelle ou un résumé schématique
peut synthétiser une difficulté. Signalez-le comme généré et conservez la source originale à part :
des pixels générés ne sont ni une mesure, ni une validation, ni un résultat de capsule.

[`examples/visual-support/figure-asset.json`](../../examples/visual-support/figure-asset.json) montre
une ressource `image` à placer dans `scene.render_assets`, le vrai fichier étant dans le dossier
`assets/` de la leçon.
[`examples/visual-support/concept-map.mmd`](../../examples/visual-support/concept-map.mmd) est une
carte conceptuelle Mermaid ; son texte sert aussi d'alternative accessible. Là où aucun moteur Mermaid
n'est disponible, livrez une image PNG passive rendue à partir d'elle et gardez le `.mmd` à côté.

## Différencier sans étiqueter les étudiants

Utilisez deux axes indépendants : la familiarité avec le domaine et la familiarité avec la méthode ou
l'outil. Un court résumé dans les mots de l'étudiant suffit souvent : « Je connais les spectres, je
découvre les réseaux moléculaires, je confonds similarité et identité. » Si l'assistant ne fait que
supposer une difficulté, il la présente comme une hypothèse et la vérifie par une courte question.

| Situation | Support possible | Vérification suivante |
|---|---|---|
| Axes ou unités mal lus | Figure originale avec repères textuels et un exemple simple | Lire un autre point ou panneau |
| Similarité confondue avec identité | Carte des relations et contre-exemple sourcé | Dire ce que le score ne prouve pas |
| Méthode difficile à suivre | Schéma des entrées, opérations et sorties | Repérer où intervient une hypothèse |
| Grande familiarité | Vue compacte, hypothèses et cas limites | Une nouvelle variation choisie par l'étudiant |

Un format préféré n'est pas un « style d'apprentissage » fixe, et les erreurs ne doivent pas devenir
un profil médical ou psychologique. Ne modifiez jamais le barème en silence.

## Préparer des médias pour un cours

Choisissez le rôle avant le format :

| Rôle | Exemple | Placement |
|---|---|---|
| Observation première | Photographie d'un objet archéologique | `before_prediction` |
| Orientation | Courte introduction sans la réponse | `before_prediction` |
| Explication | Carte conceptuelle, schéma annoté, analogie commentée | `after_prediction` (par défaut) |

Une photographie, son annotation et une reconstitution générée sont des objets différents ; une
reconstitution ne doit jamais passer pour une preuve documentaire.

1. Choisissez la source et l'intention, examinez l'image réelle ou écoutez l'extrait en entier, et
   rédigez une alternative textuelle utile.
2. Écrivez un fichier de supports : `kind` (`image`, `audio` pour WAV ou MP3, `video` pour MP4 ou
   WebM), `path`, `provenance`, `meta.alt` et `meta.placement` ; `meta.origin` vaut `source` ou
   `generated`.
3. Pour l'audio et la vidéo, ajoutez `meta.rights` (`creator`, `license`, `evidence_url`, `scope` =
   `private`, `course` ou `public`) et `meta.transcript` ; la vidéo exige aussi un `meta.captions_path`
   WebVTT et `meta.captions_language`.
4. Construisez l'activité avec `--supports SUPPORTS.json` (voir [modèles d'activités](activity-templates.fr.md))
   et relisez le résultat avant la séance.

Les chemins des médias doivent rester sous le dossier du fichier de supports. Limites : 5 Mio par
image, 20 Mio par fichier audio ou vidéo et 30 Mio au total. Les contrôles portent sur les signatures
de fichiers, les métadonnées et la taille, pas sur la vérité scientifique, la libération des droits ni
la compatibilité des codecs. L'[exemple archéologique](../../examples/archaeology/README.md) montre une
photographie de musée placée avant la prédiction.

## Un étudiant demande un nouveau support

```bash
.venv/bin/python tools/media_workflow.py prepare \
  --activity ACTIVITY --brief examples/media/teacher-brief.json --out ACTIVITY/media-request.json
```

La demande ne dépend d'aucun fournisseur : une consigne, la sortie attendue, une alternative
textuelle et les références des sources, liées à l'identité et à l'empreinte de l'activité, plus une
copie `.txt` à télécharger. Elle ne lit aucun fichier privé de l'apprenant et n'appelle aucun modèle.
L'assistant vérifie de quels outils de génération il dispose réellement, ne transmet que le contexte
nécessaire, jamais l'historique privé ni les clés de réponse, et consigne l'outil et la consigne
effectivement utilisés dans le reçu d'exploration. Après relecture de la sortie :

```bash
.venv/bin/python tools/media_workflow.py attach --request ACTIVITY/media-request.json \
  --media RETURNED_FILE.png --source-metadata SOURCE_METADATA.json --out ENRICHED_ACTIVITY
```

Ajoutez `--transcript` pour l'audio ou la vidéo et `--captions` pour la vidéo. Le rattachement écrit un
nouveau dossier avec la même identité d'activité et consigne les empreintes du parent, de la demande et
du média ; l'activité d'origine et les fichiers de l'apprenant restent intacts. Une séance déjà ouverte
dans le navigateur n'est pas rechargée : exportez d'abord sa trace.

## Accessibilité et droits

Les lecteurs ont des commandes natives, sans lecture automatique ni préchargement ; un média généré
porte un avertissement visible sur ses inexactitudes possibles. Proposez une image fixe ou une version
texte et gardez les consignes essentielles hors du média. N'inférez ni handicap ni trait durable à
partir d'une seule erreur. Sous-titres et transcriptions aident, mais n'établissent pas la conformité :
faites relire par de vrais utilisateurs, avec les
[recommandations du W3C sur l'accessibilité des médias](https://www.w3.org/WAI/media/av/).

Les champs de droits sont un enregistrement consultable, pas une certification juridique. L'usage
privé n'est pas une exemption générale : en France, l'exception de copie privée suppose notamment une
source licite et un usage strictement privé, et la diffusion à un cours relève d'un autre périmètre
([article L122-5 du Code de la propriété intellectuelle](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048603495/2026-04-11)).
Une source avec `license: "unknown"` et `scope: "private"` consigne une incertitude ; elle n'autorise
ni à la publier ni à l'envoyer à un fournisseur de modèles.

## Vérifier les médias dans le navigateur

```bash
pnpm --filter @studium/activity-presentation build
.venv/bin/python tools/prepare_media_audit.py --out .studium-session/media-check
node tools/audit-media-presentation.mjs .studium-session/media-check/activity .studium-session/media-check/audit
```

Il faut ffmpeg et Playwright avec Chrome. La commande construit une activité avec une photographie de
musée et de courts extraits synthétiques, puis vérifie lecture, sous-titres, placement, téléchargement
de la consigne et mise en page dans `report.json`. Elle ne génère aucun extrait par IA et n'évalue pas
l'apprentissage. Utilisez un nouveau dossier de sortie à chaque fois.

Code : [`tools/activity_support.py`](../../tools/activity_support.py),
[`tools/media_workflow.py`](../../tools/media_workflow.py).

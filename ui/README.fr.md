[English](README.md) · Français

# Ressources d'interface partagées

Du CSS et du JavaScript simples, partagés par plusieurs surfaces, sans étape de construction : le
catalogue d'aide contextuelle et son moteur de rendu, le moteur de rendu scientifique pour les formules,
diagrammes et médias, l'outil de langue des activités, et les feuilles de style de l'Observatory.
L'identité visuelle canonique se trouve dans [`design/`](../design/README.fr.md) ; ce dossier contient les
copies et les outils qui doivent se charger sans elle.

| | |
|---|---|
| Statut | **maintenu** |
| Lancer | rien à lancer ; importé par les applications et empaqueté par [`@studium/activity-presentation`](../packages/activity-presentation/README.fr.md) |
| Tests | `node --test ui/activity-language.test.mjs` ; `.venv/bin/python -m pytest tools` couvre le catalogue d'aide |

## Fichiers

| Fichier | Rôle | Utilisé par |
|---|---|---|
| `context-help.json`, `context-help.mjs`, `context-help.css`, `context-help-runtime.js`, `context-help.d.mts` | les rubriques d'aide rédigées (français et anglais, étudiant et enseignant) et leur rendu HTML échappé | `@studium/activity-presentation` (tableau de bord enseignant, author-web, application apprenant), panneau VS Code, `tools/contextual_help.py` |
| `scientific-support.mjs`, `scientific-support.css` | afficher formules, diagrammes, molécules et médias préparés avec des bibliothèques locales | `@studium/activity-presentation`, visionneuses d'activité |
| `activity-language.mjs` | traduire les textes de présentation d'une visionneuse d'activité sans toucher à ses contrôles ni à ses données | activités exportées par `tools/experience_templates.py` |
| `studium-tokens.css` | copie hors ligne des jetons de design | Observatory |
| `studium-theme.css` | thème de compatibilité gelé | Observatory, activités exportées et rapports d'apprenant |
| `studium-theme-current.css` | surcouche de l'Observatory fondée sur les jetons | Observatory |
| `sync-studium-tokens.mjs` | régénère `studium-tokens.css` à partir de `design/tokens.css` | mainteneurs |

## Jetons de design pour l'Observatory

`design/tokens.css` est la version canonique des jetons. L'Observatory ne peut ni servir ni importer ce
chemin du dépôt à l'exécution : `studium-tokens.css` en est une copie hors ligne déterministe.

```bash
node ui/sync-studium-tokens.mjs --check
node ui/sync-studium-tokens.mjs --write
```

Le générateur retire les zéros initiaux des valeurs CSS fractionnaires (`0.5rem` devient `.5rem`) ; la
valeur calculée est inchangée. Cela garde les valeurs de télémétrie retenues hors du texte de la page,
car les contrôles de confidentialité de l'Observatory parcourent tout le HTML, styles en ligne compris.

L'Observatory charge trois couches dans cet ordre :

1. `studium-tokens.css`, généré à partir des jetons canoniques ;
2. `studium-theme.css`, le thème de compatibilité gelé ;
3. `studium-theme-current.css`, la surcouche de l'Observatory fondée sur les jetons.

Ne réécrivez pas `studium-theme.css` sur place. La vérification des rapports d'apprenant portables
reconstruit exactement l'ancien HTML, cette feuille de style comprise. Un nouveau thème portable demande
une nouvelle génération de moteur de rendu, en conservant l'ancien moteur et son CSS. La surcouche
actuelle peut évoluer librement, car elle n'est pas intégrée à ces exports historiques.

Les trois fichiers sont locaux et ne contiennent aucune URL de police ni de ressource. La surcouche
actuelle utilise la palette sombre des jetons via `prefers-color-scheme`, force la palette claire à
l'impression, garde un focus clavier visible et prévoit des replis pour les couleurs forcées.

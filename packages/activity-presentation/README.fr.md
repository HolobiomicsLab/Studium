[English](README.md) · Français

# @studium/activity-presentation

Des éléments de présentation partagés par les interfaces web de Studium. Il fournit un composant React `ContextHelp`, qui affiche une aide contextuelle rédigée à l'avance dans un volet dépliable natif, et construit `dist/support.js`, un script autonome qui affiche hors ligne les formules (KaTeX), les schémas (Mermaid) et les molécules (SmilesDrawer) dans la visionneuse d'activités HTML. Voir [médias et supports visuels](../../docs/teach/media-and-visual-support.fr.md).

## Place dans l'ensemble

Une fine couche sur des fichiers partagés de [`ui/`](../../ui/README.md) : le catalogue d'aide et son rendu (`ui/context-help.json`, `ui/context-help.mjs`) et le rendu scientifique (`ui/scientific-support.mjs`). Le tableau de bord enseignant, l'application élève et author-web importent le composant ; `tools/experience_templates.py` insère le script construit dans les activités exportées. Voir l'[architecture](../../docs/develop/architecture.fr.md).

## API publique

| Point d'entrée | Rôle |
|---|---|
| `@studium/activity-presentation/react` → `ContextHelp({ topic, audience?, language? })` | L'aide d'un sujet du catalogue ; `audience` vaut `student` (par défaut) ou `teacher`, `language` vaut `fr` (par défaut) ou `en`. Échap referme une aide ouverte et rend le focus à son bouton. |
| `dist/support.js` (construit) | Définit `window.StudiumSupport` avec `render(container, assets)` et `renderMath(element)`. |

## Exemple

```tsx
import { ContextHelp } from "@studium/activity-presentation/react";

export function Header() {
  return <ContextHelp topic="confidence" audience="student" language="fr" />;
}
```

`topic` est une clé de `ui/context-help.json` (par exemple `confidence`, `evidence`, `provenance`, `mastery`). Pour construire les moteurs de rendu hors ligne :

```bash
pnpm --filter @studium/activity-presentation build
```

## Invariants

- Ouvrir l'aide n'envoie ni n'enregistre aucune réponse.
- Le script construit fonctionne sans réseau : les polices KaTeX sont intégrées, et les licences des moteurs embarqués figurent dans son en-tête.
- Le rendu des formules ignore `script`, `style`, `textarea`, `pre` et `code`, et lance KaTeX avec `trust: false`.
- Une activité exportée qui a besoin de formules ou de ressources de rendu échoue avec un message clair tant que le script n'est pas construit.

## Tests

```bash
pnpm --filter @studium/activity-presentation test
```

Cette commande exécute `ui/activity-language.test.mjs`, le changement de langue de la visionneuse d'activités, avec jsdom.

## Dépendances

- Dépend de : React 18 (dépendance de type *peer*) ; à la construction `esbuild`, `katex`, `mermaid`, `smiles-drawer` ; en test `jsdom`.
- Utilisé par : `apps/teacher-dashboard`, `apps/student-runtime`, `apps/author-web`, `tools/experience_templates.py`.

## Statut

Actif. Paquet privé de l'espace de travail, non publié sur npm.

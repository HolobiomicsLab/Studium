[English](docs-style.md) · Français

# Rédiger la documentation

Cette page s'adresse à toute personne qui ajoute ou modifie une page sous `docs/`. Elle indique le dossier
de chaque page, la règle bilingue, un modèle de page, le style maison, et les deux commandes qui gardent
justes les pages de référence et les liens.

## Où ranger une page

| Dossier | Lecteur | Contenu |
|---|---|---|
| `docs/start/` | tout le monde | installer, connecter un assistant, premiers pas |
| `docs/learn/` | étudiants et apprenants autonomes | apprendre et réviser avec Studium |
| `docs/teach/` | enseignants | écrire, relire et approuver une leçon, suivre une classe |
| `docs/tutorials/` | tout le monde | une tâche complète, du début au résultat |
| `docs/concepts/` | tout le monde | comment Studium fonctionne et pourquoi ; le [glossaire](../concepts/glossary.fr.md) |
| `docs/reference/` | développeurs et utilisateurs avancés | outils, format de bundle, configuration, CLI, API HTTP |
| `docs/develop/` | contributeurs | architecture, tests, publication, cette page |
| `docs/design-records/` | mainteneurs | spécifications, ADR, audits ; archives, voir [l'index](../design-records/index.fr.md) |
| `docs/internal/` | mainteneurs et agents | le journal des agents et l'historique des passations |

Le portail [docs/index.fr.md](../index.fr.md) relie le parcours de chaque lecteur ; une nouvelle page reçoit
un lien depuis le portail ou depuis une page qu'il relie déjà.

## Deux langues, une structure

Chaque page sous `docs/` existe deux fois : `page.md` en anglais et `page.fr.md` en français. Les deux ont
les mêmes titres dans le même ordre, les mêmes tableaux et les mêmes commandes. La page française est
rédigée dans un français naturel et vouvoie le lecteur ; ce n'est pas une traduction mot à mot.

La première ligne de chaque page est le sélecteur de langue, exactement :

```markdown
English · [Français](page.fr.md)
```

sur la page anglaise, et sur la page française :

```markdown
[English](page.md) · Français
```

Trois exceptions :

- `docs/design-records/` garde chaque document dans sa langue d'origine ; seul son index existe en deux
  versions.
- `docs/internal/` est un matériau de travail en une seule langue.
- Dans une page de référence générée, les tableaux générés restent en anglais dans les deux versions ; le
  texte qui les entoure est traduit.

Le README racine suit la même règle (`README.md` et `README.fr.md`).

## Modèle de page

~~~markdown
[English](ma-page.md) · Français

# Un titre qui nomme la tâche ou le sujet

Une ou deux phrases : ce que le lecteur peut faire avec cette page et ce qu'il obtient.

## Avant de commencer

Ce qui doit être installé ou connu, avec des liens.

## Faire la tâche

1. Une étape.
2. Une étape, avec la commande :

   ```bash
   pnpm --filter @studium/lesson-mcp start
   ```

## Ce que vous obtenez

Le résultat, et comment le vérifier.

## Limites

Ce que cela ne fait pas, dit une fois.
~~~

## Style maison

- Commencez par ce que le lecteur peut faire et par le résultat. Un seul H1, puis H2 et H3 uniquement.
- Visez 60 à 200 lignes. Découpez une page plus longue par tâche.
- Un tableau pour des faits parallèles, un bloc `bash` pour les commandes. Les commandes se copient telles
  quelles et utilisent des chemins relatifs au dépôt, jamais un chemin de votre machine.
- Expliquez un terme à sa première occurrence ou renvoyez au [glossaire](../concepts/glossary.fr.md).
- Pas d'emoji, pas d'emphase publicitaire, pas de dates qui vieilliront. « Depuis <version> » convient
  quand c'est utile.
- Énoncez une limite simplement, une fois, là où le lecteur en a besoin.
- Ne documentez que ce que fait le code. Avant d'écrire une commande, une option, un outil ou une valeur
  par défaut, trouvez-la dans le code. Quand une fonction disparaît, sa documentation part avec elle.

## Liens et images

Reliez pages et code par des chemins relatifs, par exemple `[tests](testing.fr.md)` ou
`[server.ts](../../apps/lesson-mcp/src/server.ts)`. Les images sont dans `docs/assets/`. Quand une image
existe en version claire et sombre, utilisez les deux, avec un texte alternatif qui dit ce que montre
l'image :

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/diagrams/architecture-dark.svg">
  <img src="../assets/diagrams/architecture-light.svg" alt="Ce que montre le schéma, en une phrase.">
</picture>
```

## Pages de référence générées

Une partie de `docs/reference/` est écrite par des scripts à partir du code. La partie générée d'une page
se trouve entre deux marqueurs ; tout ce qui est en dehors s'écrit à la main et reste modifiable dans les
deux langues :

```markdown
<!-- BEGIN GENERATED: mcp-tools (tools/docs/gen-mcp-tools.mjs; do not edit by hand) -->
<!-- END GENERATED: mcp-tools -->
```

| Script | Pages | Source |
|---|---|---|
| [`tools/docs/gen-mcp-tools.mjs`](../../tools/docs/gen-mcp-tools.mjs) | `docs/reference/mcp-tools.md` et `.fr.md` | le serveur MCP en marche : outils, champs d'entrée, prompts, instructions |
| [`tools/docs/gen-lesson-bundle.mjs`](../../tools/docs/gen-lesson-bundle.mjs) | `docs/reference/lesson-bundle.md` et `.fr.md` | les schémas Zod de `packages/lesson-bundle-schema` |

Après avoir modifié un outil ou le schéma de bundle, régénérez et committez le résultat avec la
modification du code :

```bash
node tools/docs/gen-mcp-tools.mjs
node tools/docs/gen-lesson-bundle.mjs
node tools/docs/gen-mcp-tools.mjs --check     # sort 1 quand une page n'est plus à jour
```

Les générateurs exécutent le code avec le `tsx` de l'espace de travail et `STUDIUM_EPHEMERAL=1` : il faut
avoir lancé `pnpm install`, et aucun état d'apprenant n'est écrit.

## La vérification de la documentation

[`tools/docs/check.mjs`](../../tools/docs/check.mjs) est la porte de la documentation. Lancez-la avant
d'ouvrir une pull request :

```bash
node tools/docs/check.mjs                     # tout ; sort 1 au moindre problème
node tools/docs/check.mjs --skip-generated    # liens et paires seulement, sans exécuter TypeScript
node --test tools/docs/check.test.mjs         # les tests de la vérification elle-même
```

Elle vérifie que :

1. chaque lien relatif et chaque `#ancre` de chaque fichier Markdown du dépôt aboutit ;
2. chaque page sous `docs/`, hors `design-records/` et `internal/`, a sa jumelle anglaise ou française ;
3. chaque outil enregistré par le serveur MCP a sa section dans `docs/reference/mcp-tools.md` ;
4. les régions générées correspondent au code ;
5. la première ligne de chaque page qui a une jumelle, et celle du `README` racine, est la ligne de
   sélection de langue (`English · [Français](page.fr.md)` ou `[English](page.md) · Français`) ;
6. chaque page de `docs/start`, `learn`, `teach`, `tutorials`, `concepts`, `reference` et `develop` est
   liée depuis `docs/index.md` (pages anglaises) ou `docs/index.fr.md` (pages françaises) ;
7. une image dont le nom se termine par `-light` a sa jumelle `-dark` sur le disque, et inversement, et
   chaque image a un texte alternatif. Une image à thème unique est déclarée dans `SINGLE_THEME_IMAGES`
   de `check.mjs`, avec la raison ;
8. à titre d'avertissement seulement, sans effet sur le code de sortie : une page de `docs/` de plus de
   200 lignes est signalée avec son nombre de lignes (les pages à région générée sont ignorées).

Elle ne vérifie ni que les deux versions disent la même chose, ni qu'une commande fonctionne. Cela
revient au relecteur.

## Construire le site

[`tools/docs/build-site.mjs`](../../tools/docs/build-site.mjs) rend les mêmes pages sous la forme d'un
petit site statique, dans l'identité du projet : un menu latéral, un sommaire, une zone de recherche, un
bouton pour copier chaque bloc de code, les deux langues, des thèmes clair et sombre, une mise en page
pour l'impression.

```bash
pnpm docs:site                                # écrit site/ à la racine du dépôt
node tools/docs/build-site.mjs --out /tmp/studium-docs --revision v0.5.0
node --test tools/docs/build-site.test.mjs    # les tests du générateur
```

Il lit `README.md`, `README.fr.md` et chaque page de `docs/` sauf `design-records/` et `internal/`, place
les pages anglaises à la racine et les pages françaises sous `fr/`, et construit la navigation à partir
du portail (le tableau des rôles, puis les groupes de « Toutes les pages »). Les liens vers d'autres
fichiers du dépôt, comme le code source, mènent à GitHub. Il n'a besoin d'aucun accès réseau, ni pour
construire ni pour lire le résultat, et il sort 1 quand un lien ou une ancre du site construit ne mène
nulle part. `--revision` nomme en pied de page la version ou le commit dont le site est construit.

La recherche n'a besoin d'aucun serveur : le générateur écrit un index par langue (`search-index.js` et
`fr/search-index.js` : les titres, les intertitres et le texte de chaque page sans ses blocs de code),
chargé quand la zone de recherche reçoit le focus pour la première fois. Elle ignore la casse et les
accents, et `/` place le focus dans la zone.

Le site s'ouvre depuis le système de fichiers et depuis n'importe quel sous-chemin. Le flux
[`docs-site.yml`](../../.github/workflows/docs-site.yml) le construit à chaque envoi sur `main` qui
touche la documentation et le publie sur GitHub Pages, une fois Pages activé dans les réglages du dépôt
avec « GitHub Actions » comme source.

`site/` n'est pas versionné. Le Markdown est la source : écrivez et vérifiez chaque page d'abord pour
GitHub, où elle doit aussi bien se lire.

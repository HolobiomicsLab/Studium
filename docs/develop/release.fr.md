[English](release.md) · Français

# Publication

Une version de Studium est une étiquette Git `vX.Y.Z` qui construit deux fichiers et les joint à une
release GitHub en brouillon : l'extension VS Code (`.vsix`) et le serveur MCP autonome (`lesson-mcp.cjs`).
Cette page explique la numérotation, d'où viennent ces fichiers entre deux versions, et comment en publier
une.

## Contenu d'une version

| Fichier | Ce que c'est | Construit par |
|---|---|---|
| `studium-vX.Y.Z.vsix` | l'extension VS Code, avec le serveur MCP, les bibliothèques des viewers et l'interface française et anglaise | `pnpm --filter studium-vscode package` |
| `lesson-mcp.cjs` | le serveur MCP en un seul fichier Node autonome, pour tout assistant | `apps/studium-vscode/dist/lesson-mcp.cjs`, le même fichier que celui embarqué dans le VSIX |
| `SHA256SUMS.txt` | empreintes des deux fichiers | le workflow de publication |

Le même workflow publie sur chaque registre dont le jeton est un secret du dépôt, et saute les autres :

| Secret | Registre | Ce qu'il reçoit |
|---|---|---|
| `VSCE_PAT` | Visual Studio Marketplace, éditeur `holobiomicslab` | le VSIX |
| `OVSX_PAT` | Open VSX Registry, espace `holobiomicslab` (VSCodium, Cursor, Gitpod) | le VSIX |
| `NPM_TOKEN` | npm, paquet `studium-mcp` | le fichier du serveur, préparé par [`.github/scripts/stage-npm-mcp.mjs`](../../.github/scripts/stage-npm-mcp.mjs) sans dépendance d'exécution et avec une attestation de provenance |

Avec `studium-mcp` sur npm, un assistant lance le serveur par `npx -y studium-mcp`. Chaque fichier porte la
licence du dépôt : Apache 2.0, avec `LICENSE` et `NOTICE` dans le VSIX et dans le paquet npm.

## Numérotation

- **Une seule version du produit.** La version publiée est le champ `version` de
  [`apps/studium-vscode/package.json`](../../apps/studium-vscode/package.json). Le workflow refuse une
  étiquette qui ne lui correspond pas.
- **Gardez tous les manifestes au même numéro.** Le serveur annonce aux clients MCP le `version` de
  [`apps/lesson-mcp/package.json`](../../apps/lesson-mcp/package.json), et `get_server_info` y ajoute
  l'origine, la date et le commit de construction. La même version du produit est inscrite dans
  [`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json) et dans [`server.json`](../../server.json),
  deux fois dans ce dernier : le `version` de l'entrée et celui du paquet npm.
  [`apps/lesson-mcp/src/distribution.test.ts`](../../apps/lesson-mcp/src/distribution.test.ts) échoue quand
  l'extension, le plugin ou `server.json` diffère de la version du serveur.
- **Versionnage sémantique, en 0.x pour l'instant.** Tant que la version commence par `0.`, une version
  mineure peut changer les entrées ou sorties d'un outil ; dites-le dans le changelog. Un correctif répare
  un comportement sans changer de contrat.
- **Les autres paquets de l'espace de travail** sont privés et jamais publiés. Leur champ `version` ne suit
  pas celui du produit.
- **Le format de leçon a sa propre version.** Le `schema_version` d'un bundle (actuellement `1.4`, dans
  [`packages/lesson-bundle-schema`](../../packages/lesson-bundle-schema/src/index.ts)) ne change que si le
  format change, indépendamment des versions publiées.

## Changelog

[CHANGELOG.md](../../CHANGELOG.md), à la racine, consigne ce qui change pour les utilisateurs. Ajoutez votre
entrée sous **Unreleased** dans la même pull request que la modification, pour la personne qui installe
Studium et non pour le relecteur. À la publication, le titre Unreleased devient le numéro de version.

## Constructions entre deux versions

Chaque push lance le job **VSIX + standalone MCP server** de [`ci.yml`](../../.github/workflows/ci.yml). Il
empaquette l'extension, contrôle le contenu du paquet avec
[`.github/scripts/check-vsix.sh`](../../.github/scripts/check-vsix.sh), démarre `lesson-mcp.cjs` en stdio et
dépose les deux fichiers comme artefact de workflow `studium-vsix`. Téléchargez-le depuis la page de
l'exécution dans GitHub Actions, ou :

```bash
gh run download <run-id> --name studium-vsix
```

Pour construire les mêmes fichiers en local :

```bash
pnpm install
pnpm build:libs
pnpm --filter studium-vscode package                  # écrit apps/studium-vscode/studium.vsix
.github/scripts/check-vsix.sh apps/studium-vscode/studium.vsix
pnpm --filter @studium/lesson-mcp bundle              # écrit apps/lesson-mcp/dist/studium-mcp.cjs
```

`package` copie les bibliothèques des viewers, construit `dist/extension.js` et `dist/lesson-mcp.cjs`, puis
lance `vsce`. Le contrôle refuse un paquet sans serveur embarqué, sans les fichiers KaTeX, marked et 3Dmol,
ou sans les fichiers d'interface `package.nls*.json`, ainsi qu'un paquet qui contient des sources ou
`node_modules`. Le script `bundle` de `lesson-mcp` construit le même serveur sous un autre nom, pour un
usage hors de l'extension.

Pour installer un VSIX dans VS Code :

```bash
code --install-extension apps/studium-vscode/studium.vsix
```

## Publier une version

Pousser une étiquette relève du propriétaire ; agents et contributeurs préparent la version sans
l'étiqueter.

1. Vérifiez que la CI est verte sur le commit à étiqueter (voir [tests](testing.fr.md)).
2. Inscrivez la même nouvelle version dans `apps/studium-vscode/package.json`,
   `apps/lesson-mcp/package.json`, `.claude-plugin/plugin.json` et `server.json` (deux endroits).
3. Renommez **Unreleased** dans `CHANGELOG.md` en ce numéro, puis fusionnez.
4. Étiquetez et poussez :

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

5. [`release.yml`](../../.github/workflows/release.yml) vérifie que l'étiquette correspond à la version de
   l'extension, lance les tests de l'extension et du serveur MCP, empaquette et contrôle le VSIX, puis crée
   une release en **brouillon** avec les trois fichiers et des notes générées, puis publie sur chaque
   registre dont le jeton est configuré.
6. Relisez le brouillon, remplacez au besoin les notes générées par la section du changelog, et publiez.
   Une version déposée sur un registre ne se remplace pas : une erreur se corrige par la version corrective
   suivante.

Un workflow en échec ne laisse aucune release. Corrigez la cause et publiez la version corrective suivante
plutôt que de déplacer une étiquette publiée.

## Publier à la main

Quand le workflow de publication ne peut pas tourner, le mainteneur peut publier une version étiquetée
depuis sa propre machine. Les jetons ne vont jamais dans le dépôt, ni sur une ligne de commande gardée dans
l'historique du shell : tapez chacun à l'invite d'un `read -rs`, comme ci-dessous, et fermez le shell
ensuite.

1. Construisez le serveur et préparez le paquet npm, depuis la racine du dépôt, sur le commit étiqueté :

   ```bash
   pnpm install --frozen-lockfile
   pnpm build:libs
   pnpm --filter studium-vscode build
   node .github/scripts/stage-npm-mcp.mjs X.Y.Z npm-stage
   ```

2. Vérifiez ce que contiendra le paquet (`studium-mcp.cjs`, `LICENSE`, `NOTICE`, `README.md`,
   `package.json`) :

   ```bash
   (cd npm-stage && npm pack --dry-run)
   ```

3. Publiez-le. `npm publish` utilise le `npm login` du mainteneur ; un paquet publié depuis un portable ne
   porte pas d'attestation de provenance, contrairement à celui que publie le workflow :

   ```bash
   npm login
   (cd npm-stage && npm publish)
   ```

4. Publiez le VSIX de la version (`studium-vX.Y.Z.vsix`, pris sur la page de la release ou construit par
   `pnpm --filter studium-vscode package`). `vsce` s'exécute dans `apps/studium-vscode` : donnez-lui un
   chemin absolu. `vsce` lit `VSCE_PAT` et `ovsx` lit `OVSX_PAT` dans l'environnement :

   ```bash
   read -rs VSCE_PAT && export VSCE_PAT
   pnpm --filter studium-vscode exec vsce publish --packagePath "$PWD/studium-vX.Y.Z.vsix"
   read -rs OVSX_PAT && export OVSX_PAT
   npx --yes ovsx@1.2.0 publish studium-vX.Y.Z.vsix
   ```

5. Inscrivez le serveur au MCP Registry, une fois le paquet npm publié (son manifeste porte `mcpName`, que
   le registre vérifie). Depuis la racine du dépôt, `mcp-publisher` lit `server.json` :

   ```bash
   mcp-publisher login github
   mcp-publisher publish
   ```

   Publier sous le nom de l'organisation `io.github.HolobiomicsLab/` demande un compte GitHub
   membre de l'organisation. Que le nom doive respecter la casse du nom de l'organisation sur GitHub n'a pas été
   vérifié.

Le plugin Claude Code ne demande aucune étape de publication. Claude Code lit le marketplace et le plugin
sur la branche par défaut du dépôt : une version atteint les utilisateurs une fois fusionnée sur cette
branche. Il fonctionne pour les personnes extérieures à l'organisation dès que le dépôt est public.

## Limites

Le VSIX n'est pas signé, et l'application de bureau Tauri, gelée, ne fait pas partie d'une version : sa
construction ne tourne qu'à la demande, par déclenchement manuel du workflow de CI.

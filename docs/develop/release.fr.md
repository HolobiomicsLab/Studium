[English](release.md) · Français

# Publication

Une version de Studium est une étiquette Git `vX.Y.Z`, deux fichiers construits à partir d'elle
(l'extension VS Code et le serveur MCP autonome) et le même numéro sur quatre registres. Cette page explique
la numérotation, d'où viennent ces fichiers entre deux versions, comment publier une version, et comment
l'envoyer depuis un portable quand le workflow ne peut pas tourner.

## Contenu d'une version

[`tools/release/build.sh`](../../tools/release/build.sh) construit les mêmes fichiers sur un portable et
dans le workflow de publication :

| Fichier | Ce que c'est |
|---|---|
| `studium-vX.Y.Z.vsix` | l'extension VS Code, avec le serveur MCP, les bibliothèques des viewers et l'interface française et anglaise |
| `lesson-mcp.cjs` | le serveur MCP en un seul fichier Node autonome, celui que le VSIX embarque |
| `SHA256SUMS.txt` | empreintes des deux fichiers |
| `npm-stage/` | le paquet npm `studium-mcp` : le même serveur sans dépendance d'exécution, préparé par [`stage-npm-mcp.mjs`](../../.github/scripts/stage-npm-mcp.mjs) |

Chaque fichier porte la licence du dépôt : Apache 2.0, avec `LICENSE` et `NOTICE` dans le VSIX et dans le
paquet npm.

## Où va une version

| Registre | Ce qu'il reçoit | Ce que l'on lance ensuite |
|---|---|---|
| npm, paquet `studium-mcp` | `npm-stage/` | `npx -y studium-mcp` |
| MCP Registry, `io.github.HolobiomicsLab/studium` | [`server.json`](../../server.json), qui renvoie au paquet npm | trouvé par les clients MCP qui lisent le registre |
| Visual Studio Marketplace, `holobiomicslab.studium-vscode` | le VSIX | `code --install-extension holobiomicslab.studium-vscode` |
| Open VSX, `holobiomicslab.studium-vscode` (VSCodium, Cursor, Gitpod) | le VSIX | la même commande, dans ces éditeurs |

Une version déposée sur un registre ne se remplace pas : une erreur se corrige par la version corrective
suivante. Pour voir où se trouve une version, sans rien envoyer :

```bash
node tools/release/registries.mjs status          # la version de ce clone
node tools/release/registries.mjs status 0.6.0
```

**La page que montre chaque registre.** Le Marketplace et Open VSX montrent
[`apps/studium-vscode/MARKETPLACE.md`](../../apps/studium-vscode/MARKETPLACE.md), écrite pour la personne
qui installe l'extension, en anglais puis en français ; le README des développeurs reste hors du VSIX. npm
montre [`apps/lesson-mcp/README.npm.md`](../../apps/lesson-mcp/README.npm.md). Une page de registre ne peut
pas suivre un lien relatif, et n'affiche une image que depuis une adresse `https` publique : la fiche
renvoie à la branche `main` de ce dépôt par adresse complète, et `pnpm --filter studium-vscode test` échoue
sur un lien relatif, ou sur un lien ou une image dont le fichier n'est pas dans le dépôt.

## Numérotation

- **Une seule version du produit**, le champ `version` de
  [`apps/studium-vscode/package.json`](../../apps/studium-vscode/package.json). Elle est écrite à treize
  endroits : les manifestes de l'extension, du serveur MCP et du panneau, les deux entrées du panneau,
  [`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json), `server.json` (deux fois),
  `CITATION.cff`, les deux README, le formulaire de signalement et un outil de développement.
  [`tools/release/version.mjs`](../../tools/release/version.mjs) les écrit tous et les contrôle :

  ```bash
  node tools/release/version.mjs --check     # chaque endroit porte la même version
  node tools/release/version.mjs 0.6.1       # écrit 0.6.1 partout, à la date du jour
  ```

  La construction refuse un arbre qui échoue au contrôle, ou une étiquette qui n'est pas cette version.
- **Versionnage sémantique, en 0.x pour l'instant.** Tant que la version commence par `0.`, une version
  mineure peut changer les entrées ou sorties d'un outil ; dites-le dans le changelog. Un correctif répare
  un comportement sans changer de contrat.
- **Les autres paquets de l'espace de travail** sont privés et jamais publiés. Leur champ `version` ne suit
  pas celui du produit.
- **Le format de leçon a sa propre version.** Le `schema_version` d'un bundle (actuellement `1.4`, dans
  [`packages/lesson-bundle-schema`](../../packages/lesson-bundle-schema/src/index.ts)) ne change que si le
  format change, indépendamment des versions publiées.

## Changelog

[CHANGELOG.md](../../CHANGELOG.md), à la racine, consigne ce qui change pour les utilisateurs. Ajoutez votre
entrée sous **Unreleased** dans la même pull request que la modification, pour la personne qui installe
Studium et non pour le relecteur. `version.mjs` fait des entrées Unreleased la section de la nouvelle
version, et refuse de publier une section vide.

## Constructions entre deux versions

Chaque push lance le job **VSIX + standalone MCP server** de [`ci.yml`](../../.github/workflows/ci.yml). Il
empaquette l'extension, contrôle le contenu du paquet avec
[`.github/scripts/check-vsix.sh`](../../.github/scripts/check-vsix.sh), démarre `lesson-mcp.cjs` en stdio et
dépose les deux fichiers comme artefact de workflow `studium-vsix` (`gh run download <run-id> --name
studium-vsix`). Pour construire les fichiers de version de votre arbre de travail, sans étiquette :

```bash
tools/release/build.sh /tmp/studium-trial --untagged
code --install-extension /tmp/studium-trial/studium-v*.vsix
```

Le contrôle refuse un paquet sans serveur embarqué, sans les fichiers KaTeX, marked et 3Dmol ou sans les
fichiers d'interface `package.nls*.json`, un paquet qui contient des sources ou `node_modules`, et un paquet
dont la page de registre est le README des développeurs.

## Publier une version

Pousser une étiquette relève du propriétaire ; agents et contributeurs préparent la version sans
l'étiqueter.

1. Sur `dev`, avec les tests verts sur le commit (voir [tests](testing.fr.md)), écrivez la version :

   ```bash
   node tools/release/version.mjs X.Y.Z
   ```

   Relisez la nouvelle section de `CHANGELOG.md`, ajoutez une phrase qui résume la version, et fusionnez
   jusqu'à `main`.
2. Étiquetez le commit sur `main` et poussez l'étiquette :

   ```bash
   git tag -a vX.Y.Z -m "Studium X.Y.Z"
   git push origin vX.Y.Z
   ```

3. [`release.yml`](../../.github/workflows/release.yml) lance `build.sh` (une seule version partout,
   l'étiquette égale à elle, les tests de l'extension et du serveur MCP, le VSIX et son contrôle), crée une
   release GitHub en **brouillon** avec les trois fichiers, puis envoie à chaque registre activé. Un
   registre qui a déjà la version est sauté : une exécution en échec peut donc être relancée.
4. Relisez le brouillon, remplacez au besoin les notes générées par la section du changelog, et publiez.

Quand le workflow ne peut pas tourner, les étapes 3 et 4 se font depuis un portable (section suivante). Une
exécution qui échoue après la construction laisse la release en brouillon et ce qui a déjà été envoyé ;
corrigez la cause et relancez-la (elle garde le brouillon et saute les registres qui ont la version), ou
publiez la version corrective suivante plutôt que de déplacer une étiquette publiée.

## Envoyer depuis votre machine

Depuis un clone placé sur le commit étiqueté :

```bash
tools/release/build.sh ~/studium-release-X.Y.Z      # construit et teste ; n'envoie rien
tools/release/send.sh ~/studium-release-X.Y.Z --plan  # ce qui serait envoyé ; ne demande rien
tools/release/send.sh ~/studium-release-X.Y.Z       # demande avant chaque registre
```

`send.sh` n'envoie qu'une construction de l'étiquette, faite depuis le commit où se trouve le clone (un
essai construit avec `--untagged` est refusé). Il contrôle les fichiers contre leurs empreintes, saute un
registre qui a déjà la version (on peut donc le relancer après un échec) et un registre qui ne répond pas. Les comptes et les jetons sont ceux du
mainteneur ; aucun n'est lu dans un fichier ni écrit quelque part :

| Registre | Ce qu'il faut au script |
|---|---|
| npm | votre propre `npm login` ; npm demande votre second facteur dans un navigateur. Pas d'attestation de provenance depuis un portable |
| Open VSX | `OVSX_PAT` dans l'environnement, ou tapé à une invite masquée |
| Marketplace | rien : le script nomme le fichier à déposer sur la [page de l'éditeur](https://marketplace.visualstudio.com/manage/publishers/holobiomicslab). Les jetons qu'utilisait `vsce publish` sont retirés le 1er décembre 2026 ([guide de publication de VS Code](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)) |
| MCP Registry | `mcp-publisher` installé, et `GH_ORG_TOKEN` dans l'environnement ou tapé à une invite masquée : un jeton GitHub « fine-grained » dont le propriétaire de ressource est l'organisation, avec la permission d'organisation Members en lecture seule et aucune permission de dépôt. Le nom `io.github.HolobiomicsLab/…` n'est accordé qu'à un propriétaire (Owner) de l'organisation |

Pour la 0.6.0, Open VSX a montré la version après environ trois minutes et la validation du Marketplace a
pris moins de vingt-cinq. Joignez les trois fichiers à une release GitHub à la main si vous en voulez une.

## Régler l'automatisation une fois

Le workflow n'utilise aucun jeton durable pour npm, le Marketplace ou le MCP Registry : on dit une fois à
chaque registre de faire confiance à ce dépôt et au fichier de workflow `release.yml`, et le job prouve son
identité avec le jeton OIDC de GitHub. Il faut pour cela que GitHub Actions tourne pour le dépôt : le dépôt
privé d'une organisation sans budget Actions ne le peut pas (ses workflows s'arrêtent aussitôt), un dépôt
public le peut.

| Registre | Ce que le propriétaire fait une fois | Interrupteur |
|---|---|---|
| npm | sur npmjs.com, paquet `studium-mcp`, **Settings**, **Trusted Publisher**, GitHub Actions : organisation `HolobiomicsLab`, dépôt `Studium`, workflow `release.yml`, pas d'environnement ; autoriser `npm publish` | variable du dépôt `PUBLISH_NPM` = `true` |
| Marketplace | sur la page de l'éditeur, **Trusted Publishing**, **Create** : propriétaire du dépôt `HolobiomicsLab`, dépôt `Studium`, workflow `release.yml`, pas d'environnement. Pour un dépôt privé, le workflow doit tourner dans les 48 heures qui suivent la création de la règle | `PUBLISH_MARKETPLACE` = `true` |
| MCP Registry | rien : un job de ce dépôt reçoit `io.github.HolobiomicsLab/*` | `PUBLISH_MCP_REGISTRY` = `true` |
| Open VSX | le secret `OVSX_PAT` (Open VSX n'a pas de voie OIDC) ; seule l'étape Open VSX le voit | `PUBLISH_OPEN_VSX` = `true` |

```bash
gh variable set PUBLISH_NPM --body true --repo HolobiomicsLab/studium
```

Le nom du dépôt est `Studium`, avec un S majuscule : npm lit chaque champ à la lettre près, et lui
compare le `repository.url` du paquet. npm ne contrôle pas un éditeur de confiance à l'enregistrement,
seulement à la première publication ; il ajoute une attestation de provenance quand le dépôt est public. Ces voies viennent de la documentation des
registres ([npm](https://docs.npmjs.com/trusted-publishers),
[Marketplace](https://code.visualstudio.com/api/working-with-extensions/publishing-extension),
[MCP Registry](https://modelcontextprotocol.io/registry/github-actions)) ; aucune n'a encore tourné pour
Studium.

Le plugin Claude Code ne demande aucune étape : Claude Code lit le plugin sur la branche par défaut du
dépôt, donc une version atteint les utilisateurs une fois fusionnée sur cette branche. Le dépôt est
public, donc cela vaut aussi pour les personnes extérieures à l'organisation.

## Limites

Le VSIX n'est pas signé, et l'application de bureau Tauri, gelée, ne fait pas partie d'une version : sa
construction ne tourne qu'à la demande, par déclenchement manuel du workflow de CI.

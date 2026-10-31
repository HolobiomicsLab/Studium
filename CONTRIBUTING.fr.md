[English](CONTRIBUTING.md) · Français

# Contribuer à Studium

Merci de votre aide. Cette page explique comment préparer un checkout, quels contrôles une modification doit passer et ce qu'une pull request doit contenir avant relecture. Toute participation vaut acceptation du [code de conduite](CODE_OF_CONDUCT.fr.md). Les vulnérabilités se signalent selon la [politique de sécurité](SECURITY.fr.md), jamais dans une issue publique.

## Avant de commencer

- Pour tout ce qui dépasse une petite correction, ouvrez d'abord une issue et décrivez le problème, pas seulement la solution. Certains choix (licence, publication, versions) reviennent au propriétaire du projet.
- Le travail courant arrive sur la branche `dev` ; `main` reçoit des intégrations par lots. Partez de `dev`.
- Agents et humains suivent les mêmes conventions : [`AGENTS.md`](AGENTS.md) et [`CLAUDE.md`](CLAUDE.md).
- Votre contribution prend la licence des fichiers qu'elle modifie : Apache 2.0 pour le code, CC BY 4.0 pour la documentation et les leçons du projet (voir [NOTICE](NOTICE)). N'y collez pas de texte tiers dont vous ignorez la licence.

## Préparer un checkout

Outils : Node 22 (`.nvmrc` ; Node 20 ou plus récent est accepté), pnpm 9.15.9 (épinglé dans `package.json`, fourni par `corepack enable`), Python 3.12. Rust n'est nécessaire que pour l'application Tauri, gelée.

```bash
corepack enable
pnpm install
pnpm build:libs                     # les bibliothèques du workspace se résolvent via leur dist/
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Utilisez toujours l'interpréteur du `.venv`, jamais le Python du système. Quand vous lancez le serveur MCP ou un driver à la main, positionnez `STUDIUM_EPHEMERAL=1` pour que rien ne soit écrit dans votre propre `~/.studium`.

## Contrôles à passer

Lancez-les avant d'annoncer qu'une modification est prête. La CI exécute les mêmes étapes avec `STUDIUM_EPHEMERAL=1`.

```bash
pnpm lint
pnpm build                          # tout le workspace compile
pnpm test                           # tous les paquets TypeScript et les drivers de l'extension
.venv/bin/python tools/pytest_all.py  # toutes les suites Python, un processus chacune ; succès = exit 0, « N suites, 0 failing »
pnpm --filter @studium/<paquet> exec tsc --noEmit
node_modules/.pnpm/node_modules/.bin/tsx tools/bundle_lint.mjs
bash tools/bundle_lint.test.sh
STUDIUM_EPHEMERAL=1 node apps/lesson-mcp/scripts/headless_smoke.mjs
```

Si vous avez modifié les jetons graphiques, lancez aussi `node design/scripts/check-contrast.mjs`. Les diagnostics de `fixtures/atomistique-l1/` rapportent des chiffres et sortent toujours avec le code 0 : un changement de ces chiffres est un signal à expliquer, pas un test en échec. La page [Tests](docs/develop/testing.fr.md) décrit chaque suite.

## Les tests d'abord

- Écrivez le test qui échoue avant le code (règle 002). Chaque comportement nouveau a un test qui échoue sans lui.
- Tout appel à un modèle de langage valide sa sortie contre un schéma (Pydantic côté Python, Zod côté TypeScript).
- Les tests font partie du contrat. Modifier ou supprimer un test existant est une décision que vous énoncez dans la pull request, avec sa raison ; ce n'est jamais un effet de bord d'une réparation. N'affaiblissez jamais une assertion pour obtenir un passage au vert.
- Pour tout ce qui dépend du temps (la révision espacée en particulier), utilisez une horloge injectée, pas l'horloge murale.

## Enseignement et données des apprenants

- Aucune leçon n'atteint des étudiants sans relecture et approbation d'un enseignant (règle 003). N'ajoutez aucun chemin qui la contourne.
- Ne versionnez jamais de données d'apprenants, de télémétrie, le corpus d'évaluation (`eval/corpus/`, matériel tiers), de clé d'API ni de jeton.
- Une fonctionnalité qui calcule un chiffre de classe conserve le minimum de cinq apprenants et ne se restreint jamais à une seule personne.

## Documentation

- Les pages anglaise et française sont des fichiers frères : `page.md` en anglais, `page.fr.md` en français, chacune commençant par une ligne de bascule de langue. Un changement visible par l'utilisateur met à jour les deux. Les pages de référence générées restent en anglais avec une introduction en français ; les archives de conception gardent leur langue d'origine.
- Ne documentez que ce que fait le code à cette révision ; retirez ce qui n'existe plus.
- Suivez le [style de la documentation](docs/develop/docs-style.fr.md).

## Commits

- Style conventionnel : `type(portée): sujet`, par exemple `fix(vscode): keep the scene after a failed submit`. Types utilisés : `feat`, `fix`, `test`, `docs`, `ci`, `chore`. Le sujet, à l'impératif, dit ce qui change ; le corps dit pourquoi et comment cela a été vérifié.
- Une modification cohérente par commit. Ajoutez les fichiers par leur nom ; évitez `git add -A` et `git add .`.
- Ne réécrivez pas l'historique partagé : pas de rebase d'une branche publiée, pas de force-push.
- Un commit significatif ajoute une entrée au journal des agents ([`docs/internal/agent-log.md`](docs/internal/agent-log.md)). Les anciens relais de session sont archivés dans [`docs/internal/handoff-history.md`](docs/internal/handoff-history.md).

## Pull requests

Ouvrez la pull request vers `dev`. Le [modèle](.github/PULL_REQUEST_TEMPLATE.md) demande :

- ce qui change et pourquoi, avec l'issue liée ;
- les contrôles lancés et leur résultat ;
- chaque test existant modifié, et pourquoi ;
- la documentation anglaise et française mise à jour ensemble ;
- aucune donnée d'apprenant, clé ou matériel tiers dans le diff ;
- des captures en thème clair et sombre pour un changement visible du panneau VS Code ou d'une page web.

Un mainteneur relit la justesse, la confidentialité et le respect des contrats ci-dessus. La fusion, les versions et les tags sont faits par les mainteneurs.

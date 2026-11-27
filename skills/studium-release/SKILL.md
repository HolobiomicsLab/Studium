---
name: studium-release
description: Cut and publish a Studium release from start to finish, and check that every place people get Studium from shows it. Use when asked to release, publish or ship a version (« publie la 0.6.10 », "cut X.Y.Z"), when a merged change reaches users only through a release (extension behaviour, the Marketplace or npm page), or after a release run fails. Covers the version and changelog, the merges from dev to main, the tag, the release workflow, the GitHub release, npm, Open VSX, the Visual Studio Marketplace, the MCP Registry and the documentation site. The mechanics are in docs/develop/release.md; this skill is the order to follow and the checks to make.
---

# Studium: publish a release

A release is a tag `vX.Y.Z` on `main`, a GitHub release with four files, the same version on four
registries, and the documentation site rebuilt from `main`. The mechanics, the registries' set-up and the
route from a laptop are in [docs/develop/release.md](../../docs/develop/release.md). This skill is the run:
what to do, in which order, and how to prove that each surface shows the new version.

**Merging into `dev` or `main`, tagging and publishing are the owner's decisions.** Prepare everything, then
ask once, saying what will happen (« merge PR N, tag vX.Y.Z, publish to the four registries »). A word for one
release does not cover the next.

## 1. Decide what goes out

```bash
git fetch origin --prune --tags
git log --oneline origin/main..origin/dev       # what the release carries
git show origin/dev:CHANGELOG.md | sed -n '/^## Unreleased/,/^## [0-9]/p'
```

- The Unreleased section must say, for the person who installs Studium, every change that reaches them.
  `version.mjs` refuses an empty one.
- Documentation that names the new version (« from 0.6.10 ») or describes new behaviour goes to `main`
  together with the release, never before: the documentation site publishes `main` at once.
- The Marketplace and Open VSX pages (`apps/studium-vscode/MARKETPLACE.md`) and the npm page
  (`apps/lesson-mcp/README.npm.md`) change only with a release. A change to those files is a reason to release.
- Version: a patch for fixes and documentation, a minor bump when a tool input or output changes (0.x).

## 2. Prepare the release branch

Work in a fresh worktree from `origin/dev`, never in a checkout that another task or a running server uses.

```bash
git worktree add -b chore/<date>-release-X.Y.Z ../studium-release-X.Y.Z origin/dev
cd ../studium-release-X.Y.Z
pnpm install --frozen-lockfile
node tools/release/version.mjs X.Y.Z             # thirteen places, and Unreleased becomes X.Y.Z
```

Open `CHANGELOG.md`, add under the new heading one or two sentences that sum the release up for a user
(what changes for them, what was tried, what was not), then run the checks a fresh worktree needs in this order:

```bash
node tools/release/version.mjs --check
pnpm build:libs && pnpm --filter lesson-panel-ui build   # the docs check starts the MCP server
node tools/docs/check.mjs                               # 0 problem(s)
pnpm --filter studium-vscode build                      # dist-load loads the built extension
pnpm --filter studium-vscode test
```

Commit only the files `version.mjs` listed and the changelog (`git add <paths>`), message
`chore(release): X.Y.Z`.

## 3. Merge up

1. Push the branch and open a pull request into `dev`, titled `chore(release): X.Y.Z`. Wait for every
   check (`gh pr checks N`); « Tester onboarding path » is the slowest, about eight minutes. Merge it.
2. Open a pull request from `dev` into `main`, titled `Release X.Y.Z: dev into main`. Its checks run twice
   (push and pull request). Merge it with a merge commit (`gh pr merge N --merge`), never squashed or
   rebased: `main` must contain the commits of `dev`.

## 4. Tag and run the release workflow

```bash
git fetch origin
git show origin/main:apps/studium-vscode/package.json | grep '"version"'   # must read X.Y.Z
git tag -a vX.Y.Z -m "Studium X.Y.Z" "$(git rev-parse origin/main)"
git push origin vX.Y.Z
gh run list --workflow release.yml --limit 1      # then: gh run view <id> --json status,conclusion
```

`release.yml` runs `tools/release/build.sh` (one version everywhere, the tests, the VSIX and its check),
creates a draft GitHub release and sends to each registry that is switched on. It takes about six minutes.

**If the run fails,** read its log (`gh run view <id> --log-failed`). A failure in the build reached no
registry: fix the cause on `dev` and release the next patch. Never move a published tag; a tag left without a
release is said so in the changelog (0.6.7 is one).

## 5. Publish the GitHub release

```bash
gh release view vX.Y.Z --json isDraft,assets --jq '{isDraft, assets: [.assets[].name]}'
gh release edit vX.Y.Z --draft=false --latest
```

Four files: `studium-vX.Y.Z.vsix`, `studium-vX.Y.Z.mcpb`, `lesson-mcp.cjs`, `SHA256SUMS.txt`.

## 6. Check every surface

Do not report a release as done before each line below has been checked.

| Surface | Check | Expected |
|---|---|---|
| Four registries | `node tools/release/registries.mjs status X.Y.Z` | four `yes`. The Marketplace lags a few minutes after « Published »: check again |
| Marketplace page | the gallery query below | `versions[0].version` is X.Y.Z, and its details text has a sentence new in `MARKETPLACE.md` |
| Open VSX page | `curl -fsSL https://open-vsx.org/api/holobiomicslab/studium-vscode/X.Y.Z` | `files.readme` serves the new `MARKETPLACE.md` |
| npm | `curl -fsSL https://registry.npmjs.org/studium-mcp` | `dist-tags.latest` is X.Y.Z; `readme` is `README.npm.md` |
| The VSIX itself | `gh release download vX.Y.Z --pattern '*.vsix'`, then `unzip -p <file> extension/readme.md` | the page the registries show |
| The change itself | `unzip -p <file> extension/dist/extension.js \| grep -o '<a string the change added>'` (for the server, `lesson-mcp.cjs` of the release) | found. Search a short, loose string: the bundle keeps template literals and may change the quotes |
| Documentation site | `gh run list --workflow docs-site.yml --branch main --limit 1`, then each changed page | the run succeeded; `https://holobiomicslab.github.io/Studium/<path>.html` answers 200 (French under `/fr/`) |
| Claude Code plugin | nothing to send | Claude Code reads it from `main` |

The Marketplace query:

```bash
curl -fsSL -X POST https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery \
  -H 'Content-Type: application/json' -H 'Accept: application/json;api-version=7.2-preview.1' \
  --data '{"filters":[{"criteria":[{"filterType":7,"value":"holobiomicslab.studium-vscode"}]}],"flags":643}'
```

The details text is the `source` of the file whose `assetType` is
`Microsoft.VisualStudio.Services.Content.Details`.

The documentation site is rebuilt only when `docs/`, the README files, `tools/docs/` or `design/` change on
`main`; a release that changes none of them leaves it as it was.

## 7. Close

- Remove the worktree and its local branch.
- Say what users do to get the release: VS Code updates the extension by itself or from the Extensions view,
  then **Developer: Reload Window**; an assistant connected with **Studium: Connect an Assistant…** gets its
  entry rewritten when VS Code next starts the extension.
- Say what was tried and what was not, as the changelog does.
- The project page (https://ediam.cnrs.fr/studium/) is built from its own repository. Change it only when the
  way in changes, with the owner's word.
- A maintainer's own steps (a private status file, skills linked from a local checkout) belong in their
  notes. This project's development hub keeps them in `docs/release-local.md`.

## Pitfalls met

- **A local branch ref lies.** Compare with `origin/main` and `origin/dev` after a fetch, never with a local
  `main` that nobody pulls.
- **A fresh worktree has no `node_modules` and no `dist/`.** The docs check fails on a missing module until
  `pnpm build:libs` and the panel build have run; `dist-load` fails until the extension is built.
- **Tests on the sources cannot see a bundling fault.** Extension 0.6.6 did not start at all, while every
  driver run through `tsx` passed; `dist-load` now loads the built file. Keep it in the test loop.
- **The release build runs the tests.** For 0.6.7 the extension tests ran before the extension was built,
  the run stopped, and nothing was published; 0.6.8 carried it.
- **A registry version cannot be replaced.** A wrong upload is fixed by the next patch.
- **French pages use non-breaking spaces** before `:`, `;`, `?`, `!` and inside « ». An edit that looks
  for the exact text with ordinary spaces does not find it.

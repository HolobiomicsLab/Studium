English · [Français](release.fr.md)

# Release

A Studium release is a Git tag `vX.Y.Z`, two files built from it (the VS Code extension and the standalone
MCP server) and the same version on four registries. This page says how versions are numbered, where the
files come from between releases, how to cut a release, and how to send one from a laptop when the
workflow cannot run.

## What a release contains

[`tools/release/build.sh`](../../tools/release/build.sh) builds the same files on a laptop and in the
release workflow:

| File | What it is |
|---|---|
| `studium-vX.Y.Z.vsix` | the VS Code extension, with the MCP server, viewer libraries and French and English interface inside |
| `lesson-mcp.cjs` | the MCP server as one self-contained Node file, the one the VSIX embeds |
| `SHA256SUMS.txt` | checksums of the two files |
| `npm-stage/` | the npm package `studium-mcp`: the same server with no runtime dependency, staged by [`stage-npm-mcp.mjs`](../../.github/scripts/stage-npm-mcp.mjs) |

Every file carries the licence of the repository: Apache-2.0, with `LICENSE` and `NOTICE` inside the VSIX
and the npm package.

## Where a release goes

| Registry | What it receives | What people then run |
|---|---|---|
| npm, package `studium-mcp` | `npm-stage/` | `npx -y studium-mcp` |
| MCP Registry, `io.github.HolobiomicsLab/studium` | [`server.json`](../../server.json), which points to the npm package | found by MCP clients that read the registry |
| Visual Studio Marketplace, `holobiomicslab.studium-vscode` | the VSIX | `code --install-extension holobiomicslab.studium-vscode` |
| Open VSX, `holobiomicslab.studium-vscode` (VSCodium, Cursor, Gitpod) | the VSIX | the same, in those editors |

A registry version cannot be replaced: a wrong upload is fixed by the next patch version. To see where a
version is, without sending anything:

```bash
node tools/release/registries.mjs status          # the version of this checkout
node tools/release/registries.mjs status 0.6.0
```

**The page each registry shows.** The Marketplace and Open VSX show
[`apps/studium-vscode/MARKETPLACE.md`](../../apps/studium-vscode/MARKETPLACE.md), written for the person
who installs the extension, in English then French; the developers' README stays out of the VSIX. npm shows
[`apps/lesson-mcp/README.npm.md`](../../apps/lesson-mcp/README.npm.md). A registry page cannot follow a
relative link, and shows an image only from a public `https` address: the listing links to this
repository's `main` branch by full address, and `pnpm --filter studium-vscode test` fails on a relative
link, or on a link or an image whose file is not in the repository.

## Versioning

- **One product version**, the `version` of
  [`apps/studium-vscode/package.json`](../../apps/studium-vscode/package.json). It is written in thirteen
  places: the manifests of the extension, of the MCP server and of the panel, the two panel entries,
  [`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json), `server.json` (twice), `CITATION.cff`,
  the two README files, the issue form and a development tool.
  [`tools/release/version.mjs`](../../tools/release/version.mjs) writes them all and checks them:

  ```bash
  node tools/release/version.mjs --check     # every place carries the same version
  node tools/release/version.mjs 0.6.1       # write 0.6.1 everywhere, dated today
  ```

  The build refuses a tree that fails the check, or a tag that is not that version.
- **Semantic versions, 0.x for now.** While the version starts with `0.`, a minor bump may change tool
  inputs or outputs; say so in the changelog. A patch fixes behaviour without changing a contract.
- **The other workspace packages** are private and never published. Their `version` fields do not follow
  the product version.
- **The lesson format has its own version.** `schema_version` in a bundle (currently `1.4`, in
  [`packages/lesson-bundle-schema`](../../packages/lesson-bundle-schema/src/index.ts)) changes only when the
  bundle format changes, independently of releases.

## Changelog

[CHANGELOG.md](../../CHANGELOG.md) at the root records what changes for users. Add your entry under
**Unreleased** in the same pull request as the change, written for the reader who installs Studium, not
for the reviewer. `version.mjs` turns the Unreleased entries into the section of the new version, and
refuses to release an empty section.

## Builds between releases

Every push runs the **VSIX + standalone MCP server** job of
[`ci.yml`](../../.github/workflows/ci.yml). It packages the extension, checks the package contents with
[`.github/scripts/check-vsix.sh`](../../.github/scripts/check-vsix.sh), starts `lesson-mcp.cjs` over stdio,
and uploads both files as the workflow artifact `studium-vsix` (`gh run download <run-id> --name
studium-vsix`). To build the release files of your working tree, without a tag:

```bash
tools/release/build.sh /tmp/studium-trial --untagged
code --install-extension /tmp/studium-trial/studium-v*.vsix
```

The check refuses a package without the bundled server, the vendored KaTeX, marked and 3Dmol files or the
`package.nls*.json` interface files, one that contains sources or `node_modules`, and one whose registry
page is the developers' README.

## Cutting a release

Pushing a tag is the owner's decision; agents and contributors prepare the release but do not tag.

1. On `dev`, with the tests green on the commit (see [testing](testing.md)), write the version:

   ```bash
   node tools/release/version.mjs X.Y.Z
   ```

   Read the new section of `CHANGELOG.md`, add a sentence that sums the release up, and merge up to `main`.
2. Tag the commit on `main` and push the tag:

   ```bash
   git tag -a vX.Y.Z -m "Studium X.Y.Z"
   git push origin vX.Y.Z
   ```

3. [`release.yml`](../../.github/workflows/release.yml) runs `build.sh` (one version everywhere, the tag
   equal to it, the tests of the extension and of the MCP server, the VSIX and its check), creates a
   **draft** GitHub release with the three files, then sends to each registry that is switched on. A
   registry that already has the version is skipped, so a failed run can be started again.
4. Read the draft, replace the generated notes with the changelog section if needed, and publish it.

When the workflow cannot run, steps 3 and 4 are done from a laptop (next section). A run that fails after
the build leaves the draft release and whatever was already sent; fix the cause and run it again (it keeps
the draft and skips the registries that have the version), or release the next patch version rather than
moving a published tag.

## Sending from your machine

From a checkout of the tagged commit:

```bash
tools/release/build.sh ~/studium-release-X.Y.Z      # builds and tests; sends nothing
tools/release/send.sh ~/studium-release-X.Y.Z --plan  # what would be sent; asks nothing
tools/release/send.sh ~/studium-release-X.Y.Z       # asks before each registry
```

`send.sh` sends only a build of the tag, made from the commit the checkout is on (a trial built with
`--untagged` is refused). It checks the files against their checksums, skips a registry that already has
the version (so it can be run again after a failure) and one that gives no answer. Accounts and tokens are the maintainer's;
none is read from a file or written anywhere:

| Registry | What the script needs |
|---|---|
| npm | your own `npm login`; npm asks for your second factor in a browser. No provenance attestation from a laptop |
| Open VSX | `OVSX_PAT` in the environment, or typed at a hidden prompt |
| Marketplace | nothing: the script names the file to upload on the [publisher's page](https://marketplace.visualstudio.com/manage/publishers/holobiomicslab). The tokens `vsce publish` used are retired on 1 December 2026 ([VS Code publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)) |
| MCP Registry | `mcp-publisher` installed, and `GH_ORG_TOKEN` in the environment or typed at a hidden prompt: a fine-grained GitHub token whose resource owner is the organisation, with the organisation permission Members, read-only, and no repository permission. The name `io.github.HolobiomicsLab/…` is granted only to an Owner of the organisation |

For 0.6.0, Open VSX showed the version after about three minutes and the Marketplace's validation took
less than twenty-five. Attach the three files to a GitHub release by hand if you want one.

## Set up the automation once

The workflow uses no long-lived token for npm, the Marketplace or the MCP Registry: each registry is told
once to trust this repository and the workflow file `release.yml`, and the job proves who it is with
GitHub's OIDC token. This needs GitHub Actions to run for the repository: a private repository of an
organisation without an Actions budget cannot (its workflows stop at once), a public one can.

| Registry | What the owner does once | Switch |
|---|---|---|
| npm | on npmjs.com, package `studium-mcp`, **Settings**, **Trusted Publisher**, GitHub Actions: organisation `HolobiomicsLab`, repository `studium`, workflow `release.yml`, no environment; allow `npm publish` | repository variable `PUBLISH_NPM` = `true` |
| Marketplace | on the publisher's page, **Trusted Publishing**, **Create**: repository owner `HolobiomicsLab`, repository `studium`, workflow `release.yml`, no environment. For a private repository the workflow must run within 48 hours of creating the policy | `PUBLISH_MARKETPLACE` = `true` |
| MCP Registry | nothing: a job of this repository is granted `io.github.HolobiomicsLab/*` | `PUBLISH_MCP_REGISTRY` = `true` |
| Open VSX | the secret `OVSX_PAT` (Open VSX has no OIDC route); only the Open VSX step sees it | `PUBLISH_OPEN_VSX` = `true` |

```bash
gh variable set PUBLISH_NPM --body true --repo HolobiomicsLab/studium
```

npm does not check a trusted publisher when it is saved, only at the first publication; it adds a
provenance attestation when the repository is public. These routes come from the registries' documentation
([npm](https://docs.npmjs.com/trusted-publishers),
[Marketplace](https://code.visualstudio.com/api/working-with-extensions/publishing-extension),
[MCP Registry](https://modelcontextprotocol.io/registry/github-actions)); none has run for Studium yet.

The Claude Code plugin needs no step: Claude Code reads the plugin from the repository's default branch,
so a version reaches users when it is merged there. The repository is public, so this includes people
outside the organisation.

## Limits

The VSIX is not signed, and the frozen Tauri desktop app is not part of a release: its build runs only on
manual dispatch of the CI workflow.

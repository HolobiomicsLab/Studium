English · [Français](release.fr.md)

# Release

A Studium release is a Git tag `vX.Y.Z` that builds two files and attaches them to a draft GitHub
release: the VS Code extension (`.vsix`) and the standalone MCP server (`lesson-mcp.cjs`). This page says
how versions are numbered, where the files come from between releases, and how to cut one.

## What a release contains

| File | What it is | Built from |
|---|---|---|
| `studium-vX.Y.Z.vsix` | the VS Code extension, with the MCP server, viewer libraries and French and English interface inside | `pnpm --filter studium-vscode package` |
| `lesson-mcp.cjs` | the MCP server as one self-contained Node file, for any harness | `apps/studium-vscode/dist/lesson-mcp.cjs`, the same file the VSIX embeds |
| `SHA256SUMS.txt` | checksums of the two files | the release workflow |

The same workflow publishes to each registry whose token is a repository secret, and skips the others:

| Secret | Registry | What it receives |
|---|---|---|
| `VSCE_PAT` | Visual Studio Marketplace, publisher `holobiomicslab` | the VSIX |
| `OVSX_PAT` | Open VSX Registry, namespace `holobiomicslab` (VSCodium, Cursor, Gitpod) | the VSIX |
| `NPM_TOKEN` | npm, package `studium-mcp` | the server file, staged by [`.github/scripts/stage-npm-mcp.mjs`](../../.github/scripts/stage-npm-mcp.mjs) with no runtime dependency and a provenance attestation |

With `studium-mcp` on npm, a harness starts the server with `npx -y studium-mcp`. Every file carries the
licence of the repository: Apache-2.0, with `LICENSE` and `NOTICE` inside the VSIX and the npm package.

## Versioning

- **One product version.** The version of a release is the `version` of
  [`apps/studium-vscode/package.json`](../../apps/studium-vscode/package.json). The release workflow refuses a
  tag that does not match it.
- **Keep the MCP server in step.** The server reports the `version` of
  [`apps/lesson-mcp/package.json`](../../apps/lesson-mcp/package.json) to MCP clients, and `get_server_info`
  adds the build origin, time and commit. Bump it with the extension; nothing checks this for you.
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
for the reviewer. At release time, the Unreleased heading becomes the version number.

## Builds between releases

Every push runs the **VSIX + standalone MCP server** job of
[`ci.yml`](../../.github/workflows/ci.yml). It packages the extension, checks the package contents with
[`.github/scripts/check-vsix.sh`](../../.github/scripts/check-vsix.sh), starts `lesson-mcp.cjs` over stdio,
and uploads both files as the workflow artifact `studium-vsix`. Download it from the run page in GitHub
Actions, or:

```bash
gh run download <run-id> --name studium-vsix
```

To build the same files locally:

```bash
pnpm install
pnpm build:libs
pnpm --filter studium-vscode package                  # writes apps/studium-vscode/studium.vsix
.github/scripts/check-vsix.sh apps/studium-vscode/studium.vsix
pnpm --filter @studium/lesson-mcp bundle              # writes apps/lesson-mcp/dist/studium-mcp.cjs
```

`package` vendors the viewer libraries, builds `dist/extension.js` and `dist/lesson-mcp.cjs`, then runs
`vsce`. The check refuses a package without the bundled server, the vendored KaTeX, marked and 3Dmol files,
or the `package.nls*.json` interface files, and one that contains sources or `node_modules`. The `bundle`
script of `lesson-mcp` builds the same server entry under another name, for use outside the extension.

To install a VSIX in VS Code:

```bash
code --install-extension apps/studium-vscode/studium.vsix
```

## Cutting a release

Pushing a tag is the owner's decision; agents and contributors prepare the release but do not tag.

1. Make sure CI is green on the commit you will tag (see [testing](testing.md)).
2. Set the same new version in `apps/studium-vscode/package.json` and `apps/lesson-mcp/package.json`.
3. Rename **Unreleased** in `CHANGELOG.md` to that version and merge.
4. Tag and push:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

5. [`release.yml`](../../.github/workflows/release.yml) checks that the tag matches the extension version,
   runs the extension and MCP server tests, packages and checks the VSIX, creates a **draft** release
   with the three files and generated notes, then publishes to each registry whose token is configured.
6. Read the draft, replace the generated notes with the changelog section if needed, and publish it. A
   registry version cannot be replaced: a wrong upload is fixed by the next patch version.

A failed workflow leaves no release behind. Fix the cause and release the next patch version rather than
moving a published tag.

## Limits

The VSIX is not signed, and the frozen Tauri desktop app is not part of a release: its build runs only on
manual dispatch of the CI workflow.

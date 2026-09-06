/**
 * Repo-wide guard: a workspace whose `build` script runs `tsc` must set either
 * `outDir` or `noEmit` (INT-STUDIUM-015).
 *
 * With neither, tsc writes each emitted file beside its source, so `src/x.ts`
 * gains a sibling `src/x.js`. Four consequences, in decreasing order of damage:
 * a bundler resolving `./x.js` reaches the stale emit instead of the source;
 * vitest's default include glob matches `.js` too, so every suite is collected
 * twice, the second copy from a frozen test body; emitted `.d.ts` enters the
 * eslint surface; and `.gitignore` hides all of it, so `git status` stays clean.
 *
 * The check is an enumeration, not a list of names: a workspace added later is
 * covered without touching this file. The population is read from
 * `pnpm-workspace.yaml`, and each tsconfig is resolved by the compiler itself
 * (`extends` chains and block comments included) rather than by a JSON parse.
 *
 * Home: `@studium/telemetry-events` already sets `noEmit`, so the guard can
 * never be compiled into a duplicate of itself, and every workspace that runs
 * tsc depends on it, so `pnpm -r test` reaches it first.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** `tsc` as a command word: `tsc`, `tsc -p .`, `tsc && vite build` — not `next build`. */
const RUNS_TSC = /(^|[\s&|;])tsc([\s&|;]|$)/
/** `-p <path>` / `--project <path>`, so a non-default config is still resolved. */
const PROJECT_ARG = /(?:^|\s)(?:-p|--project)\s+(\S+)/

/**
 * Workspace roots, from `pnpm-workspace.yaml`. Hand-parsed: this package
 * declares only zod, vitest and typescript, and an undeclared YAML import would
 * break a clean `pnpm install`.
 */
function workspacePatterns(): string[] {
  const lines = readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8').split('\n')
  const start = lines.findIndex((l) => l.trimEnd() === 'packages:')
  expect(start, 'pnpm-workspace.yaml has no `packages:` block').toBeGreaterThanOrEqual(0)
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    const item = /^\s+-\s+["']?(.+?)["']?\s*$/.exec(line)
    if (!item) break
    out.push(item[1] as string)
  }
  return out
}

function workspaceDirs(): string[] {
  const dirs: string[] = []
  for (const pattern of workspacePatterns()) {
    // Only the `<dir>/*` form is used here; anything else must fail loudly
    // rather than be silently skipped.
    expect(pattern.endsWith('/*'), `unsupported workspace pattern ${pattern}`).toBe(true)
    const parent = join(REPO_ROOT, pattern.slice(0, -2))
    if (!existsSync(parent)) continue
    for (const name of readdirSync(parent).sort()) {
      const dir = join(parent, name)
      if (statSync(dir).isDirectory() && existsSync(join(dir, 'package.json'))) dirs.push(dir)
    }
  }
  return dirs
}

interface Workspace {
  name: string
  dir: string
  configPath: string
}

/** Workspaces whose `build` script invokes tsc, each with the config it uses. */
function tscBuilders(): Workspace[] {
  const out: Workspace[] = []
  for (const dir of workspaceDirs()) {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      name?: string
      scripts?: Record<string, string>
    }
    const build = pkg.scripts?.build
    if (!build || !RUNS_TSC.test(build)) continue
    const project = PROJECT_ARG.exec(build)?.[1]
    const configPath = project ? resolve(dir, project) : join(dir, 'tsconfig.json')
    out.push({ name: pkg.name ?? dir, dir, configPath })
  }
  return out
}

/** The compiler's own view of a tsconfig: comments stripped, `extends` followed. */
function resolveOptions(configPath: string): ts.CompilerOptions {
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'))
    },
  }
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host)
  if (!parsed) throw new Error(`could not read ${configPath}`)
  return parsed.options
}

const SOURCE_EXTS = ['.js', '.d.ts', '.js.map', '.d.ts.map']

/** Emitted files sitting beside the `.ts` they came from, under one src/ tree. */
function emittedBesideSources(srcDir: string): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      const ext = SOURCE_EXTS.find((e) => entry.name.endsWith(e))
      if (!ext) continue
      const stem = entry.name.slice(0, -ext.length)
      if (existsSync(join(dir, `${stem}.ts`))) found.push(full.slice(REPO_ROOT.length + 1))
    }
  }
  walk(srcDir)
  return found.sort()
}

describe('tsc emission', () => {
  it('every workspace that builds with tsc sets outDir or noEmit', () => {
    const builders = tscBuilders()
    // A regression in the enumeration itself would make this test vacuously
    // green, so assert the population is the size we measured.
    expect(builders.length).toBeGreaterThanOrEqual(15)

    const emitting = builders
      .filter((w) => {
        const options = resolveOptions(w.configPath)
        return options.noEmit !== true && options.outDir === undefined
      })
      .map((w) => w.name)

    expect(emitting, 'these workspaces emit beside their sources').toEqual([])
  })

  it('no emitted file sits beside the source it was compiled from', () => {
    // A local tripwire, not a CI gate: a clean checkout passes this trivially,
    // before the fix as well as after. It is the only check that can see the
    // recurrence path .gitignore names — an ad-hoc `tsc src/foo.ts`, which
    // ignores tsconfig and emits beside the source even under noEmit.
    const stray: string[] = []
    for (const dir of workspaceDirs()) {
      const srcDir = join(dir, 'src')
      if (existsSync(srcDir)) stray.push(...emittedBesideSources(srcDir))
    }
    expect(stray, 'build output shadowing sources; delete it and rebuild').toEqual([])
  })
})

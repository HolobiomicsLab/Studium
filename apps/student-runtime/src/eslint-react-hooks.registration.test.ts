/**
 * The react-hooks rules are registered and actually evaluate (INT-STUDIUM-014).
 *
 * `eslint-plugin-react-hooks` was absent from the repository entirely — not in
 * `package.json`, not in the lockfile, not on disk — so `react-hooks/*` was an
 * unknown rule id. ESLint does not warn about that: it evaluates nothing and
 * turns any `eslint-disable-next-line react-hooks/…` comment into a hard
 * "Definition for rule was not found" error. The rule appeared to be enforced
 * and was not.
 *
 * Asserting that `.eslintrc.json` contains the right strings would not catch
 * that, because the config was never the missing half. This lints a genuine
 * violation through the real root config and asserts the rule reports it — so
 * it fails if the dependency is dropped, if `plugins` loses the entry, or if a
 * plugin upgrade renames the rule.
 *
 * It deliberately asserts nothing about how many violations the repository has:
 * that number moves with every new hook, and pinning it would make ordinary
 * React work fail this test.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

/** A mount-only effect that reads a prop: the canonical exhaustive-deps violation. */
const PROBE = `
import { useEffect, useState } from "react";
export default function Probe({ value }: { value: string }) {
  const [seen, setSeen] = useState("");
  useEffect(() => { setSeen(value); }, []);
  return seen;
}
`

describe('react-hooks rules in the root ESLint config', () => {
  it('evaluates exhaustive-deps rather than reporting an unknown rule', async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT })
    const [result] = await eslint.lintText(PROBE, {
      filePath: path.join(REPO_ROOT, 'apps/student-runtime/src/__eslint_probe__.tsx'),
    })
    const messages = result?.messages ?? []
    const hit = messages.find((m) => m.ruleId === 'react-hooks/exhaustive-deps')
    expect(
      hit,
      `exhaustive-deps did not run over a real violation; got: ${messages
        .map((m) => `${m.ruleId}: ${m.message}`)
        .join(' | ')}`,
    ).toBeDefined()
    expect(hit?.message ?? '').not.toMatch(/was not found/)
  })

  it('keeps both rules at warn, so the Lint step cannot fail on them', async () => {
    // `pnpm lint` has no --max-warnings, so warnings exit 0. Promoting either
    // rule to error is a deliberate act that must be measured on a CI run
    // first; this catches the promotion happening by accident.
    const eslint = new ESLint({ cwd: REPO_ROOT })
    const config = (await eslint.calculateConfigForFile(
      path.join(REPO_ROOT, 'apps/student-runtime/src/__eslint_probe__.tsx'),
    )) as { rules?: Record<string, unknown[]> }
    for (const rule of ['react-hooks/rules-of-hooks', 'react-hooks/exhaustive-deps']) {
      expect(config.rules?.[rule]?.[0], `${rule} severity`).toBe('warn')
    }
  })
})

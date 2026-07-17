# Pre-registration — the decisive Studium classroom trial

**Status: PLAN (not yet run).** This is the registered-report-style companion to the
Studium preprint. The manuscript concedes that the one empirical step it does not take is
the decisive one — a classroom study measuring a *learning gain* for the operation→judgment
loop. This document pre-commits that study so that, when the trio (a student per graduate
school, a pedagogical engineer, and the researcher) runs it next term, it is a
data-collection exercise, not a from-scratch design. Everything except the human cohort is
built and validated: the trust instrument (`packages/learner-state/src/sdt.ts`,
`packages/lesson-session/src/grading/deck.ts`), its construct validation
(`packages/lesson-session/src/gate-validity.ts`), the run attestation
(`packages/lesson-session-host/src/run-result.ts`), and the power analysis
(`eval/decisive-trial/power_analysis.py`).

## 1. Research question

Does grounding a judgment task on a learner's *own executed result* — run a reproduction
capsule, then audit a deliberately flawed reading of your own output — improve *calibrated
judgment of machine output* more than an equally engaging control that omits the audit loop,
and does that judgment skill **transfer** to a result the learner did not produce?

## 2. Hypotheses

- **H1 (primary — transfer).** Learners in the TREATMENT arm score higher on a
  *judgment-transfer* task (auditing a novel flawed reading of a result they did **not**
  produce) than learners in the ACTIVE CONTROL arm.
- **H2 (secondary — calibration direction).** TREATMENT reduces the *net* mis-trust
  (|criterion c| from the verdict-deck instrument) more than CONTROL, without inflating
  over-distrust (skepticism is the safe direction and must not be penalised).
- **H3 (secondary — competence).** No loss of concept mastery in TREATMENT vs CONTROL (the
  audit loop must not cost content learning).

## 3. Design

Within-subject **crossover**, two capsules matched for difficulty (A, B), two arms:

- **TREATMENT:** capsule + the operation→judgment loop (run → audit a flawed reading of your
  own result → trust-calibration feedback), verdict-deck scored.
- **ACTIVE CONTROL:** same capsule + an equally-timed elaboration task (summarise the method
  and result) with **no** audit of a flawed reading. Matched for time-on-task and for seeing
  the same real artifact — the only difference is the judgment audit.

Order (A-treatment-then-B-control vs B-treatment-then-A-control) is **counterbalanced** and
randomly assigned. The paired difference per learner (transfer score under treatment minus
under control) is the unit of analysis, so the effect size is Cohen's *d_z*.

## 4. Endpoints

- **Primary:** judgment-transfer score — accuracy / signal-detection d′ on a *frozen*
  transfer test (novel flawed + sound claims about a result the learner did not produce),
  scored by the verdict-deck instrument, **key-free**.
- **Secondary:** verdict-deck criterion *c* and A′ (bias vs competence); concept-mastery
  pre/post; over-distrust rate (must not rise); time-on-task (manipulation check).

## 5. Sample size and power

From `power_analysis.py` (paired design, two-sided α = 0.05, normal approximation — treat n
as a floor):

| target effect *d_z* | learners for 80 % power | for 90 % power |
|---|---|---|
| 0.30 (small) | 88 | 117 |
| 0.50 (medium) | 32 | 43 |
| 0.80 (large) | 13 | 17 |

Minimum detectable effect at realistic L1 / graduate class sizes (80 % power): **n = 60 →
d_z = 0.36; n = 120 → d_z = 0.26.** Plan: recruit **two L1/graduate sections (target n ≈
60–120)**, powered to detect a medium effect (d_z ≈ 0.5 needs 32) with margin, and able to
detect down to d_z ≈ 0.26 at the top of the range. A Monte-Carlo check confirms the analytic
power (n = 45, d = 0.5: analytic 0.918, MC 0.914).

## 6. Analysis plan

- **H1:** paired *t*-test on the per-learner transfer difference (mixed model with a random
  intercept per learner and fixed effects for arm, capsule, and order if the crossover shows
  a period effect). Report the effect with a 95 % CI, not only *p*.
- **H2/H3:** the same paired model on criterion *c* and on the mastery pre/post delta.
- Multiplicity: H1 is confirmatory; H2/H3 are secondary and reported as such.
- **Exclusions (pre-specified):** a learner whose run fails attestation on *both* capsules
  (no verifiable execution to ground on) is excluded from H1; recorded and reported.
- **Stopping rule:** fixed-n; no interim peeking. Analysis is run once, after data lock.

## 7. Randomization, blinding, materials

- Arm/order assigned by a seeded list held by the pedagogical engineer; the researcher scores
  the frozen transfer test blind to arm (the verdict-deck scoring is deterministic and
  key-free, so scoring is arm-agnostic by construction).
- **Open materials:** the instrument, the gate-validity harness, and this power script are in
  the repository; the frozen transfer-test item bank is versioned before data collection.

## 8. Consent and ethics (skeleton — the pedagogical engineer completes with the institution)

- Voluntary participation; no effect on course grades; opt-out at any time.
- Data are pseudonymous (the runtime keeps per-learner mastery on-device; only consented,
  k-anonymous, pseudonym-salted telemetry leaves the client — see `services/analytics-collector`).
- Institutional review / ethics sign-off obtained before recruitment. Data-management plan
  (retention, access, deletion) attached as an annex.

## 9. The trio (Isabelle's mandate)

- **Student (per graduate school):** co-designs and pilots the transfer-test item bank; runs
  the n = 1–3 dry pilot to check timing and ceiling/floor.
- **Pedagogical engineer:** consent, scheduling, randomization list, data-management plan.
- **Researcher:** analysis, pre-registration lock, reporting.

The executable operating model — expanded responsibilities, a RACI, recruitment asks, and a timeline
anchored to the two pending gates — is in `TRIO.md`.

## 10. What is done vs pending

- **Done (in-repo, tested):** the key-free bidirectional instrument + construct validation;
  run attestation; the power analysis; this pre-registration.
- **Pending (needs the term):** the frozen transfer-test item bank (human-authored, pilot-
  vetted); IRB/consent sign-off; the cohort run; a live model in the grading loop for the
  free-text audit path (the deck path needs none).

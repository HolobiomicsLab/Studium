# The trio — operating model for the decisive trial

Executable companion to `PREREGISTRATION.md` (§9). Isabelle's mandate is that every contribution forms a
**trio**: a student per graduate school, a pedagogical engineer, and the researcher. The pre-registration
fixes *what* the study is; this document fixes *who does what, when, and with which artefact*, so the trio
runs a data-collection exercise, not a design.

The pre-registration is deposit-ready now; the trio's job is the part that needs a term and a cohort. What is
already done in-repo and tested (the key-free instrument, run attestation, the power analysis, the
gate-validity harness) is theirs to *use*, not rebuild.

## Roles and owned deliverables

| Role | Owns | Concrete deliverables | Pre-reg section |
|---|---|---|---|
| **Student** (per graduate school) | The transfer test | Co-designs + versions the frozen transfer-test item bank; runs the n = 1–3 dry pilot for timing + ceiling/floor; reports the pilot back to the item bank | §6, §7 (materials), §10 pending |
| **Pedagogical engineer** | Human logistics + ethics | Consent form + IRB/ethics submission; scheduling of the two sections; the seeded arm/order randomization list; the data-management plan (retention/access/deletion annex) | §7, §8 |
| **Researcher** | Evidence integrity | Locks the pre-registration before collection; scores the frozen transfer test blind to arm; runs the analysis (`power_analysis.py`, `pilot_export.py`); reports | §4, §5, §9, §10 |

Blinding is structural, not a discipline the trio must enforce: the verdict-deck scoring is deterministic and
key-free, so the researcher scores arm-agnostically by construction (§7). The engineer holds the arm list; the
researcher never needs it to score.

## RACI over the workstreams

R = responsible, A = accountable, C = consulted, I = informed.

| Workstream | Student | Ped. engineer | Researcher | Isabelle / PI |
|---|---|---|---|---|
| Transfer-test item bank (author + freeze) | R/A | C | C | I |
| Dry pilot (n = 1–3): timing, ceiling/floor | R/A | I | C | I |
| Consent + IRB/ethics sign-off | I | R/A | C | I |
| Scheduling + randomization list | C | R/A | I | I |
| Data-management plan | I | R/A | C | A |
| Pre-registration lock | I | I | R/A | C |
| Cohort run (two sections) | C | R/A | C | I |
| Scoring (blind) + analysis | I | I | R/A | I |
| Reporting / write-up | C | C | R/A | C |

## Recruitment (the ask)

- **Student** — one per participating graduate school. Ask: co-author the transfer-test item bank and run a
  short dry pilot. Commitment: ~2–3 half-days across item authoring + pilot. Benefit: co-authorship on the
  methods/materials, hands-on assessment-design experience.
- **Pedagogical engineer** — the institution's teaching-and-learning / e-learning engineer. Ask: consent,
  scheduling, randomization, data plan. Commitment: the ethics submission (front-loaded) + ~1 session-day
  per section. This is the role that unblocks everything human; recruit first.
- **Researcher** — the contributing scientist (the "R" of the trio). Ask: lock the pre-registration, score
  blind, analyse, report.

## Timeline (anchored to the two pending gates)

Two things gate data collection (`PREREGISTRATION.md` §10): the **frozen item bank** and **IRB/consent
sign-off**. Everything else is ready. Suggested ordering relative to the target section (T = first session):

- **T − 8 weeks:** engineer opens the IRB/ethics submission; student begins the item bank (aim for ~2× the
  transfer items you need, so pilot attrition leaves a clean frozen set).
- **T − 4 weeks:** dry pilot (n = 1–3) via the packaged extension (`studium.vsix`) — check per-item timing
  and that scores are not at ceiling/floor; revise + **freeze** the item bank (version it in-repo).
- **T − 2 weeks:** researcher runs `power_analysis.py` on the *actual* section sizes to confirm the target n
  and MDE (n = 60 → d_z = 0.36; n = 120 → 0.26), and **locks** the pre-registration (tag the commit).
- **T:** cohort run across the two sections (within-subject crossover; arm/order from the engineer's seeded
  list).
- **T + 1–2 weeks:** researcher exports the study table (`pilot_export.py` over the consented telemetry),
  scores blind, runs the analysis, reports.

The pre-registration itself is deposit-ready for the **end-July preprint** — the trial does not block the
deposit; it is the confirmatory follow-up the deposit pre-registers.

## What the trio uses (already built — do not rebuild)

- **Packaged extension** for the dry pilot + the run: `pnpm --filter studium-vscode package` →
  `studium.vsix` (install per `apps/studium-vscode/README.md`; testers still need the cloned repo).
- **`power_analysis.py`** — plug in the real section sizes for the final n / MDE.
- **`pilot_export.py`** — projects the consented `ai_audit_result` telemetry into the study table.
- **The deterministic verdict-deck scoring** — key-free, so scoring is blind by construction (§7).
- **The gate-validity harness + construct validation** — already establishes the instrument recovers the
  intended disposition on synthetic learners; the trial is the human-cohort confirmation.

## Pre-flight checklist (before the first real session)

- [ ] IRB/ethics sign-off obtained; consent form final (engineer).
- [ ] Transfer-test item bank frozen + versioned in-repo; dry-pilot timing/ceiling checked (student).
- [ ] Section sizes confirmed; `power_analysis.py` re-run on them; MDE acceptable (researcher).
- [ ] Randomization list generated + held by the engineer; researcher does **not** hold it.
- [ ] Data-management plan annexed (retention, access, deletion) (engineer/PI).
- [ ] Pre-registration commit tagged/locked (researcher).

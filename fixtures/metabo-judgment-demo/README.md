# Flagship capsule — concept → reproduce → judge (metabolomics)

The north-star loop on **real metabolomics content**: a learner reproduces a genuine
annotation computation, then audits an AI reading of *their own* result that over-interprets
it — the failure mode that matters most in untargeted LC-MS/MS, where a spectral-similarity
score is routinely mistaken for a confirmed identification.

## The loop

1. **Concept** — annotation confidence and the MSI identification levels (Sumner 2007 /
   Schymanski 2014): a spectral-library match is a *putative* annotation, not a confirmed
   structure.
2. **Reproduce** (`run.py`) — computes the real GNPS-style **modified cosine** between an
   experimental MS/MS spectrum and a library reference of a near-analogue (precursor differs
   by one CH2), allowing the precursor mass shift. Deterministic landmark:
   `MODIFIED_COSINE=0.6477 MATCHED_PEAKS=7`. Stdlib only.
3. **Judge** (`judgment.json`) — a `spot_the_flaw` (verdict-deck) scene grounded on that
   landmark. The AI reading claims the 0.65 match is a *confirmed MSI-level-1, novel*
   identification. The learner must flag the three over-confidence claims **and not** flag the
   two correct ones (the modified cosine legitimately tolerates the mass shift; seven fragments
   really are shared). Over-flagging the sound claims registers as over-distrust; missing the
   over-confidence registers as over-trust — exactly the bidirectional signal D1 measures.

## Why this content

Modified cosine is the actual algorithm behind molecular networking and GNPS library search,
and a moderate score (~0.65) on an analogue is the canonical site of dangerous AI
over-confidence: the MSI ladder maps one-to-one onto `trust_calibration`, so the assessment is
authentic to how a working scientist must judge machine output. The score is the graded
*evidence*, not the graded object — the learner is assessed on the judgment, not the float.

## Fidelity gate

A capsule is trustworthy only if it re-derives its headline statistic within tolerance. Here
that is the deterministic modified cosine (0.6477); `test_modified_cosine.py` locks it. In the
full flagship the gate compares the learner's re-derived value against the source paper's
reported number within a declared tolerance.

## From demo to full flagship (weeks; needs a redistributable dataset)

This scaffold proves the pattern on small, self-contained real spectra. The full flagship swaps
in a **real public FBMN job** and adds the formula/class step:

1. **Data.** A redistributable (CC0/CC-BY) GNPS2/MassIVE FBMN spectrum pair from a frontier
   reverse-metabolomics study (e.g. conjugated bile-acid discovery) — confirm the license and
   pin the accession (MSV / MassIVE task id) before bundling. Replace `spectra.json`.
2. **Pipeline.** Extend `run.py` to call the `metabo-library-match` / `metabo-network` /
   `metabo-sirius` skills (matchms + SIRIUS/CANOPUS) on the real mgf; the landmark becomes the
   paper's headline number (a specific network-propagated MSI-L3 analogue).
3. **Judgment.** Keep the same over-confidence flaw, now anchored on the real feature id and the
   real MSI level from CANOPUS/COSMIC.

**Honest boundary.** This directory is the *pattern*, proven on real (small) metabolomics math.
The full flagship — a real public FBMN job re-derived within tolerance plus SIRIUS/CANOPUS — is
weeks of work and is gated on a confirmed redistributable dataset; do not present the demo as a
completed flagship.

## How it wires into Studium

`run.py` is a `reproduction` scene's `run_manifest` target (`expected_outputs: outputs/match.json`,
`verify_checks: file exists: outputs/match.json`); the learner's own run produces the landmark,
which grounds `judgment.json` (`reference_from_run: metabo-modified-cosine`). Run attestation
(D5) quarantines a fabricated run so only a real execution feeds the trust signal.

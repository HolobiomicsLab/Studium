# grounding_relevance — are a bundle's citations on-topic, or just present?

An **additive validity tool**. It does not touch the eval harness, the auditor,
or any other code — it reads a finished lesson bundle and asks one question the
auditor does not ask:

> Are the bibliographic citations attached to a scene actually **about** that
> scene, or are they merely **present**?

## The gap it closes

The eval auditor scores the `grounding_citations` dimension by **presence** of
evidence: if an intro/concept scene carries any attached bibliographic ref, the
dimension scores 1.0. That is gameable. In `STUDIUM_PERSPICACITE_MODE=mock`, the
enricher bolts a single fixed metabolomics paper —
*"Untargeted metabolomics reveals a link between gut microbiota and host energy
metabolism"* (`10.1073/pnas.1319030111`) — onto **every** scene, including a
"Eukaryotic Cells" / "Peroxisomes" biology lesson. The bundle still scores
`grounding_citations: 1.0`, because the citation is *there*. It is just
off-topic.

This tool measures **topical relevance**, distinguishing **real (relevant)**
grounding from **presence-only** grounding. Run against that exact mock bundle it
returns verdict `presence_only` (mean best-ref relevance ≈ 0.04, grade 0.0) — the
honest counterweight to the auditor's 1.0.

## What it measures (and the lexical-vs-semantic caveat)

Relevance is a **lexical** signal: the Jaccard overlap between the bag of content
words in the scene (`title + markdown`) and the bag of content words in the
citation (`title + excerpt`), after lowercasing, splitting on non-alphanumerics,
and dropping a small English stopword set + tokens shorter than 3 chars.

This is a **token-overlap proxy, not a semantic embedding match**. Consequences:

- A citation that **paraphrases** the scene with disjoint vocabulary scores low
  even though it is topically apt → possible **false off-topic flag**.
- A citation that shares surface vocabulary but is about a different sub-topic
  could score deceptively high → possible **false on-topic pass**.

So this tool **complements — it does not replace —** the auditor's presence
check. It is cheap (pure stdlib, no LLM, no embeddings, no network) and it
reliably separates the clear cases: a metabolomics paper on a peroxisomes lesson
has near-zero overlap and is flagged; a peroxisome-biology paper on the same
lesson clears the threshold.

It distinguishes **mock (off-topic) grounding** from **live-literature
(on-topic) grounding**: a real Perspicacité search returns refs that share the
scene's subject vocabulary and clears the threshold; the mock fixture does not.

## Scorecard

`analyze_bundle(bundle, threshold=0.06)` reports, over intro/concept scenes that
carry an `evidence.bibliographic_refs` block:

- `n_evidenced_scenes` — how many grounded scenes were scored.
- `mean_best_relevance` — mean over evidenced scenes of each scene's best-ref
  relevance (`None` if no evidenced scenes).
- `irrelevant_scenes` — scenes whose **best** ref relevance is below `threshold`
  (citations present but off-topic); each is a finding.
- `relevance_grade` ∈ [0, 1] — fraction of evidenced scenes whose best-ref
  relevance ≥ `threshold`.
- `verdict` — `"relevant"` if `relevance_grade ≥ 0.5`, else `"presence_only"`
  (citations present but largely off-topic); `"no_evidence"` when nothing was
  grounded.

The `0.06` threshold is a conservative Jaccard floor: off-topic mock refs sit
near 0, on-topic refs that share the scene's subject vocabulary clear it.

## Usage

```bash
PY=/Users/holobiomicslab/git/prototype-build/.venv/bin/python

# score a specific bundle (zip or lesson.json)
$PY eval/validity/grounding_relevance/run_relevance.py \
    --bundle eval/reports/01-deterministic-XXXX/01-bundle.zip

# or point at a run dir; the *-bundle.zip inside it is scored
$PY eval/validity/grounding_relevance/run_relevance.py \
    --run-dir eval/reports/01-deterministic-XXXX
```

Prints the scorecard and writes a gitignored JSON report under `reports/`.
Exit code is `1` when the verdict is `presence_only` (usable as a CI signal),
else `0`.

### Producing a grounded bundle to score

A deterministic eval run leaves `evidence: null` (Perspicacité off). To get a
bundle with evidence blocks, enable the mock enricher:

```bash
STUDIUM_PERSPICACITE_ENABLED=on STUDIUM_PERSPICACITE_MODE=mock \
  $PY eval/run_eval.py --corpus 01
# then score eval/reports/01-*/01-bundle.zip as above
```

## Tests

```bash
/Users/holobiomicslab/git/prototype-build/.venv/bin/python \
  -m pytest eval/validity/grounding_relevance/tests -q
```

Pure stdlib, no new dependencies. Touches only `eval/validity/grounding_relevance/`.

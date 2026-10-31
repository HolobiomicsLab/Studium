English · [Français](learner-model.fr.md)

# Learner model

Studium keeps, for each concept, two separate estimates: how well the learner has *shown* they know it (mastery), and how likely they are to *still recall* it now (retention). This page gives the equations exactly as the code applies them, and the rules that keep both estimates honest. You do not need it to use Studium; read it to judge what a mastery figure means.

## Mastery: a Beta estimate

Each concept starts with a uniform prior, α = 1 and β = 1. α collects evidence of knowing, β evidence of not knowing. Mastery is the posterior mean:

```text
p = α / (α + β)
```

A graded answer at difficulty w (between 0 and 1, from the concept's Bloom level, see [Scene types](scene-types.md#difficulty)) with h hints updates it:

```text
correct:  α ← α + (2 − w) / (1 + 2h)
wrong:    β ← β + (1 + w)
```

### Hints discount the credit

Each hint shrinks the credit of a correct answer. At w = 0.5, an unhinted correct answer adds 1.5, one hint 0.5, two hints 0.3. Leaning on hints cannot certify a concept as cheaply as answering alone.

### Correction for guessing

On a choice item, a learner can be right by luck. With k right options out of n, the guess rate is g = k / n. A wrong answer then also moves the credit a lucky guess would have earned from α to β:

```text
τ = min(α − 1, (2 − w) · g / (1 − g))
wrong:    α ← α − τ,   β ← β + (1 + w) + τ
```

For a learner who knows a fraction of the items and guesses the rest, the expected estimate tends to that fraction rather than to the fraction plus lucky guesses. A coin-flipper on true/false items no longer reads 0.5. α never drops below its prior of 1, and correct answers are not changed.

### Cap on old evidence

When α + β exceeds 20, both are scaled down by the same factor. The mean is kept, and a new answer always carries at least about 5 % of the total weight, so a learner who stops knowing a concept is not hidden behind a long early streak. Attempt counts are not scaled.

The update is in [`beta-updater.ts`](../../packages/adaptation-engine/src/beta-updater.ts).

## When a concept counts as mastered

| Use | Condition |
|---|---|
| Unlock a dependent concept in the graph | each direct prerequisite at p ≥ 0.8 (0.6 in a `lenient` universe), with at least 3 graded attempts |
| Certify mastery (a mastery claim is written) | p ≥ 0.8, at least 3 graded attempts, not measured as overconfident, not measured as over-trusting |
| Count as "due" in the study plan | p ≥ 0.6 and the review is due |

The three-attempt floor means two lucky answers can let the learner move on but never certify the concept.

## Retention: FSRS

Each graded answer, and each self-rating, is a review of the concept in a scheduler derived from FSRS-4.5 (Free Spaced Repetition Scheduler) with its published default weights. The memory of a concept has a stability S, in days, and a difficulty between 1 and 10. Retrievability, the probability of recall t days after the last review, is:

```text
R(t) = (1 + (19/81) · t / S) ^ (−0.5)
```

A concept is due when R falls to the target retention of 0.9; with these constants that happens after S days. A successful review increases S, more so when it comes late (the spacing effect); a lapse resets it to a lower value, never a higher one.

| Event | FSRS grade |
|---|---|
| Graded answer, wrong | again |
| Graded answer, right with hints | hard |
| Graded answer, right without hints | good |
| Self-rating | the learner's choice: again, hard, good or easy |

The scheduler is in [`fsrs.ts`](../../packages/adaptation-engine/src/fsrs.ts). Memory is kept per lesson and on the learner's cross-lesson profile, so a concept reviewed in one lesson is known in another.

## Effective mastery

What the learner can use now is the posterior discounted by recall:

```text
m_eff = p · R(t)     when the concept has been reviewed
m_eff = p            when it has never been reviewed
```

Skipping a concept as already mastered reads effective mastery, so a concept mastered weeks ago and since faded is not skipped. The function is `effectiveMastery` in [`learner-state`](../../packages/learner-state/src/index.ts).

## Self-rating

After a free-text answer that no judge assessed, the learner compares it with the reference and rates their recall: again, hard, good or easy. The rating is FSRS input only, for every concept of the rated scene. It schedules the next review and never changes α or β. A request waiting for a rating is saved with the learner's state, so it survives a server restart.

## Calibration

### Confidence

A `meta_checkpoint`, or a confidence given with a quiz answer, is compared with measured mastery:

```text
gap = c / 4 − p        c = declared confidence, 0 to 4
```

A positive gap is overconfidence, a negative gap underconfidence. A checkpoint sets the gap to its latest value; confidences given with answers form a running average (weight 0.4 per answer). Within ±0.4 the learner is calibrated. Only measured overconfidence withholds a mastery certificate; an underconfident learner who has proven the concept is not penalised.

### Trust in AI output

A `spot_the_flaw` grounded in a real executed result measures how far the learner trusts a flawed AI reading of it:

```text
over_trust    = missed flaws / planted flaws
over_distrust = sound claims wrongly flagged / sound claims on offer
gap           = over_trust − over_distrust      (running average, weight 0.5)
```

Measured over-trust beyond 0.4 withholds a mastery certificate. A signal-detection summary (discrimination A′ and bias c) is also kept for reading; it never gates.

## Unmeasured is not zero

The model never turns an absence of evidence into a value.

- An answer nobody graded (free text without a judge) moves neither α nor β, does not count as an attempt, does not start or clear an error streak. It is counted apart, as an ungraded attempt.
- A concept never reviewed has no retention evidence: its effective mastery is its posterior, not zero.
- A calibration never measured is neither calibrated nor miscalibrated, so no gate fires on it.
- Over-distrust is unmeasured when a scene offers no sound claims; the gap then reflects over-trust only.
- A concept only self-rated is listed in the study plan as "Due for review", never as "To relearn".
- The class report states accuracy only where a key or a judge graded.

See also [Honesty and provenance](honesty-and-provenance.md) and the [glossary](glossary.md).

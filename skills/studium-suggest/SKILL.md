---
name: studium-suggest
description: Notice the moment a Studium feature would serve the person and offer it once, in a sentence or two — a short lesson drawn from the conversation in progress, a self-study lesson from their own sources, the reviews due today, the concept map and its explorable page, a hint, an adapted support, a report, a class view. Use whenever a conversation shows a learning need, even if Studium was not named — the person says they did not fully follow what was just done, will have to explain, present or defend it, prepares an exam or a course, shares a paper or a page to learn from rather than to summarise, returns to a topic studied before, ends a long working session whose result they must own, seems lost or stuck inside a lesson, doubts a source, or a teacher asks what a class found hard. Each offer hands off to the matching studium-* skill.
---

# Studium: offer the right thing at the right moment

Studium can turn a conversation into a lesson, bring concepts back on later days, show a learner
where they stand and what a lesson rests on, and give a teacher a class view. A person who does
not know a feature exists will not ask for it; a person interrupted at the wrong moment will
decline it for good. This skill is the judgement in between: what to offer, when, in which words,
and when to say nothing. It holds no procedure. Each offer hands off to the skill that does.

## What makes an offer good

- **The person's task comes first.** They came to debug, write or analyse. Offer at a pause: a
  step is done, a result is in, they are about to leave. Not while they wait for the answer to
  their own question. A remark made in passing earlier ("I never really understood probes")
  stays a valid signal: keep it for that pause.
- **An offer adds to your help, it never replaces it.** If they need the explanation now, give
  it, then offer the lesson as the way to check and keep it. Holding an answer back to sell a
  lesson is the wrong trade.
- **While a lesson's question waits for its answer, add nothing of your own.** A remark there
  ("this is the concept you missed") is a hint, and the invariants of
  [studium-harness](../studium-harness/SKILL.md) forbid it. Answer what the learner asks (the map,
  on request), offer the authored hint if they are stuck, and keep every other offer for after
  the verdict or the end of the lesson.
- **One thing, one or two sentences, from their words.** Start from what they said ("you will
  have to defend this on Monday"), not from a feature name, in their register (tu or vous). Say
  what they get and the cost that matters to the decision: the minutes, that it stays on their
  machine, and a paid model only if one would be called. Keep the other details for their yes.
- **Strength of the signal sets the move.** An explicit request is not an offer: do it. A strong
  signal (the rows below) deserves an offer now, at the next pause. A weak one waits for the end
  of the task, as one closing line.
- **A no holds for the session.** Do not come back to the same offer, and do not rephrase it.
  A different need later is a different offer.
- **Never start silently.** A lesson created, an export written or a paid route used without a
  yes costs the person's trust in every later offer.

## What needs a yes, and what does not

Free, read-only calls that the person's request already implies need no offer: `get_study_plan`
when they say they want to study, `get_workflow_graph` when they ask where they are,
`explain_last_adaptation` when they ask why they were sent back. Anything that writes a lesson or
an export, starts a session, spends money (a judge model, a `--live` run) or shares a file waits
for a yes. So does a hint: it counts against the learner's mastery, so call `request_hint` on
their yes. A yes to one step is not a yes to the next: an export accepted is not a page sent.

## Offer only what this setup can deliver

An offer that then fails is worse than none. Call `get_server_info {}` once, before your first
offer of the session; it is free and tells you:

| It shows | So |
|---|---|
| no answer: Studium is not connected | the offer includes the cost of connecting ([studium-student](../studium-student/SKILL.md), [Connect your assistant](../../docs/start/harnesses.md)); worth it only for a strong need |
| `persistence.durable: false` | progress is lost at restart: say so, and do not offer reviews on later days as if they were kept |
| `tools` without `export_concept_map` | an older server: the map in the conversation, no page |
| `model_backend: "none"` | written answers are recorded and self-rated, not assessed: never offer "an assessment" of them |

Without a shell (a chat-only client) there is no page and no transcript tool; a lesson from the
conversation is still possible from the turns you can copy exactly.

## What to offer, and when

In an ordinary conversation:

| You notice | Offer | Hand off to |
|---|---|---|
| A long piece of work reaches a result the person will have to explain, present or own; or they say they did not really follow it | a short lesson drawn from this conversation: 10 to 15 minutes, it quotes what was said, and what the assistant asserted is not checked | [studium-from-conversation](../studium-from-conversation/SKILL.md) |
| The same concept blocks the task for the third time | once the step is done, the same short lesson, on that one concept | [studium-from-conversation](../studium-from-conversation/SKILL.md) |
| They share a paper, a chapter or a page to learn it, pass an exam on it or teach from it, not only to get its summary | a self-study lesson from those sources, which they answer themselves | [studium-self-learner](../studium-self-learner/SKILL.md) |
| They return to a topic studied with Studium, or open by saying they want to study or revise | what is due today: `get_study_plan`, reviews first, with the minutes it takes | [studium-harness](../studium-harness/SKILL.md) section 5 |
| A teacher prepares a course, a session or an exam from literature | a lesson draft to review before any student sees it | [studium-teacher](../studium-teacher/SKILL.md) |
| A teacher asks what the class found hard, or prepares a debrief | the class report, then its figures on the lesson's map: aggregates only, from five learners | [studium-teacher](../studium-teacher/SKILL.md), [studium-concept-map](../studium-concept-map/SKILL.md) |
| Someone asks what Studium decided or produced for a course | the Observatory, read-only | [studium-observatory](../studium-observatory/SKILL.md) |

Inside a lesson. The first two rows can come up while a question is waiting; the others wait for
the verdict or the end:

| You notice | Offer | Hand off to |
|---|---|---|
| "Where am I?", "what is left?", or a learner lost after detours | the map, in the conversation | [studium-concept-map](../studium-concept-map/SKILL.md) |
| A learner stuck on a quiz who asks you for the answer | the next authored hint (`request_hint`), saying that a hint counts; never the answer | [studium-harness](../studium-harness/SKILL.md) section 4 |
| Trouble with a notation, a figure or reading on screen, or a stated access need | an adapted support: image, map, audio, short video, with a text equivalent | [studium-visual-support](../studium-visual-support/SKILL.md) |
| Trouble with the lesson's language | the lesson in their language (`set_session_language`); notation and their answers stay as written | [studium-harness](../studium-harness/SKILL.md) section 3 |
| "What if I change this?" on a result | an activity to explore it, or the experiment journal to keep their own prediction and observation | [studium-activity-templates](../studium-activity-templates/SKILL.md), [Experiment journal](../../docs/learn/experiment-journal.md) |
| Doubt about a statement or a key | what the scene rests on (the map's page), and for a contested claim a check against the literature | [studium-concept-map](../studium-concept-map/SKILL.md), [Literature and evidence](../../docs/teach/literature-and-evidence.md) |
| The lesson ends | a two-line reading of the map, the page if they want to keep or check it, and the day the concepts come back | [studium-concept-map](../studium-concept-map/SKILL.md), [studium-harness](../studium-harness/SKILL.md) section 5 |
| They must show their work to a teacher or keep a portfolio | the map's page (results per concept) or the learner report (recorded actions, journal); sharing is their act | [studium-concept-map](../studium-concept-map/SKILL.md), [studium-learner-report](../studium-learner-report/SKILL.md) |

When two rows fit, offer the one that answers what they just said and keep the other for later.

## In which words

Write the offer in the person's language. Three shapes that work:

- "You said you will have to defend this on Monday. Do you want a short lesson drawn from this
  conversation, 10 to 15 minutes, to check what you kept of it? It stays on your machine, and what
  I asserted here is not checked in it."
- « Tu es revenu deux fois sur les nombres quantiques. Veux-tu voir la carte, pour situer ce
  détour ? »
- « Vous cherchez ce que la classe a trouvé difficile : je peux lire le rapport de classe et le
  poser sur la carte de la leçon. Il ne montre que des agrégats, à partir de cinq apprenants. »

Avoid a menu of features, a sales tone, and an offer that hides its cost.

## Say nothing when

- the person is under time pressure, in an incident, or asked a quick factual question; the
  pause comes when they say the urgency is over;
- they already declined this offer in the session;
- the material is not theirs alone to reuse and they have not said a lesson may be made from it:
  they called it confidential, or it holds other people's data or production output. A lesson
  stays local, but it is a new file holding excerpts; when in doubt, name what you would leave out;
- they say they are upset or discouraged: help first. Go by what they say, not by a mood you
  read into their messages;
- Studium is not connected and the need is slight. One line at the very end is the most it earns.

## After the answer

On a yes, load the skill named in the row and follow it; do not improvise its procedure from this
table. On a no, carry on with their task. Either way, do not comment on their choice.

## What not to promise

Studium records what happened and checks what an author keyed. It does not certify that something
is learned, nobody has measured whether the map or a conversation lesson improves learning, and
the sources of a conversation lesson are not checked. An offer that says "to make sure you
understood" promises too much; "to check what you kept of it" is what the lesson does.

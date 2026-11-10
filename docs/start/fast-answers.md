English · [Français](fast-answers.fr.md)

# Keep answers fast

Studium grades an answer and chooses the next screen in a few milliseconds. What you wait for is the
assistant that relays it. Three choices decide most of that wait:

- **A session for the lesson.** Play a lesson in a new, short session, not at the end of a long working
  conversation: every answer carries the whole conversation behind it.
- **A fast model.** Relaying needs no reasoning, since Studium grades and routes. Keep the larger model for
  a question that needs a real explanation.
- **The MCP connection** described in [Connect your assistant](harnesses.md), not shell calls to the HTTP API: each shell call starts a
  process.

## What was measured

Measured on the demo lesson `atomistique-l1` with `tools/latency_bench.py` (Claude Code, medians over six
answers, 6 November 2026):

| Who relays | End of the reply | First word |
|---|---|---|
| a large model, through shell calls, at the end of a long working session (a real trial, desktop app) | 27 s | about 20 s |
| the same large model, short session, MCP tools | 8.2 s | 5.4 s |
| the fast model, short session, MCP tools | 5.4 s | 2.0 s |
| the lesson agent `studium-lesson` as the session (see [Claude Code](claude-code.md#use-the-lesson-agent)) | 5.5 s | 1.9 s |
| a large model handing every answer to that fast agent | 16.1 s | 13.5 s |

One run per line: a difference of a second between two lines is not established. The bench measures a
relay in Claude Code; it does not measure the other clients on this page, or what anyone learns. Lowering
the reasoning effort changed nothing measurable. The last line is the trap: an agent placed between you and
the server makes two models write every screen.

## Play in forms

A prototype goes one step further: where the client can show forms (MCP elicitation), `play_in_forms` lets
Studium ask the questions itself. You read a screen or pick a choice in a form, the verdict opens the next
form, and no model writes anything in between; the conversation resumes when a step needs your own words or
when you close a form to ask something. When the lesson has a concept map, every scene form offers `map`:
the map form lists each concept with its id, returns to the untouched scene when accepted empty, or takes
`contest_concept` and `claim` (`known` or `unsure`) to ask the check questions and then resume that scene.
Only a hint, a question or a proposal still needs the conversation, as the help line says. A form never asks
you to say "continue", since nothing can be said in it. Ask your assistant to "play the next steps in forms".
How clients draw a long screen, a formula, or this map form has not yet been observed in a real client.

With no model in between, the server's own part is small: an answer given in a form or on a panel gets its
verdict in under 20 ms at the 95th centile, transport included (same script, `--mode forms` and
`--mode panel`, three runs of 32 to 40 answers each, the learner's state saved to disk, 6 November 2026).
The time a client then takes to draw the screen is not in that figure and has not been measured.


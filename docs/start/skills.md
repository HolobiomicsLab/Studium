English · [Français](skills.fr.md)

# Skills

Skills are written procedures your assistant reads at the right moment: how to onboard a teacher, how to
drive a lesson without answering for the learner, how to build a self-study lesson. They come with the
repository in `skills/`. A skill brings no model, account or server of its own: connect the Studium server
first ([Harnesses](harnesses.md)).

You do not need a skill to learn a topic in a conversation. When the server connects, it gives the
assistant its instructions, and the `learn` and `review` prompts start the two everyday flows.

## Available skills

| Skill | Use it to | Example request |
|---|---|---|
| `studium-student` | install or connect Studium, set up Copilot Student or another assistant, start a first lesson | "I have Copilot Student; help me start the course." |
| `studium-teacher` | install, connect an assistant, draft a lesson from literature, review it before a pilot | "Help me prepare my first course from this article." |
| `studium-harness` | run the lesson loop over MCP, HTTP or the file channel: present scenes, collect the learner's answers, run capsules honestly | "Drive this session and wait for my answers." |
| `studium-self-learner` | turn references you chose (a web page, a PDF, a text) into a self-study lesson with the Python packet tools, then play it | "Build a lesson from this chapter, then play it with me." |
| `studium-from-conversation` | turn the conversation in progress, or a past session, into a short lesson that quotes it, with a concept map | "Make a short lesson from this conversation so I can check I understood why the gate sent me back." |
| `studium-concept-map` | show where you stand on each concept of a lesson, and export the map as a page to explore, with what each concept rests on | "Where am I in this lesson? Then export the map as a page." |
| `studium-suggest` | let the assistant offer the right Studium feature at the right moment, once, and wait for your yes | "Tell me when a short lesson or a review would help, and ask first." |
| `studium-activity-templates` | choose and adapt an interactive activity tied to a scene | "Let me explore this result with a template." |
| `studium-visual-support` | inspect source photographs or request an adapted image, map, audio or video through your assistant | "Prepare a visual aid with a text equivalent." |
| `studium-learner-report` | export a recorded activity trace or experiment journal as a local report | "Prepare my report without my private texts." |
| `studium-observatory` | run and read the Observatory, the read-only local view of what Studium produced | "Show me the decisions and evidence behind this course." |

## Use them in a checkout

The repository links the skills into `.claude/skills/` (Claude Code) and `.agents/skills/` (Codex and other
clients that read that folder). Clients that recognise these folders can load a skill on their own;
discovery depends on the client, its version, whether you trusted the project, and whether your checkout
kept the symlinks. If your client does not list a skill, `studium-observatory` for example, name its file.

In Codex, call a skill by name:

```text
Use $studium-student to connect my assistant and start the lesson my teacher gave me. Wait for my own answers.
```

In any client, the portable way is explicit:

```text
Read skills/studium-teacher/SKILL.md in this repository and apply it to my teacher onboarding.
```

Replace the name with the skill you need. The skill resolves its real folder to find the guides and tools
it refers to.

## Use them from another folder

To use the skills outside the checkout, link each skill folder into the skills folder your client reads,
for example `~/.claude/skills` for Claude Code or `~/.agents/skills` for Codex:

```bash
ln -s /path/to/studium/skills/studium-student ~/.claude/skills/studium-student
```

Point the links at a durable checkout, not a temporary worktree, and keep any entries already there. Do not
copy `SKILL.md` alone: it refers to guides and tools in the repository. After an update, open a new session
if your client caches its skill list. On Windows without symlinks, name the source file in your prompt.

## What a skill does not prove

A loaded skill does not prove that the Studium server is connected: check with `get_server_info`
([Harnesses](harnesses.md#check-the-connection)). An automated demo does not prove that anyone learned.
A request to onboard does not authorise a purchase, sharing with students or publishing data; the skills
ask before such steps and reuse the permissions you already gave for local ones.

Related pages: [Activity templates](../teach/activity-templates.md),
[Media and visual support](../teach/media-and-visual-support.md),
[Learner report](../learn/learner-report.md), [Observatory](../teach/observatory.md).

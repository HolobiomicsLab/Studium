English · [Français](models.fr.md)

# Choose your model

Studium ships no model and picks none. This page says where a model is used, what it must be able to do,
and how to work with a Copilot plan, with a model that runs on your machine, or with no extra model at all.

## Before you start

- Connect an assistant first: [Connect your assistant](harnesses.md). MCP is the protocol an assistant
  uses to call Studium's tools.
- A *judge* is a model that assesses a written answer; see
  [Honesty and provenance](../concepts/honesty-and-provenance.md#the-judge).

## Where a model is used

| Model | What it does | Where you choose it | Needed |
|---|---|---|---|
| Your assistant's model | builds a lesson from your sources, shows each step, passes your answers on | in the assistant (Copilot, Claude Code, Codex, OpenCode, Cursor) | yes |
| A judge model | assesses some written answers and leads the discussion steps | on the Studium server, with `LITELLM_BASE_URL` | no |

The two are independent. A Copilot plan gives your assistant its models; it does not give Studium an
endpoint, so it cannot serve as the judge.

## Your assistant's model

Studium asks one thing of it: the model must be able to call tools, since every step of a lesson is a tool
call.

### With a Copilot plan

1. Add the server to Copilot in VS Code:

   ```bash
   code --add-mcp '{"name":"studium","command":"npx","args":["-y","studium-mcp"],"env":{"LITELLM_BASE_URL":""}}'
   ```

2. Open Copilot Chat in agent mode and pick a model in the model picker. The models offered depend on your
   plan (Pro, or Copilot for students and teachers through GitHub Education): see
   [Connect Copilot](copilot.md).
3. Ask: "I want to learn … with Studium", and name your sources.

### With a model that runs on your machine

| Assistant | How |
|---|---|
| VS Code chat | run **Chat: Manage Language Models**, then **Add Models**: the Ollama extension for a model served by Ollama, or **Custom Endpoint** for any compatible server. VS Code offers a model in agent mode only if it supports tool calling. Reference: [AI language models in VS Code](https://code.visualstudio.com/docs/agent-customization/language-models) |
| OpenCode | configure a local provider, then add the Studium server: [Connect OpenCode](opencode.md) |

Building a lesson is the demanding part: every quotation must match its source passage character for
character, and Studium refuses a draft that does not. Playing a lesson asks less: the assistant shows the
text Studium returns and passes your words on. Lessons and progress live in `~/.studium`, whatever the
assistant, so a lesson built with one assistant can be played with another on the same machine.

## The judge model

Without a judge, nothing is lost: on a written answer Studium shows the reference, you compare and rate
your recall, and the verdict says that nobody assessed it. With a judge, some written answers are assessed
by the model and say so.

Set the judge in the assistant's configuration of the Studium server, next to `LITELLM_BASE_URL=`:

| Variable | Value |
|---|---|
| `LITELLM_BASE_URL` | the address of an OpenAI-compatible server, without `/v1`: Studium posts to `<address>/v1/chat/completions` |
| `LITELLM_API_KEY` | the bearer key, when the server asks for one |
| `LITELLM_MODEL` | the model name sent for the assessment of critiques; `studium/audit-judge` by default |

The server must also answer to the model name `studium/runtime-tutor`, which Studium sends for the
discussion steps and cannot be changed. The other settings are in
[Configuration](../reference/configuration.md#judge-model-optional).

A non-empty `LITELLM_BASE_URL` may be a paid route: check what the endpoint charges before you set it.

### A judge on your machine

A [LiteLLM](https://docs.litellm.ai/) proxy can give the two names to a local model. An example to adapt, for a model
served by Ollama:

```yaml
model_list:
  - model_name: studium/audit-judge
    litellm_params:
      model: ollama/<model>
      api_base: http://localhost:11434
  - model_name: studium/runtime-tutor
    litellm_params:
      model: ollama/<model>
      api_base: http://localhost:11434
```

Start the proxy with this file, then give its address to Studium, for example
`LITELLM_BASE_URL=http://localhost:4000`.

## What you get

- `get_server_info` reports `model_backend`: `none`, or `configured` when `LITELLM_BASE_URL` is set. Ask
  your assistant to call it.
- Each verdict says who assessed the answer (`assessed_by`): the author's `key`, a `judge`, or `none`. The
  notice on the first screen of a lesson an assistant wrote says whether a judge assesses written answers.
- If the judge does not answer, or answers with an error, the lesson goes on and the answer is recorded as
  not assessed.

## Limits

- No model that runs on a machine has been tried with Studium, neither as the assistant's model nor as the
  judge. What was checked is what Studium sends: one request to `<address>/v1/chat/completions` with the
  model name, the key and a JSON reply format, and what it does when that request fails.
- The LiteLLM file above has not been run with Studium.
- With `STUDIUM_EPHEMERAL=1` and a judge, set `STUDIUM_PSEUDO_SECRET` too: the server refuses to open a
  session without it. With the default, durable storage, nothing more is needed.
- An HTTP 200 from an endpoint does not prove that a model answered.
- Plans, models and limits of an assistant are set by its provider and change over time.

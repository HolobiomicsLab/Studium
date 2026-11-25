English · [Français](browser.fr.md)

# Play a lesson in your browser

**Status: experimental.** The browser player plays an existing Studium lesson in an ordinary web browser,
with no VS Code and no AI assistant. It runs on your own computer, or on a classroom workstation, and
answers only that computer. It does not build lessons: that still needs an assistant (see
[Quickstart](quickstart.md)). Read [Limits](#limits) before you rely on it.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/browser-player-quiz-dark.png">
  <img src="../assets/screenshots/browser-player-quiz-light.png" width="420" alt="A quiz step of the Atomistique L1 demo lesson in a web browser: step 3 of 32, a chip saying the quiz is graded by the author's key, a Validated chip, the question, a hint already shown, four choices with the second selected, the confidence scale and the Submit and Help buttons.">
</picture>

## Before you start

| Needed | Why |
|---|---|
| Node.js 20 or later (22 recommended) | it runs the player; one command in a terminal starts it |
| A folder of lessons (optional) | each lesson is a folder with its `lesson.json`; without one, the page lists your library and the short demo lesson shipped with Studium; more demo lessons are the `fixtures` folder of the [repository archive](https://github.com/HolobiomicsLab/studium/archive/refs/heads/main.zip) |
| A recent web browser | the lesson opens in it |

No VS Code, no assistant and no AI account are needed.

## Start the player

```bash
npx -y studium-mcp play /path/to/lessons
```

The player prints where it reads the lessons, where it keeps progress, and an address such as
`http://127.0.0.1:53817/play#token=…`, which it opens in your default browser. Keep the terminal open:
closing it, or Ctrl+C, stops the player. If no browser opens, copy the address into one.

The `play` command is in `studium-mcp` 0.6.4 and later.

| Option | Effect |
|---|---|
| `folder` | the folder of lessons; without it, your library (`~/.studium/library`) |
| `--port N` | the port on 127.0.0.1; without it, a free port chosen by the system |
| `--no-open` | print the address without opening the browser |

The same environment variables as the server apply: `STUDIUM_HOME`, `STUDIUM_DATA_DIR`,
`STUDIUM_LEARNER_ID`, `STUDIUM_EPHEMERAL=1` (see [Configuration](../reference/configuration.md)).

## Play

1. The page lists the lessons of the folder and of your library, then the demo lesson shipped with
   Studium, with their number of steps, whether a teacher approved them, and how far you got. While this
   list is on screen, it is read again each time you come back to its tab or its window: a lesson your
   assistant saved in your library meanwhile appears without a reload.
2. Choose one. It opens at your first unfinished step.
3. Answer in the page. Each step is drawn by the same renderer as the VS Code pane, with the same notices:
   who wrote the lesson and its answer key, and, after an answer, whether the key or a judge assessed it,
   or nobody. You also have hints, the confidence scale, recall ratings, the concept map, French or
   English (**⋯**, **Settings**), and the end-of-lesson summary.
4. **⋯**, **Choose another course** returns to the list; **Forget me** erases your learning data after a
   confirmation.

What the page does not do: capsule reproduction steps need the VS Code terminal, and the page says so;
there is no assistant to ask, so **Ask a question** is not offered and the explanation rung of **Help**
is closed with its reason.

## Where progress is kept

Progress is kept in `~/.studium/data` (or `STUDIUM_DATA_DIR`), as for the server your assistant starts,
so a lesson reopened after a restart resumes where you stopped. With `STUDIUM_EPHEMERAL=1` nothing is
written and progress ends with the player. One player is one learner: `STUDIUM_LEARNER_ID`, else
`anonymous`. People who share a computer account share that record; on a shared workstation, give each
student an account or set `STUDIUM_HOME` per student.

## Who can reach it

- It listens on 127.0.0.1 only: other computers, on the room's network or elsewhere, cannot reach it.
- Its address carries a key made for this run. Without it, nothing is answered; the key means nothing
  once the player stops. Do not paste the address in a chat or a shared document.
- Other web sites open in the same browser cannot call it: it refuses requests from other origins and
  answers none of them with permission to read.
- The page never receives an answer key before you answer: grading stays in the player.

The [design record](../design-records/specs/2026-11-25-browser-player.md) gives the details and what a
hosted, multi-user version would need (sign-in, one identity per learner, data protection).

## Limits

- **Tried by scripts only, on macOS.** No person has used the player yet. A headless Google Chrome
  driven by Playwright:
  - from this repository's build of the server, opened the list, played the first five steps of
    `fixtures/atomistique-l1` (an introduction, a concept, a quiz with a hint, graded by the author's key,
    and a summary audit, with its « not certified » notice and the recall rating), in light and dark themes,
    and resumed the same step after a page reload; a second run checked that progress kept on disk resumes
    at the same step after the player restarts;
  - from the published `studium-mcp` 0.6.4 (`npx`), played the Discover Studium demo lesson to its end,
    once with the CDN (`cdn.jsdelivr.net`) reachable and once with it blocked.
- **Not tried:** Windows and Linux (the browser opener uses `cmd /c start` and `xdg-open`), Firefox and
  Safari, a screen reader, a computer without network access, the plain-text fallback of equations, charts
  and molecules (the demo lesson played with the CDN blocked has none of them), a teaching room, several
  students on one workstation.
- After a recall rating, the rating box closes without showing « Noted »; the rating is recorded.
- Starting the player still needs Node and one command. Nothing yet starts it from a desktop shortcut or
  from VS Code.
- Report what you meet: [Report a problem or contribute](report-and-contribute.md).

// apps/lesson-mcp/src/feedback.ts
//
// Where a difficulty with Studium itself goes (INT-STUDIUM-062). The skills are not shipped with the
// VS Code extension or the npm package, so an assistant that loaded none still has to learn two things
// from the server: the exact addresses, so it never invents one, and what a report holds and leaves out.
// get_server_info returns FEEDBACK; one line of the server's instructions points to it.
export const REPOSITORY_URL = "https://github.com/HolobiomicsLab/studium";

/** What get_server_info returns under `feedback`: the addresses, then how to use them, in the order an
 * assistant needs them. Plain sentences: a harness shows or follows them as they are. */
export const FEEDBACK = {
  repository_url: REPOSITORY_URL,
  issues_url: `${REPOSITORY_URL}/issues`,
  new_issue_url: `${REPOSITORY_URL}/issues/new/choose`,
  contributing_url: `${REPOSITORY_URL}/blob/main/CONTRIBUTING.md`,
  security_url: `${REPOSITORY_URL}/security/policy`,
  guide_url: `${REPOSITORY_URL}/blob/main/docs/start/report-and-contribute.md`,
  how: [
    "When Studium itself fails, contradicts its documentation or cannot do what the person asks, say so plainly, help them on, then offer once, at a pause, to report it (new_issue_url) or to propose a change (contributing_url).",
    "A report holds: what was tried, what was expected, what happened (the exact message), the version and build of this result, the assistant and the platform.",
    "It holds never a learner's answers, a name, an answer key or a secret; shorten paths that name a person.",
    "The person posts it: draft the text with them and give the address. Post it yourself only when they ask you to, after they read the final text.",
    "A mistake in a lesson's content goes to its teacher or author, not here, unless the lesson ships with Studium. A vulnerability goes to security_url, never a public issue.",
  ],
} as const;

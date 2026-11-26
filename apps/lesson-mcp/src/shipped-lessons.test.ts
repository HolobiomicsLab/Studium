// apps/lesson-mcp/src/shipped-lessons.test.ts
//
// The lessons shipped with Studium (2026-11-25): a fresh install has no lesson, so the server finds the
// « Discover Studium » demo beside itself (shippedLessonsRoot) and offers it to a learner who has none. Here the
// real shipped bundles are played end to end through the real MCP server, in English and in French, the way a
// harness plays them: get_study_plan's next step, each display_markdown, the learner's words. The demo is drafted
// by an AI agent and carries an approval record: the tests check that the record and its receipt are bound to the
// exact bytes of lesson.json, whoever the reviewer, so a rebuild or a hand edit of lesson.json fails here until
// approve runs again; that the lesson's own text never asserts an approval (the status comes from the record); and
// that every passage it quotes is still in the documentation page it cites.
import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { hostFromEnvironment, shippedLessonsRoot } from "./index.js";
import { buildMcpServer, SERVER_INSTRUCTIONS } from "./server.js";

type Json = Record<string, any>;
const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(APP, "../..");
const SHIPPED = join(APP, "shipped-lessons");
const DRAFTS = join(APP, "shipped-lessons-src", "discover-studium");
const LANGUAGES = ["en", "fr"] as const;
const refOf = (language: string) => `discover-studium-${language}/lesson.json`;
const bundleOf = (language: string): Json => JSON.parse(readFileSync(join(SHIPPED, refOf(language)), "utf8"));
const draftOf = (language: string): Json => JSON.parse(readFileSync(join(DRAFTS, `draft.${language}.json`), "utf8"));
const approvalOf = (language: string): Json =>
  JSON.parse(readFileSync(join(SHIPPED, `discover-studium-${language}`, "approval.json"), "utf8"));

/** Words a lesson's fixed text must not hold: the approval status comes from the record, which can be missing or
 * stale (a copy in a library or a course folder, a rebuild), so the text never asserts it (rule 003). */
const APPROVAL_CLAIMS = [
  "approved by a teacher",
  "a teacher then approved",
  "teacher's approval record",
  "approuvée par un enseignant",
  "un enseignant a ensuite approuvé",
  "registre d'approbation d'un enseignant",
];
function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringsOf);
  return [];
}

const temps: string[] = [];
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });
function temp(prefix: string): string { const dir = mkdtempSync(join(tmpdir(), prefix)); temps.push(dir); return dir; }

async function startServer(home: string) {
  const { host } = hostFromEnvironment({ STUDIUM_HOME: home, STUDIUM_EPHEMERAL: "1" }, "/nonexistent-home", { shippedRoot: SHIPPED });
  const server = buildMcpServer(host);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "shipped-harness", version: "1.0.0" });
  await client.connect(clientT);
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Json> => {
    const result = await client.callTool({ name, arguments: args }) as { content: Array<{ text?: string }>; isError?: boolean };
    const body = JSON.parse(result.content[0]?.text ?? "null") as Json;
    if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(body)}`);
    return body;
  };
  return { call, close: () => client.close() };
}

/** The learner's words for the scene on screen: the right choice's letter, or the wrong one's when asked. */
function reply(scene: Json, draft: Json, wrong = false): string {
  if (scene.type !== "quiz") return scene.type === "explain_back" ? "My own words on why keywords are not counted." : "continue";
  const authored = draft.scenes.find((s: Json) => s.title === scene.title);
  const wanted = authored.choices.find((c: Json) => c.correct !== wrong).text;
  return scene.choices.find((c: Json) => c.text === wanted).id;
}

describe("where the server finds the shipped lessons", () => {
  it("beside the bundled script, through the npm bin link, from the sources, or where STUDIUM_SHIPPED_LESSONS says", () => {
    const pkg = realpathSync(temp("studium-pkg-")); // the script's real path is what the server uses
    writeFileSync(join(pkg, "studium-mcp.cjs"), "");
    mkdirSync(join(pkg, "shipped-lessons"));
    expect(shippedLessonsRoot({ scriptPath: join(pkg, "studium-mcp.cjs") })).toBe(join(pkg, "shipped-lessons"));
    const bin = temp("studium-bin-");
    symlinkSync(join(pkg, "studium-mcp.cjs"), join(bin, "studium-mcp"));
    expect(shippedLessonsRoot({ scriptPath: join(bin, "studium-mcp") })).toBe(join(pkg, "shipped-lessons"));
    expect(shippedLessonsRoot({ scriptPath: join(APP, "src", "index.ts") })).toBe(SHIPPED);
    expect(shippedLessonsRoot({ scriptPath: join(temp("lone-"), "lesson-mcp.cjs") })).toBeNull();
    expect(shippedLessonsRoot({ scriptPath: undefined })).toBeNull();
    expect(shippedLessonsRoot({ scriptPath: join(pkg, "studium-mcp.cjs"), env: { STUDIUM_SHIPPED_LESSONS: "off" } })).toBeNull();
    expect(shippedLessonsRoot({ scriptPath: undefined, env: { STUDIUM_SHIPPED_LESSONS: SHIPPED } })).toBe(SHIPPED);
  });

  it("is not set unless the entry point passes it, so a host built for a test keeps an empty catalog", async () => {
    const { host } = hostFromEnvironment({ STUDIUM_HOME: temp("studium-home-"), STUDIUM_EPHEMERAL: "1" }, "/nonexistent-home");
    expect(host.shippedRoot).toBeNull();
  });

  it("asks the harness to offer the demo before building a lesson", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/demo lesson shipped with Studium/);
  });
});

describe("the shipped « Discover Studium » lessons", () => {
  // Changed: 2026-11-25, the demo carries an approval record. It was a self-study lesson validated by nobody, with no
  // approval record (and the old check looked for approval.json in shipped-lessons/ instead of the language folder).
  // Now: teacher mode, drafted by an agent, an approval record bound to the exact bytes of lesson.json and one receipt
  // for those bytes that agrees with it. Nothing here names the reviewer or the scenes opened: any later honest
  // approval passes once approve runs on the current bytes (rule 003: the receipt says what happened).
  it("are drafted by an AI agent and carry an approval record bound to their exact bytes, with its receipt (rule 003)", () => {
    expect(readdirSync(SHIPPED).sort()).toEqual(LANGUAGES.map((language) => `discover-studium-${language}`));
    for (const language of LANGUAGES) {
      const folder = join(SHIPPED, `discover-studium-${language}`);
      const bytes = readFileSync(join(folder, "lesson.json"));
      const bundle = JSON.parse(bytes.toString("utf8")) as Json;
      expect(bundle.metadata).toMatchObject({ language, authoring: { mode: "teacher", drafted_by: "agent", author_is_learner: false } });
      expect(bundle.source_plan_id).toBe(JSON.parse(readFileSync(join(DRAFTS, `source-set.${language}.json`), "utf8")).source_set_id);
      expect(readdirSync(folder).sort(), language).toEqual(["approval.json", "lesson.json", "reviews"]);
      // The CI guard: a rebuild or a hand edit of lesson.json changes its sha256, so this fails until
      // experience_packet.py approve runs again (shipped-lessons-src/README.md).
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const approval = JSON.parse(readFileSync(join(folder, "approval.json"), "utf8")) as Json;
      expect(approval, `${language}: approval.json is bound to these exact bytes`).toMatchObject({
        schema: "studium-approval/1", bundle_sha256: sha256,
      });
      expect(typeof approval.reviewer === "string" && approval.reviewer.trim().length > 0, `${language}: the record names its reviewer`).toBe(true);
      expect(bundle.validated_by).toBe(approval.reviewer);
      const reviews = readdirSync(join(folder, "reviews"));
      expect(reviews).toContain("telemetry.jsonl");
      const receipts = reviews.filter((name) => name.endsWith(".json"))
        .map((name) => JSON.parse(readFileSync(join(folder, "reviews", name), "utf8")) as Json)
        .filter((receipt) => receipt.bundle_sha256 === sha256);
      expect(receipts, `${language}: one receipt for these bytes`).toHaveLength(1);
      expect(receipts[0]).toMatchObject({ decision: "approved", reviewer: approval.reviewer });
      expect(receipts[0]!.opened + receipts[0]!.not_opened, `${language}: the receipt accounts for every scene`).toBe(bundle.scenes.length);
      expect(typeof receipts[0]!.note === "string" && receipts[0]!.note.trim().length > 0, `${language}: the receipt says what happened`).toBe(true);
    }
  });

  it("never assert an approval in their own text: the status comes from the record (rule 003)", () => {
    for (const language of LANGUAGES) {
      const text = stringsOf(bundleOf(language).scenes).join("\n").toLowerCase();
      for (const claim of APPROVAL_CLAIMS) expect(text, `${language}: "${claim}"`).not.toContain(claim);
    }
  });

  // D7 (2026-11-26): the demo is the first lesson everyone plays, in the VS Code pane, the browser or a chat. Its text names
  // the control on screen ("press Concept map under the step; with an assistant, ask …"), never a surface the learner may
  // not have: no "in the VS Code pane, …", no "in a chat, …", no "tell your assistant …". The drafts are checked too, so
  // that a rebuild cannot bring the wording back.
  it("give no instruction that assumes a surface: no 'VS Code pane', no 'tell the assistant' (D7)", () => {
    const SURFACE_INSTRUCTIONS: Record<string, RegExp[]> = {
      en: [/\bvs code pane\b/, /\bin the pane\b/, /\btell (the|your) assistant\b/, /\bin a chat\b/],
      fr: [/\bpanneau vs code\b/, /\bdans le panneau\b/, /\bdis(-le)? à (ton|l')assistant\b/, /\bdans une conversation\b/],
    };
    for (const language of LANGUAGES) {
      for (const [what, value] of [["lesson.json", bundleOf(language).scenes], [`draft.${language}.json`, draftOf(language).scenes]] as const) {
        const text = stringsOf(value).join("\n").toLowerCase();
        for (const pattern of SURFACE_INSTRUCTIONS[language]!) expect(text, `${language} ${what}: ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  // D7: the welcome text said "about ten minutes" while metadata.duration_minutes, which the header shows, said 11.
  it("state one duration: the welcome text, metadata.duration_minutes and the scenes' estimated seconds agree (D7)", () => {
    const SAID: Record<string, Record<number, string>> = {
      en: { 10: "about ten minutes", 11: "about eleven minutes", 12: "about twelve minutes" },
      fr: { 10: "une dizaine de minutes", 11: "environ onze minutes", 12: "environ douze minutes" },
    };
    for (const language of LANGUAGES) {
      const bundle = bundleOf(language);
      const minutes = bundle.metadata.duration_minutes as number;
      const seconds = bundle.scenes.reduce((sum: number, scene: Json) => sum + (scene.estimated_seconds as number), 0);
      expect(Math.ceil(seconds / 60), `${language}: ${seconds} s of scenes`).toBe(minutes);
      expect(draftOf(language).duration_minutes ?? minutes).toBe(minutes);
      expect(SAID[language]![minutes], `${language}: a wording for ${minutes} minutes`).toBeDefined();
      expect(bundle.scenes[0].markdown, `${language}: the welcome step says ${minutes} minutes`).toContain(SAID[language]![minutes]);
    }
  });

  // D7: the shipped lessons are what the build script makes of the drafts, not hand edits. The script rebuilds them into a
  // temporary folder (--out) at the date the shipped ones were built (their enrichment timestamp); approve then rewrote
  // validated_by and validated_at and normalized the JSON, so those two fields are left out and the JSON is compared
  // parsed. So are the ids the build derives from the whole documentation pages (the source set's id and the passages'
  // numbers): an edit elsewhere in a cited page changes them without changing the lesson, and the quote test above
  // already fails when a quoted sentence goes.
  it("match a rebuild from their drafts (D7)", () => {
    const out = temp("studium-rebuild-");
    const built = bundleOf("en").scenes[0].evidence.enrichment_metadata.timestamp as string;
    execFileSync(process.execPath, ["--import", "tsx", join(APP, "scripts", "build-shipped-lessons.ts"), "--now", built, "--out", out],
      { cwd: APP, stdio: "pipe", timeout: 120_000 });
    const comparable = (bundle: Json): Json => {
      const { validated_by: _by, validated_at: _at, source_plan_id: _plan, ...rest } = bundle;
      return JSON.parse(JSON.stringify(rest, (key, value) => (key === "perspicacite_doc_id" ? undefined : value)));
    };
    for (const language of LANGUAGES) {
      const rebuilt = JSON.parse(readFileSync(join(out, `discover-studium-${language}`, "lesson.json"), "utf8")) as Json;
      expect(comparable(bundleOf(language)), `${language}: rebuild with scripts/build-shipped-lessons.ts, then approve again`).toEqual(comparable(rebuilt));
    }
  }, 120_000);

  it("quote, character for character, passages still in the documentation pages they cite", () => {
    const fold = (text: string) => text.normalize("NFC").replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ").trim();
    for (const language of LANGUAGES) {
      const refs = bundleOf(language).scenes.flatMap((scene: Json) => scene.evidence?.bibliographic_refs ?? []);
      expect(refs.length).toBeGreaterThanOrEqual(12);
      for (const ref of refs) {
        const page = /\/blob\/main\/(docs\/.+\.md)$/.exec(ref.prov_derived_from)?.[1];
        expect(page, ref.prov_derived_from).toBeDefined();
        expect(ref.license).toBe("CC-BY-4.0");
        // A documentation edit that drops a quoted sentence breaks the demo: rebuild it (shipped-lessons-src/README.md).
        expect(fold(readFileSync(join(REPO, page!), "utf8")), `${language}: ${ref.excerpt}`).toContain(fold(ref.excerpt));
      }
    }
  });
});

describe("a newcomer plays the demo through the MCP server", () => {
  for (const language of LANGUAGES) {
    it(`${language}: the plan proposes it, list_lessons labels it, and it plays to the end with a hint, a recall rating and a review date`, async () => {
      const { call, close } = await startServer(temp("studium-home-"));
      const draft = draftOf(language);
      const plan = await call("get_study_plan", { learner_id: "newcomer", language });
      expect(plan.next_step).toMatchObject({
        action: "start", tool: "start_lesson_session", arguments: { bundle_ref: refOf(language), learner_id: "newcomer" },
      });
      const listed = await call("list_lessons", { learner_id: "newcomer", language });
      expect(listed.lessons).toEqual([]);
      // Changed: 2026-11-26 (D7), list_lessons {language} listed the demo in both languages; it lists only the one in the
      // language asked for, since that version exists (the other stays startable by its ref, and listed without a language).
      expect(listed.shipped_lessons.map((l: Json) => [l.bundle_ref, l.source])).toEqual([[refOf(language), "shipped"]]);
      expect(listed.display_markdown).toMatch(language === "en" ? /Shipped with Studium/ : /Livrée avec Studium/);

      const started = await call(plan.next_step.tool, plan.next_step.arguments);
      // Changed: 2026-11-25, the demo carries an approval record: it is a teacher-mode lesson whose record matches,
      // so it has no self-study notice and its first screen names who drafted it and the reviewer the record names.
      const reviewer = approvalOf(language).reviewer as string;
      expect(started.authoring).toMatchObject({
        mode: "teacher", drafted_by: "agent", validated: true, shipped: true,
        approval: { recorded: true, matches: true, reviewer },
      });
      expect(started.authoring.notice).toBeNull();
      expect(started.presentation.display_markdown).toContain(language === "en"
        ? `> AI-drafted lesson, validated by ${reviewer}.` : `> Leçon rédigée par l'IA, validée par ${reviewer}.`);
      const sessionId = started.session_id as string;
      let presentation = started.presentation as Json;
      const types = new Set<string>();
      let hinted = false;
      let rated: Json | null = null;
      let last: Json = {};
      for (let guard = 0; guard < 30 && presentation; guard += 1) {
        const scene = presentation.scene as Json;
        types.add(scene.type);
        if (scene.id === "s4-quiz") {
          const hint = await call("request_hint", { session_id: sessionId });
          hinted = typeof hint.hint?.hint === "string";
        }
        const { transition } = await call("submit_response", { session_id: sessionId, input: { kind: "reply", text: reply(scene, draft) } });
        if (scene.type === "quiz") expect(transition.verdict).toMatchObject({ assessed_by: "key", correct: true });
        if (scene.type === "explain_back") {
          expect(transition.verdict.assessed_by).toBe("none");
          expect(transition.self_rating).toMatchObject({ requested: true, scene_id: scene.id });
          rated = await call("rate_recall", { session_id: sessionId, scene_id: scene.id, grade: "good" });
        }
        last = transition;
        presentation = transition.presentation;
      }
      expect([...types].sort()).toEqual(["concept", "explain_back", "intro", "quiz"]);
      expect(hinted).toBe(true);
      expect(rated).toMatchObject({ source: "self_rated", grade: "good" });
      expect(last.navigation.kind).toBe("complete");
      expect(last.display_markdown).toMatch(language === "en" ? /Next review: / : /Prochaine révision\s?: /u);
      // Once played, the demo is not offered again: what is left is the reviews it scheduled.
      const later = await call("get_study_plan", { learner_id: "newcomer", language, now_ms: Date.now() + 8 * 86_400_000 });
      expect(later.next_step.action).toBe("review");
      expect(later.next_lesson).toBeNull();
      await close();
    });
  }

  it("takes a detour through the graph question when the learner misses the graph quiz, then comes back", async () => {
    const { call, close } = await startServer(temp("studium-home-"));
    const draft = draftOf("en");
    const started = await call("start_lesson_session", { bundle_ref: refOf("en"), learner_id: "detour" });
    let presentation = started.presentation as Json;
    const order: string[] = [];
    let detour: Json | null = null;
    for (let guard = 0; guard < 30 && presentation; guard += 1) {
      const scene = presentation.scene as Json;
      order.push(scene.id);
      const { transition } = await call("submit_response", {
        session_id: started.session_id, input: { kind: "reply", text: reply(scene, draft, scene.id === "s4-quiz") },
      });
      if (scene.id === "s4-quiz") detour = transition.navigation;
      presentation = transition.presentation;
    }
    expect(detour).toMatchObject({ kind: "remediate", scene_id: "s12-quiz", returns_to: "s5-concept" });
    expect(order.slice(0, 6)).toEqual(["s1-intro", "s2-quiz", "s3-concept", "s4-quiz", "s12-quiz", "s5-concept"]);
    expect(order.filter((id) => id === "s12-quiz")).toHaveLength(1);
    await close();
  });

  it("is never offered, nor started in its place, once the learner has a lesson of their own", async () => {
    const home = temp("studium-home-");
    const own = bundleOf("en");
    own.bundle_id = "my-own-lesson";
    own.metadata.title = "My own lesson";
    mkdirSync(join(home, "library", "discover-studium-en"), { recursive: true });
    writeFileSync(join(home, "library", "discover-studium-en", "lesson.json"), JSON.stringify(own));
    const { call, close } = await startServer(home);
    const plan = await call("get_study_plan", { learner_id: "owner", language: "en" });
    expect(plan.next_step).toMatchObject({ action: "start", arguments: { bundle_ref: refOf("en") } });
    expect(plan.next_lesson.title).toBe("My own lesson");
    const listed = await call("list_lessons", { language: "en" });
    expect(listed.lessons.map((l: Json) => l.title)).toEqual(["My own lesson"]);
    expect(listed.shipped_lessons.map((l: Json) => l.bundle_ref)).toEqual([refOf("fr")]);
    const started = await call("start_lesson_session", { bundle_ref: refOf("en"), learner_id: "owner" });
    expect(started.authoring.shipped).toBeUndefined();
    // Changed: 2026-11-25, the demo is a teacher-mode lesson now. A copy in the learner's library has no approval
    // record beside it: no self-study notice, not validated, and its first screen gives the voice line of an
    // AI-drafted lesson without a record, never the name in its validated_by.
    expect(started.authoring).toMatchObject({ mode: "teacher", drafted_by: "agent", validated: false, approval: { recorded: false } });
    expect(started.authoring.notice).toBeNull();
    expect(started.presentation.display_markdown).toContain("> AI-drafted lesson, not reviewed by a teacher.");
    // The first screen claims no approval: neither the record's reviewer nor the lesson's own text says one happened.
    expect(started.presentation.display_markdown).not.toContain(approvalOf("en").reviewer);
    expect(started.presentation.display_markdown).not.toMatch(/validated by|approved/i);
    await close();
  });
});

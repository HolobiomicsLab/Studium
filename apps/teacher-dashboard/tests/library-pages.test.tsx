import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import LibraryPage from "../app/library/page";
import ReviewPage from "../app/library/[lesson]/review/page";
import { encodeLessonRef } from "../lib/library";

const request = vi.hoisted(() => ({ language: "fr", cookie: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  headers: () => ({ get: () => request.language }),
  cookies: () => ({ get: () => request.cookie ? { value: request.cookie } : undefined }),
}));
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  request.language = "fr";
  request.cookie = undefined;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "studium-library-pages-"));
  roots.push(root);
  const bundle = JSON.parse(await readFile(resolve(__dirname, "../../../fixtures/atomistique-l1/lesson.json"), "utf8"));
  bundle.scenes[0].markdown = "PRIVATE_LESSON_BODY";
  bundle.scenes[0].evidence = {
    bibliographic_refs: [{ title: "Reference title", prov_derived_from: "https://example.org/source", excerpt: "PRIVATE_SOURCE_EXCERPT", perspicacite_doc_id: "source-a", authors: [], relevance_score: 1 }],
    enrichment_metadata: { enriched_at: "2026-10-30T00:00:00Z", enrichment_version: "1" },
  };
  const quiz = bundle.scenes.find((scene: { type: string }) => scene.type === "quiz");
  quiz.choices[0].text = "PRIVATE_ANSWER_KEY";
  await mkdir(join(root, "course"));
  await writeFile(join(root, "course/lesson.json"), JSON.stringify(bundle));
  vi.stubEnv("BUNDLES_ROOT", root);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  return root;
}

describe("server-rendered library and review", () => {
  it("lists real filesystem lessons in French with status and key mix", async () => {
    await setup();
    const html = renderToStaticMarkup(await LibraryPage());
    expect(html).toContain("Bibliothèque de cours");
    expect(html).toContain("Atomistique");
    expect(html).toContain("Clé d’auteur");
    expect(html).toContain("/library/Y291cnNl/review");
    expect(html).not.toContain("PRIVATE_");
  });
  it("uses English from Accept-Language and lets a French cookie override it", async () => {
    await setup();
    request.language = "en-GB,en;q=0.9,fr;q=0.5";
    expect(renderToStaticMarkup(await LibraryPage())).toContain("Course library");
    request.cookie = "fr";
    expect(renderToStaticMarkup(await LibraryPage())).toContain("Bibliothèque de cours");
  });
  it("renders review metadata and source references without prompts, keys or excerpts", async () => {
    const root = await setup();
    const html = renderToStaticMarkup(await ReviewPage({ params: { lesson: encodeLessonRef("course") } }));
    expect(html).toContain("Parcours de la leçon");
    expect(html).toContain("Reference title");
    expect(html).toContain("https://example.org/source");
    expect(html).toContain("experience_packet.py approve --bundle");
    expect(html).toContain(root);
    expect(html).toContain("MySTRA indisponible");
    expect(html).not.toContain("PRIVATE_");
    expect(html).not.toContain("feedback_correct");
  });
  it("links to the existing MySTRA report when its service responds", async () => {
    await setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const html = renderToStaticMarkup(await ReviewPage({ params: { lesson: encodeLessonRef("course") } }));
    expect(html).toContain('href="http://localhost:8004/courses/course/mystra"');
    expect(html).not.toContain("MySTRA indisponible");
  });
  it("offers a concrete recovery message when BUNDLES_ROOT is absent", async () => {
    await setup();
    vi.stubEnv("BUNDLES_ROOT", "/does-not-exist-studium-v2");
    const html = renderToStaticMarkup(await LibraryPage());
    expect(html).toContain('role="alert"');
    expect(html).toContain("Bibliothèque indisponible");
    expect(html).toContain("BUNDLES_ROOT");
    expect(html).not.toContain("/does-not-exist-studium-v2");
  });
  it("rejects encoded traversal at the page boundary", async () => {
    await setup();
    await expect(ReviewPage({ params: { lesson: Buffer.from("../outside").toString("base64url") } })).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("explains a malformed lesson instead of claiming it is missing", async () => {
    const root = await setup();
    await writeFile(join(root, "course/lesson.json"), "{broken");
    const html = renderToStaticMarkup(await ReviewPage({ params: { lesson: encodeLessonRef("course") } }));
    expect(html).toContain("Leçon illisible");
    expect(html).toContain("lesson.json");
    expect(html).not.toContain("{broken");
  });
  it("does not offer an unsupported approval command for self-study", async () => {
    const root = await setup();
    const path = join(root, "course/lesson.json");
    const bundle = JSON.parse(await readFile(path, "utf8"));
    bundle.metadata.authoring = { mode: "self_study", author_is_learner: false, drafted_by: "agent" };
    await writeFile(path, JSON.stringify(bundle));
    const html = renderToStaticMarkup(await ReviewPage({ params: { lesson: encodeLessonRef("course") } }));
    expect(html).toContain("approve refuse ce mode");
    expect(html).not.toContain("experience_packet.py approve --bundle");
  });
  it("shows the review inbox sorted by consequence, without fingerprints, between the heading and the outline", async () => {
    const root = await setup();
    const path = join(root, "course/lesson.json");
    const bundle = JSON.parse(await readFile(path, "utf8"));
    bundle.scenes[3].title = "TODO blocking title";
    await writeFile(path, JSON.stringify(bundle));
    const html = renderToStaticMarkup(await ReviewPage({ params: { lesson: encodeLessonRef("course") } }));
    expect(html).toContain("Boîte de relecture");
    expect(html.indexOf("Boîte de relecture")).toBeLessThan(html.indexOf("Parcours de la leçon"));
    const blocking = html.indexOf(`data-item="${bundle.scenes[3].id}"`);
    const firstQuiz = html.indexOf(`data-item="${bundle.scenes[2].id}"`);
    // scenes[0] blocks too: setup() gives it evidence the schema refuses. scenes[1] is a plain concept.
    const intro = html.indexOf(`data-item="${bundle.scenes[1].id}"`);
    expect(blocking).toBeGreaterThan(0);
    expect(blocking).toBeLessThan(firstQuiz);
    expect(firstQuiz).toBeLessThan(intro);
    expect(html).toContain("aucun reçu antérieur");
    expect(html).toContain('role="status"');
    expect(html).toContain("experience_packet.py receipt --bundle");
    expect(html).not.toContain("--opened");
    expect(html).not.toMatch(/[0-9a-f]{64}/);
    expect(html).not.toContain("PRIVATE_");
  });
});

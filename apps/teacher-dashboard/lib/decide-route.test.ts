/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleDecision } from "./decide-route";

/** Generated per run: a test token is never a value written in the repository. */
const REVIEW_TOKEN = `test-${crypto.randomUUID()}-${crypto.randomUUID()}`;
const NOW = () => "2026-11-10T09:00:00.000Z";
const APPROVE = { course_id: "atomistique-l1", decision: "approve", reviewer_name: "Mme Curie" };

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3001/api/learner-items/it-1/decide", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3001", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("decision route handler (server side of a moderation decision)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ item_id: "it-1", review_state: "published" }),
    });
  });

  it("calls scene-synth with the bearer token, the typed reviewer and the server's time", async () => {
    vi.stubEnv("STUDIUM_REVIEW_TOKEN", REVIEW_TOKEN);
    const response = await handleDecision(request({ course_id: "atomistique-l1", decision: "approve", reviewer_name: " Mme Curie " }), "it-1", NOW);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(REVIEW_TOKEN);
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toBe("http://localhost:8002/learner-items/it-1/decide");
    expect(init.headers.Authorization).toBe(`Bearer ${REVIEW_TOKEN}`);
    expect(JSON.parse(init.body)).toEqual({
      decision: "approve",
      reviewer: "Mme Curie",
      reviewed_at: "2026-11-10T09:00:00.000Z",
    });
  });

  it("refuses with 503 and one line when the dashboard holds no review token", async () => {
    const response = await handleDecision(request(APPROVE), "it-1", NOW);
    expect(response.status).toBe(503);
    const { error } = await response.json();
    expect(error).toContain("STUDIUM_REVIEW_TOKEN");
    expect(error).not.toContain("\n");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ origin: "http://localhost:3000" }],
    [{ "sec-fetch-site": "same-site" }],
    [{ "sec-fetch-site": "cross-site" }],
    [{ origin: "null" }],
  ])("refuses a request from another origin (%o)", async (headers) => {
    vi.stubEnv("STUDIUM_REVIEW_TOKEN", REVIEW_TOKEN);
    const response = await handleDecision(request({ course_id: "atomistique-l1", decision: "approve" }, headers), "it-1", NOW);
    expect(response.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("accepts the dashboard's own origin", async () => {
    vi.stubEnv("STUDIUM_REVIEW_TOKEN", REVIEW_TOKEN);
    const headers = { origin: "http://localhost:3001", "sec-fetch-site": "same-origin" };
    const response = await handleDecision(request({ course_id: "atomistique-l1", decision: "reject", note_code: "off_topic" }, headers), "it-1", NOW);
    expect(response.status).toBe(200);
    expect(JSON.parse((global.fetch as any).mock.calls[0][1].body).note_code).toBe("off_topic");
  });

  it("refuses a non-JSON body (a cross-site form cannot post here) and malformed fields", async () => {
    vi.stubEnv("STUDIUM_REVIEW_TOKEN", REVIEW_TOKEN);
    const form = await handleDecision(request("decision=approve", { "content-type": "text/plain" }), "it-1", NOW);
    expect(form.status).toBe(415);
    for (const body of [
      { course_id: "atomistique-l1", decision: "publish" },
      { course_id: "../etc", decision: "approve" },
      { course_id: "atomistique-l1", decision: "reject", note_code: "free text" },
      { course_id: "atomistique-l1", decision: "approve", reviewer_name: "Mme Curie", reviewer: "self" },
      "not json",
    ]) {
      const response = await handleDecision(request(body), "it-1", NOW);
      if (typeof body === "object" && "reviewer" in body) {
        // extra fields are ignored: the reviewer is always set by the server
        expect(response.status).toBe(200);
        expect(JSON.parse((global.fetch as any).mock.calls.at(-1)[1].body).reviewer).toBe("Mme Curie");
      } else {
        expect(response.status).toBe(400);
      }
    }
  });

  it("relays a scene-synth refusal without the token", async () => {
    vi.stubEnv("STUDIUM_REVIEW_TOKEN", REVIEW_TOKEN);
    (global.fetch as any).mockResolvedValue({ ok: false, status: 401 });
    const response = await handleDecision(request(APPROVE), "it-1", NOW);
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).toContain("401");
    expect(text).not.toContain(REVIEW_TOKEN);
  });

  it.each([
    ["missing", undefined],
    ["blank", "   "],
    ["longer than 200 characters", "x".repeat(201)],
    ["with a control character", "Mme\u0007Curie"],
    ["an identifier", "urn:studium:teacher:atomistique-l1"],
    ["an identifier in capitals", " URN:x"],
  ])("refuses approve when the typed name is %s, before calling scene-synth", async (_label, name) => {
    vi.stubEnv("STUDIUM_REVIEW_TOKEN", REVIEW_TOKEN);
    const body: Record<string, unknown> = { course_id: "atomistique-l1", decision: "approve" };
    if (name !== undefined) body.reviewer_name = name;
    const response = await handleDecision(request(body), "it-1", NOW);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/^Décision refusée/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("accepts a 200-character name", async () => {
    vi.stubEnv("STUDIUM_REVIEW_TOKEN", REVIEW_TOKEN);
    const response = await handleDecision(request({ ...APPROVE, reviewer_name: "r".repeat(200) }), "it-1", NOW);
    expect(response.status).toBe(200);
  });

  it.each(["reject", "request_revision"])("%s uses the typed name when given, else the course IRI", async (decision) => {
    vi.stubEnv("STUDIUM_REVIEW_TOKEN", REVIEW_TOKEN);
    await handleDecision(request({ course_id: "atomistique-l1", decision, reviewer_name: "Mme Curie" }), "it-1", NOW);
    await handleDecision(request({ course_id: "atomistique-l1", decision }), "it-1", NOW);
    await handleDecision(request({ course_id: "atomistique-l1", decision, reviewer_name: "  " }), "it-1", NOW);
    const sent = (global.fetch as any).mock.calls.map((call: any) => JSON.parse(call[1].body).reviewer);
    expect(sent).toEqual(["Mme Curie", "urn:studium:teacher:atomistique-l1", "urn:studium:teacher:atomistique-l1"]);
    const bad = await handleDecision(request({ course_id: "atomistique-l1", decision, reviewer_name: "urn:x" }), "it-1", NOW);
    expect(bad.status).toBe(400);
  });

  it("refuses a reviewer_name that is not a string", async () => {
    vi.stubEnv("STUDIUM_REVIEW_TOKEN", REVIEW_TOKEN);
    const response = await handleDecision(request({ ...APPROVE, reviewer_name: 42 }), "it-1", NOW);
    expect(response.status).toBe(400);
  });
});

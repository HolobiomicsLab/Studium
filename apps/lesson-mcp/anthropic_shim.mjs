// anthropic_shim.mjs — minimal OpenAI-compatible /v1/chat/completions endpoint backed by the
// Anthropic Messages API. Lets Studium's runtime "litellm" LLM client (which POSTs
// {model: <alias>, messages:[{role,content}]} and reads choices[0].message.content) talk to
// Claude directly, with NO LiteLLM proxy and NO pip install. The alias is mapped to a real
// Claude model here. Reads ANTHROPIC_API_KEY from its own env (launch via `zsh -lic` so the
// key is sourced from ~/.zshrc and never printed on a command line).
//
//   PORT=8799 node anthropic_shim.mjs
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8799);
const MODEL = process.env.SHIM_MODEL ?? "claude-haiku-4-5-20251001"; // fast: classification + short Socratic moves
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { process.stderr.write("anthropic_shim: ANTHROPIC_API_KEY missing\n"); process.exit(1); }

// Claude may wrap JSON in prose/fences; the runtime parsers do JSON.parse(raw) directly, so
// extract the first balanced {...} object to maximize parse success.
function extractJson(s) {
  const start = s.indexOf("{");
  if (start < 0) return s.trim();
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return s.slice(start).trim();
}

createServer((req, res) => {
  if (req.method !== "POST" || !req.url.includes("/chat/completions")) { res.writeHead(404); return res.end("nope"); }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try {
      const { messages = [] } = JSON.parse(body || "{}");
      const prompt = messages.map((m) => m.content).join("\n");
      const ar = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: 512, temperature: 0, messages: [{ role: "user", content: prompt }] }),
      });
      if (!ar.ok) { const t = await ar.text(); process.stderr.write(`anthropic ${ar.status}: ${t}\n`); res.writeHead(502); return res.end(t); }
      const data = await ar.json();
      const raw = data.content?.map((b) => b.text ?? "").join("") ?? "";
      const content = extractJson(raw);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    } catch (e) {
      process.stderr.write(`shim error: ${String(e)}\n`);
      res.writeHead(500); res.end(String(e));
    }
  });
}).listen(PORT, "127.0.0.1", () => process.stderr.write(`anthropic_shim on http://127.0.0.1:${PORT} (model ${MODEL})\n`));

// critique_shim.mjs — semantic critique scorer for Studium's HttpCritiqueEvaluator.
// Serves POST http://localhost:8002/scenes/critique-eval  {claims, rubric, student_critique}
// → {score, feedback}, backed by the Anthropic Messages API (no LiteLLM proxy). The runtime's
// HttpCritiqueEvaluator hardcodes this URL; setting live mode (LITELLM_BASE_URL) makes the host
// wire it instead of the offline keyword matcher. Launch via `zsh -lic` so ANTHROPIC_API_KEY is
// sourced from ~/.zshrc and never printed.
//
//   PORT=8002 node critique_shim.mjs
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8002);
const MODEL = process.env.SHIM_MODEL ?? "claude-haiku-4-5-20251001";
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { process.stderr.write("critique_shim: ANTHROPIC_API_KEY missing\n"); process.exit(1); }

function extractJson(s) {
  const i = s.indexOf("{"); if (i < 0) return s.trim();
  let d = 0;
  for (let j = i; j < s.length; j++) { if (s[j] === "{") d++; else if (s[j] === "}") { d--; if (!d) return s.slice(i, j + 1); } }
  return s.slice(i);
}

function buildPrompt({ claims = [], rubric = {}, student_critique = "" }) {
  const lines = claims.map((c, i) =>
    `- claim-${i + 1}: "${c.text}"\n  intended flaws: ${JSON.stringify(c.flaws_expected ?? [])}`).join("\n");
  return `Tu corriges la critique d'un étudiant face à des affirmations DÉLIBÉRÉMENT erronées d'un tuteur IA.
Pour chaque affirmation, les défauts attendus sont listés. Évalue SÉMANTIQUEMENT (pas par mots-clés)
dans quelle mesure la critique de l'étudiant identifie et réfute correctement ces défauts.

AFFIRMATIONS (fausses) :
${lines}

Barème (poids): ${JSON.stringify(rubric)}

CRITIQUE DE L'ÉTUDIANT :
"""${student_critique}"""

Donne un score global de 0.0 à 1.0 (fraction des défauts correctement identifiés/réfutés, pondérée par
la justesse) et un retour bref (1–3 phrases, en français), nommant tout défaut manqué ou toute erreur.
Réponds en JSON STRICT : {"score": <0..1>, "feedback": "<...>"}`;
}

createServer((req, res) => {
  if (req.method !== "POST" || !req.url.includes("/scenes/critique-eval")) { res.writeHead(404); return res.end("nope"); }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try {
      const input = JSON.parse(body || "{}");
      const ar = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: 512, temperature: 0, messages: [{ role: "user", content: buildPrompt(input) }] }),
      });
      if (!ar.ok) { const t = await ar.text(); process.stderr.write(`anthropic ${ar.status}: ${t}\n`); res.writeHead(502); return res.end(t); }
      const data = await ar.json();
      const raw = data.content?.map((b) => b.text ?? "").join("") ?? "";
      const parsed = JSON.parse(extractJson(raw));
      const score = Math.max(0, Math.min(1, Number(parsed.score)));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ score, feedback: String(parsed.feedback ?? "") }));
    } catch (e) {
      process.stderr.write(`critique_shim error: ${String(e)}\n`);
      res.writeHead(500); res.end(String(e));
    }
  });
}).listen(PORT, "127.0.0.1", () => process.stderr.write(`critique_shim on http://127.0.0.1:${PORT}/scenes/critique-eval (model ${MODEL})\n`));

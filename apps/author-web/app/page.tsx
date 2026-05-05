"use client";
import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ingestCorpus, generatePlan, type PlanResponse } from "@/lib/api";

export default function UploadPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const fd = new FormData(e.currentTarget);
      const pdf = fd.get("pdf") as File;
      const bib = fd.get("bib") as File | null;
      const target = fd.get("target") as string;
      const keywords = fd.get("keywords") as string;

      if (!pdf || pdf.size === 0) throw new Error("Un fichier PDF est requis.");

      const manifest = await ingestCorpus(pdf, target, bib?.size ? bib : undefined, keywords || undefined);
      const planResp: PlanResponse = await generatePlan(manifest);

      // Store in sessionStorage for the editor page
      sessionStorage.setItem("plan_response", JSON.stringify(planResp));
      router.push(`/plan/${planResp.lesson_plan.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>Nouveau cours</h2>
      <p style={{ color: "#555" }}>
        Importez votre corpus (PDF + BibTeX optionnel) pour générer un plan pédagogique.
      </p>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 500 }}>
        <label>
          Fichier PDF *
          <input name="pdf" type="file" accept=".pdf" required style={{ display: "block", marginTop: 4 }} />
        </label>
        <label>
          Bibliographie BibTeX (optionnel)
          <input name="bib" type="file" accept=".bib" style={{ display: "block", marginTop: 4 }} />
        </label>
        <label>
          Niveau cible *
          <input name="target" type="text" placeholder="ex: L3, M1, PhD" required defaultValue="L3"
            style={{ display: "block", marginTop: 4, padding: "4px 8px", width: "100%" }} />
        </label>
        <label>
          Mots-clés (optionnel)
          <input name="keywords" type="text" placeholder="ex: metabolomics, LC-MS"
            style={{ display: "block", marginTop: 4, padding: "4px 8px", width: "100%" }} />
        </label>
        <button type="submit" disabled={loading}
          style={{ padding: "8px 16px", background: "#0070f3", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
          {loading ? "Génération en cours…" : "Générer le plan"}
        </button>
        {error && <p style={{ color: "red" }}>{error}</p>}
      </form>
    </div>
  );
}
